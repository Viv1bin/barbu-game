import {
  applyMatchAction,
  autoAction,
  createMatch,
  currentActor,
  redactState,
  trickWinner,
  type Action,
  type ClientMsg,
  type Difficulty,
  type MancheLog,
  type MatchState,
  type PlayerId,
  type SeatInfo,
  type ServerMsg,
  type TrickPause,
} from '@barbu/engine';

/** Délais d'animation (mutables : les tests les mettent à 0 pour accélérer). */
export const TIMING = { botDelay: 650, pauseMs: 1400 };
const DEFAULT_LEVEL: Difficulty = 'difficile';
const SEATS: PlayerId[] = [0, 1, 2, 3];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** PRNG déterministe (mulberry32) — même implémentation que le client. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Occupant interne d'un siège (le serveur est la seule autorité). */
interface Seat {
  kind: 'human' | 'bot' | 'open';
  profileId?: string;
  name?: string;
  avatar?: string;
  level: Difficulty;
  connId?: string; // connexion active si un humain est présent
}

/** Connexion minimale dont la salle a besoin : un identifiant et un envoi. */
export interface Conn {
  id: string;
  send(data: string): void;
}

/** Hôte de la salle : identité (code de partie) + accès aux connexions vivantes. */
export interface RoomHost {
  readonly id: string;
  getConnections(): Iterable<Conn>;
}

/**
 * Une salle = une instance. Le serveur détient l'unique MatchState, valide
 * chaque action via le moteur pur, pilote les bots, et diffuse à chaque joueur
 * une vue caviardée (sa main + tailles adverses). Anti-triche natif.
 *
 * Logique agnostique du transport : `RoomHost` fournit l'identité et les
 * connexions, `Conn` l'envoi. L'adaptateur (partyserver) et les tests injectent
 * leur propre implémentation.
 */
export class GameRoom {
  seats: Seat[] = SEATS.map(() => ({ kind: 'open', level: DEFAULT_LEVEL }));
  hostId: string | null = null;
  match: MatchState | null = null;
  history: MancheLog[] = [];
  started = false;
  rng = mulberry((Math.random() * 2 ** 32) >>> 0);

  // Sérialise toutes les mutations d'état : évite les courses entre actions
  // humaines et coups de bots (qui s'exécutent avec des délais).
  private chain: Promise<void> = Promise.resolve();

  constructor(private room: RoomHost) {}

  private run(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch((e) => console.error('[barbu]', e));
    return this.chain;
  }

  onConnect(conn: Conn) {
    // Le profil est inconnu jusqu'au JOIN → on envoie un instantané du lobby.
    this.sendMsg(conn, this.lobbyMsg(null));
  }

  onMessage(raw: string, sender: Conn) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'JOIN':
        return void this.run(async () => this.handleJoin(sender, msg));
      case 'SEAT':
        return void this.run(async () => this.handleSeat(sender, msg));
      case 'START':
        return void this.run(async () => this.handleStart(sender));
      case 'ACTION':
        return void this.run(async () => this.handleAction(sender, msg.action)).then(() => this.tick());
      case 'NEW_GAME':
        return void this.run(async () => this.handleNewGame(sender)).then(() => this.tick());
      case 'LEAVE':
        return void this.run(async () => this.detach(sender.id));
    }
  }

  onClose(conn: Conn) {
    void this.run(async () => this.detach(conn.id));
  }

  // -- Lobby -----------------------------------------------------------------

  private handleJoin(sender: Conn, msg: Extract<ClientMsg, { t: 'JOIN' }>) {
    if (this.hostId === null) this.hostId = msg.profileId;

    // Reconnexion : un siège porte déjà ce profil → on réattache la connexion.
    const existing = this.seats.findIndex((s) => s.profileId === msg.profileId);
    if (existing >= 0) {
      this.seats[existing]!.connId = sender.id;
      this.seats[existing]!.kind = 'human';
    } else if (!this.started) {
      const free = this.seats.findIndex((s) => s.kind === 'open');
      if (free >= 0) {
        this.seats[free] = {
          kind: 'human',
          profileId: msg.profileId,
          name: msg.name,
          avatar: msg.avatar,
          level: DEFAULT_LEVEL,
          connId: sender.id,
        };
      }
      // sinon : salle pleine → spectateur (aucun siège).
    }
    // Partie en cours et pas de siège correspondant → spectateur.
    this.broadcast();
  }

  private handleSeat(sender: Conn, msg: Extract<ClientMsg, { t: 'SEAT' }>) {
    if (!this.isHost(sender) || this.started) return this.sendError(sender, 'Action réservée à l\'hôte, avant le début.');
    const seat = this.seats[msg.seat];
    if (!seat || seat.kind === 'human') return this.sendError(sender, 'Siège occupé par un joueur.');
    if (msg.kind === 'bot') {
      this.seats[msg.seat] = { kind: 'bot', name: `Bot ${msg.seat + 1}`, avatar: '🤖', level: msg.level ?? DEFAULT_LEVEL };
    } else {
      this.seats[msg.seat] = { kind: 'open', level: DEFAULT_LEVEL };
    }
    this.broadcast();
  }

  private handleStart(sender: Conn) {
    if (!this.isHost(sender)) return this.sendError(sender, 'Seul l\'hôte peut démarrer.');
    if (this.started) return;
    if (this.seats.some((s) => s.kind === 'open')) return this.sendError(sender, 'Des sièges sont encore vides.');
    this.started = true;
    this.history = [];
    this.match = createMatch(this.rng);
    this.broadcast();
    this.tick();
  }

  private handleNewGame(sender: Conn) {
    if (!this.isHost(sender)) return this.sendError(sender, 'Seul l\'hôte peut relancer.');
    if (!this.match || this.match.phase !== 'DONE') return;
    this.history = [];
    this.match = createMatch(this.rng);
    this.broadcast();
  }

  // -- Jeu -------------------------------------------------------------------

  private async handleAction(sender: Conn, action: Action) {
    if (!this.match || this.match.phase === 'DONE') return this.sendError(sender, 'Aucune partie en cours.');
    const seat = this.seatOfConn(sender.id);
    if (seat === null) return this.sendError(sender, 'Vous n\'êtes pas assis à cette table.');
    if (currentActor(this.match) !== seat) return this.sendError(sender, 'Ce n\'est pas votre tour.');
    if ('player' in action && action.player !== seat) return this.sendError(sender, 'Action invalide.');
    try {
      await this.applyAction(action);
    } catch {
      this.sendError(sender, 'Coup illégal.');
    }
  }

  /** Un coup de bot à la fois ; se relance tant que c'est à un siège piloté. */
  private tick() {
    void this.run(async () => {
      if (!this.match || this.match.phase === 'DONE') return;
      const actor = currentActor(this.match);
      if (actor === null) return;
      const seat = this.seats[actor]!;
      if (!this.botControlled(seat)) return; // au tour d'un humain : on attend
      await sleep(TIMING.botDelay);
      if (!this.match || currentActor(this.match) !== actor) return void this.tick();
      const action = autoAction(this.match, this.rng, seat.level);
      await this.applyAction(action);
      this.tick();
    });
  }

  /** Applique une action, journalise la manche, gère la pause d'un pli, diffuse. */
  private async applyAction(action: Action) {
    const m = this.match!;
    let pause: TrickPause | null = null;
    const r = m.round;
    if (m.phase === 'PLAY' && r && 'currentTrick' in r && action.t === 'PLAY_CARD' && r.currentTrick.length === 3) {
      const trick = [...r.currentTrick, { player: action.player, card: action.card }];
      pause = { trick, winner: trickWinner(trick).player };
    }
    const next = applyMatchAction(m, action, this.rng);
    if (next.mancheCount > m.mancheCount && m.currentContract) {
      this.history.push({
        dealer: m.dealer,
        contract: m.currentContract,
        contres: m.contres,
        points: next.scores.map((sc, p) => sc - m.scores[p]!),
      });
    }
    this.match = next;
    this.broadcast(pause);
    if (pause) {
      await sleep(TIMING.pauseMs);
      this.broadcast(null); // pli ramassé → état suivant
    }
  }

  // -- Diffusion -------------------------------------------------------------

  private broadcast(pause: TrickPause | null = null) {
    for (const conn of this.room.getConnections()) {
      const seat = this.seatOfConn(conn.id);
      this.sendMsg(conn, this.started && this.match ? this.viewMsg(seat, pause) : this.lobbyMsg(seat));
    }
  }

  private viewMsg(seat: PlayerId | null, pause: TrickPause | null): ServerMsg {
    // Spectateur (seat null) : perspective -1 → aucune main révélée.
    const view = redactState(this.match!, seat ?? (-1 as PlayerId));
    return { t: 'VIEW', view, seats: this.seatInfos(), youSeat: seat, history: this.history, pause };
  }

  private lobbyMsg(seat: PlayerId | null): ServerMsg {
    return { t: 'LOBBY', code: this.room.id, seats: this.seatInfos(), hostId: this.hostId, youSeat: seat, started: this.started };
  }

  private seatInfos(): SeatInfo[] {
    return this.seats.map((s, i) => ({
      seat: i as PlayerId,
      kind: s.kind,
      name: s.name,
      avatar: s.avatar,
      level: s.kind === 'bot' ? s.level : undefined,
      connected: s.kind === 'human' ? !!s.connId : undefined,
    }));
  }

  // -- Helpers ---------------------------------------------------------------

  private seatOfConn(connId: string): PlayerId | null {
    const i = this.seats.findIndex((s) => s.connId === connId);
    return i >= 0 ? (i as PlayerId) : null;
  }

  private isHost(conn: Conn): boolean {
    const seat = this.seatOfConn(conn.id);
    return seat !== null && this.seats[seat]!.profileId === this.hostId;
  }

  private botControlled(seat: Seat): boolean {
    return seat.kind === 'bot' || (seat.kind === 'human' && !seat.connId);
  }

  /** Un humain se déconnecte : son siège reste réservé, joué par un bot en attendant. */
  private detach(connId: string) {
    const seat = this.seatOfConn(connId);
    if (seat === null) return;
    this.seats[seat]!.connId = undefined;
    if (!this.started) {
      // Avant le début : le siège se libère complètement.
      this.seats[seat] = { kind: 'open', level: DEFAULT_LEVEL };
    }
    this.broadcast();
    this.tick(); // au cas où c'était son tour → un bot prend le relais
  }

  private sendMsg(conn: Conn, msg: ServerMsg) {
    conn.send(JSON.stringify(msg));
  }

  private sendError(conn: Conn, msg: string) {
    this.sendMsg(conn, { t: 'ERROR', msg });
  }
}

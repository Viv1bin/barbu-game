import {
  applyMatchAction,
  autoAction,
  createMatch,
  normalizeMatchOptions,
  DEFAULT_MATCH_OPTIONS,
  type MatchOptions,
  currentActor,
  redactState,
  trickWinner,
  type Account,
  type Action,
  type ClientMsg,
  type Difficulty,
  type GameResultEntry,
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
  /**
   * Résout un token de session en compte. **Seule** source d'identité de la
   * salle : le client ne déclare jamais qui il est. Renvoie null si le token est
   * absent, invalide ou expiré.
   */
  resolveAccount(token: string): Promise<Account | null>;
  /** Début d'une partie (comptes humains) → historique des parties en ligne. */
  reportStart?(matchId: string, code: string, accountIds: string[]): void;
  /** Résultat d'une partie terminée (comptes humains + scores) → stats en ligne. */
  reportResult?(matchId: string, entries: GameResultEntry[]): void;
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
  /** Options de la partie, fixées par l'hôte au démarrage. */
  options: MatchOptions = DEFAULT_MATCH_OPTIONS;
  /**
   * Identifiant de la partie en cours dans l'historique. Une salle peut en
   * enchaîner plusieurs (« Rejouer ») : chacune a le sien, la salle garde son code.
   */
  matchId: string | null = null;
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
        return void this.run(async () => this.handleStart(sender, msg));
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

  private async handleJoin(sender: Conn, msg: Extract<ClientMsg, { t: 'JOIN' }>) {
    // Identité prouvée par le token, jamais déclarée : sans ça, n'importe qui
    // pourrait se présenter avec l'id d'un autre et récupérer son siège (donc sa main).
    const token = typeof msg.token === 'string' ? msg.token : '';
    const account = token ? await this.room.resolveAccount(token) : null;
    if (!account) return this.sendError(sender, 'Session expirée : reconnecte-toi.');

    if (this.hostId === null) this.hostId = account.id;

    // Reconnexion : un siège porte déjà ce compte → on réattache la connexion.
    const existing = this.seats.findIndex((s) => s.profileId === account.id);
    if (existing >= 0) {
      this.seats[existing]!.connId = sender.id;
      this.seats[existing]!.kind = 'human';
      // Le profil peut avoir changé entre-temps (pseudo / avatar).
      this.seats[existing]!.name = account.pseudo;
      this.seats[existing]!.avatar = account.avatar;
    } else if (!this.started) {
      const free = this.seats.findIndex((s) => s.kind === 'open');
      if (free >= 0) {
        this.seats[free] = {
          kind: 'human',
          profileId: account.id,
          name: account.pseudo,
          avatar: account.avatar,
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
      this.seats[msg.seat] = { kind: 'bot', name: `Bot ${msg.seat + 1}`, avatar: 'bot', level: msg.level ?? DEFAULT_LEVEL };
    } else {
      this.seats[msg.seat] = { kind: 'open', level: DEFAULT_LEVEL };
    }
    this.broadcast();
  }

  private handleStart(sender: Conn, msg: Extract<ClientMsg, { t: 'START' }>) {
    if (!this.isHost(sender)) return this.sendError(sender, 'Seul l\'hôte peut démarrer.');
    if (this.started) return;
    if (this.seats.some((s) => s.kind === 'open')) return this.sendError(sender, 'Des sièges sont encore vides.');
    // Les options viennent de l'hôte : on les renormalise avant de s'en servir.
    this.options = normalizeMatchOptions(msg.options);
    this.started = true;
    this.history = [];
    this.match = createMatch(this.rng, this.options);
    this.reportGameStart();
    this.broadcast();
    this.tick();
  }

  private handleNewGame(sender: Conn) {
    if (!this.isHost(sender)) return this.sendError(sender, 'Seul l\'hôte peut relancer.');
    if (!this.match || this.match.phase !== 'DONE') return;
    this.history = [];
    this.match = createMatch(this.rng, this.options);
    this.reportGameStart();
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
    if (m.phase !== 'DONE' && next.phase === 'DONE') this.reportGameEnd(next);
    this.match = next;
    this.broadcast(pause);
    if (pause) {
      await sleep(TIMING.pauseMs);
      this.broadcast(null); // pli ramassé → état suivant
    }
  }

  /** Début de partie : ouvre l'entrée d'historique et retient son identifiant. */
  private reportGameStart() {
    this.matchId = `${this.room.id}:${Date.now()}`;
    const accountIds = this.seats.filter((s) => s.kind === 'human' && s.profileId).map((s) => s.profileId!);
    if (accountIds.length >= 2) this.room.reportStart?.(this.matchId, this.room.id, accountIds);
  }

  /** Fin de partie : remonte les scores finaux des sièges humains (comptes). */
  private reportGameEnd(final: MatchState) {
    const entries: GameResultEntry[] = [];
    this.seats.forEach((s, p) => {
      if (s.kind === 'human' && s.profileId) entries.push({ accountId: s.profileId, score: final.scores[p]! });
    });
    if (entries.length >= 2 && this.matchId) this.room.reportResult?.(this.matchId, entries);
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
    return {
      t: 'LOBBY',
      code: this.room.id,
      seats: this.seatInfos(),
      hostId: this.hostId,
      youSeat: seat,
      started: this.started,
      options: this.options,
    };
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

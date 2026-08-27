import {
  applyMatchAction,
  autoAction,
  createMatch,
  normalizeMatchOptions,
  totalManches,
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
  type RoomHalt,
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
  /**
   * Compte titulaire du siège. Conservé même quand l'hôte fait reprendre le
   * siège par un bot : le joueur qui revient le récupère au JOIN suivant.
   */
  profileId?: string;
  name?: string;
  avatar?: string;
  level: Difficulty;
  connId?: string; // connexion active si un humain est présent
}

/**
 * État persistant d'une salle. Une Durable Object est évincée dès que plus
 * personne n'est connecté : sans ça, revenir sur le code d'une partie en cours
 * retombait sur une salle vierge (donc l'écran de configuration).
 */
export interface RoomSnapshot {
  v: 1;
  /** Sièges sans `connId` : toutes les connexions sont mortes à la restauration. */
  seats: Omit<Seat, 'connId'>[];
  /** Créateur de la salle. Absent des instantanés v1 d'avant la propriété. */
  ownerId?: string | null;
  hostId: string | null;
  started: boolean;
  paused: boolean;
  options: MatchOptions;
  match: MatchState | null;
  history: MancheLog[];
  matchId: string | null;
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
  reportStart?(matchId: string, code: string, accountIds: string[], ownerId: string | null, totalManches: number): void;
  /** Manches terminées → avancement affiché dans « Parties en cours ». */
  reportProgress?(matchId: string, manches: number): void;
  /** Pause de l'hôte → « à reprendre » plutôt que « à rejoindre » au menu. */
  reportPaused?(matchId: string, paused: boolean): void;
  /** Résultat d'une partie terminée (comptes humains + scores) → stats en ligne. */
  reportResult?(matchId: string, entries: GameResultEntry[]): void;
  /** Relit l'état de la salle au réveil de l'instance (null si aucune partie). */
  loadState?(): Promise<RoomSnapshot | null>;
  /** Écrit l'état après chaque mutation (reprise après éviction). */
  saveState?(snapshot: RoomSnapshot): void;
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
  /**
   * Créateur de la salle : propriétaire définitif. Distinct de `hostId`, qui est
   * l'hôte *effectif* — le rôle passe temporairement à un autre joueur quand le
   * créateur n'est pas connecté, sinon une salle qu'il a quittée serait bloquée.
   * Il le récupère automatiquement dès qu'il revient.
   */
  ownerId: string | null = null;
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
  /** Pause décidée par l'hôte (les absences suspendent la partie séparément). */
  paused = false;
  /** Demandes de pause en attente de confirmation de l'hôte. */
  asks: PlayerId[] = [];
  rng = mulberry((Math.random() * 2 ** 32) >>> 0);

  // Sérialise toutes les mutations d'état : évite les courses entre actions
  // humaines et coups de bots (qui s'exécutent avec des délais).
  private chain: Promise<void> = Promise.resolve();

  constructor(private room: RoomHost) {
    // Première tâche de la chaîne : tout message reçu entre-temps sera traité
    // après, donc sur l'état restauré.
    if (room.loadState) {
      void this.run(async () => {
        const snap = await room.loadState!();
        if (snap && snap.v === 1) this.restore(snap);
      });
    }
  }

  private restore(snap: RoomSnapshot) {
    this.seats = snap.seats.map((s) => ({ ...s })); // connId absent : personne n'est connecté
    // Instantané écrit avant la notion de propriétaire : l'hôte enregistré en
    // tenait lieu, on le promeut plutôt que de laisser la salle sans créateur.
    this.ownerId = snap.ownerId ?? snap.hostId;
    this.hostId = snap.hostId;
    this.started = snap.started;
    this.paused = snap.paused;
    this.options = snap.options;
    this.match = snap.match;
    this.history = snap.history;
    this.matchId = snap.matchId;
    this.asks = [];
  }

  private snapshot(): RoomSnapshot {
    return {
      v: 1,
      seats: this.seats.map(({ connId: _connId, ...rest }) => rest),
      ownerId: this.ownerId,
      hostId: this.hostId,
      started: this.started,
      paused: this.paused,
      options: this.options,
      match: this.match,
      history: this.history,
      matchId: this.matchId,
    };
  }

  private run(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch((e) => console.error('[barbu]', e));
    return this.chain;
  }

  onConnect(conn: Conn) {
    // Le profil est inconnu jusqu'au JOIN → on envoie un instantané du lobby.
    // Passé par la chaîne : la restauration de l'état doit avoir eu lieu, sinon
    // un client qui revient sur une partie en cours verrait une salle vierge.
    void this.run(async () => this.sendMsg(conn, this.lobbyMsg(null)));
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
      case 'PAUSE':
        return void this.run(async () => this.handlePause(sender, true));
      case 'RESUME':
        return void this.run(async () => this.handlePause(sender, false)).then(() => this.tick());
      case 'FILL_BOT':
        return void this.run(async () => this.handleFillBot(sender, msg)).then(() => this.tick());
      case 'ASK_PAUSE':
        return void this.run(async () => this.handleAskPause(sender));
      case 'DENY_PAUSE':
        return void this.run(async () => this.handleDenyPause(sender));
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

    // Le premier arrivé crée la salle et en reste le propriétaire. S'il revient
    // après une coupure, il reprend la main : sans ça, un simple retour au menu
    // ou un écran verrouillé lui faisait perdre l'administration pour de bon.
    if (this.ownerId === null) this.ownerId = account.id;
    if (this.hostId === null || account.id === this.ownerId) this.hostId = account.id;

    // Reconnexion : un siège porte déjà ce compte → on réattache la connexion.
    const existing = this.seats.findIndex((s) => s.profileId === account.id);
    if (existing >= 0) {
      this.seats[existing]!.connId = sender.id;
      // Reprend son siège même si l'hôte l'avait confié à un bot le temps de
      // son absence : le compte reste le titulaire.
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
    this.tick(); // le retour d'un absent peut relancer la partie
  }

  private handleSeat(sender: Conn, msg: Extract<ClientMsg, { t: 'SEAT' }>) {
    if (!this.isHost(sender) || this.started) return this.sendError(sender, 'Action réservée à l\'hôte, avant le début.');
    const seat = this.seats[msg.seat];
    // Un siège humain **connecté** est intouchable ; s'il est déconnecté, l'hôte
    // peut le libérer ou y mettre un bot — sinon un joueur parti avant le début
    // bloquerait la salle, faute de siège « ouvert » à remplir.
    if (!seat || (seat.kind === 'human' && seat.connId)) return this.sendError(sender, 'Siège occupé par un joueur.');
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
    this.paused = false;
    this.asks = [];
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

  // -- Administration de la partie (hôte) ------------------------------------

  /** Pause / reprise : décision de l'hôte seul, à tout moment de la partie. */
  private handlePause(sender: Conn, paused: boolean) {
    if (!this.isHost(sender)) return this.sendError(sender, 'Seul l\'hôte peut mettre en pause.');
    if (!this.started) return;
    this.paused = paused;
    this.asks = []; // la décision de l'hôte tranche les demandes en attente
    // L'historique distingue une partie mise en pause d'une partie qu'on a
    // seulement quittée : la première se reprend, la seconde se rejoint.
    if (this.matchId) this.room.reportPaused?.(this.matchId, paused);
    this.broadcast();
  }

  /** Un joueur suggère une pause ; elle ne prend effet que si l'hôte confirme. */
  private handleAskPause(sender: Conn) {
    const seat = this.seatOfConn(sender.id);
    if (seat === null || !this.started || this.paused) return;
    if (!this.asks.includes(seat)) this.asks.push(seat);
    this.broadcast();
  }

  /** L'hôte refuse les demandes en attente (ou un joueur retire la sienne). */
  private handleDenyPause(sender: Conn) {
    const seat = this.seatOfConn(sender.id);
    if (seat === null) return;
    this.asks = this.isHost(sender) ? [] : this.asks.filter((p) => p !== seat);
    this.broadcast();
  }

  /**
   * Remplacement d'un joueur absent par un bot. **Seul** l'hôte peut le faire :
   * une déconnexion ne met jamais un bot à la place toute seule, elle suspend la
   * partie le temps que le joueur revienne.
   */
  private handleFillBot(sender: Conn, msg: Extract<ClientMsg, { t: 'FILL_BOT' }>) {
    if (!this.isHost(sender)) return this.sendError(sender, 'Action réservée à l\'hôte.');
    const seat = this.seats[msg.seat];
    if (!seat || seat.kind !== 'human') return;
    if (seat.connId) return this.sendError(sender, 'Ce joueur est connecté.');
    // `profileId` est conservé : s'il revient, il retrouve son siège au JOIN.
    this.seats[msg.seat] = {
      kind: 'bot',
      profileId: seat.profileId,
      name: `Bot ${msg.seat + 1}`,
      avatar: 'bot',
      level: msg.level ?? DEFAULT_LEVEL,
    };
    this.broadcast();
  }

  /** Sièges humains sans connexion : la partie ne peut pas avancer sans eux. */
  private absentSeats(): PlayerId[] {
    if (!this.started) return [];
    const out: PlayerId[] = [];
    this.seats.forEach((s, i) => {
      if (s.kind === 'human' && !s.connId) out.push(i as PlayerId);
    });
    return out;
  }

  /** Partie suspendue : pause de l'hôte, ou au moins un joueur absent. */
  private halted(): boolean {
    return this.paused || this.absentSeats().length > 0;
  }

  // -- Jeu -------------------------------------------------------------------

  private async handleAction(sender: Conn, action: Action) {
    if (!this.match || this.match.phase === 'DONE') return this.sendError(sender, 'Aucune partie en cours.');
    if (this.halted()) return this.sendError(sender, 'Partie en pause.');
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
      if (this.halted()) return; // pause de l'hôte ou joueur absent : rien ne bouge
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
      // Une manche de plus : l'historique affiche l'avancement de la partie.
      if (this.matchId) this.room.reportProgress?.(this.matchId, next.mancheCount);
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
    if (accountIds.length >= 2) {
      this.room.reportStart?.(this.matchId, this.room.id, accountIds, this.ownerId, totalManches(this.options));
    }
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
    // Toute diffusion suit une mutation : c'est le point unique de sauvegarde.
    this.room.saveState?.(this.snapshot());
    for (const conn of this.room.getConnections()) {
      const seat = this.seatOfConn(conn.id);
      this.sendMsg(conn, this.started && this.match ? this.viewMsg(seat, pause) : this.lobbyMsg(seat));
    }
  }

  private halt(): RoomHalt {
    return { paused: this.paused, absent: this.absentSeats(), asks: [...this.asks] };
  }

  private viewMsg(seat: PlayerId | null, pause: TrickPause | null): ServerMsg {
    // Spectateur (seat null) : perspective -1 → aucune main révélée.
    const view = redactState(this.match!, seat ?? (-1 as PlayerId));
    return {
      t: 'VIEW',
      view,
      seats: this.seatInfos(),
      youSeat: seat,
      hostId: this.hostId,
      history: this.history,
      pause,
      halt: this.halt(),
    };
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
      halt: this.halt(),
    };
  }

  private seatInfos(): SeatInfo[] {
    return this.seats.map((s, i) => ({
      seat: i as PlayerId,
      kind: s.kind,
      profileId: s.kind === 'human' ? s.profileId : undefined,
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
    return seat.kind === 'bot';
  }

  /**
   * Un humain se déconnecte : son siège lui reste réservé et la partie se
   * suspend. Aucun bot ne prend sa place — il faut que l'hôte le décide
   * (`FILL_BOT`), ou que le joueur revienne.
   */
  private detach(connId: string) {
    const seat = this.seatOfConn(connId);
    if (seat === null) return;
    this.seats[seat]!.connId = undefined;
    this.asks = this.asks.filter((p) => p !== seat);
    // Le siège reste au compte, y compris dans le salon : une coupure d'une
    // seconde ne doit pas coûter sa place. C'est l'hôte qui libère un siège
    // resté vide (`SEAT`), personne d'autre.
    // L'hôte s'en va : sans passation, plus personne ne pourrait reprendre la
    // partie ni remplacer un absent. On transmet au premier humain connecté.
    if (this.seats[seat]!.profileId === this.hostId) this.migrateHost();
    this.broadcast();
  }

  /**
   * Transfère le rôle d'hôte si son titulaire n'est plus connecté : intérim, pas
   * dépossession — le créateur le reprend à son prochain JOIN.
   */
  private migrateHost() {
    const holder = this.seats.find((s) => s.profileId === this.hostId);
    if (holder?.connId) return; // l'hôte est encore là
    const owner = this.seats.find((s) => s.profileId === this.ownerId && s.connId);
    const next = owner ?? this.seats.find((s) => s.kind === 'human' && s.connId && s.profileId);
    if (next) this.hostId = next.profileId!;
  }

  private sendMsg(conn: Conn, msg: ServerMsg) {
    conn.send(JSON.stringify(msg));
  }

  private sendError(conn: Conn, msg: string) {
    this.sendMsg(conn, { t: 'ERROR', msg });
  }
}

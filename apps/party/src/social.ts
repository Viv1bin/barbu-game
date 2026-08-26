// Logique sociale (amis, stats, présence, sauvegarde solo), agnostique du runtime
// — même approche que `auth.ts` : logique pure sur une abstraction `SocialDB`,
// testable sans Durable Object. L'authentification est faite en amont : toutes les
// méthodes reçoivent l'`accountId` déjà résolu depuis le token.
import type {
  FriendRequestInfo,
  GameResultEntry,
  PlayerStats,
  PublicProfile,
  SavedGame,
  SocialSnapshot,
} from '@barbu/engine';

/** Au-delà de ce délai sans « ping », un compte est considéré hors ligne. */
const ONLINE_WINDOW_MS = 70_000;

/**
 * Taille maximale d'une sauvegarde solo, sérialisée. Une partie réelle pèse
 * quelques kilo-octets ; la borne empêche un compte de faire enfler le SQLite
 * du Durable Object, qui est partagé par tous les joueurs.
 */
export const MAX_SAVED_GAME_BYTES = 64 * 1024;

// --- Modèle de stockage --------------------------------------------------

/** Ligne de stats telle que persistée. */
export interface StatsRow {
  accountId: string;
  games: number;
  wins: number;
  totalPoints: number;
  bestScore: number | null;
}

/** Abstraction de persistance sociale. Impl SQLite (DO) ou en mémoire (tests). */
export interface SocialDB {
  findByPseudoLower(pseudoLower: string): PublicProfile | undefined;
  findById(id: string): PublicProfile | undefined;

  friendIds(id: string): string[];
  areFriends(a: string, b: string): boolean;
  addFriendship(a: string, b: string): void;
  removeFriendship(a: string, b: string): void;

  requestExists(from: string, to: string): boolean;
  addRequest(from: string, to: string): void;
  removeRequest(from: string, to: string): void;
  /** Ids des expéditeurs de demandes reçues par `id`. */
  incomingRequests(id: string): string[];
  /** Ids des destinataires des demandes envoyées par `id`. */
  outgoingRequests(id: string): string[];

  stats(id: string): StatsRow | undefined;
  saveStats(row: StatsRow): void;

  /** Parties solo sauvegardées d'un compte, plus récente d'abord. */
  listSavedGames(accountId: string): SavedGame[];
  getSavedGame(accountId: string, gameId: string): SavedGame | undefined;
  putSavedGame(accountId: string, gameId: string, state: unknown): void;
  deleteSavedGame(accountId: string, gameId: string): void;

  /** Marque `id` comme actif « maintenant ». */
  touchPresence(id: string): void;
  /** Dernière activité de `id` (epoch ms), ou undefined si jamais vu. */
  presence(id: string): number | undefined;
}

/** Erreur métier : message affichable + code HTTP. */
export class SocialError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'SocialError';
  }
}

const EMPTY_STATS: PlayerStats = { games: 0, wins: 0, totalPoints: 0, bestScore: null };

/** Valide l'identifiant de partie fourni par le client (non vide, longueur bornée). */
function gameKey(gameId: unknown): string {
  const g = typeof gameId === 'string' ? gameId.trim() : '';
  if (!g || g.length > 64) throw new SocialError('Identifiant de partie invalide.');
  return g;
}

// --- Logique métier ------------------------------------------------------

export class SocialLogic {
  constructor(
    private db: SocialDB,
    private now: () => number = () => Date.now(),
  ) {}

  private isOnline(id: string): boolean {
    const t = this.db.presence(id);
    return t != null && this.now() - t < ONLINE_WINDOW_MS;
  }

  private statsFor(id: string): PlayerStats {
    const r = this.db.stats(id);
    return r ? { games: r.games, wins: r.wins, totalPoints: r.totalPoints, bestScore: r.bestScore } : { ...EMPTY_STATS };
  }

  /** Marque le compte comme en ligne (heartbeat). */
  ping(id: string): void {
    this.db.touchPresence(id);
  }

  /** Amis (avec stats + présence) et demandes en attente. */
  snapshot(id: string): SocialSnapshot {
    const friends = this.db
      .friendIds(id)
      .map((fid) => this.db.findById(fid))
      .filter((p): p is PublicProfile => !!p)
      .map((p) => ({ ...p, stats: this.statsFor(p.id), online: this.isOnline(p.id) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.pseudo.localeCompare(b.pseudo));

    const toInfo = (dir: 'incoming' | 'outgoing') => (fid: string): FriendRequestInfo | null => {
      const p = this.db.findById(fid);
      return p ? { ...p, direction: dir } : null;
    };
    const requests = [
      ...this.db.incomingRequests(id).map(toInfo('incoming')),
      ...this.db.outgoingRequests(id).map(toInfo('outgoing')),
    ].filter((r): r is FriendRequestInfo => !!r);

    return { friends, requests };
  }

  /** Envoie une demande d'ami par pseudo. Si l'autre m'a déjà demandé → amitié directe. */
  sendRequest(id: string, pseudoRaw: unknown): { status: 'sent' | 'accepted' } {
    const pseudo = (typeof pseudoRaw === 'string' ? pseudoRaw : '').trim();
    if (!pseudo) throw new SocialError('Indiquez un pseudo.');
    const target = this.db.findByPseudoLower(pseudo.toLowerCase());
    if (!target) throw new SocialError('Aucun joueur avec ce pseudo.', 404);
    if (target.id === id) throw new SocialError('Vous ne pouvez pas vous ajouter vous-même.');
    if (this.db.areFriends(id, target.id)) throw new SocialError('Vous êtes déjà amis.', 409);
    // Demande croisée déjà reçue → on scelle l'amitié tout de suite.
    if (this.db.requestExists(target.id, id)) {
      this.db.removeRequest(target.id, id);
      this.db.addFriendship(id, target.id);
      return { status: 'accepted' };
    }
    if (this.db.requestExists(id, target.id)) throw new SocialError('Demande déjà envoyée.', 409);
    this.db.addRequest(id, target.id);
    return { status: 'sent' };
  }

  /** Accepte ou refuse une demande reçue de `fromId`. */
  respondRequest(id: string, fromId: unknown, accept: boolean): { ok: true } {
    const from = String(fromId ?? '');
    if (!this.db.requestExists(from, id)) throw new SocialError('Demande introuvable.', 404);
    this.db.removeRequest(from, id);
    if (accept) this.db.addFriendship(id, from);
    return { ok: true };
  }

  /** Annule une demande que j'ai envoyée. */
  cancelRequest(id: string, toId: unknown): { ok: true } {
    const to = String(toId ?? '');
    if (this.db.requestExists(id, to)) this.db.removeRequest(id, to);
    return { ok: true };
  }

  /** Retire un ami (dans les deux sens). */
  removeFriend(id: string, otherId: unknown): { ok: true } {
    this.db.removeFriendship(id, String(otherId ?? ''));
    return { ok: true };
  }

  myStats(id: string): PlayerStats {
    return this.statsFor(id);
  }

  // -- Sauvegardes solo (plusieurs parties par compte) ----------------------

  /** Liste des parties solo en cours du compte (plus récente d'abord). */
  listGames(id: string): SavedGame[] {
    return this.db.listSavedGames(id);
  }

  saveGame(id: string, gameId: unknown, state: unknown): { ok: true } {
    if (state === undefined || state === null) throw new SocialError('Sauvegarde vide.');
    let encoded: string;
    try {
      encoded = JSON.stringify(state);
    } catch {
      throw new SocialError('Sauvegarde illisible.'); // cycles, BigInt…
    }
    if (encoded === undefined) throw new SocialError('Sauvegarde illisible.');
    if (new TextEncoder().encode(encoded).length > MAX_SAVED_GAME_BYTES) {
      throw new SocialError('Sauvegarde trop volumineuse.', 413);
    }
    this.db.putSavedGame(id, gameKey(gameId), state);
    return { ok: true };
  }

  loadGame(id: string, gameId: unknown): SavedGame | null {
    return this.db.getSavedGame(id, gameKey(gameId)) ?? null;
  }

  deleteGame(id: string, gameId: unknown): { ok: true } {
    this.db.deleteSavedGame(id, gameKey(gameId));
    return { ok: true };
  }

  // -- Enregistrement des parties en ligne (appel de confiance côté salle) ---

  /**
   * Enregistre le résultat d'une partie en ligne. On ne compte que les comptes
   * réels ; il en faut au moins deux (sinon partie « solo » face à des bots →
   * ignorée). Le(s) plus bas score = gagnant(s).
   */
  recordGame(entries: GameResultEntry[]): { recorded: boolean } {
    const valid = entries.filter((e) => e.accountId && this.db.findById(e.accountId));
    if (valid.length < 2) return { recorded: false };
    const best = Math.min(...valid.map((e) => e.score));
    for (const e of valid) {
      const cur = this.db.stats(e.accountId) ?? { accountId: e.accountId, games: 0, wins: 0, totalPoints: 0, bestScore: null };
      this.db.saveStats({
        accountId: e.accountId,
        games: cur.games + 1,
        wins: cur.wins + (e.score === best ? 1 : 0),
        totalPoints: cur.totalPoints + e.score,
        bestScore: cur.bestScore == null ? e.score : Math.min(cur.bestScore, e.score),
      });
    }
    return { recorded: true };
  }
}

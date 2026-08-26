// Logique sociale (amis, stats, présence, sauvegarde solo), agnostique du runtime
// — même approche que `auth.ts` : logique pure sur une abstraction `SocialDB`,
// testable sans Durable Object. L'authentification est faite en amont : toutes les
// méthodes reçoivent l'`accountId` déjà résolu depuis le token.
import type {
  FriendRequestInfo,
  GameResultEntry,
  OnlineMatch,
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

/** Nombre de parties en ligne conservées par compte dans l'historique. */
export const MATCH_HISTORY_LIMIT = 25;

/** Une partie en ligne telle que persistée (identités non résolues). */
export interface MatchRow {
  id: string;
  code: string;
  startedAt: string;
  endedAt: string | null;
  /** Créateur de la salle ; null pour les parties d'avant son enregistrement. */
  ownerId: string | null;
  manches: number;
  totalManches: number;
  players: { accountId: string; score: number | null }[];
}

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

  /** Ouvre (ou réécrit) une partie en ligne avec ses participants, scores inconnus. */
  openMatch(
    id: string,
    code: string,
    startedAt: string,
    accountIds: string[],
    ownerId: string | null,
    totalManches: number,
  ): void;
  /** Clôt une partie en ligne : date de fin + score de chaque participant. */
  closeMatch(id: string, endedAt: string, scores: GameResultEntry[]): void;
  /** Met à jour le nombre de manches jouées d'une partie en cours. */
  setMatchProgress(id: string, manches: number): void;
  /** En-tête d'une partie (sans les participants), ou undefined si inconnue. */
  getMatch(id: string): MatchRow | undefined;
  /** Supprime une partie de l'historique de tous ses participants. */
  deleteMatch(id: string): void;
  /** Parties en ligne où `accountId` a joué, plus récente d'abord. */
  listMatches(accountId: string, limit: number): MatchRow[];

  /** Marque `id` comme actif « maintenant ». */
  touchPresence(id: string): void;
  /** Dernière activité de `id` (epoch ms), ou undefined si jamais vu. */
  presence(id: string): number | undefined;

  /** Efface toutes les données sociales d'un compte (suppression de compte). */
  purgeAccount(id: string): void;
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

  /**
   * Fiche publique d'un autre compte : profil, stats et lien d'amitié. Rien de
   * privé n'en sort (ni e-mail ni présence fine), c'est la même information que
   * le classement — on l'ouvre depuis la table pour voir contre qui on joue.
   */
  publicProfile(viewerId: string, otherId: unknown): { profile: PublicProfile; stats: PlayerStats; friend: boolean } {
    const target = this.db.findById(String(otherId ?? ''));
    if (!target) throw new SocialError('Joueur introuvable.', 404);
    return {
      profile: target,
      stats: this.statsFor(target.id),
      friend: target.id !== viewerId && this.db.areFriends(viewerId, target.id),
    };
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
  recordGame(matchId: string, entries: GameResultEntry[]): { recorded: boolean } {
    const valid = entries.filter((e) => e.accountId && this.db.findById(e.accountId));
    if (valid.length < 2) return { recorded: false };
    this.db.closeMatch(matchId, new Date(this.now()).toISOString(), valid);
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

  /**
   * Ouvre une partie en ligne dans l'historique. Comme `recordGame`, on n'archive
   * que les tables où au moins deux comptes réels s'affrontent : une partie
   * contre des bots n'a rien à faire dans l'historique partagé.
   */
  startGame(
    matchId: string,
    code: string,
    accountIds: string[],
    ownerId: string | null = null,
    totalManches = 0,
  ): { recorded: boolean } {
    const valid = accountIds.filter((id) => id && this.db.findById(id));
    if (valid.length < 2) return { recorded: false };
    this.db.openMatch(matchId, code, new Date(this.now()).toISOString(), valid, ownerId, totalManches);
    return { recorded: true };
  }

  /** Avancement d'une partie en cours (manches terminées), remonté par la salle. */
  progressGame(matchId: string, manches: number): void {
    if (this.db.getMatch(matchId)) this.db.setMatchProgress(matchId, Math.max(0, Math.floor(manches)));
  }

  /**
   * Supprime une partie de l'historique. Réservé au créateur de la salle :
   * l'entrée est partagée par tous les participants, un joueur ne peut pas
   * l'effacer chez les autres. Irréversible — la confirmation est côté client.
   */
  deleteMatch(viewerId: string, matchId: unknown): { ok: true } {
    const match = this.db.getMatch(String(matchId ?? ''));
    if (!match) throw new SocialError('Partie introuvable.', 404);
    if (match.ownerId !== viewerId) throw new SocialError('Seul le créateur de la partie peut la supprimer.', 403);
    this.db.deleteMatch(match.id);
    return { ok: true };
  }

  /** Historique des parties en ligne du compte, pseudos et avatars résolus. */
  listMatches(id: string): OnlineMatch[] {
    return this.db.listMatches(id, MATCH_HISTORY_LIMIT).map((m) => ({
      id: m.id,
      code: m.code,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      ownerId: m.ownerId,
      manches: m.manches,
      totalManches: m.totalManches,
      players: m.players
        .map((p) => {
          const profile = this.db.findById(p.accountId);
          return profile ? { ...profile, score: p.score } : null;
        })
        .filter((p): p is OnlineMatch['players'][number] => !!p)
        // Partie finie : du meilleur (plus bas) au pire ; en cours : ordre stable.
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0)),
    }));
  }

  /** Efface toutes les traces sociales d'un compte supprimé. */
  purge(id: string): void {
    this.db.purgeAccount(id);
  }
}

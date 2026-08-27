import { DurableObject } from 'cloudflare:workers';
import { Server, routePartykitRequest, type Connection, type WSMessage } from 'partyserver';
import { isValidRoomCode } from '@barbu/engine';
import type { Account, GameResultEntry, PublicProfile, SavedGame } from '@barbu/engine';
import { GameRoom, type Conn, type RoomSnapshot } from './core.js';
import { AuthLogic, AuthError, bearerToken, type AccountRow, type AuthDB, type SessionRow } from './auth.js';
import {
  SocialLogic,
  SocialError,
  MAX_SAVED_GAME_BYTES,
  type MatchRow,
  type SocialDB,
  type StatsRow,
} from './social.js';

/** Clé de stockage de l'état d'une salle dans sa Durable Object. */
const ROOM_KEY = 'room';

/** Plafond du corps des requêtes JSON (sauvegarde de partie + marge d'encodage). */
const MAX_BODY_BYTES = MAX_SAVED_GAME_BYTES * 2;

// Réexporté pour les tests (délais d'animation mutables).
export { TIMING } from './core.js';

/** Bindings Workers (voir wrangler.jsonc). */
interface Env {
  Main: DurableObjectNamespace<BarbuServer>;
  Auth: DurableObjectNamespace<AuthServer>;
}

/**
 * Adaptateur partyserver : une salle Barbu = une Durable Object Cloudflare.
 * Toute la logique de jeu vit dans `GameRoom` (agnostique du transport) ; cette
 * classe ne fait que relier les entrées partyserver à la salle et lui fournir
 * l'identité (nom de salle) + les connexions vivantes.
 */
export class BarbuServer extends Server<Env> {
  private room: GameRoom;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const server = this;
    this.room = new GameRoom({
      get id() {
        return server.name;
      },
      getConnections: () => server.getConnections() as Iterable<Conn>,
      // Identité du joueur : résolue par le registre de comptes, pas déclarée
      // par le client. Un token invalide → aucun siège.
      resolveAccount: async (token) => {
        const stub = env.Auth.get(env.Auth.idFromName('global'));
        try {
          return await stub.accountForToken(token);
        } catch {
          return null; // registre injoignable → on refuse plutôt que d'ouvrir
        }
      },
      // Début de partie en ligne → entrée « en cours » dans l'historique.
      reportStart: (matchId, code, accountIds, ownerId, totalManches) => {
        const stub = env.Auth.get(env.Auth.idFromName('global'));
        void stub.recordOnlineStart(matchId, code, accountIds, ownerId, totalManches);
      },
      // Avancement d'une partie en cours (une écriture par manche).
      reportProgress: (matchId, manches) => {
        const stub = env.Auth.get(env.Auth.idFromName('global'));
        void stub.recordOnlineProgress(matchId, manches);
      },
      // Pause de l'hôte : distingue « à reprendre » de « à rejoindre » au menu.
      reportPaused: (matchId, paused) => {
        const stub = env.Auth.get(env.Auth.idFromName('global'));
        void stub.recordOnlinePause(matchId, paused);
      },
      // Fin de partie en ligne → agrège les stats des comptes dans le DO global.
      reportResult: (matchId, entries) => {
        const stub = env.Auth.get(env.Auth.idFromName('global'));
        void stub.recordOnlineGame(matchId, entries);
      },
      // Une DO est évincée dès que plus personne n'est connecté : sans état
      // persistant, revenir sur le code d'une partie en cours retombait sur une
      // salle vierge (écran de configuration au lieu de la reprise).
      loadState: () => ctx.storage.get<RoomSnapshot>(ROOM_KEY).then((s) => s ?? null),
      saveState: (snapshot) => void ctx.storage.put(ROOM_KEY, snapshot),
    });
  }

  override onConnect(conn: Connection) {
    this.room.onConnect(conn);
  }

  override onMessage(conn: Connection, message: WSMessage) {
    // Le protocole est du JSON texte ; on ignore tout binaire éventuel.
    this.room.onMessage(typeof message === 'string' ? message : '', conn);
  }

  override onClose(conn: Connection) {
    this.room.onClose(conn);
  }
}

// ===========================================================================
// Comptes — Durable Object global unique + implémentation SQLite de AuthDB.
// ===========================================================================

/** En-tête d'une partie en ligne, sans ses participants. */
function toMatchHead(h: Record<string, SqlStorageValue>): Omit<MatchRow, 'players'> {
  return {
    id: String(h.id),
    code: String(h.code),
    startedAt: String(h.started_at),
    endedAt: h.ended_at == null ? null : String(h.ended_at),
    ownerId: h.owner_id == null ? null : String(h.owner_id),
    manches: Number(h.manches ?? 0),
    totalManches: Number(h.total_manches ?? 0),
    paused: Number(h.paused ?? 0) === 1,
  };
}

/** Traduit une ligne SQL en `AccountRow` typée. */
function toAccountRow(r: Record<string, SqlStorageValue>): AccountRow {
  return {
    id: String(r.id),
    pseudo: String(r.pseudo),
    pseudoLower: String(r.pseudo_lower),
    avatar: String(r.avatar),
    hash: String(r.hash),
    salt: String(r.salt),
    createdAt: String(r.created_at),
  };
}

/**
 * Registre global des comptes. Une seule instance (name « global »), stockage
 * SQLite. La logique vit dans `AuthLogic` ; cette classe branche `AuthDB` sur SQL
 * et expose une API HTTP JSON consommée par le `fetch` racine du Worker.
 */
export class AuthServer extends DurableObject<Env> {
  private sql: SqlStorage;
  private logic: AuthLogic;
  private social: SocialLogic;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, pseudo TEXT NOT NULL, pseudo_lower TEXT UNIQUE NOT NULL,
        avatar TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL
      )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    );
    // Migration : les bases créées avant l'ajout de l'expiration n'ont pas la
    // colonne. On l'ajoute, et les sessions préexistantes (expires_at NULL) sont
    // traitées comme échues — ces tokens sont antérieurs au durcissement, on les
    // invalide volontairement.
    try {
      this.sql.exec('ALTER TABLE sessions ADD COLUMN expires_at INTEGER');
    } catch {
      /* colonne déjà présente */
    }
    // Tables sociales (amis, stats en ligne, présence, sauvegarde solo).
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS stats (
        account_id TEXT PRIMARY KEY, games INTEGER NOT NULL, wins INTEGER NOT NULL,
        total_points INTEGER NOT NULL, best_score INTEGER
      )`,
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS friendships (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b))`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS friend_requests (from_id TEXT NOT NULL, to_id TEXT NOT NULL, PRIMARY KEY (from_id, to_id))`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS solo_saves (account_id TEXT NOT NULL, game_id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (account_id, game_id))`,
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS presence (account_id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL)`);
    // Historique des parties en ligne : l'en-tête d'un côté, les participants de
    // l'autre, pour pouvoir lister « les parties de ce compte » par un index.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, code TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
        owner_id TEXT, manches INTEGER NOT NULL DEFAULT 0, total_manches INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0
      )`,
    );
    // Tables créées avant la progression et le créateur : SQLite n'a pas d'ADD
    // COLUMN IF NOT EXISTS, on tente et on ignore l'erreur « duplicate column ».
    for (const col of [
      'owner_id TEXT',
      'manches INTEGER NOT NULL DEFAULT 0',
      'total_manches INTEGER NOT NULL DEFAULT 0',
      'paused INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.sql.exec(`ALTER TABLE matches ADD COLUMN ${col}`);
      } catch {
        /* colonne déjà présente */
      }
    }
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL, account_id TEXT NOT NULL, score INTEGER, PRIMARY KEY (match_id, account_id)
      )`,
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS match_players_account ON match_players (account_id)');
    const sql = this.sql;
    const db: AuthDB = {
      findByPseudoLower: (p) => toRow(sql.exec('SELECT * FROM accounts WHERE pseudo_lower = ?', p)),
      findById: (id) => toRow(sql.exec('SELECT * FROM accounts WHERE id = ?', id)),
      insertAccount: (r) =>
        void sql.exec(
          'INSERT INTO accounts (id, pseudo, pseudo_lower, avatar, hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          r.id,
          r.pseudo,
          r.pseudoLower,
          r.avatar,
          r.hash,
          r.salt,
          r.createdAt,
        ),
      updateAccount: (r) =>
        void sql.exec(
          'UPDATE accounts SET pseudo = ?, pseudo_lower = ?, avatar = ?, hash = ?, salt = ? WHERE id = ?',
          r.pseudo,
          r.pseudoLower,
          r.avatar,
          r.hash,
          r.salt,
          r.id,
        ),
      insertSession: (r) =>
        void sql.exec(
          'INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
          r.token,
          r.accountId,
          r.createdAt,
          r.expiresAt,
        ),
      findSession: (token) => {
        const row = [...sql.exec('SELECT * FROM sessions WHERE token = ?', token)][0];
        if (!row) return undefined;
        return {
          token: String(row.token),
          accountId: String(row.account_id),
          createdAt: String(row.created_at),
          // expires_at NULL = session d'avant la migration → échue.
          expiresAt: row.expires_at == null ? 0 : Number(row.expires_at),
        } satisfies SessionRow;
      },
      deleteAccount: (id) => void sql.exec('DELETE FROM accounts WHERE id = ?', id),
      deleteSession: (token) => void sql.exec('DELETE FROM sessions WHERE token = ?', token),
      deleteExpiredSessions: (now) =>
        void sql.exec('DELETE FROM sessions WHERE expires_at IS NULL OR expires_at <= ?', now),
      deleteSessionsForAccount: (accountId, exceptToken) =>
        void sql.exec(
          'DELETE FROM sessions WHERE account_id = ? AND token IS NOT ?',
          accountId,
          exceptToken ?? null,
        ),
    };
    this.logic = new AuthLogic(db);

    const profileById = (id: string): PublicProfile | undefined => {
      const r = [...sql.exec('SELECT id, pseudo, avatar FROM accounts WHERE id = ?', id)][0];
      return r ? { id: String(r.id), pseudo: String(r.pseudo), avatar: String(r.avatar) } : undefined;
    };
    const ids = (cursor: SqlStorageCursor<Record<string, SqlStorageValue>>, col: string): string[] =>
      [...cursor].map((r) => String(r[col]));
    const socialDb: SocialDB = {
      findByPseudoLower: (p) => {
        const r = [...sql.exec('SELECT id, pseudo, avatar FROM accounts WHERE pseudo_lower = ?', p)][0];
        return r ? { id: String(r.id), pseudo: String(r.pseudo), avatar: String(r.avatar) } : undefined;
      },
      findById: profileById,
      friendIds: (id) => ids(sql.exec('SELECT b FROM friendships WHERE a = ?', id), 'b'),
      areFriends: (a, b) => [...sql.exec('SELECT 1 FROM friendships WHERE a = ? AND b = ?', a, b)].length > 0,
      addFriendship: (a, b) => {
        sql.exec('INSERT OR IGNORE INTO friendships (a, b) VALUES (?, ?)', a, b);
        sql.exec('INSERT OR IGNORE INTO friendships (a, b) VALUES (?, ?)', b, a);
      },
      removeFriendship: (a, b) => {
        sql.exec('DELETE FROM friendships WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', a, b, b, a);
      },
      requestExists: (from, to) => [...sql.exec('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?', from, to)].length > 0,
      addRequest: (from, to) => void sql.exec('INSERT OR IGNORE INTO friend_requests (from_id, to_id) VALUES (?, ?)', from, to),
      removeRequest: (from, to) => void sql.exec('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', from, to),
      incomingRequests: (id) => ids(sql.exec('SELECT from_id FROM friend_requests WHERE to_id = ?', id), 'from_id'),
      outgoingRequests: (id) => ids(sql.exec('SELECT to_id FROM friend_requests WHERE from_id = ?', id), 'to_id'),
      stats: (id) => {
        const r = [...sql.exec('SELECT * FROM stats WHERE account_id = ?', id)][0];
        return r
          ? {
              accountId: String(r.account_id),
              games: Number(r.games),
              wins: Number(r.wins),
              totalPoints: Number(r.total_points),
              bestScore: r.best_score == null ? null : Number(r.best_score),
            }
          : undefined;
      },
      saveStats: (row: StatsRow) =>
        void sql.exec(
          'INSERT OR REPLACE INTO stats (account_id, games, wins, total_points, best_score) VALUES (?, ?, ?, ?, ?)',
          row.accountId,
          row.games,
          row.wins,
          row.totalPoints,
          row.bestScore,
        ),
      listSavedGames: (accountId): SavedGame[] =>
        [...sql.exec('SELECT game_id, state, updated_at FROM solo_saves WHERE account_id = ? ORDER BY updated_at DESC', accountId)].map(
          (r) => ({ id: String(r.game_id), state: JSON.parse(String(r.state)), updatedAt: String(r.updated_at) }),
        ),
      getSavedGame: (accountId, gameId): SavedGame | undefined => {
        const r = [...sql.exec('SELECT game_id, state, updated_at FROM solo_saves WHERE account_id = ? AND game_id = ?', accountId, gameId)][0];
        return r ? { id: String(r.game_id), state: JSON.parse(String(r.state)), updatedAt: String(r.updated_at) } : undefined;
      },
      putSavedGame: (accountId, gameId, state) =>
        void sql.exec(
          'INSERT OR REPLACE INTO solo_saves (account_id, game_id, state, updated_at) VALUES (?, ?, ?, ?)',
          accountId,
          gameId,
          JSON.stringify(state ?? null),
          new Date().toISOString(),
        ),
      deleteSavedGame: (accountId, gameId) =>
        void sql.exec('DELETE FROM solo_saves WHERE account_id = ? AND game_id = ?', accountId, gameId),
      openMatch: (id, code, startedAt, accountIds, ownerId, totalManches) => {
        sql.exec(
          `INSERT OR REPLACE INTO matches (id, code, started_at, ended_at, owner_id, manches, total_manches, paused)
           VALUES (?, ?, ?, NULL, ?, 0, ?, 0)`,
          id,
          code,
          startedAt,
          ownerId,
          totalManches,
        );
        for (const a of accountIds) {
          sql.exec('INSERT OR REPLACE INTO match_players (match_id, account_id, score) VALUES (?, ?, NULL)', id, a);
        }
      },
      closeMatch: (id, endedAt, scores) => {
        sql.exec('UPDATE matches SET ended_at = ? WHERE id = ?', endedAt, id);
        for (const s of scores) {
          sql.exec('UPDATE match_players SET score = ? WHERE match_id = ? AND account_id = ?', s.score, id, s.accountId);
        }
      },
      setMatchProgress: (id, manches) => void sql.exec('UPDATE matches SET manches = ? WHERE id = ?', manches, id),
      setMatchPaused: (id, paused) => void sql.exec('UPDATE matches SET paused = ? WHERE id = ?', paused ? 1 : 0, id),
      getMatch: (id): MatchRow | undefined => {
        const h = [...sql.exec('SELECT * FROM matches WHERE id = ?', id)][0];
        return h ? { ...toMatchHead(h), players: [] } : undefined;
      },
      deleteMatch: (id) => {
        sql.exec('DELETE FROM match_players WHERE match_id = ?', id);
        sql.exec('DELETE FROM matches WHERE id = ?', id);
      },
      listMatches: (accountId, limit): MatchRow[] => {
        const heads = [
          ...sql.exec(
            `SELECT m.id, m.code, m.started_at, m.ended_at, m.owner_id, m.manches, m.total_manches, m.paused FROM matches m
             JOIN match_players p ON p.match_id = m.id
             WHERE p.account_id = ? ORDER BY m.started_at DESC LIMIT ?`,
            accountId,
            limit,
          ),
        ];
        return heads.map((h) => ({
          ...toMatchHead(h),
          players: [...sql.exec('SELECT account_id, score FROM match_players WHERE match_id = ?', String(h.id))].map((p) => ({
            accountId: String(p.account_id),
            score: p.score == null ? null : Number(p.score),
          })),
        }));
      },
      touchPresence: (id) => void sql.exec('INSERT OR REPLACE INTO presence (account_id, last_seen) VALUES (?, ?)', id, Date.now()),
      presence: (id) => {
        const r = [...sql.exec('SELECT last_seen FROM presence WHERE account_id = ?', id)][0];
        return r ? Number(r.last_seen) : undefined;
      },
      purgeAccount: (id) => {
        sql.exec('DELETE FROM friendships WHERE a = ? OR b = ?', id, id);
        sql.exec('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', id, id);
        sql.exec('DELETE FROM stats WHERE account_id = ?', id);
        sql.exec('DELETE FROM solo_saves WHERE account_id = ?', id);
        sql.exec('DELETE FROM presence WHERE account_id = ?', id);
        sql.exec('DELETE FROM match_players WHERE account_id = ?', id);
        // Une partie dont plus aucun participant n'existe n'a plus rien à montrer.
        sql.exec('DELETE FROM matches WHERE id NOT IN (SELECT match_id FROM match_players)');
      },
    };
    this.social = new SocialLogic(socialDb);
  }

  /** Ouvre une partie en ligne dans l'historique (RPC depuis la salle). */
  recordOnlineStart(
    matchId: string,
    code: string,
    accountIds: string[],
    ownerId: string | null = null,
    totalManches = 0,
  ): void {
    this.social.startGame(matchId, code, accountIds, ownerId, totalManches);
  }

  /** Avancement d'une partie en cours, remonté à chaque fin de manche (RPC). */
  recordOnlineProgress(matchId: string, manches: number): void {
    this.social.progressGame(matchId, manches);
  }

  /** Pause / reprise décidée par l'hôte de la salle (RPC). */
  recordOnlinePause(matchId: string, paused: boolean): void {
    this.social.pauseGame(matchId, paused);
  }

  /** Enregistre une partie en ligne (appel de confiance depuis la salle via RPC). */
  recordOnlineGame(matchId: string, entries: GameResultEntry[]): void {
    this.social.recordGame(matchId, entries);
  }

  /**
   * Résout un token de session en compte, pour les salles de jeu (RPC interne).
   * C'est ce qui permet au WebSocket d'avoir une identité prouvée.
   */
  accountForToken(token: string): Account | null {
    return this.logic.me(token);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = bearerToken(request.headers.get('Authorization'));
    // IP réelle du client (en-tête posé par Cloudflare, non falsifiable ici).
    const ip = request.headers.get('CF-Connecting-IP') ?? 'inconnue';
    try {
      // Borne dure avant toute lecture : la plus grosse charge légitime est une
      // sauvegarde de partie (64 Ko), on laisse une marge et on refuse le reste.
      const declared = Number(request.headers.get('Content-Length') ?? 0);
      if (declared > MAX_BODY_BYTES) return json({ error: 'Requête trop volumineuse.' }, 413);
      let body: Record<string, unknown> = {};
      if (request.method === 'POST') {
        // Content-Length peut manquer (chunked) : on revérifie après lecture.
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ error: 'Requête trop volumineuse.' }, 413);
        try {
          body = (JSON.parse(raw || '{}') ?? {}) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      if (url.pathname.startsWith('/social/')) return this.handleSocial(url.pathname, request.method, token, body);
      switch (url.pathname) {
        case '/auth/register':
          return json(await this.logic.register(body, ip));
        case '/auth/login':
          return json(await this.logic.login(body, ip));
        case '/auth/me':
          return json({ account: this.logic.me(token) });
        case '/auth/profile':
          return json({ account: await this.logic.updateProfile(token, body) });
        case '/auth/password':
          return json(await this.logic.changePassword(token, body, ip));
        case '/auth/delete': {
          // Suppression définitive : le compte part, et avec lui toutes ses
          // données sociales (amitiés, stats, sauvegardes, historique).
          const { id } = await this.logic.deleteAccount(token, body, ip);
          this.social.purge(id);
          return json({ ok: true });
        }
        case '/auth/logout':
          this.logic.logout(token);
          return json({ ok: true });
        default:
          return json({ error: 'Route inconnue.' }, 404);
      }
    } catch (e) {
      if (e instanceof AuthError || e instanceof SocialError) return json({ error: e.message }, e.status);
      return json({ error: 'Erreur serveur.' }, 500);
    }
  }

  /** Routes /social/* : nécessitent un token valide ; toute activité rafraîchit la présence. */
  private handleSocial(pathname: string, method: string, token: string | null, body: Record<string, unknown>): Response {
    const account = this.logic.me(token);
    if (!account) throw new SocialError('Session expirée.', 401);
    const id = account.id;
    this.social.ping(id); // marque en ligne à chaque appel social
    switch (`${method} ${pathname}`) {
      case 'GET /social/snapshot':
        return json(this.social.snapshot(id));
      case 'GET /social/stats':
        return json({ stats: this.social.myStats(id) });
      case 'POST /social/profile':
        return json(this.social.publicProfile(id, body.id));
      case 'POST /social/request':
        return json(this.social.sendRequest(id, body.pseudo));
      case 'POST /social/respond':
        return json(this.social.respondRequest(id, body.fromId, body.accept === true));
      case 'POST /social/cancel':
        return json(this.social.cancelRequest(id, body.toId));
      case 'POST /social/remove':
        return json(this.social.removeFriend(id, body.id));
      case 'POST /social/ping':
        return json({ ok: true });
      case 'GET /social/matches':
        return json({ matches: this.social.listMatches(id) });
      case 'POST /social/match/delete':
        return json(this.social.deleteMatch(id, body.id));
      case 'GET /social/games':
        return json({ saves: this.social.listGames(id) });
      case 'POST /social/game':
        return json(this.social.saveGame(id, body.id, body.state));
      case 'POST /social/game/delete':
        return json(this.social.deleteGame(id, body.id));
      default:
        return json({ error: 'Route inconnue.' }, 404);
    }
  }
}

function toRow(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>): AccountRow | undefined {
  const row = [...cursor][0];
  return row ? toAccountRow(row) : undefined;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/**
 * Extrait le code de salle d'une URL partyserver (`/parties/<namespace>/<code>`),
 * ou null si le chemin ne désigne pas une salle.
 */
function roomCodeOf(pathname: string): string | null {
  const m = /^\/parties\/[^/]+\/([^/?]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Point d'entrée Worker : /auth/* et /social/* → comptes, sinon /parties/main/:code → salle. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/social/')) {
      const stub = env.Auth.get(env.Auth.idFromName('global'));
      return stub.fetch(request);
    }
    // Le code de salle est le seul secret qui protège une partie : on refuse
    // tout ce qui n'a pas la forme attendue, sinon des codes courts (donc
    // énumérables) suffiraient à tomber sur des parties en cours.
    const room = roomCodeOf(url.pathname);
    if (room !== null && !isValidRoomCode(room)) {
      return new Response('Code de salle invalide.', { status: 400 });
    }
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};

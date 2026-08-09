import { DurableObject } from 'cloudflare:workers';
import { Server, routePartykitRequest, type Connection, type WSMessage } from 'partyserver';
import type { GameResultEntry, PublicProfile, SavedGame } from '@barbu/engine';
import { GameRoom, type Conn } from './core.js';
import { AuthLogic, AuthError, bearerToken, type AccountRow, type AuthDB, type SessionRow } from './auth.js';
import { SocialLogic, SocialError, type SocialDB, type StatsRow } from './social.js';

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
      // Fin de partie en ligne → agrège les stats des comptes dans le DO global.
      reportResult: (entries) => {
        const stub = env.Auth.get(env.Auth.idFromName('global'));
        void stub.recordOnlineGame(entries);
      },
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
        token TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at TEXT NOT NULL
      )`,
    );
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
      `CREATE TABLE IF NOT EXISTS saved_games (account_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS presence (account_id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL)`);
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
        void sql.exec('INSERT INTO sessions (token, account_id, created_at) VALUES (?, ?, ?)', r.token, r.accountId, r.createdAt),
      findSession: (token) => {
        const row = [...sql.exec('SELECT * FROM sessions WHERE token = ?', token)][0];
        return row ? ({ token: String(row.token), accountId: String(row.account_id), createdAt: String(row.created_at) } as SessionRow) : undefined;
      },
      deleteSession: (token) => void sql.exec('DELETE FROM sessions WHERE token = ?', token),
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
      savedGame: (id): SavedGame | undefined => {
        const r = [...sql.exec('SELECT state, updated_at FROM saved_games WHERE account_id = ?', id)][0];
        return r ? { state: JSON.parse(String(r.state)), updatedAt: String(r.updated_at) } : undefined;
      },
      putSavedGame: (id, state) =>
        void sql.exec(
          'INSERT OR REPLACE INTO saved_games (account_id, state, updated_at) VALUES (?, ?, ?)',
          id,
          JSON.stringify(state ?? null),
          new Date().toISOString(),
        ),
      deleteSavedGame: (id) => void sql.exec('DELETE FROM saved_games WHERE account_id = ?', id),
      touchPresence: (id) => void sql.exec('INSERT OR REPLACE INTO presence (account_id, last_seen) VALUES (?, ?)', id, Date.now()),
      presence: (id) => {
        const r = [...sql.exec('SELECT last_seen FROM presence WHERE account_id = ?', id)][0];
        return r ? Number(r.last_seen) : undefined;
      },
    };
    this.social = new SocialLogic(socialDb);
  }

  /** Enregistre une partie en ligne (appel de confiance depuis la salle via RPC). */
  recordOnlineGame(entries: GameResultEntry[]): void {
    this.social.recordGame(entries);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = bearerToken(request.headers.get('Authorization'));
    try {
      const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
      if (url.pathname.startsWith('/social/')) return this.handleSocial(url.pathname, request.method, token, body);
      switch (url.pathname) {
        case '/auth/register':
          return json(await this.logic.register(body));
        case '/auth/login':
          return json(await this.logic.login(body));
        case '/auth/me':
          return json({ account: this.logic.me(token) });
        case '/auth/profile':
          return json({ account: await this.logic.updateProfile(token, body) });
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
      case 'GET /social/game':
        return json({ save: this.social.loadGame(id) });
      case 'POST /social/game':
        return json(this.social.saveGame(id, body.state));
      case 'POST /social/game/delete':
        return json(this.social.deleteGame(id));
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

/** Point d'entrée Worker : /auth/* et /social/* → comptes, sinon /parties/main/:code → salle. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/social/')) {
      const stub = env.Auth.get(env.Auth.idFromName('global'));
      return stub.fetch(request);
    }
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};

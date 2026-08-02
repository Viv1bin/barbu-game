import { DurableObject } from 'cloudflare:workers';
import { Server, routePartykitRequest, type Connection, type WSMessage } from 'partyserver';
import { GameRoom, type Conn } from './core.js';
import { AuthLogic, AuthError, bearerToken, type AccountRow, type AuthDB, type SessionRow } from './auth.js';

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
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = bearerToken(request.headers.get('Authorization'));
    try {
      const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
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
      if (e instanceof AuthError) return json({ error: e.message }, e.status);
      return json({ error: 'Erreur serveur.' }, 500);
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

/** Point d'entrée Worker : /auth/* → comptes, sinon /parties/main/:code → salle. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname.startsWith('/auth/')) {
      const stub = env.Auth.get(env.Auth.idFromName('global'));
      return stub.fetch(request);
    }
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};

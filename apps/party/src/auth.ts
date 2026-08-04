// Logique de comptes, agnostique du runtime (comme core.ts pour le jeu).
// Ne dépend que de WebCrypto (présent en Workers ET en Node) et d'une abstraction
// de stockage `AuthDB` → testable sans Durable Object.
import type { Account, AuthResponse } from '@barbu/engine';

const PBKDF2_ITERATIONS = 100_000;

// --- Modèle de stockage --------------------------------------------------

/** Ligne compte telle que persistée (avec secret, jamais renvoyée au client). */
export interface AccountRow {
  id: string;
  pseudo: string;
  pseudoLower: string;
  avatar: string;
  hash: string;
  salt: string;
  createdAt: string;
}

export interface SessionRow {
  token: string;
  accountId: string;
  createdAt: string;
}

/** Abstraction minimale de persistance. Impl SQLite (DO) ou en mémoire (tests). */
export interface AuthDB {
  findByPseudoLower(pseudoLower: string): AccountRow | undefined;
  findById(id: string): AccountRow | undefined;
  insertAccount(row: AccountRow): void;
  updateAccount(row: AccountRow): void;
  insertSession(row: SessionRow): void;
  findSession(token: string): SessionRow | undefined;
  deleteSession(token: string): void;
}

/** Erreur métier : message affichable côté client + code HTTP. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// --- Crypto --------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Sel aléatoire (base64), 16 octets. */
export function randomSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Token de session opaque (base64url-ish), 24 octets. */
export function randomToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, '');
}

/** Dérive le hash PBKDF2-SHA256 (base64) d'un mot de passe pour un sel donné. */
export async function hashPassword(password: string, saltB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltB64), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Comparaison à durée constante de deux chaînes base64 de même longueur. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- Validation ----------------------------------------------------------

function normalizePseudo(raw: unknown): string {
  const pseudo = typeof raw === 'string' ? raw.trim() : '';
  if (pseudo.length < 2 || pseudo.length > 18) {
    throw new AuthError('Le pseudo doit faire entre 2 et 18 caractères.');
  }
  return pseudo;
}

function checkPassword(raw: unknown): string {
  const pw = typeof raw === 'string' ? raw : '';
  if (pw.length < 4) throw new AuthError('Le mot de passe doit faire au moins 4 caractères.');
  return pw;
}

function newId(): string {
  return randomToken().slice(0, 12);
}

function toAccount(row: AccountRow): Account {
  return { id: row.id, pseudo: row.pseudo, avatar: row.avatar };
}

// --- Logique métier ------------------------------------------------------

export class AuthLogic {
  constructor(private db: AuthDB) {}

  async register(input: { pseudo?: unknown; password?: unknown; avatar?: unknown }): Promise<AuthResponse> {
    const pseudo = normalizePseudo(input.pseudo);
    const password = checkPassword(input.password);
    const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : '🙂';
    const pseudoLower = pseudo.toLowerCase();
    if (this.db.findByPseudoLower(pseudoLower)) {
      throw new AuthError('Ce pseudo est déjà pris.', 409);
    }
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    const row: AccountRow = {
      id: newId(),
      pseudo,
      pseudoLower,
      avatar,
      hash,
      salt,
      createdAt: new Date().toISOString(),
    };
    this.db.insertAccount(row);
    return { token: this.openSession(row.id), account: toAccount(row) };
  }

  async login(input: { pseudo?: unknown; password?: unknown }): Promise<AuthResponse> {
    const pseudo = typeof input.pseudo === 'string' ? input.pseudo.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const row = this.db.findByPseudoLower(pseudo.toLowerCase());
    // Message générique (ne révèle pas si le pseudo existe).
    const fail = () => new AuthError('Pseudo ou mot de passe incorrect.', 401);
    if (!row) throw fail();
    const hash = await hashPassword(password, row.salt);
    if (!constantTimeEqual(hash, row.hash)) throw fail();
    return { token: this.openSession(row.id), account: toAccount(row) };
  }

  /** Renvoie le compte associé à un token, ou null si le token est invalide. */
  me(token: string | null): Account | null {
    const row = this.rowForToken(token);
    return row ? toAccount(row) : null;
  }

  async updateProfile(token: string | null, patch: { pseudo?: unknown; avatar?: unknown }): Promise<Account> {
    const row = this.rowForToken(token);
    if (!row) throw new AuthError('Session expirée.', 401);
    let next = { ...row };
    if (patch.pseudo !== undefined) {
      const pseudo = normalizePseudo(patch.pseudo);
      const pseudoLower = pseudo.toLowerCase();
      const clash = this.db.findByPseudoLower(pseudoLower);
      if (clash && clash.id !== row.id) throw new AuthError('Ce pseudo est déjà pris.', 409);
      next = { ...next, pseudo, pseudoLower };
    }
    if (patch.avatar !== undefined && typeof patch.avatar === 'string' && patch.avatar) {
      next = { ...next, avatar: patch.avatar };
    }
    this.db.updateAccount(next);
    return toAccount(next);
  }

  logout(token: string | null): void {
    if (token) this.db.deleteSession(token);
  }

  private openSession(accountId: string): string {
    const token = randomToken();
    this.db.insertSession({ token, accountId, createdAt: new Date().toISOString() });
    return token;
  }

  private rowForToken(token: string | null): AccountRow | undefined {
    if (!token) return undefined;
    const session = this.db.findSession(token);
    if (!session) return undefined;
    return this.db.findById(session.accountId);
  }
}

/** Extrait le token d'un en-tête `Authorization: Bearer <token>`. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

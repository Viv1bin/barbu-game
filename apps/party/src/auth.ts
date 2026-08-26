// Logique de comptes, agnostique du runtime (comme core.ts pour le jeu).
// Ne dépend que de WebCrypto (présent en Workers ET en Node) et d'une abstraction
// de stockage `AuthDB` → testable sans Durable Object.
import { DEFAULT_AVATAR, isValidAvatar, MIN_PASSWORD_LENGTH } from '@barbu/engine';
import type { Account, AuthResponse } from '@barbu/engine';

const PBKDF2_ITERATIONS = 100_000;

/** Durée de vie d'une session. Au-delà, le token est refusé et purgé. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

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
  /** Instant d'expiration (epoch ms). Une session échue vaut session absente. */
  expiresAt: number;
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
  /** Purge les sessions échues à l'instant `now` (epoch ms). */
  deleteExpiredSessions(now: number): void;
  /** Révoque toutes les sessions d'un compte, sauf éventuellement `exceptToken`. */
  deleteSessionsForAccount(accountId: string, exceptToken?: string): void;
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

// --- Limitation de débit --------------------------------------------------

/**
 * Compteur de tentatives à fenêtre fixe, en mémoire du Durable Object.
 *
 * En mémoire volontairement : écrire en SQLite à chaque tentative ferait du
 * limiteur lui-même un vecteur d'abus. Le DO des comptes est unique et
 * long-vivant, donc le compteur couvre l'essentiel ; une éviction du DO remet
 * les compteurs à zéro, ce qui reste acceptable face à un bruteforce soutenu.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private now: () => number = () => Date.now()) {}

  /** Consomme une tentative pour `key`. Jette une AuthError 429 au-delà de `max`. */
  consume(key: string, max: number, windowMs: number, message: string): void {
    const t = this.now();
    this.prune(t);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + windowMs });
      return;
    }
    cur.count++;
    if (cur.count > max) throw new AuthError(message, 429);
  }

  /** Efface le compteur d'une clé (ex. connexion réussie). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Purge les fenêtres échues ; borne la mémoire si le flux d'attaque est large. */
  private prune(t: number): void {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    // Toujours saturé (attaque avec des clés uniques) → on repart de zéro.
    if (this.hits.size >= 5000) this.hits.clear();
  }
}

/** Plafonds de tentatives. */
const LIMITS = {
  /** Échecs de connexion tolérés pour un même pseudo. */
  loginPerPseudo: { max: 8, windowMs: 15 * 60_000 },
  /** Tentatives de connexion tolérées depuis une même IP (succès compris). */
  loginPerIp: { max: 40, windowMs: 15 * 60_000 },
  /** Créations de compte tolérées depuis une même IP. */
  registerPerIp: { max: 5, windowMs: 60 * 60_000 },
};

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

/**
 * Valide un mot de passe **nouvellement choisi** (inscription, changement).
 * La connexion ne passe pas par ici : les comptes créés sous l'ancien minimum
 * de 4 caractères restent utilisables jusqu'à ce que leur porteur en change.
 */
function checkPassword(raw: unknown): string {
  const pw = typeof raw === 'string' ? raw : '';
  if (pw.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
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
  private limiter: RateLimiter;

  constructor(
    private db: AuthDB,
    private now: () => number = () => Date.now(),
  ) {
    this.limiter = new RateLimiter(now);
  }

  async register(
    input: { pseudo?: unknown; password?: unknown; avatar?: unknown },
    ip = 'inconnue',
  ): Promise<AuthResponse> {
    this.limiter.consume(
      `reg:${ip}`,
      LIMITS.registerPerIp.max,
      LIMITS.registerPerIp.windowMs,
      'Trop de comptes créés depuis cette connexion. Réessaie dans une heure.',
    );
    const pseudo = normalizePseudo(input.pseudo);
    const password = checkPassword(input.password);
    // Avatar restreint à la liste connue : sinon le champ accepte une chaîne
    // arbitraire, stockée puis rediffusée à tous les joueurs de la table.
    const avatar = isValidAvatar(input.avatar) ? input.avatar : DEFAULT_AVATAR;
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

  async login(input: { pseudo?: unknown; password?: unknown }, ip = 'inconnue'): Promise<AuthResponse> {
    const pseudo = typeof input.pseudo === 'string' ? input.pseudo.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const pseudoLower = pseudo.toLowerCase();

    // Deux garde-fous : l'un cible le bruteforce d'un compte précis, l'autre le
    // balayage de nombreux comptes depuis une même origine. Consommés *avant* le
    // PBKDF2, qui est justement l'opération coûteuse qu'on protège.
    this.limiter.consume(
      `login-ip:${ip}`,
      LIMITS.loginPerIp.max,
      LIMITS.loginPerIp.windowMs,
      'Trop de tentatives depuis cette connexion. Réessaie dans quelques minutes.',
    );
    const pseudoKey = `login:${pseudoLower}`;
    const tooMany = 'Trop de tentatives sur ce compte. Réessaie dans quelques minutes.';
    this.limiter.consume(pseudoKey, LIMITS.loginPerPseudo.max, LIMITS.loginPerPseudo.windowMs, tooMany);

    const row = this.db.findByPseudoLower(pseudoLower);
    // Message générique (ne révèle pas si le pseudo existe).
    const fail = () => new AuthError('Pseudo ou mot de passe incorrect.', 401);
    if (!row) throw fail();
    const hash = await hashPassword(password, row.salt);
    if (!constantTimeEqual(hash, row.hash)) throw fail();
    // Succès : le compteur du pseudo repart à zéro (seuls les échecs comptent).
    this.limiter.reset(pseudoKey);
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
    if (patch.avatar !== undefined) {
      if (!isValidAvatar(patch.avatar)) throw new AuthError('Avatar inconnu.');
      next = { ...next, avatar: patch.avatar };
    }
    this.db.updateAccount(next);
    return toAccount(next);
  }

  /**
   * Change le mot de passe après vérification de l'actuel, puis **révoque toutes
   * les autres sessions** : c'est ce qui rend un token volé récupérable.
   */
  async changePassword(
    token: string | null,
    input: { current?: unknown; next?: unknown },
    ip = 'inconnue',
  ): Promise<{ ok: true }> {
    const row = this.rowForToken(token);
    if (!row) throw new AuthError('Session expirée.', 401);

    // Même protection que le login : le mot de passe actuel est vérifiable ici.
    this.limiter.consume(
      `pw:${row.id}:${ip}`,
      LIMITS.loginPerPseudo.max,
      LIMITS.loginPerPseudo.windowMs,
      'Trop de tentatives. Réessaie dans quelques minutes.',
    );

    const current = typeof input.current === 'string' ? input.current : '';
    const currentHash = await hashPassword(current, row.salt);
    if (!constantTimeEqual(currentHash, row.hash)) {
      throw new AuthError('Mot de passe actuel incorrect.', 401);
    }
    const next = checkPassword(input.next);
    if (next === current) throw new AuthError('Le nouveau mot de passe doit être différent.');

    const salt = randomSalt();
    const hash = await hashPassword(next, salt);
    this.db.updateAccount({ ...row, salt, hash });
    this.db.deleteSessionsForAccount(row.id, token ?? undefined);
    this.limiter.reset(`pw:${row.id}:${ip}`);
    return { ok: true };
  }

  logout(token: string | null): void {
    if (token) this.db.deleteSession(token);
  }

  private openSession(accountId: string): string {
    const token = randomToken();
    const t = this.now();
    this.db.insertSession({
      token,
      accountId,
      createdAt: new Date(t).toISOString(),
      expiresAt: t + SESSION_TTL_MS,
    });
    // Bon moment pour balayer les sessions échues : rare et borné.
    this.db.deleteExpiredSessions(t);
    return token;
  }

  private rowForToken(token: string | null): AccountRow | undefined {
    if (!token) return undefined;
    const session = this.db.findSession(token);
    if (!session) return undefined;
    if (session.expiresAt <= this.now()) {
      this.db.deleteSession(token); // échue → on la retire au passage
      return undefined;
    }
    return this.db.findById(session.accountId);
  }
}

/** Extrait le token d'un en-tête `Authorization: Bearer <token>`. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

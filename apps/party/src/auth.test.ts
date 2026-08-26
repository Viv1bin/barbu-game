import { describe, expect, it } from 'vitest';
import { AVATARS, DEFAULT_AVATAR } from '@barbu/engine';
import {
  AuthLogic,
  AuthError,
  hashPassword,
  SESSION_TTL_MS,
  type AccountRow,
  type AuthDB,
  type SessionRow,
} from './auth.js';

// Implémentation en mémoire de AuthDB (miroir de la version SQLite du DO).
class MemoryDB implements AuthDB {
  accounts = new Map<string, AccountRow>();
  byPseudo = new Map<string, string>();
  sessions = new Map<string, SessionRow>();

  findByPseudoLower(p: string) {
    const id = this.byPseudo.get(p);
    return id ? this.accounts.get(id) : undefined;
  }
  findById(id: string) {
    return this.accounts.get(id);
  }
  insertAccount(row: AccountRow) {
    this.accounts.set(row.id, row);
    this.byPseudo.set(row.pseudoLower, row.id);
  }
  updateAccount(row: AccountRow) {
    const prev = this.accounts.get(row.id);
    if (prev && prev.pseudoLower !== row.pseudoLower) this.byPseudo.delete(prev.pseudoLower);
    this.accounts.set(row.id, row);
    this.byPseudo.set(row.pseudoLower, row.id);
  }
  insertSession(row: SessionRow) {
    this.sessions.set(row.token, row);
  }
  findSession(token: string) {
    return this.sessions.get(token);
  }
  deleteSession(token: string) {
    this.sessions.delete(token);
  }
  deleteExpiredSessions(now: number) {
    for (const [t, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(t);
  }
  deleteSessionsForAccount(accountId: string, exceptToken?: string) {
    for (const [t, s] of this.sessions) {
      if (s.accountId === accountId && t !== exceptToken) this.sessions.delete(t);
    }
  }
}

const auth = () => new AuthLogic(new MemoryDB());

describe('comptes', () => {
  it('inscription puis connexion réussies', async () => {
    const a = auth();
    const reg = await a.register({ pseudo: 'Vivien', password: 'secret12', avatar: 'star' });
    expect(reg.account.pseudo).toBe('Vivien');
    expect(reg.account.avatar).toBe('star');
    expect(reg.token).toBeTruthy();

    const log = await a.login({ pseudo: 'Vivien', password: 'secret12' });
    expect(log.account.id).toBe(reg.account.id);
    expect(log.token).not.toBe(reg.token); // nouvelle session
  });

  it('mauvais mot de passe → échec 401', async () => {
    const a = auth();
    await a.register({ pseudo: 'Bob', password: 'goodpass' });
    await expect(a.login({ pseudo: 'Bob', password: 'wrong' })).rejects.toBeInstanceOf(AuthError);
  });

  it('pseudo dupliqué (casse différente) → refus', async () => {
    const a = auth();
    await a.register({ pseudo: 'Alice', password: 'pw123456' });
    await expect(a.register({ pseudo: 'alice', password: 'other123' })).rejects.toMatchObject({ status: 409 });
  });

  it('pseudo trop court / mdp trop court → refus', async () => {
    const a = auth();
    await expect(a.register({ pseudo: 'A', password: 'pw123456' })).rejects.toBeInstanceOf(AuthError);
    await expect(a.register({ pseudo: 'Bob', password: 'pw' })).rejects.toBeInstanceOf(AuthError);
  });

  it('me(token) renvoie le compte, logout invalide', async () => {
    const a = auth();
    const { token } = await a.register({ pseudo: 'Carl', password: 'pw123456' });
    expect(a.me(token)?.pseudo).toBe('Carl');
    a.logout(token);
    expect(a.me(token)).toBeNull();
    expect(a.me('bogus')).toBeNull();
    expect(a.me(null)).toBeNull();
  });

  it('updateProfile change avatar et pseudo, revalide l’unicité', async () => {
    const a = auth();
    const { token } = await a.register({ pseudo: 'Dan', password: 'pw123456', avatar: 'circle' });
    await a.register({ pseudo: 'Eve', password: 'pw123456' });
    const up = await a.updateProfile(token, { avatar: 'moon', pseudo: 'Danny' });
    expect(up.avatar).toBe('moon');
    expect(up.pseudo).toBe('Danny');
    // reconnexion possible avec le nouveau pseudo
    expect((await a.login({ pseudo: 'Danny', password: 'pw123456' })).account.id).toBe(up.id);
    // ne peut pas prendre un pseudo déjà utilisé
    await expect(a.updateProfile(token, { pseudo: 'Eve' })).rejects.toMatchObject({ status: 409 });
  });

  it('bruteforce : les échecs sur un pseudo sont plafonnés puis rouvrent', async () => {
    let clock = 1_000_000;
    const a = new AuthLogic(new MemoryDB(), () => clock);
    await a.register({ pseudo: 'Fay', password: 'goodpass' }, '1.2.3.4');

    // 8 échecs tolérés, le 9e est refusé en 429 sans même vérifier le mot de passe.
    for (let i = 0; i < 8; i++) {
      await expect(a.login({ pseudo: 'Fay', password: 'wrong' }, '9.9.9.9')).rejects.toMatchObject({ status: 401 });
    }
    await expect(a.login({ pseudo: 'Fay', password: 'wrong' }, '9.9.9.9')).rejects.toMatchObject({ status: 429 });
    // Même le bon mot de passe est bloqué pendant la fenêtre.
    await expect(a.login({ pseudo: 'Fay', password: 'goodpass' }, '9.9.9.9')).rejects.toMatchObject({ status: 429 });

    // Fenêtre écoulée → on peut réessayer.
    clock += 16 * 60_000;
    expect((await a.login({ pseudo: 'Fay', password: 'goodpass' }, '9.9.9.9')).account.pseudo).toBe('Fay');
  });

  it('une connexion réussie remet le compteur du pseudo à zéro', async () => {
    const a = new AuthLogic(new MemoryDB(), () => 5_000_000);
    await a.register({ pseudo: 'Gus', password: 'goodpass' }, '1.1.1.1');
    for (let i = 0; i < 7; i++) {
      await expect(a.login({ pseudo: 'Gus', password: 'wrong' }, '1.1.1.1')).rejects.toMatchObject({ status: 401 });
    }
    await a.login({ pseudo: 'Gus', password: 'goodpass' }, '1.1.1.1');
    // Le quota est reparti de zéro : 8 nouveaux échecs restent possibles.
    for (let i = 0; i < 8; i++) {
      await expect(a.login({ pseudo: 'Gus', password: 'wrong' }, '1.1.1.1')).rejects.toMatchObject({ status: 401 });
    }
  });

  it('créations de comptes plafonnées par IP', async () => {
    const a = new AuthLogic(new MemoryDB(), () => 7_000_000);
    for (let i = 0; i < 5; i++) {
      await a.register({ pseudo: `Bot${i}`, password: 'pw123456' }, '5.5.5.5');
    }
    await expect(a.register({ pseudo: 'Bot5', password: 'pw123456' }, '5.5.5.5')).rejects.toMatchObject({ status: 429 });
    // Une autre origine n'est pas affectée.
    expect((await a.register({ pseudo: 'Bot5', password: 'pw123456' }, '6.6.6.6')).account.pseudo).toBe('Bot5');
  });

  it('une session expire au bout du TTL', async () => {
    let clock = 1_000_000;
    const a = new AuthLogic(new MemoryDB(), () => clock);
    const { token } = await a.register({ pseudo: 'Hugo', password: 'pw123456' });
    expect(a.me(token)?.pseudo).toBe('Hugo');

    clock += SESSION_TTL_MS - 1;
    expect(a.me(token)?.pseudo).toBe('Hugo'); // encore valide

    clock += 2;
    expect(a.me(token)).toBeNull(); // échue
  });

  it('changer de mot de passe révoque les autres sessions, garde la courante', async () => {
    const db = new MemoryDB();
    const a = new AuthLogic(db, () => 2_000_000);
    await a.register({ pseudo: 'Iris', password: 'oldpass1' });
    const s1 = (await a.login({ pseudo: 'Iris', password: 'oldpass1' })).token;
    const s2 = (await a.login({ pseudo: 'Iris', password: 'oldpass1' })).token;

    await a.changePassword(s2, { current: 'oldpass1', next: 'newpass1' });

    expect(a.me(s2)?.pseudo).toBe('Iris'); // session courante conservée
    expect(a.me(s1)).toBeNull(); // les autres sont révoquées
    // Le nouveau mot de passe fonctionne, l'ancien non.
    expect((await a.login({ pseudo: 'Iris', password: 'newpass1' })).account.pseudo).toBe('Iris');
    await expect(a.login({ pseudo: 'Iris', password: 'oldpass1' })).rejects.toMatchObject({ status: 401 });
  });

  it('changement de mot de passe : mauvais mot de passe actuel → 401', async () => {
    const a = new AuthLogic(new MemoryDB(), () => 3_000_000);
    const { token } = await a.register({ pseudo: 'Jo', password: 'oldpass1' });
    await expect(a.changePassword(token, { current: 'nope', next: 'newpass1' })).rejects.toMatchObject({ status: 401 });
    await expect(a.changePassword(token, { current: 'oldpass1', next: 'ab' })).rejects.toMatchObject({ status: 400 });
    await expect(a.changePassword(null, { current: 'oldpass1', next: 'newpass1' })).rejects.toMatchObject({ status: 401 });
  });

  it('avatar : restreint à la liste connue', async () => {
    const a = auth();
    // Avatar hors liste à l'inscription → on retombe sur le défaut.
    const reg = await a.register({ pseudo: 'Kim', password: 'pw123456', avatar: 'x'.repeat(10_000) });
    expect(reg.account.avatar).toBe(DEFAULT_AVATAR);
    // Et refusé explicitement à la mise à jour.
    await expect(a.updateProfile(reg.token, { avatar: '<script>' })).rejects.toBeInstanceOf(AuthError);
    expect((await a.updateProfile(reg.token, { avatar: AVATARS[3] })).avatar).toBe(AVATARS[3]);
  });

  it('hashPassword : déterministe par sel, différent sinon', async () => {
    const h1 = await hashPassword('pw', 'c2FsdA==');
    const h2 = await hashPassword('pw', 'c2FsdA==');
    const h3 = await hashPassword('pw', 'b3RoZXI=');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

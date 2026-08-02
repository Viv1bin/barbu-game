import { describe, expect, it } from 'vitest';
import { AuthLogic, AuthError, hashPassword, type AccountRow, type AuthDB, type SessionRow } from './auth.js';

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
}

const auth = () => new AuthLogic(new MemoryDB());

describe('comptes', () => {
  it('inscription puis connexion réussies', async () => {
    const a = auth();
    const reg = await a.register({ pseudo: 'Vivien', password: 'secret', avatar: '🦊' });
    expect(reg.account.pseudo).toBe('Vivien');
    expect(reg.account.avatar).toBe('🦊');
    expect(reg.token).toBeTruthy();

    const log = await a.login({ pseudo: 'Vivien', password: 'secret' });
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
    await a.register({ pseudo: 'Alice', password: 'pw123' });
    await expect(a.register({ pseudo: 'alice', password: 'other' })).rejects.toMatchObject({ status: 409 });
  });

  it('pseudo trop court / mdp trop court → refus', async () => {
    const a = auth();
    await expect(a.register({ pseudo: 'A', password: 'pw123' })).rejects.toBeInstanceOf(AuthError);
    await expect(a.register({ pseudo: 'Bob', password: 'pw' })).rejects.toBeInstanceOf(AuthError);
  });

  it('me(token) renvoie le compte, logout invalide', async () => {
    const a = auth();
    const { token } = await a.register({ pseudo: 'Carl', password: 'pw123' });
    expect(a.me(token)?.pseudo).toBe('Carl');
    a.logout(token);
    expect(a.me(token)).toBeNull();
    expect(a.me('bogus')).toBeNull();
    expect(a.me(null)).toBeNull();
  });

  it('updateProfile change avatar et pseudo, revalide l’unicité', async () => {
    const a = auth();
    const { token } = await a.register({ pseudo: 'Dan', password: 'pw123', avatar: '🙂' });
    await a.register({ pseudo: 'Eve', password: 'pw123' });
    const up = await a.updateProfile(token, { avatar: '👑', pseudo: 'Danny' });
    expect(up.avatar).toBe('👑');
    expect(up.pseudo).toBe('Danny');
    // reconnexion possible avec le nouveau pseudo
    expect((await a.login({ pseudo: 'Danny', password: 'pw123' })).account.id).toBe(up.id);
    // ne peut pas prendre un pseudo déjà utilisé
    await expect(a.updateProfile(token, { pseudo: 'Eve' })).rejects.toMatchObject({ status: 409 });
  });

  it('hashPassword : déterministe par sel, différent sinon', async () => {
    const h1 = await hashPassword('pw', 'c2FsdA==');
    const h2 = await hashPassword('pw', 'c2FsdA==');
    const h3 = await hashPassword('pw', 'b3RoZXI=');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

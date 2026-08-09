import { describe, expect, it } from 'vitest';
import type { PublicProfile, SavedGame } from '@barbu/engine';
import { SocialError, SocialLogic, type SocialDB, type StatsRow } from './social.js';

// Implémentation en mémoire de SocialDB (miroir de la version SQLite du DO).
class MemoryDB implements SocialDB {
  accounts = new Map<string, PublicProfile>();
  friends = new Set<string>(); // clés "a|b" dans les deux sens
  requests = new Set<string>(); // clés "from|to"
  statsRows = new Map<string, StatsRow>();
  saves = new Map<string, Map<string, SavedGame>>(); // accountId -> gameId -> save
  seen = new Map<string, number>();

  add(id: string, pseudo: string, avatar = '🙂') {
    this.accounts.set(id, { id, pseudo, avatar });
  }
  findByPseudoLower(p: string) {
    return [...this.accounts.values()].find((a) => a.pseudo.toLowerCase() === p);
  }
  findById(id: string) {
    return this.accounts.get(id);
  }
  friendIds(id: string) {
    return [...this.friends].filter((k) => k.startsWith(`${id}|`)).map((k) => k.split('|')[1]!);
  }
  areFriends(a: string, b: string) {
    return this.friends.has(`${a}|${b}`);
  }
  addFriendship(a: string, b: string) {
    this.friends.add(`${a}|${b}`);
    this.friends.add(`${b}|${a}`);
  }
  removeFriendship(a: string, b: string) {
    this.friends.delete(`${a}|${b}`);
    this.friends.delete(`${b}|${a}`);
  }
  requestExists(from: string, to: string) {
    return this.requests.has(`${from}|${to}`);
  }
  addRequest(from: string, to: string) {
    this.requests.add(`${from}|${to}`);
  }
  removeRequest(from: string, to: string) {
    this.requests.delete(`${from}|${to}`);
  }
  incomingRequests(id: string) {
    return [...this.requests].filter((k) => k.endsWith(`|${id}`)).map((k) => k.split('|')[0]!);
  }
  outgoingRequests(id: string) {
    return [...this.requests].filter((k) => k.startsWith(`${id}|`)).map((k) => k.split('|')[1]!);
  }
  stats(id: string) {
    return this.statsRows.get(id);
  }
  saveStats(row: StatsRow) {
    this.statsRows.set(row.accountId, row);
  }
  listSavedGames(accountId: string) {
    return [...(this.saves.get(accountId)?.values() ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getSavedGame(accountId: string, gameId: string) {
    return this.saves.get(accountId)?.get(gameId);
  }
  putSavedGame(accountId: string, gameId: string, state: unknown) {
    const slot = this.saves.get(accountId) ?? new Map<string, SavedGame>();
    slot.set(gameId, { id: gameId, state, updatedAt: new Date().toISOString() });
    this.saves.set(accountId, slot);
  }
  deleteSavedGame(accountId: string, gameId: string) {
    this.saves.get(accountId)?.delete(gameId);
  }
  touchPresence(id: string) {
    this.seen.set(id, this.clock);
  }
  presence(id: string) {
    return this.seen.get(id);
  }
  clock = 1000; // horloge injectable pour la présence
}

function setup() {
  const db = new MemoryDB();
  db.add('a', 'Alice');
  db.add('b', 'Bob');
  db.add('c', 'Carol');
  const social = new SocialLogic(db, () => db.clock);
  return { db, social };
}

describe('amis', () => {
  it('demande + acceptation crée une amitié réciproque', () => {
    const { db, social } = setup();
    expect(social.sendRequest('a', 'Bob')).toEqual({ status: 'sent' });
    // côté Bob : demande entrante
    expect(social.snapshot('b').requests).toEqual([
      { id: 'a', pseudo: 'Alice', avatar: '🙂', direction: 'incoming' },
    ]);
    social.respondRequest('b', 'a', true);
    expect(db.areFriends('a', 'b')).toBe(true);
    expect(social.snapshot('a').friends.map((f) => f.id)).toEqual(['b']);
    expect(social.snapshot('a').requests).toEqual([]);
  });

  it('demande croisée → amitié directe', () => {
    const { social } = setup();
    social.sendRequest('a', 'Bob');
    // Bob demande Alice en retour → scellé immédiatement
    expect(social.sendRequest('b', 'Alice')).toEqual({ status: 'accepted' });
    expect(social.snapshot('a').friends.map((f) => f.id)).toEqual(['b']);
    expect(social.snapshot('b').requests).toEqual([]);
  });

  it('refus supprime la demande sans créer d’amitié', () => {
    const { db, social } = setup();
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', false);
    expect(db.areFriends('a', 'b')).toBe(false);
    expect(social.snapshot('b').requests).toEqual([]);
  });

  it('erreurs : pseudo inconnu, soi-même, doublon, déjà amis', () => {
    const { social } = setup();
    expect(() => social.sendRequest('a', 'Zoe')).toThrow(SocialError);
    expect(() => social.sendRequest('a', 'Alice')).toThrow(/vous-même/i);
    social.sendRequest('a', 'Bob');
    expect(() => social.sendRequest('a', 'Bob')).toThrow(/déjà envoyée/i);
    social.respondRequest('b', 'a', true);
    expect(() => social.sendRequest('a', 'Bob')).toThrow(/déjà amis/i);
  });

  it('retrait d’ami', () => {
    const { db, social } = setup();
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', true);
    social.removeFriend('a', 'b');
    expect(db.areFriends('a', 'b')).toBe(false);
    expect(social.snapshot('b').friends).toEqual([]);
  });
});

describe('présence', () => {
  it('en ligne dans la fenêtre, hors ligne au-delà', () => {
    const { db, social } = setup();
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', true);
    social.ping('b'); // Bob actif à clock=1000
    expect(social.snapshot('a').friends[0]!.online).toBe(true);
    db.clock = 1000 + 80_000; // 80s plus tard → hors ligne
    expect(social.snapshot('a').friends[0]!.online).toBe(false);
  });
});

describe('stats en ligne', () => {
  it('enregistre parties, victoires, points et meilleur score', () => {
    const { social } = setup();
    // Partie 1 : Alice 40 (gagne), Bob 90, Carol 120
    social.recordGame([
      { accountId: 'a', score: 40 },
      { accountId: 'b', score: 90 },
      { accountId: 'c', score: 120 },
    ]);
    // Partie 2 : Bob 30 (gagne), Alice 60
    social.recordGame([
      { accountId: 'a', score: 60 },
      { accountId: 'b', score: 30 },
    ]);
    expect(social.myStats('a')).toEqual({ games: 2, wins: 1, totalPoints: 100, bestScore: 40 });
    expect(social.myStats('b')).toEqual({ games: 2, wins: 1, totalPoints: 120, bestScore: 30 });
    expect(social.myStats('c')).toEqual({ games: 1, wins: 0, totalPoints: 120, bestScore: 120 });
  });

  it('ignore les parties avec moins de 2 comptes réels', () => {
    const { social } = setup();
    expect(social.recordGame([{ accountId: 'a', score: 10 }, { accountId: 'ghost', score: 20 }])).toEqual({
      recorded: false,
    });
    expect(social.myStats('a').games).toBe(0);
  });
});

describe('sauvegarde solo (multi-parties)', () => {
  it('sauver, recharger, supprimer une partie ciblée', () => {
    const { social } = setup();
    expect(social.loadGame('a', 'g1')).toBeNull();
    social.saveGame('a', 'g1', { manche: 3, seed: 42 });
    expect(social.loadGame('a', 'g1')?.state).toEqual({ manche: 3, seed: 42 });
    social.deleteGame('a', 'g1');
    expect(social.loadGame('a', 'g1')).toBeNull();
  });

  it('liste plusieurs parties du compte, isolées par compte', () => {
    const { social } = setup();
    social.saveGame('a', 'g1', { manche: 1 });
    social.saveGame('a', 'g2', { manche: 5 });
    social.saveGame('b', 'g3', { manche: 2 });
    expect(social.listGames('a').map((s) => s.id).sort()).toEqual(['g1', 'g2']);
    expect(social.listGames('b').map((s) => s.id)).toEqual(['g3']);
    social.deleteGame('a', 'g1');
    expect(social.listGames('a').map((s) => s.id)).toEqual(['g2']);
  });

  it('rejette un identifiant de partie invalide', () => {
    const { social } = setup();
    expect(() => social.saveGame('a', '', { x: 1 })).toThrow(SocialError);
    expect(() => social.saveGame('a', 123, { x: 1 })).toThrow(SocialError);
  });
});

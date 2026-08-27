import { describe, expect, it } from 'vitest';
import type { PublicProfile, SavedGame } from '@barbu/engine';
import {
  INVITE_TTL_MS,
  MAX_SAVED_GAME_BYTES,
  SocialError,
  SocialLogic,
  type InviteRow,
  type MatchRow,
  type SocialDB,
  type StatsRow,
} from './social.js';

// Implémentation en mémoire de SocialDB (miroir de la version SQLite du DO).
class MemoryDB implements SocialDB {
  accounts = new Map<string, PublicProfile>();
  friends = new Set<string>(); // clés "a|b" dans les deux sens
  requests = new Set<string>(); // clés "from|to"
  statsRows = new Map<string, StatsRow>();
  saves = new Map<string, Map<string, SavedGame>>(); // accountId -> gameId -> save
  seen = new Map<string, number>();
  invites = new Map<string, InviteRow>(); // clé "code|to"

  addInvite(row: InviteRow) {
    this.invites.set(`${row.code}|${row.toId}`, row);
  }
  listInvites(toId: string) {
    return [...this.invites.values()].filter((i) => i.toId === toId).sort((a, b) => b.createdAt - a.createdAt);
  }
  removeInvite(code: string, toId: string) {
    this.invites.delete(`${code}|${toId}`);
  }
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
  openMatch(
    id: string,
    code: string,
    startedAt: string,
    accountIds: string[],
    ownerId: string | null = null,
    totalManches = 0,
  ) {
    this.matches.set(id, {
      id,
      code,
      startedAt,
      endedAt: null,
      ownerId,
      manches: 0,
      totalManches,
      paused: false,
      players: accountIds.map((a) => ({ accountId: a, score: null })),
    });
  }
  setMatchPaused(id: string, paused: boolean) {
    const m = this.matches.get(id);
    if (m) m.paused = paused;
  }
  setMatchProgress(id: string, manches: number) {
    const m = this.matches.get(id);
    if (m) m.manches = manches;
  }
  getMatch(id: string) {
    return this.matches.get(id);
  }
  deleteMatch(id: string) {
    this.matches.delete(id);
  }
  closeMatch(id: string, endedAt: string, scores: { accountId: string; score: number }[]) {
    const m = this.matches.get(id);
    if (!m) return;
    m.endedAt = endedAt;
    for (const s of scores) {
      const p = m.players.find((x) => x.accountId === s.accountId);
      if (p) p.score = s.score;
    }
  }
  listMatches(accountId: string, limit: number) {
    return [...this.matches.values()]
      .filter((m) => m.players.some((p) => p.accountId === accountId))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }
  touchPresence(id: string) {
    this.seen.set(id, this.clock);
  }
  presence(id: string) {
    return this.seen.get(id);
  }
  purgeAccount(id: string) {
    this.accounts.delete(id);
    for (const k of [...this.friends]) if (k.startsWith(`${id}|`) || k.endsWith(`|${id}`)) this.friends.delete(k);
    for (const k of [...this.requests]) if (k.startsWith(`${id}|`) || k.endsWith(`|${id}`)) this.requests.delete(k);
    this.statsRows.delete(id);
    this.saves.delete(id);
    this.seen.delete(id);
    for (const m of this.matches.values()) m.players = m.players.filter((p) => p.accountId !== id);
    for (const [k, m] of [...this.matches]) if (m.players.length === 0) this.matches.delete(k);
  }
  matches = new Map<string, MatchRow>();
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

describe('fiche publique', () => {
  it('renvoie profil, stats et lien d’amitié ; 404 sur un inconnu', () => {
    const { social } = setup();
    social.recordGame('m1', [
      { accountId: 'b', score: 30 },
      { accountId: 'c', score: 90 },
    ]);
    // Alice consulte Bob, croisé en partie : elle voit ses stats sans être son amie.
    expect(social.publicProfile('a', 'b')).toEqual({
      profile: { id: 'b', pseudo: 'Bob', avatar: '🙂' },
      stats: { games: 1, wins: 1, totalPoints: 30, bestScore: 30 },
      friend: false,
    });
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', true);
    expect(social.publicProfile('a', 'b').friend).toBe(true);
    expect(() => social.publicProfile('a', 'zzz')).toThrow(SocialError);
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
    social.recordGame('m1', [
      { accountId: 'a', score: 40 },
      { accountId: 'b', score: 90 },
      { accountId: 'c', score: 120 },
    ]);
    // Partie 2 : Bob 30 (gagne), Alice 60
    social.recordGame('m2', [
      { accountId: 'a', score: 60 },
      { accountId: 'b', score: 30 },
    ]);
    expect(social.myStats('a')).toEqual({ games: 2, wins: 1, totalPoints: 100, bestScore: 40 });
    expect(social.myStats('b')).toEqual({ games: 2, wins: 1, totalPoints: 120, bestScore: 30 });
    expect(social.myStats('c')).toEqual({ games: 1, wins: 0, totalPoints: 120, bestScore: 120 });
  });

  it('ignore les parties avec moins de 2 comptes réels', () => {
    const { social } = setup();
    expect(social.recordGame('m1', [{ accountId: 'a', score: 10 }, { accountId: 'ghost', score: 20 }])).toEqual({
      recorded: false,
    });
    expect(social.myStats('a').games).toBe(0);
  });
});

describe('historique des parties en ligne', () => {
  it('liste les parties en cours puis terminées, avec les scores', () => {
    const { social } = setup();
    social.startGame('m1', 'ABCD1234', ['a', 'b', 'c']);
    expect(social.listMatches('a')).toMatchObject([{ id: 'm1', code: 'ABCD1234', endedAt: null }]);
    expect(social.listMatches('a')[0]!.players.map((p) => p.score)).toEqual([null, null, null]);
    // Non-participant : la partie ne lui apparaît pas.
    expect(social.listMatches('d')).toEqual([]);

    social.recordGame('m1', [
      { accountId: 'a', score: 90 },
      { accountId: 'b', score: 40 },
      { accountId: 'c', score: 120 },
    ]);
    const done = social.listMatches('b')[0]!;
    expect(done.endedAt).not.toBeNull();
    // Classement de la meilleure (plus basse) à la pire.
    expect(done.players.map((p) => [p.pseudo, p.score])).toEqual([
      ['Bob', 40],
      ['Alice', 90],
      ['Carol', 120],
    ]);
  });

  it('suit l’avancement d’une partie en cours', () => {
    const { social } = setup();
    social.startGame('m1', 'ABCD12', ['a', 'b'], 'a', 28);
    expect(social.listMatches('a')[0]).toMatchObject({ ownerId: 'a', manches: 0, totalManches: 28 });
    social.progressGame('m1', 7);
    expect(social.listMatches('b')[0]!.manches).toBe(7);
    // Partie inconnue : sans effet, et surtout pas de ligne fantôme créée.
    social.progressGame('inconnue', 3);
    expect(social.listMatches('a')).toHaveLength(1);
  });

  it('invite un ami à rejoindre une salle, et la retire une fois traitée', () => {
    const { db, social } = setup();
    // Un inconnu ne peut pas être invité : l'invitation est une notification,
    // pas un canal de sollicitation ouvert à tous.
    expect(() => social.invite('a', 'b', 'ABCD12')).toThrow(/amis/i);
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', true);
    expect(social.invite('a', 'b', 'abcd12')).toEqual({ ok: true });
    expect(social.listInvites('b')).toEqual([
      { code: 'ABCD12', from: { id: 'a', pseudo: 'Alice', avatar: '🙂' }, createdAt: new Date(db.clock).toISOString() },
    ]);
    // Réinviter rafraîchit la date au lieu d'empiler des doublons.
    social.invite('a', 'b', 'ABCD12');
    expect(social.listInvites('b')).toHaveLength(1);
    expect(() => social.invite('a', 'b', 'x')).toThrow(/code/i);
    social.dismissInvite('b', 'abcd12');
    expect(social.listInvites('b')).toEqual([]);
  });

  it('périme les invitations oubliées', () => {
    const { db, social } = setup();
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', true);
    social.invite('a', 'b', 'ABCD12');
    db.clock += INVITE_TTL_MS + 1;
    expect(social.listInvites('b')).toEqual([]);
  });

  it('distingue une partie en pause d’une partie simplement quittée', () => {
    const { social } = setup();
    social.startGame('m1', 'ABCD12', ['a', 'b'], 'a', 28);
    expect(social.listMatches('a')[0]!.paused).toBe(false);
    social.pauseGame('m1', true);
    expect(social.listMatches('b')[0]!.paused).toBe(true);
    social.pauseGame('m1', false);
    expect(social.listMatches('b')[0]!.paused).toBe(false);
  });

  it('laisse les participants supprimer une partie sans créateur connu', () => {
    const { social } = setup();
    // Partie ouverte avant l'enregistrement du créateur : personne n'en est
    // propriétaire, sinon elle resterait pour toujours dans l'historique.
    social.startGame('m1', 'ABCD12', ['a', 'b'], null, 28);
    expect(() => social.deleteMatch('c', 'm1')).toThrow(/créateur/i);
    expect(social.deleteMatch('b', 'm1')).toEqual({ ok: true });
    expect(social.listMatches('a')).toEqual([]);
  });

  it('seul le créateur supprime une partie, et pour tout le monde', () => {
    const { social } = setup();
    social.startGame('m1', 'ABCD12', ['a', 'b'], 'a', 28);
    expect(() => social.deleteMatch('b', 'm1')).toThrow(/créateur/i);
    expect(() => social.deleteMatch('a', 'inconnue')).toThrow(SocialError);
    expect(social.deleteMatch('a', 'm1')).toEqual({ ok: true });
    expect(social.listMatches('a')).toEqual([]);
    expect(social.listMatches('b')).toEqual([]);
  });

  it('ignore les tables de moins de 2 comptes réels', () => {
    const { social } = setup();
    expect(social.startGame('m1', 'ABCD1234', ['a', 'ghost'])).toEqual({ recorded: false });
    expect(social.listMatches('a')).toEqual([]);
  });

  it('la suppression d’un compte efface ses traces sociales', () => {
    const { social, db } = setup();
    social.sendRequest('a', 'Bob');
    social.respondRequest('b', 'a', true);
    social.startGame('m1', 'ABCD1234', ['a', 'b']);
    social.recordGame('m1', [{ accountId: 'a', score: 10 }, { accountId: 'b', score: 20 }]);

    social.purge('a');
    expect(db.findById('a')).toBeUndefined();
    expect(social.snapshot('b').friends).toEqual([]);
    expect(social.myStats('a')).toEqual({ games: 0, wins: 0, totalPoints: 0, bestScore: null });
    // La partie survit pour Bob, mais sans le compte supprimé.
    expect(social.listMatches('b')[0]!.players.map((p) => p.pseudo)).toEqual(['Bob']);
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

  it('refuse une sauvegarde hors gabarit', () => {
    const { social } = setup();
    // Au-delà du plafond : rejet, et rien n'est écrit.
    const gros = { blob: 'x'.repeat(MAX_SAVED_GAME_BYTES + 1) };
    expect(() => social.saveGame('a', 'g1', gros)).toThrow(SocialError);
    expect(social.loadGame('a', 'g1')).toBeNull();

    expect(() => social.saveGame('a', 'g1', null)).toThrow(SocialError);
    expect(() => social.saveGame('a', 'g1', undefined)).toThrow(SocialError);

    // Juste sous le plafond : accepté.
    const ok = { blob: 'x'.repeat(MAX_SAVED_GAME_BYTES - 100) };
    social.saveGame('a', 'g1', ok);
    expect(social.loadGame('a', 'g1')?.state).toEqual(ok);
  });
});

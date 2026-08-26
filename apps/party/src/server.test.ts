import { beforeAll, describe, expect, it } from 'vitest';
import { GameRoom, TIMING, type RoomSnapshot } from './core.js';
import type { Account, ClientMsg, ServerMsg } from '@barbu/engine';

// Faux harnais de transport : capture les messages envoyés à chaque connexion.
class FakeConn {
  sent: ServerMsg[] = [];
  constructor(public id: string) {}
  send(s: string) {
    this.sent.push(JSON.parse(s) as ServerMsg);
  }
}
/** Registre de comptes factice : un token → un compte. */
const ACCOUNTS: Record<string, Account> = {
  'tok-host': { id: 'p-host', pseudo: 'Hôte', avatar: '🙂' },
  'tok-other': { id: 'p-other', pseudo: 'Autre', avatar: '🦊' },
};

class FakeRoom {
  id = 'TEST';
  conns: FakeConn[] = [];
  /** Stockage persistant simulé (la Durable Object réelle : ctx.storage). */
  saved: RoomSnapshot | null = null;
  getConnections() {
    return this.conns;
  }
  resolveAccount(token: string): Promise<Account | null> {
    return Promise.resolve(ACCOUNTS[token] ?? null);
  }
  loadState(): Promise<RoomSnapshot | null> {
    return Promise.resolve(this.saved);
  }
  saveState(snapshot: RoomSnapshot) {
    // Round-trip JSON : ce qui ne survit pas à la sérialisation se voit ici.
    this.saved = JSON.parse(JSON.stringify(snapshot)) as RoomSnapshot;
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const msg = (m: ClientMsg) => JSON.stringify(m);

/** Laisse tourner la chaîne asynchrone jusqu'à la fin de partie (délais à 0). */
async function driveToDone(server: GameRoom) {
  for (let i = 0; i < 200000 && server.match?.phase !== 'DONE'; i++) await flush();
}

beforeAll(() => {
  TIMING.botDelay = 0;
  TIMING.pauseMs = 0;
});

describe('serveur en ligne', () => {
  it('vue caviardée : un joueur ne voit que sa propre main', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    room.conns.push(host);

    server.onConnect(host);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), host);
    for (const seat of [1, 2, 3] as const) {
      server.onMessage(msg({ t: 'SEAT', seat, kind: 'bot', level: 'facile' }), host);
    }
    server.onMessage(msg({ t: 'START' }), host);
    await flush();

    const view = host.sent.find((m) => m.t === 'VIEW');
    expect(view?.t).toBe('VIEW');
    if (view?.t !== 'VIEW') return;
    expect(view.youSeat).toBe(0);
    expect(view.view.handSizes).toEqual([13, 13, 13, 13]);
    const hands = view.view.pendingHands ?? view.view.round?.hands ?? [];
    expect(hands[0]!.length).toBe(13); // ma main visible
    for (const opp of [1, 2, 3]) expect(hands[opp]!.length).toBe(0); // adverses cachées
  });

  it('JOIN sans token valide → ERROR, aucun siège attribué', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const intrus = new FakeConn('x');
    room.conns.push(intrus);

    server.onMessage(msg({ t: 'JOIN', token: 'token-bidon' }), intrus);
    await flush();

    expect(intrus.sent.some((m) => m.t === 'ERROR')).toBe(true);
    expect(server.seats.every((s) => s.kind === 'open')).toBe(true);
    expect(server.hostId).toBeNull();
  });

  it('un intrus ne peut pas reprendre le siège d\'un autre compte', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    room.conns.push(host);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), host);
    await flush();
    expect(server.seats[0]!.profileId).toBe('p-host');

    // L'intrus connaît l'id du joueur assis, mais pas son token : il obtient
    // au mieux un siège libre, jamais celui de la victime.
    const intrus = new FakeConn('x');
    room.conns.push(intrus);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-other' }), intrus);
    await flush();

    expect(server.seats[0]!.profileId).toBe('p-host');
    expect(server.seats[0]!.connId).toBe('h'); // la victime garde sa connexion
    expect(server.seats[1]!.profileId).toBe('p-other');
  });

  it('le pseudo et l\'avatar viennent du compte, pas du client', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    room.conns.push(host);
    // Le client tente de se déclarer sous un autre nom : ignoré.
    server.onMessage(
      JSON.stringify({ t: 'JOIN', token: 'tok-host', profileId: 'p-other', name: 'Pirate', avatar: '💀' }),
      host,
    );
    await flush();

    expect(server.seats[0]!.profileId).toBe('p-host');
    expect(server.seats[0]!.name).toBe('Hôte');
    expect(server.seats[0]!.avatar).toBe('🙂');
  });

  it('coup illégal / hors-tour → ERROR, état inchangé', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    room.conns.push(host);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), host);
    // Action alors qu'aucune partie n'est lancée → ERROR.
    host.sent = [];
    server.onMessage(msg({ t: 'ACTION', action: { t: 'PLAY_CARD', player: 0, card: { suit: 'H', rank: 2 } } }), host);
    await flush();
    expect(host.sent.some((m) => m.t === 'ERROR')).toBe(true);
    expect(server.match).toBeNull();
  });

  it('partie complète (bots) atteint DONE avec 4 scores', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    room.conns.push(host);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), host);
    for (const seat of [1, 2, 3] as const) {
      server.onMessage(msg({ t: 'SEAT', seat, kind: 'bot', level: 'facile' }), host);
    }
    server.onMessage(msg({ t: 'START' }), host);
    await flush();
    // L'hôte confie son propre siège à un bot avant de partir → la partie se
    // joue seule (une simple déconnexion, elle, suspendrait tout).
    server.onMessage(msg({ t: 'ACTION', action: { t: 'CHOOSE_CONTRACT', contract: 'BARBU' } }), host);
    server.seats[0]!.connId = undefined;
    server.onMessage(msg({ t: 'SEAT', seat: 0, kind: 'bot', level: 'facile' }), host);
    server.seats[0] = { kind: 'bot', name: 'Bot 1', avatar: 'bot', level: 'facile' };
    server.onClose(host);
    await driveToDone(server);

    expect(server.match?.phase).toBe('DONE');
    expect(server.match?.scores).toHaveLength(4);
    expect(server.match!.scores.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(server.history.length).toBe(28); // 28 manches journalisées
  }, 30000);

  // --- Pause, absences, reprise --------------------------------------------

  /** Salle prête : hôte en siège 0, second humain en siège 1, deux bots, partie lancée. */
  async function startedRoom() {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    const other = new FakeConn('o');
    room.conns.push(host, other);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), host);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-other' }), other);
    for (const seat of [2, 3] as const) {
      server.onMessage(msg({ t: 'SEAT', seat, kind: 'bot', level: 'facile' }), host);
    }
    server.onMessage(msg({ t: 'START' }), host);
    await flush();
    return { room, server, host, other };
  }

  it('un joueur déconnecté n\'est pas remplacé par un bot : la partie se suspend', async () => {
    const { server, host } = await startedRoom();
    server.onClose(host);
    for (let i = 0; i < 50; i++) await flush();

    // Le siège reste au compte, et rien n'avance (aucune manche jouée).
    expect(server.seats[0]!.kind).toBe('human');
    expect(server.seats[0]!.profileId).toBe('p-host');
    expect(server.history.length).toBe(0);
    expect(server.match?.phase).not.toBe('DONE');
  });

  it('le joueur qui revient retrouve son siège et la partie repart', async () => {
    const { room, server, host } = await startedRoom();
    server.onClose(host);
    await flush();

    const back = new FakeConn('h2');
    room.conns.push(back);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), back);
    await flush();

    expect(server.seats[0]!.connId).toBe('h2');
    const view = back.sent.findLast((m) => m.t === 'VIEW');
    expect(view?.t).toBe('VIEW');
    if (view?.t !== 'VIEW') return;
    expect(view.youSeat).toBe(0);
    expect(view.halt.absent).toEqual([]);
  });

  it('l\'hôte peut mettre en pause, et lui seul', async () => {
    const { server, host, other } = await startedRoom();

    // Le second joueur ne peut que demander : la partie n'est pas en pause.
    other.sent = [];
    server.onMessage(msg({ t: 'PAUSE' }), other);
    await flush();
    expect(server.paused).toBe(false);
    expect(other.sent.some((m) => m.t === 'ERROR')).toBe(true);

    server.onMessage(msg({ t: 'ASK_PAUSE' }), other);
    await flush();
    expect(server.asks).toEqual([1]);

    server.onMessage(msg({ t: 'PAUSE' }), host);
    await flush();
    expect(server.paused).toBe(true);
    expect(server.asks).toEqual([]); // la décision de l'hôte tranche

    // En pause, plus aucun coup n'est accepté.
    host.sent = [];
    server.onMessage(msg({ t: 'ACTION', action: { t: 'CHOOSE_CONTRACT', contract: 'BARBU' } }), host);
    await flush();
    expect(host.sent.some((m) => m.t === 'ERROR')).toBe(true);
    expect(server.match?.currentContract).toBeNull();

    server.onMessage(msg({ t: 'RESUME' }), host);
    await flush();
    expect(server.paused).toBe(false);
  });

  it('FILL_BOT : l\'hôte confie le siège d\'un absent à un bot, qui le rend au retour', async () => {
    const { room, server, host, other } = await startedRoom();
    server.onClose(other);
    await flush();
    expect(server.seats[1]!.kind).toBe('human'); // pas de bot automatique

    server.onMessage(msg({ t: 'FILL_BOT', seat: 1, level: 'facile' }), host);
    await flush();
    expect(server.seats[1]!.kind).toBe('bot');
    expect(server.seats[1]!.profileId).toBe('p-other'); // le titulaire est gardé

    const back = new FakeConn('o2');
    room.conns.push(back);
    server.onMessage(msg({ t: 'JOIN', token: 'tok-other' }), back);
    await flush();
    expect(server.seats[1]!.kind).toBe('human');
    expect(server.seats[1]!.connId).toBe('o2');
  });

  it('la salle restaure son état : reprise directe, sans reconfiguration', async () => {
    const { room, server, host } = await startedRoom();
    server.onMessage(msg({ t: 'ACTION', action: { t: 'CHOOSE_CONTRACT', contract: 'BARBU' } }), host);
    await flush();
    const saved = room.saved;
    expect(saved).not.toBeNull();

    // Nouvelle instance (l'ancienne a été évincée) : elle relit l'état.
    const revived = new FakeRoom();
    revived.saved = saved;
    const server2 = new GameRoom(revived);
    const conn = new FakeConn('h3');
    revived.conns.push(conn);
    server2.onConnect(conn);
    server2.onMessage(msg({ t: 'JOIN', token: 'tok-host' }), conn);
    await flush();

    expect(server2.started).toBe(true);
    expect(server2.match?.currentContract).toBe('BARBU');
    expect(server2.seats[2]!.kind).toBe('bot');
    const view = conn.sent.findLast((m) => m.t === 'VIEW');
    expect(view?.t).toBe('VIEW'); // et pas un LOBBY de configuration
  });
});

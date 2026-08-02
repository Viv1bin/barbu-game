import { beforeAll, describe, expect, it } from 'vitest';
import { GameRoom, TIMING } from './core.js';
import type { ClientMsg, ServerMsg } from '@barbu/engine';

// Faux harnais de transport : capture les messages envoyés à chaque connexion.
class FakeConn {
  sent: ServerMsg[] = [];
  constructor(public id: string) {}
  send(s: string) {
    this.sent.push(JSON.parse(s) as ServerMsg);
  }
}
class FakeRoom {
  id = 'TEST';
  conns: FakeConn[] = [];
  getConnections() {
    return this.conns;
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
    server.onMessage(msg({ t: 'JOIN', profileId: 'p-host', name: 'Hôte', avatar: '🙂' }), host);
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

  it('coup illégal / hors-tour → ERROR, état inchangé', async () => {
    const room = new FakeRoom();
    const server = new GameRoom(room);
    const host = new FakeConn('h');
    room.conns.push(host);
    server.onMessage(msg({ t: 'JOIN', profileId: 'p', name: 'Hôte', avatar: '🙂' }), host);
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
    server.onMessage(msg({ t: 'JOIN', profileId: 'p', name: 'Hôte', avatar: '🙂' }), host);
    for (const seat of [1, 2, 3] as const) {
      server.onMessage(msg({ t: 'SEAT', seat, kind: 'bot', level: 'facile' }), host);
    }
    server.onMessage(msg({ t: 'START' }), host);
    await flush();
    // L'hôte quitte : son siège est repris par un bot → la partie se joue seule.
    server.onClose(host);
    await driveToDone(server);

    expect(server.match?.phase).toBe('DONE');
    expect(server.match?.scores).toHaveLength(4);
    expect(server.match!.scores.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(server.history.length).toBe(28); // 28 manches journalisées
  }, 30000);
});

import { describe, expect, it } from 'vitest';
import { deal, fullDeck, shuffle } from './cards.js';
import { randomBot } from './bots.js';
import {
  canPass,
  initReussiteRound,
  legalReussitePlays,
  reussitePass,
  reussitePlay,
} from './reussiteRound.js';
import type { Card, ReussiteState } from './types.js';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ouverture', () => {
  it('une carte de la hauteur ouvre une file', () => {
    const hands: Card[][] = [[{ suit: 'H', rank: 7 }, { suit: 'S', rank: 2 }], [], [], []];
    let s = initReussiteRound(7, hands, 0);
    expect(legalReussitePlays(s, 0)).toContainEqual({ suit: 'H', rank: 7 });
    s = reussitePlay(s, 0, { suit: 'H', rank: 7 });
    expect(s.files.H).toEqual({ low: 7, high: 7 });
  });
});

describe('interdiction de passer si on peut jouer', () => {
  it('passe illégale quand un coup existe', () => {
    const hands: Card[][] = [[{ suit: 'H', rank: 7 }], [], [], []];
    const s = initReussiteRound(7, hands, 0);
    expect(canPass(s, 0)).toBe(false);
    expect(() => reussitePass(s, 0)).toThrow();
  });
});

describe('As — rejoue puis arrêt volontaire', () => {
  it('poser un As garde le tour, puis on peut passer volontairement', () => {
    const s0: ReussiteState = {
      rank: 7,
      files: { H: { low: 7, high: 13 }, S: null, D: null, C: null },
      hands: [[{ suit: 'H', rank: 14 }, { suit: 'D', rank: 2 }], [], [], []],
      turn: 0,
      finishOrder: [],
      awaitingAceChoice: false,
      consecutivePasses: 0,
      finished: false,
    };
    let s = reussitePlay(s0, 0, { suit: 'H', rank: 14 }); // As de cœur prolonge H
    expect(s.files.H).toEqual({ low: 7, high: 14 });
    expect(s.turn).toBe(0); // rejoue
    expect(s.awaitingAceChoice).toBe(true);
    expect(canPass(s, 0)).toBe(true); // arrêt volontaire autorisé
    s = reussitePass(s, 0);
    expect(s.awaitingAceChoice).toBe(false);
  });
});

describe('simulation complète (randomBot)', () => {
  it('la manche se termine avec 4 joueurs classés', () => {
    const r = rng(7);
    let s = initReussiteRound(7, deal(shuffle(fullDeck(), r)), 0);
    let guard = 0;
    while (!s.finished && guard++ < 2000) {
      const a = randomBot.reussite(s, s.turn, r);
      s = a.t === 'REUSSITE_PLAY' ? reussitePlay(s, s.turn, a.card) : reussitePass(s, s.turn);
    }
    expect(s.finished).toBe(true);
    expect(s.finishOrder.length).toBe(4);
    expect(new Set(s.finishOrder).size).toBe(4); // 4 joueurs distincts
  });
});

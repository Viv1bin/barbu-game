import { describe, expect, it } from 'vitest';
import { deal, fullDeck, shuffle } from './cards.js';
import { currentPlayer, initTrickRound, legalPlays, playCard } from './trickRound.js';
import { randomBot } from './bots.js';
import { scoreBarbu, scoreCoeur, type TrickResult } from './scoring.js';
import type { Card, PlayerId } from './types.js';

/** RNG déterministe (mulberry32). */
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

describe('restriction cœur à l’entame', () => {
  it('interdit d’entamer cœur si autre couleur en main', () => {
    const hands: Card[][] = [
      [{ suit: 'H', rank: 5 }, { suit: 'S', rank: 9 }],
      [], [], [],
    ];
    const s = initTrickRound('COEUR', hands, 0);
    const plays = legalPlays(s, 0);
    expect(plays.every((c) => c.suit !== 'H')).toBe(true);
  });

  it('autorise cœur si main 100% cœur', () => {
    const hands: Card[][] = [[{ suit: 'H', rank: 5 }, { suit: 'H', rank: 9 }], [], [], []];
    const s = initTrickRound('COEUR', hands, 0);
    expect(legalPlays(s, 0).length).toBe(2);
  });
});

describe('obligation de fournir la couleur', () => {
  it('doit suivre la couleur d’entame si possible', () => {
    const hands: Card[][] = [
      [{ suit: 'S', rank: 5 }],
      [{ suit: 'S', rank: 9 }, { suit: 'C', rank: 2 }],
      [], [],
    ];
    let s = initTrickRound('PLIS', hands, 0);
    s = playCard(s, 0, { suit: 'S', rank: 5 }); // entame pique
    const plays = legalPlays(s, 1);
    expect(plays).toEqual([{ suit: 'S', rank: 9 }]); // trèfle interdit
  });
});

describe('Barbu — arrêt sur Roi de cœur', () => {
  it('la manche s’arrête dès que le Roi de cœur est ramassé', () => {
    const hands: Card[][] = [
      [{ suit: 'S', rank: 5 }, { suit: 'C', rank: 2 }],
      [{ suit: 'S', rank: 9 }, { suit: 'C', rank: 3 }],
      [{ suit: 'H', rank: 13 }, { suit: 'C', rank: 4 }], // KH + trèfle, pas de pique
      [{ suit: 'S', rank: 2 }, { suit: 'C', rank: 5 }],
    ];
    let s = initTrickRound('BARBU', hands, 0);
    s = playCard(s, 0, { suit: 'S', rank: 5 });
    s = playCard(s, 1, { suit: 'S', rank: 9 });
    s = playCard(s, 2, { suit: 'H', rank: 13 }); // défausse le KH
    s = playCard(s, 3, { suit: 'S', rank: 2 });
    expect(s.finished).toBe(true); // stop immédiat, mains non vides
    expect(s.completedTricks.length).toBe(1);
    expect(s.wonBy[0]).toBe(1); // p1 gagne (plus fort pique)
    const res: TrickResult = { completedTricks: s.completedTricks, wonBy: s.wonBy };
    expect(scoreBarbu(res)[1]).toBe(80);
  });
});

describe('simulation complète (randomBot)', () => {
  it('un contrat non-Barbu joue 13 plis et vide les mains', () => {
    const r = rng(42);
    let s = initTrickRound('COEUR', deal(shuffle(fullDeck(), r)), 0);
    let guard = 0;
    while (!s.finished && guard++ < 100) {
      const p = currentPlayer(s);
      s = playCard(s, p, randomBot.trickPlay(s, p, r));
    }
    expect(s.finished).toBe(true);
    expect(s.completedTricks.length).toBe(13);
    expect(s.hands.every((h) => h.length === 0)).toBe(true);
    const res: TrickResult = { completedTricks: s.completedTricks, wonBy: s.wonBy };
    const total = scoreCoeur(res).reduce((a, b) => a + b, 0);
    expect(total).toBe(130); // 13 cœurs * 10
  });
});

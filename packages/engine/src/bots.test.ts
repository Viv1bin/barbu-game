import { describe, expect, it } from 'vitest';
import { createMatch, applyMatchAction, autoAction, currentActor } from './match.js';
import type { Difficulty, MatchState, PlayerId } from './index.js';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Joue une partie complète, chaque siège à son niveau. Retourne les scores finaux. */
function playMatch(levels: Difficulty[], seed: number): number[] {
  const rng = mulberry(seed);
  let s: MatchState = createMatch(rng);
  let guard = 0;
  while (s.phase !== 'DONE') {
    if (guard++ > 100000) throw new Error('boucle infinie');
    const actor = currentActor(s) as PlayerId;
    const action = autoAction(s, rng, levels[actor]!);
    s = applyMatchAction(s, action, rng);
  }
  return s.scores;
}

describe('bots — robustesse', () => {
  for (const level of ['facile', 'moyen', 'difficile'] as Difficulty[]) {
    it(`niveau ${level} : parties complètes légales (coups toujours valides)`, () => {
      for (const seed of [1, 42, 123, 777]) {
        const scores = playMatch([level, level, level, level], seed);
        expect(scores).toHaveLength(4);
        // Somme = zéro (contres) + total des points distribués sur 28 manches > 0.
        const total = scores.reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(0);
      }
    });
  }
});

describe('bots — force', () => {
  it('Difficile (siège 0) marque moins que 3 Faciles, en moyenne', () => {
    let smart = 0;
    let dumbAvg = 0;
    const N = 24;
    for (let seed = 1; seed <= N; seed++) {
      const sc = playMatch(['difficile', 'facile', 'facile', 'facile'], seed);
      smart += sc[0]!;
      dumbAvg += (sc[1]! + sc[2]! + sc[3]!) / 3;
    }
    // Moins de points = mieux. Le bot malin doit battre la moyenne des faciles.
    expect(smart).toBeLessThan(dumbAvg);
  });
});

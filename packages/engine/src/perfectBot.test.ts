import { beforeAll, describe, expect, it } from 'vitest';
import { applyMatchAction, autoAction, createMatch, currentActor } from './match.js';
import { IMPOSSIBLE } from './perfectBot.js';
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
    s = applyMatchAction(s, autoAction(s, rng, levels[actor]!), rng);
  }
  return s.scores;
}

// Réduit le nombre de mondes : garde le comportement, accélère les tests.
beforeAll(() => {
  IMPOSSIBLE.cardWorlds = 10;
  IMPOSSIBLE.contractWorlds = 12;
  IMPOSSIBLE.contreWorlds = 12;
  IMPOSSIBLE.reussiteWorlds = 8;
});

describe('bot impossible — robustesse', () => {
  it('parties complètes légales (coups toujours valides)', () => {
    for (const seed of [1, 42]) {
      const scores = playMatch(['impossible', 'impossible', 'impossible', 'impossible'], seed);
      expect(scores).toHaveLength(4);
      expect(scores.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
  }, 60000);

  it('déterministe : même graine ⇒ mêmes scores', () => {
    const a = playMatch(['impossible', 'difficile', 'difficile', 'difficile'], 7);
    const b = playMatch(['impossible', 'difficile', 'difficile', 'difficile'], 7);
    expect(a).toEqual(b);
  }, 60000);
});

describe('bot impossible — force', () => {
  it('Impossible (siège 0) marque moins que 3 Difficiles, en moyenne', () => {
    let smart = 0;
    let hardAvg = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed++) {
      const sc = playMatch(['impossible', 'difficile', 'difficile', 'difficile'], seed);
      smart += sc[0]!;
      hardAvg += (sc[1]! + sc[2]! + sc[3]!) / 3;
    }
    // Moins de points = mieux : le bot parfait doit battre la moyenne des difficiles.
    expect(smart).toBeLessThan(hardAvg);
  }, 120000);
});

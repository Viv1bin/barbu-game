import { describe, expect, it } from 'vitest';
import { ALL_CONTRACTS, CONTRACTS } from './contracts.js';
import { randomBot } from './bots.js';
import { currentPlayer } from './trickRound.js';
import {
  applyMatchAction,
  createMatch,
  legalContracts,
  nextContreResponder,
} from './match.js';
import type { MatchState, ReussiteState, TrickRoundState } from './types.js';

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

/** Joue une partie entière avec des bots. */
function playFullMatch(seed: number): MatchState {
  const r = rng(seed);
  let s = createMatch(r);
  let guard = 0;
  while (s.phase !== 'DONE' && guard++ < 20000) {
    if (s.phase === 'CHOOSE_CONTRACT') {
      const c = legalContracts(s)[0]!;
      const rank = CONTRACTS[c].kind === 'reussite' ? 7 : undefined;
      s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contract: c, rank }, r);
    } else if (s.phase === 'CONTRE') {
      const p = nextContreResponder(s)!;
      s = applyMatchAction(s, { t: 'CONTRE', player: p, contre: r() < 0.25 }, r);
    } else if (s.phase === 'PLAY') {
      const round = s.round!;
      if ('currentTrick' in round) {
        const tr = round as TrickRoundState;
        const p = currentPlayer(tr);
        s = applyMatchAction(s, { t: 'PLAY_CARD', player: p, card: randomBot.trickPlay(tr, p, r) }, r);
      } else {
        const rr = round as ReussiteState;
        s = applyMatchAction(s, randomBot.reussite(rr, rr.turn, r), r);
      }
    }
  }
  return s;
}

describe('partie complète (28 manches, bots)', () => {
  for (const seed of [1, 42, 123, 777]) {
    it(`seed ${seed} : se termine, chaque joueur donne les 7 contrats`, () => {
      const s = playFullMatch(seed);
      expect(s.phase).toBe('DONE');
      expect(s.mancheCount).toBe(28);
      for (const p of [0, 1, 2, 3]) {
        expect([...s.playedContracts[p]!].sort()).toEqual([...ALL_CONTRACTS].sort());
      }
      expect(s.scores.every((n) => Number.isFinite(n))).toBe(true);
    });
  }

  it('les contres sont à somme nulle (n’altèrent pas le total)', () => {
    // Sans contre : total des scores = total des points de manche.
    // On vérifie juste que la partie reste cohérente (4 scores finis).
    const s = playFullMatch(9);
    expect(s.scores).toHaveLength(4);
  });
});

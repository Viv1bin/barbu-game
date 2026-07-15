import { describe, expect, it } from 'vitest';
import {
  scoreBarbuHolder,
  scoreCoeurCounts,
  scoreDamesCounts,
  scoreDeuxDerWinners,
  scorePlisCounts,
  scoreSaladeCounts,
} from './manualScoring.js';

describe('manualScoring (comptes agrégés)', () => {
  it('Barbu holder = 80', () => expect(scoreBarbuHolder(2)).toEqual([0, 0, 80, 0]));
  it('Cœur : 13 cœurs répartis = 130 total', () => {
    const s = scoreCoeurCounts([5, 4, 3, 1]);
    expect(s).toEqual([50, 40, 30, 10]);
    expect(s.reduce((a, b) => a + b)).toBe(130);
  });
  it('Dames : 4 dames = 80 total', () => expect(scoreDamesCounts([1, 1, 1, 1]).reduce((a, b) => a + b)).toBe(80));
  it('Plis : 13 plis = 130 total', () => expect(scorePlisCounts([4, 3, 3, 3]).reduce((a, b) => a + b)).toBe(130));
  it('2 der : +20 / +60', () => expect(scoreDeuxDerWinners(1, 3)).toEqual([0, 20, 0, 60]));
  it('Salade = 250 total, Roi de cœur porteur cumule', () => {
    const s = scoreSaladeCounts({
      hearts: [13, 0, 0, 0],
      dames: [4, 0, 0, 0],
      plis: [13, 0, 0, 0],
      khHolder: 0,
      secondLast: 0,
      last: 0,
    });
    expect(s[0]).toBe(250); // 65 + 40 + 65 + 40 + 40
    expect(s.reduce((a, b) => a + b)).toBe(250);
  });
});

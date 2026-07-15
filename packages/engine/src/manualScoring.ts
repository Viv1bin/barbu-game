// Scoring à partir de comptes agrégés (mode arbitre : on saisit des totaux,
// pas des plis carte par carte). Mêmes barèmes que scoring.ts / regles.md.
import type { PlayerId } from './types.js';

function zero(): number[] {
  return [0, 0, 0, 0];
}

/** Barbu : 80 pts au joueur ayant ramassé le Roi de cœur. */
export function scoreBarbuHolder(khHolder: PlayerId, points = 80): number[] {
  const s = zero();
  s[khHolder] = points;
  return s;
}

/** Cœur : `hearts[p]` = nombre de cœurs ramassés par p (somme = 13). */
export function scoreCoeurCounts(hearts: readonly number[], per = 10): number[] {
  return hearts.map((n) => n * per);
}

/** Dames : `dames[p]` = nombre de dames ramassées par p (somme = 4). */
export function scoreDamesCounts(dames: readonly number[], per = 20): number[] {
  return dames.map((n) => n * per);
}

/** Plis : `plis[p]` = nombre de plis ramassés par p (somme = 13). */
export function scorePlisCounts(plis: readonly number[], per = 10): number[] {
  return plis.map((n) => n * per);
}

/** 2 der : gagnants de l'avant-dernier et du dernier pli. */
export function scoreDeuxDerWinners(secondLast: PlayerId, last: PlayerId, sl = 20, l = 60): number[] {
  const s = zero();
  s[secondLast]! += sl;
  s[last]! += l;
  return s;
}

export interface SaladeCounts {
  hearts: number[]; // somme 13
  dames: number[]; // somme 4
  plis: number[]; // somme 13
  khHolder: PlayerId; // Roi de cœur
  secondLast: PlayerId; // avant-dernier pli
  last: PlayerId; // dernier pli
}

/** Salade : cumul des 5 contrats, valeurs ÷2 (total 250). */
export function scoreSaladeCounts(c: SaladeCounts): number[] {
  const s = zero();
  c.hearts.forEach((n, p) => (s[p]! += n * 5));
  c.dames.forEach((n, p) => (s[p]! += n * 10));
  c.plis.forEach((n, p) => (s[p]! += n * 5));
  s[c.khHolder]! += 40;
  s[c.secondLast]! += 10;
  s[c.last]! += 30;
  return s;
}

// Scoring pur, une fonction par contrat. Voir regles.md.
import type { ContractId, PlayedCard, PlayerId } from './types.js';
import { isHeart, isKingOfHearts, isQueen } from './cards.js';

/** Résultat d'une manche à plis, tel que consommé par le scoring. */
export interface TrickResult {
  /** Plis complets dans l'ordre de jeu. */
  completedTricks: PlayedCard[][];
  /** wonBy[i] = gagnant du pli i. */
  wonBy: PlayerId[];
}

function zero(): number[] {
  return [0, 0, 0, 0];
}

/** Cartes gagnées par chaque joueur, à partir des plis + gagnants. */
function wonCardsByPlayer(r: TrickResult): PlayedCard['card'][][] {
  const won: PlayedCard['card'][][] = [[], [], [], []];
  r.completedTricks.forEach((trick, i) => {
    const w = r.wonBy[i]!;
    for (const pc of trick) won[w]!.push(pc.card);
  });
  return won;
}

export function scoreCoeur(r: TrickResult, per = 10): number[] {
  const s = zero();
  const won = wonCardsByPlayer(r);
  won.forEach((cards, p) => {
    s[p] = cards.filter(isHeart).length * per;
  });
  return s;
}

export function scoreDames(r: TrickResult, per = 20): number[] {
  const s = zero();
  const won = wonCardsByPlayer(r);
  won.forEach((cards, p) => {
    s[p] = cards.filter(isQueen).length * per;
  });
  return s;
}

export function scorePlis(r: TrickResult, per = 10): number[] {
  const s = zero();
  for (const w of r.wonBy) s[w]! += per;
  return s;
}

/** Avant-dernier pli = `secondLast`, dernier pli = `last`. */
export function scoreDeuxDer(r: TrickResult, secondLast = 20, last = 60): number[] {
  const s = zero();
  const n = r.wonBy.length;
  if (n >= 1) s[r.wonBy[n - 1]!]! += last;
  if (n >= 2) s[r.wonBy[n - 2]!]! += secondLast;
  return s;
}

/** 80 pts au gagnant du pli contenant le Roi de cœur (Barbu). */
export function scoreBarbu(r: TrickResult, points = 80): number[] {
  const s = zero();
  r.completedTricks.forEach((trick, i) => {
    if (trick.some((pc) => isKingOfHearts(pc.card))) s[r.wonBy[i]!]! += points;
  });
  return s;
}

/** Salade : cumul des 5 contrats, valeurs ÷2 (total 250). */
export function scoreSalade(r: TrickResult): number[] {
  const parts = [
    scoreBarbu(r, 40),
    scoreCoeur(r, 5),
    scoreDames(r, 10),
    scorePlis(r, 5),
    scoreDeuxDer(r, 10, 30),
  ];
  const s = zero();
  for (const part of parts) part.forEach((v, p) => (s[p]! += v));
  return s;
}

const REUSSITE_POINTS = [-120, -60, -20, 0];
/** finishOrder[0] = 1er sorti. */
export function scoreReussite(finishOrder: PlayerId[]): number[] {
  const s = zero();
  finishOrder.forEach((p, rank) => {
    s[p] = REUSSITE_POINTS[rank] ?? 0;
  });
  return s;
}

/** Aiguillage par contrat pour les manches à plis. */
export function scoreTrickContract(contract: ContractId, r: TrickResult): number[] {
  switch (contract) {
    case 'BARBU':
      return scoreBarbu(r);
    case 'COEUR':
      return scoreCoeur(r);
    case 'DAMES':
      return scoreDames(r);
    case 'PLIS':
      return scorePlis(r);
    case 'DEUXDER':
      return scoreDeuxDer(r);
    case 'SALADE':
      return scoreSalade(r);
    default:
      throw new Error(`scoreTrickContract: contrat non-plis ${contract}`);
  }
}

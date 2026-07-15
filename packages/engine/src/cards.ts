import type { Card, PlayedCard, Rank, Suit } from './types.js';

export const SUITS: readonly Suit[] = ['H', 'S', 'D', 'C'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function isHeart(c: Card): boolean {
  return c.suit === 'H';
}
export function isQueen(c: Card): boolean {
  return c.rank === 12;
}
export function isKingOfHearts(c: Card): boolean {
  return c.suit === 'H' && c.rank === 13;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function cardId(c: Card): string {
  return `${c.suit}${c.rank}`;
}

/** Jeu de 52 cartes trié. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
}

/** Mélange Fisher-Yates. `rng` injectable pour des tests déterministes. */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Distribue 13 cartes à chacun des 4 joueurs. */
export function deal(deck: Card[]): Card[][] {
  const hands: Card[][] = [[], [], [], []];
  deck.forEach((card, i) => hands[i % 4]!.push(card));
  return hands;
}

/**
 * Gagnant d'un pli : carte la plus forte de la couleur demandée (celle de la
 * première carte jouée). Les défausses ne peuvent pas gagner.
 */
export function trickWinner(trick: PlayedCard[]): PlayedCard {
  const lead = trick[0]!;
  let best = lead;
  for (const pc of trick) {
    if (pc.card.suit === lead.card.suit && pc.card.rank > best.card.rank) best = pc;
  }
  return best;
}

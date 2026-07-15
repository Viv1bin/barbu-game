// Réducteur des contrats à plis (tous sauf Réussite). Valide la légalité des coups.
import { CONTRACTS } from './contracts.js';
import { cardEquals, isHeart, isKingOfHearts, trickWinner } from './cards.js';
import type { Card, ContractId, PlayerId, TrickRoundState } from './types.js';

/** Joueur à qui c'est le tour dans le pli courant. */
export function currentPlayer(s: TrickRoundState): PlayerId {
  return ((s.leader + s.currentTrick.length) % 4) as PlayerId;
}

/** Couleur d'entame du pli courant, ou null si pli vide. */
function ledSuit(s: TrickRoundState): Card['suit'] | null {
  return s.currentTrick[0]?.card.suit ?? null;
}

/** Cartes légalement jouables par `player`. Vide si ce n'est pas son tour. */
export function legalPlays(s: TrickRoundState, player: PlayerId): Card[] {
  if (s.finished || player !== currentPlayer(s)) return [];
  const hand = s.hands[player]!;
  const led = ledSuit(s);

  if (led === null) {
    // Entame : restriction cœur pour les contrats concernés.
    if (CONTRACTS[s.contract].heartRestricted) {
      const nonHearts = hand.filter((c) => !isHeart(c));
      if (nonHearts.length > 0) return nonHearts; // interdit d'entamer cœur
    }
    return hand.slice();
  }

  // Suivre : obligation de fournir la couleur d'entame si possible.
  const following = hand.filter((c) => c.suit === led);
  return following.length > 0 ? following : hand.slice();
}

export function isLegalPlay(s: TrickRoundState, player: PlayerId, card: Card): boolean {
  return legalPlays(s, player).some((c) => cardEquals(c, card));
}

export function initTrickRound(contract: ContractId, hands: Card[][], firstLeader: PlayerId): TrickRoundState {
  return {
    contract,
    hands: hands.map((h) => h.slice()),
    leader: firstLeader,
    currentTrick: [],
    completedTricks: [],
    wonBy: [],
    heartsBroken: false,
    finished: false,
  };
}

/**
 * Joue une carte. Retourne un nouvel état. Lève si le coup est illégal.
 */
export function playCard(s: TrickRoundState, player: PlayerId, card: Card): TrickRoundState {
  if (!isLegalPlay(s, player, card)) throw new Error('Coup illégal');

  const hands = s.hands.map((h) => h.slice());
  hands[player] = hands[player]!.filter((c) => !cardEquals(c, card));
  const currentTrick = [...s.currentTrick, { player, card }];
  const heartsBroken = s.heartsBroken || isHeart(card);

  // Pli incomplet : on attend les autres.
  if (currentTrick.length < 4) {
    return { ...s, hands, currentTrick, heartsBroken };
  }

  // Pli complet : résolution.
  const winner = trickWinner(currentTrick).player;
  const completedTricks = [...s.completedTricks, currentTrick];
  const wonBy = [...s.wonBy, winner];

  // Barbu : la manche s'arrête dès que le Roi de cœur est ramassé.
  const kingTaken = CONTRACTS[s.contract].stopsOnKingOfHearts && currentTrick.some((pc) => isKingOfHearts(pc.card));
  const allPlayed = hands.every((h) => h.length === 0);
  const finished = kingTaken || allPlayed;

  return {
    ...s,
    hands,
    leader: winner,
    currentTrick: [],
    completedTricks,
    wonBy,
    heartsBroken,
    finished,
  };
}

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
    // Entame : restriction cœur pour les contrats concernés. En manche
    // combinée, la restriction la plus stricte l'emporte.
    if (s.contracts.some((c) => CONTRACTS[c].heartRestricted)) {
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

export function initTrickRound(contracts: ContractId[], hands: Card[][], firstLeader: PlayerId): TrickRoundState {
  return {
    contracts,
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
 * Peut-on reprendre sa carte ? Oui tant que personne n'a joué par-dessus : la
 * carte est encore seule au-dessus du tas, la reprendre ne change rien à ce que
 * les autres ont pu voir d'eux-mêmes. Une fois le joueur suivant engagé, il a
 * décidé *en fonction* de cette carte — la reprendre réécrirait sa décision.
 */
export function canUndoPlay(s: TrickRoundState, player: PlayerId): boolean {
  if (s.finished || s.currentTrick.length === 0) return false;
  return s.currentTrick[s.currentTrick.length - 1]!.player === player;
}

/** Reprend la dernière carte posée par `player`. Lève si ce n'est plus possible. */
export function undoPlay(s: TrickRoundState, player: PlayerId): TrickRoundState {
  if (!canUndoPlay(s, player)) throw new Error('Trop tard : la carte est recouverte');
  const last = s.currentTrick[s.currentTrick.length - 1]!;
  const hands = s.hands.map((h) => h.slice());
  hands[player] = [...hands[player]!, last.card];
  const currentTrick = s.currentTrick.slice(0, -1);
  // `heartsBroken` se redéduit du jeu visible : il ne doit pas rester vrai à
  // cause d'une carte qu'on vient justement de retirer de la table.
  const heartsBroken =
    s.completedTricks.flat().some((pc) => isHeart(pc.card)) || currentTrick.some((pc) => isHeart(pc.card));
  return { ...s, hands, currentTrick, heartsBroken };
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

  // Barbu : la manche s'arrête dès que le Roi de cœur est ramassé. Sauf en
  // manche combinée — l'autre contrat, lui, se joue jusqu'à la dernière carte.
  const kingTaken =
    s.contracts.length === 1 &&
    CONTRACTS[s.contracts[0]!].stopsOnKingOfHearts &&
    currentTrick.some((pc) => isKingOfHearts(pc.card));
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

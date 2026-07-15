// Réducteur du contrat Réussite (pose en files, mécanique hors plis). Voir regles.md.
import { cardEquals } from './cards.js';
import type { Card, Fan, PlayerId, Rank, ReussiteState, Suit } from './types.js';

const SUITS: Suit[] = ['H', 'S', 'D', 'C'];

export function initReussiteRound(rank: Rank, hands: Card[][], starter: PlayerId): ReussiteState {
  return {
    rank,
    files: { H: null, S: null, D: null, C: null },
    hands: hands.map((h) => h.slice()),
    turn: starter,
    finishOrder: [],
    awaitingAceChoice: false,
    consecutivePasses: 0,
    finished: false,
  };
}

/** Un joueur est actif tant qu'il lui reste des cartes. */
function activePlayers(s: ReussiteState): PlayerId[] {
  return ([0, 1, 2, 3] as PlayerId[]).filter((p) => s.hands[p]!.length > 0);
}

/** Prochain joueur actif dans le sens du jeu (exclut `from`). */
function nextActive(s: ReussiteState, from: PlayerId): PlayerId {
  for (let i = 1; i <= 4; i++) {
    const p = ((from + i) % 4) as PlayerId;
    if (s.hands[p]!.length > 0) return p;
  }
  return from;
}

function canOpen(s: ReussiteState, c: Card): boolean {
  return c.rank === s.rank && s.files[c.suit] === null;
}
function canExtend(s: ReussiteState, c: Card): boolean {
  const fan: Fan | null = s.files[c.suit];
  if (!fan) return false;
  return (c.rank === fan.high + 1 && c.rank <= 14) || (c.rank === fan.low - 1 && c.rank >= 2);
}

/** Cartes légalement jouables par `player`. Vide si ce n'est pas son tour. */
export function legalReussitePlays(s: ReussiteState, player: PlayerId): Card[] {
  if (s.finished || player !== s.turn) return [];
  return s.hands[player]!.filter((c) => canOpen(s, c) || canExtend(s, c));
}

export function isLegalReussitePlay(s: ReussiteState, player: PlayerId, card: Card): boolean {
  return legalReussitePlays(s, player).some((c) => cardEquals(c, card));
}

/** Un joueur peut-il/doit-il passer ? (bloqué, ou arrêt volontaire après un As) */
export function canPass(s: ReussiteState, player: PlayerId): boolean {
  if (s.finished || player !== s.turn) return false;
  if (s.awaitingAceChoice) return true; // arrêt volontaire autorisé
  return legalReussitePlays(s, player).length === 0; // sinon uniquement si bloqué
}

/** Termine la manche en classant les joueurs restants (moins de cartes = mieux classé). */
function finishRemaining(s: ReussiteState): ReussiteState {
  const remaining = activePlayers(s).sort((a, b) => s.hands[a]!.length - s.hands[b]!.length);
  return { ...s, finishOrder: [...s.finishOrder, ...remaining], finished: true, awaitingAceChoice: false };
}

export function reussitePlay(s: ReussiteState, player: PlayerId, card: Card): ReussiteState {
  if (!isLegalReussitePlay(s, player, card)) throw new Error('Coup Réussite illégal');

  const files = { ...s.files };
  const existing = files[card.suit];
  if (!existing) files[card.suit] = { low: card.rank, high: card.rank };
  else files[card.suit] = { low: Math.min(existing.low, card.rank) as Rank, high: Math.max(existing.high, card.rank) as Rank };

  const hands = s.hands.map((h) => h.slice());
  hands[player] = hands[player]!.filter((c) => !cardEquals(c, card));

  const finishOrder = [...s.finishOrder];
  const emptied = hands[player]!.length === 0;
  if (emptied) finishOrder.push(player);

  let next: ReussiteState = { ...s, files, hands, finishOrder, consecutivePasses: 0 };

  // 3 joueurs sortis -> la manche se termine (le 4e est dernier).
  if (finishOrder.length >= 3) return finishRemaining(next);

  // As posé + il reste des cartes -> le joueur rejoue (ou pourra passer volontairement).
  if (card.rank === 14 && !emptied) {
    return { ...next, turn: player, awaitingAceChoice: true };
  }
  return { ...next, turn: nextActive(next, player), awaitingAceChoice: false };
}

export function reussitePass(s: ReussiteState, player: PlayerId): ReussiteState {
  if (!canPass(s, player)) throw new Error('Passe Réussite illégale (un coup est possible)');

  // Arrêt volontaire après un As : progrès réel, on ne compte pas de blocage.
  if (s.awaitingAceChoice) {
    return { ...s, turn: nextActive(s, player), awaitingAceChoice: false, consecutivePasses: 0 };
  }

  // Passe forcée (bloqué). Si tous les actifs passent d'affilée -> blocage total.
  const consecutivePasses = s.consecutivePasses + 1;
  if (consecutivePasses >= activePlayers(s).length) return finishRemaining(s);
  return { ...s, turn: nextActive(s, player), consecutivePasses };
}

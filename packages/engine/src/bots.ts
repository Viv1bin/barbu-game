// Bots à 4 niveaux. Un moteur pur : les bots ne lisent que l'info publique
// (leur main + les plis terminés), jamais les mains adverses.
//  - facile     : coup légal au hasard.
//  - moyen      : heuristique gloutonne par contrat, sans mémoire.
//  - difficile  : moyen + comptage de cartes (encaisse les couleurs « mortes »)
//                 + contre/choix de contrat basés sur l'espérance de points.
//  - impossible : Monte-Carlo par déterminisation (voir perfectBot.ts). Simule
//                 la fin de la manche sur des mains adverses échantillonnées
//                 depuis la seule info publique, choisit l'espérance minimale.
import { legalPlays } from './trickRound.js';
import { canPass, legalReussitePlays } from './reussiteRound.js';
import { isHeart, isKingOfHearts, isQueen } from './cards.js';
import type {
  Action,
  Card,
  ContractId,
  MatchState,
  PlayerId,
  Rank,
  ReussiteState,
  TrickRoundState,
} from './types.js';
import { legalContracts } from './match.js';
import { mcChooseContract, mcContre, mcReussite, mcTrickPlay } from './perfectBot.js';

export type Difficulty = 'facile' | 'moyen' | 'difficile' | 'impossible';

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
function minBy<T>(a: T[], f: (x: T) => number): T {
  return a.reduce((b, x) => (f(x) < f(b) ? x : b));
}
function maxBy<T>(a: T[], f: (x: T) => number): T {
  return a.reduce((b, x) => (f(x) > f(b) ? x : b));
}

// ---------------------------------------------------------------------------
// Bot facile : aléatoire (baseline, interface stable).
// ---------------------------------------------------------------------------
export interface RoundBot {
  trickPlay(s: TrickRoundState, player: PlayerId, rng?: () => number): Card;
  reussite(s: ReussiteState, player: PlayerId, rng?: () => number): Action;
}

export const randomBot: RoundBot = {
  trickPlay(s, player, rng = Math.random) {
    const plays = legalPlays(s, player);
    if (plays.length === 0) throw new Error('Aucun coup légal (pas son tour ?)');
    return pick(plays, rng);
  },
  reussite(s, player, rng = Math.random) {
    const plays = legalReussitePlays(s, player);
    if (plays.length > 0) return { t: 'REUSSITE_PLAY', player, card: pick(plays, rng) };
    if (canPass(s, player)) return { t: 'REUSSITE_PASS', player };
    throw new Error('Aucune action légale de Réussite');
  },
};

// ---------------------------------------------------------------------------
// Comptage de cartes (info publique uniquement).
// ---------------------------------------------------------------------------
export function seenCards(s: TrickRoundState): Card[] {
  return [...s.completedTricks.flat().map((pc) => pc.card), ...s.currentTrick.map((pc) => pc.card)];
}

/** Reste-t-il des cartes pénalité chez les adversaires (ni vues, ni dans ma main) ? */
export function penaltyLeftOutside(contract: ContractId, seen: Card[], mine: Card[]): boolean {
  const known = (pred: (c: Card) => boolean) =>
    seen.filter(pred).length + mine.filter(pred).length;
  switch (contract) {
    case 'BARBU':
      return known(isKingOfHearts) < 1; // le Roi de cœur circule encore
    case 'COEUR':
      return known(isHeart) < 13;
    case 'DAMES':
      return known(isQueen) < 4;
    default:
      return true; // PLIS/DEUXDER/SALADE : gagner un pli est en soi pénalisant
  }
}

// ---------------------------------------------------------------------------
// Jeu à plis heuristique. `count` = mémoire (niveau difficile).
// ---------------------------------------------------------------------------
/** Danger à défausser : carte la plus risquée à conserver / à lâcher quand on est coupé. */
function discardDanger(contract: ContractId, c: Card): number {
  switch (contract) {
    case 'BARBU':
      return isKingOfHearts(c) ? 1000 : c.rank;
    case 'COEUR':
      return isHeart(c) ? 100 + c.rank : c.rank;
    case 'DAMES':
      return isQueen(c) ? 100 + c.rank : c.rank;
    case 'SALADE':
      return (isKingOfHearts(c) ? 200 : 0) + (isHeart(c) ? 40 : 0) + (isQueen(c) ? 80 : 0) + c.rank;
    default:
      return c.rank; // PLIS/DEUXDER : se délester des hautes
  }
}

export function smartTrick(s: TrickRoundState, player: PlayerId, count: boolean): Card {
  const plays = legalPlays(s, player);
  if (plays.length === 1) return plays[0]!;
  const contract = s.contract;
  const trick = s.currentTrick;
  const led = trick[0]?.card.suit ?? null;
  const last2 = s.completedTricks.length >= 11; // plis 12 & 13

  // Difficile : plus aucune pénalité dehors -> gagner est inoffensif, on lâche le plus haut.
  if (count && !penaltyLeftOutside(contract, seenCards(s), s.hands[player]!)) {
    return maxBy(plays, (c) => c.rank);
  }

  // ENTAME
  if (led === null) {
    if (contract === 'DEUXDER' && !last2) return maxBy(plays, (c) => c.rank); // lâcher les hautes tôt
    return minBy(plays, (c) => c.rank); // entamer bas pour ne pas ramasser
  }

  const haveLed = plays.some((c) => c.suit === led);
  if (haveLed) {
    const winRank = Math.max(
      ...trick.filter((pc) => pc.card.suit === led).map((pc) => pc.card.rank)
    );
    const safe = plays.filter((c) => c.rank < winRank);
    if (safe.length) return maxBy(safe, (c) => c.rank); // passer sous, en lâchant la plus haute
    return minBy(plays, (c) => c.rank); // forcé de monter : minimiser, laisser passer les suivants
  }

  // COUPÉ : défausser la carte la plus dangereuse.
  return maxBy(plays, (c) => discardDanger(contract, c));
}

export function smartReussite(s: ReussiteState, player: PlayerId): Action {
  const plays = legalReussitePlays(s, player);
  if (plays.length > 0) {
    // Vider vite : jouer depuis la couleur où l'on tient le plus de cartes.
    const suitCount = (c: Card) => s.hands[player]!.filter((x) => x.suit === c.suit).length;
    const card = maxBy(plays, (c) => suitCount(c) * 100 + c.rank);
    return { t: 'REUSSITE_PLAY', player, card };
  }
  if (canPass(s, player)) return { t: 'REUSSITE_PASS', player };
  throw new Error('Aucune action légale de Réussite');
}

// ---------------------------------------------------------------------------
// Espérance de points (pour choix de contrat + contre).
// ---------------------------------------------------------------------------
function reussiteFluidity(hand: Card[], rank: Rank): number {
  // Adjacences dans la main autour de la hauteur : plus fluide = sort plus vite.
  let adj = 0;
  for (const c of hand) {
    if (hand.some((o) => o.suit === c.suit && Math.abs(o.rank - c.rank) === 1)) adj++;
    if (c.rank === rank) adj += 2; // ouvre une file
  }
  return adj;
}

/** Points attendus pour le détenteur de `hand` sur ce contrat (approx, plus bas = mieux). */
export function expectedPoints(contract: ContractId, hand: Card[], rank?: Rank): number {
  const hi = (r: number) => hand.filter((c) => c.rank >= r).length;
  const hearts = hand.filter(isHeart);
  switch (contract) {
    case 'COEUR':
      return hearts.filter((c) => c.rank >= 10).length * 10 + hearts.filter((c) => c.rank < 10).length * 3;
    case 'DAMES':
      return hand.filter(isQueen).length * 14 + hi(13) * 2;
    case 'PLIS':
      return hi(11) * 8;
    case 'BARBU':
      return (hand.some(isKingOfHearts) ? 35 : 0) + hearts.filter((c) => c.rank >= 11).length * 5;
    case 'DEUXDER':
      return hi(12) * 10;
    case 'SALADE':
      return (
        (expectedPoints('COEUR', hand) +
          expectedPoints('DAMES', hand) +
          expectedPoints('PLIS', hand) +
          expectedPoints('BARBU', hand) +
          expectedPoints('DEUXDER', hand)) /
        2
      );
    case 'REUSSITE':
      return 40 - reussiteFluidity(hand, rank ?? 8) * 4; // fluide -> bas (attractif)
    default:
      return 0;
  }
}

/** Meilleure hauteur d'ouverture Réussite pour cette main (max de fluidité). */
export function bestReussiteRank(hand: Card[]): Rank {
  const ranks = [...new Set(hand.map((c) => c.rank))] as Rank[];
  return maxBy(ranks, (r) => reussiteFluidity(hand, r));
}

// ---------------------------------------------------------------------------
// Décisions de niveau match (contrat, contre) et API publique.
// ---------------------------------------------------------------------------
/** Choix du contrat par le donneur : le plus sûr (espérance minimale). */
export function botChooseContract(s: MatchState, level: Difficulty, rng: () => number): Action {
  const options = legalContracts(s);
  const hand = s.pendingHands![s.dealer]!;
  if (level === 'facile') {
    const contract = pick(options, rng);
    if (contract === 'REUSSITE') {
      const ranks = [...new Set(hand.map((c) => c.rank))];
      return { t: 'CHOOSE_CONTRACT', contract, rank: pick(ranks, rng) as Rank };
    }
    return { t: 'CHOOSE_CONTRACT', contract };
  }
  if (level === 'impossible') return mcChooseContract(s, rng);
  const rankFor = (c: ContractId) => (c === 'REUSSITE' ? bestReussiteRank(hand) : undefined);
  const contract = minBy(options, (c) => expectedPoints(c, hand, rankFor(c)));
  const rank = rankFor(contract);
  return rank === undefined ? { t: 'CHOOSE_CONTRACT', contract } : { t: 'CHOOSE_CONTRACT', contract, rank };
}

const CONTRE_BASE: Record<ContractId, number> = {
  COEUR: 32,
  DAMES: 20,
  PLIS: 32,
  BARBU: 20,
  DEUXDER: 20,
  SALADE: 62,
  REUSSITE: 0,
};

/** Décision de contre : contrer si notre espérance de points est bien sous la moyenne. */
export function botContre(s: MatchState, player: PlayerId, level: Difficulty, rng: () => number): Action {
  if (level === 'facile') return { t: 'CONTRE', player, contre: rng() < 0.2 };
  if (level === 'impossible') return mcContre(s, player, rng);
  const contract = s.currentContract!;
  if (contract === 'REUSSITE') return { t: 'CONTRE', player, contre: false }; // trop incertain
  const hand = s.pendingHands![player]!;
  const factor = level === 'difficile' ? 0.7 : 0.45;
  const contre = expectedPoints(contract, hand) < CONTRE_BASE[contract] * factor;
  return { t: 'CONTRE', player, contre };
}

/** Coup à jouer dans un contrat à plis, selon le niveau. */
export function botTrickPlay(s: TrickRoundState, player: PlayerId, level: Difficulty, rng: () => number): Card {
  if (level === 'facile') return randomBot.trickPlay(s, player, rng);
  if (level === 'impossible') return mcTrickPlay(s, player, rng);
  return smartTrick(s, player, level === 'difficile');
}

/** Action de Réussite selon le niveau. */
export function botReussite(s: ReussiteState, player: PlayerId, level: Difficulty, rng: () => number): Action {
  if (level === 'facile') return randomBot.reussite(s, player, rng);
  if (level === 'impossible') return mcReussite(s, player, rng);
  return smartReussite(s, player);
}

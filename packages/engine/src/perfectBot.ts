// Bot « impossible » : Monte-Carlo par déterminisation (PIMC).
//
// Idée : à information imparfaite, on ne connaît pas les mains adverses. On en
// échantillonne donc plusieurs versions plausibles (« mondes ») à partir de la
// SEULE information publique — cartes déjà vues + tailles de mains + couleurs où
// un adversaire s'est montré coupé — puis on résout chaque monde en information
// parfaite avec une politique de simulation (l'heuristique `difficile`). On
// choisit l'action dont l'espérance de points est la meilleure.
//
// Honnêteté : ce module ne lit JAMAIS le contenu de `hands[o]` / `pendingHands[o]`
// d'un adversaire `o`. Les mains adverses sont reconstruites par `sampleWorlds`
// depuis `fullDeck − cartes vues − ma main`. Seules des quantités publiques
// (nombre de cartes restantes) sont utilisées.
import { fullDeck, shuffle, SUITS } from './cards.js';
import { CONTRACTS } from './contracts.js';
import { legalContractSets } from './match.js';
import { scoreReussite, scoreTrickContracts } from './scoring.js';
import { currentPlayer, initTrickRound, legalPlays, playCard } from './trickRound.js';
import {
  canPass,
  initReussiteRound,
  legalReussitePlays,
  reussitePass,
  reussitePlay,
} from './reussiteRound.js';
import { penaltyLeftOutside, seenCards, smartReussite, smartTrick, topReussiteRanks } from './bots.js';
import type {
  Action,
  Card,
  ContractId,
  MatchState,
  PlayerId,
  Rank,
  ReussiteState,
  Suit,
  TrickRoundState,
} from './types.js';

// Force/perf du niveau impossible. Mutable pour permettre aux tests de réduire
// le nombre de mondes (donc le temps de calcul) sans changer la logique.
export const IMPOSSIBLE = {
  cardWorlds: 20, // mondes échantillonnés par décision de jeu à la carte
  contractWorlds: 24, // mondes par contrat évalué au choix du contrat
  contreWorlds: 24, // mondes pour la décision de contre
  reussiteWorlds: 14, // mondes pour le jeu de la Réussite
  contreMargin: 3, // on ne contre que si l'espérance de gain dépasse cette marge
};

const ALL_PLAYERS: PlayerId[] = [0, 1, 2, 3];

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
function minBy<T>(a: T[], f: (x: T) => number): T {
  return a.reduce((b, x) => (f(x) < f(b) ? x : b));
}
function maxBy<T>(a: T[], f: (x: T) => number): T {
  return a.reduce((b, x) => (f(x) > f(b) ? x : b));
}
function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

// ---------------------------------------------------------------------------
// Échantillonnage des mains adverses (info publique uniquement).
// ---------------------------------------------------------------------------
/** Couleurs où chaque joueur s'est montré coupé (déduites du jeu public). */
function inferredVoids(s: TrickRoundState): Set<Suit>[] {
  const v: Set<Suit>[] = [new Set(), new Set(), new Set(), new Set()];
  const scan = (trick: TrickRoundState['currentTrick']) => {
    if (trick.length === 0) return;
    const led = trick[0]!.card.suit;
    for (const pc of trick) if (pc.card.suit !== led) v[pc.player]!.add(led);
  };
  s.completedTricks.forEach(scan);
  scan(s.currentTrick);
  return v;
}

/** Nombre de cartes déjà jouées par chaque joueur (public). */
function playedCounts(s: TrickRoundState): number[] {
  const cnt = [0, 0, 0, 0];
  for (const t of s.completedTricks) for (const pc of t) cnt[pc.player]!++;
  for (const pc of s.currentTrick) cnt[pc.player]!++;
  return cnt;
}

/** Tente une répartition des cartes invisibles respectant capacités + coupes. Null si bloqué. */
function tryAssign(
  unseen: Card[],
  opps: PlayerId[],
  capacity: Record<number, number>,
  voids: Set<Suit>[],
  rng: () => number,
): Record<number, Card[]> | null {
  const cap: Record<number, number> = { ...capacity };
  const out: Record<number, Card[]> = {};
  for (const o of opps) out[o] = [];
  const eligibleStatic = (c: Card) => opps.filter((o) => !voids[o]!.has(c.suit)).length;
  // Cartes les plus contraintes d'abord (le moins d'adversaires éligibles).
  const order = unseen.slice().sort((a, b) => eligibleStatic(a) - eligibleStatic(b));
  for (const c of order) {
    const cands = opps.filter((o) => cap[o]! > 0 && !voids[o]!.has(c.suit));
    if (cands.length === 0) return null;
    const chosen = pick(cands, rng);
    out[chosen]!.push(c);
    cap[chosen]!--;
  }
  return out;
}

/** Un monde plausible : mes vraies cartes + mains adverses échantillonnées. */
function sampleTrickWorld(s: TrickRoundState, me: PlayerId, rng: () => number): Card[][] {
  const myHand = s.hands[me]!;
  const blocked = new Set<string>([...seenCards(s), ...myHand].map(cardKey));
  const unseen = fullDeck().filter((c) => !blocked.has(cardKey(c)));

  const opps = ALL_PLAYERS.filter((p) => p !== me);
  const counts = playedCounts(s);
  const capacity: Record<number, number> = {};
  for (const o of opps) capacity[o] = 13 - counts[o]!; // 13 au départ, moins ce qui est joué

  const voids = inferredVoids(s);
  let assigned: Record<number, Card[]> | null = null;
  for (let t = 0; t < 30 && !assigned; t++) assigned = tryAssign(unseen, opps, capacity, voids, rng);
  // Repli si les coupes rendent la contrainte insatisfiable : on ignore les coupes.
  if (!assigned) assigned = tryAssign(unseen, opps, capacity, [new Set(), new Set(), new Set(), new Set()], rng);

  const hands: Card[][] = [[], [], [], []];
  hands[me] = myHand.slice();
  for (const o of opps) hands[o] = assigned![o]!;
  return hands;
}

/** Répartition simple (sans coupe) de `cards` selon des capacités données. */
function distribute(cards: Card[], seats: PlayerId[], capacity: Record<number, number>, rng: () => number): Record<number, Card[]> {
  const shuffled = shuffle(cards, rng);
  const out: Record<number, Card[]> = {};
  let i = 0;
  for (const p of seats) {
    out[p] = shuffled.slice(i, i + capacity[p]!);
    i += capacity[p]!;
  }
  return out;
}

/** Monde de début de manche : ma main connue, les 3 autres tirées à 13 cartes. */
function sampleFreshWorld(myHand: Card[], me: PlayerId, rng: () => number): Card[][] {
  const blocked = new Set(myHand.map(cardKey));
  const unseen = fullDeck().filter((c) => !blocked.has(cardKey(c)));
  const others = ALL_PLAYERS.filter((p) => p !== me);
  const cap: Record<number, number> = {};
  for (const o of others) cap[o] = 13;
  const dealt = distribute(unseen, others, cap, rng);
  const hands: Card[][] = [[], [], [], []];
  hands[me] = myHand.slice();
  for (const o of others) hands[o] = dealt[o]!;
  return hands;
}

// ---------------------------------------------------------------------------
// Simulations (rollouts) avec la politique `difficile`.
// ---------------------------------------------------------------------------
/** Termine un pli en cours avec la politique `smartTrick`, renvoie les points du contrat. */
function playoutTrick(start: TrickRoundState): number[] {
  let st = start;
  let guard = 0;
  while (!st.finished && guard++ < 60) {
    const p = currentPlayer(st);
    st = playCard(st, p, smartTrick(st, p, true));
  }
  return scoreTrickContracts(st.contracts, { completedTricks: st.completedTricks, wonBy: st.wonBy });
}

/** Simule une manche à plis complète depuis des mains données. */
function simulateTrick(contracts: ContractId[], hands: Card[][], leader: PlayerId): number[] {
  return playoutTrick(initTrickRound(contracts, hands, leader));
}

/** Termine une Réussite en cours avec la politique `smartReussite`, renvoie les points. */
function playoutReussite(start: ReussiteState): number[] {
  let st = start;
  let guard = 0;
  while (!st.finished && guard++ < 600) {
    const p = st.turn;
    const act = smartReussite(st, p);
    st = act.t === 'REUSSITE_PLAY' ? reussitePlay(st, p, act.card) : reussitePass(st, p);
  }
  return scoreReussite(st.finishOrder);
}

/** Simule une Réussite complète depuis des mains données. */
function simulateReussite(rank: Rank, hands: Card[][], starter: PlayerId): number[] {
  return playoutReussite(initReussiteRound(rank, hands, starter));
}

/** Points d'une manche (annonce quelconque) depuis des mains, hors contres. */
function simulateRound(contracts: ContractId[], rank: Rank | null, hands: Card[][], dealer: PlayerId): number[] {
  if (contracts.length === 1 && CONTRACTS[contracts[0]!].kind === 'reussite') {
    return simulateReussite(rank ?? 8, hands, dealer);
  }
  return simulateTrick(contracts, hands, dealer);
}

// ---------------------------------------------------------------------------
// Décisions.
// ---------------------------------------------------------------------------
/** Jeu à la carte : coup d'espérance de points minimale sur les mondes échantillonnés. */
export function mcTrickPlay(s: TrickRoundState, me: PlayerId, rng: () => number): Card {
  const plays = legalPlays(s, me);
  if (plays.length <= 1) return plays[0]!;

  // Plus aucune pénalité dehors : gagner est inoffensif, on lâche la plus haute.
  if (!penaltyLeftOutside(s.contracts, seenCards(s), s.hands[me]!)) {
    return maxBy(plays, (c) => c.rank);
  }

  const worlds: Card[][][] = [];
  for (let i = 0; i < IMPOSSIBLE.cardWorlds; i++) worlds.push(sampleTrickWorld(s, me, rng));

  let best = plays[0]!;
  let bestEV = Infinity;
  for (const c of plays) {
    let sum = 0;
    for (const hands of worlds) {
      const world: TrickRoundState = { ...s, hands: hands.map((h) => h.slice()) };
      sum += playoutTrick(playCard(world, me, c))[me]!;
    }
    const ev = sum / worlds.length;
    if (ev < bestEV - 1e-9 || (Math.abs(ev - bestEV) < 1e-9 && c.rank < best.rank)) {
      bestEV = ev;
      best = c;
    }
  }
  return best;
}

/**
 * Choix du contrat par AVANTAGE RELATIF (et non points absolus).
 *
 * Minimiser les points absolus du donneur biaise le choix vers les contrats
 * intrinsèquement bas (une Réussite fluide, une SALADE où tout le monde marque
 * peu) : on compare alors des échelles différentes. Or le donneur devra de toute
 * façon donner ses 7 contrats un jour ; ce qui compte n'est pas « où je marque
 * peu dans l'absolu » mais « où ma main me place le mieux PAR RAPPORT aux
 * adversaires ». On mesure donc `points_donneur − moyenne_adversaires` (négatif =
 * le donneur s'en tire mieux que les autres) et on garde le contrat qui maximise
 * cet avantage. La main décide, plus l'échelle du contrat.
 */
export function mcChooseContract(s: MatchState, rng: () => number): Action {
  const dealer = s.dealer;
  const hand = s.pendingHands![dealer]!;
  const sets = legalContractSets(s);
  const opps = ALL_PLAYERS.filter((p) => p !== dealer);

  // Budget constant : en manche combinée il y a jusqu'à 21 annonces possibles
  // au lieu de 7, on ne peut pas garder 24 mondes par annonce sans faire
  // attendre la table. Le nombre de simulations totales, lui, ne bouge pas.
  const budget = IMPOSSIBLE.contractWorlds * 7;
  const worldCount = Math.max(8, Math.round(budget / Math.max(1, sets.length)));

  // MONDES COMMUNS : toutes les annonces sont jugées sur les mêmes donnes.
  // Comparer des contrats sur des donnes différentes, c'est mesurer surtout le
  // bruit du tirage ; à donne égale, l'écart mesuré est bien celui du contrat.
  const worlds: Card[][][] = [];
  for (let i = 0; i < worldCount; i++) worlds.push(sampleFreshWorld(hand, dealer, rng));

  const evalSet = (contracts: ContractId[], rank: Rank | null): number => {
    let sum = 0;
    for (const w of worlds) {
      const pts = simulateRound(contracts, rank, w.map((h) => h.slice()), dealer);
      const oppAvg = opps.reduce<number>((a, o) => a + pts[o]!, 0) / opps.length;
      sum += pts[dealer]! - oppAvg; // avantage relatif : plus bas = mieux placé que les autres
    }
    return sum / worlds.length;
  };

  let best: { contracts: ContractId[]; rank: Rank | null } = { contracts: sets[0]!, rank: null };
  let bestEV = Infinity;
  for (const contracts of sets) {
    // La Réussite se donne seule : on teste ses hauteurs les plus fluides.
    const ranks: (Rank | null)[] =
      contracts.length === 1 && contracts[0] === 'REUSSITE' ? topReussiteRanks(hand, 3) : [null];
    for (const rank of ranks) {
      const ev = evalSet(contracts, rank);
      if (ev < bestEV) {
        bestEV = ev;
        best = { contracts, rank };
      }
    }
  }
  return best.rank === null
    ? { t: 'CHOOSE_CONTRACT', contracts: best.contracts }
    : { t: 'CHOOSE_CONTRACT', contracts: best.contracts, rank: best.rank };
}

/** Contre : on contre si l'espérance de `E = mes points − points du donneur` est nettement négative. */
export function mcContre(s: MatchState, me: PlayerId, rng: () => number): Action {
  const contracts = s.currentContracts;
  const rank = s.reussiteRank;
  const dealer = s.dealer;
  const myHand = s.pendingHands![me]!;

  let sumE = 0;
  for (let i = 0; i < IMPOSSIBLE.contreWorlds; i++) {
    const hands = sampleFreshWorld(myHand, me, rng);
    const pts = simulateRound(contracts, rank, hands, dealer);
    sumE += pts[me]! - pts[dealer]!;
  }
  const avgE = sumE / IMPOSSIBLE.contreWorlds;
  return { t: 'CONTRE', player: me, contre: avgE < -IMPOSSIBLE.contreMargin };
}

/** Jeu de la Réussite : action minimisant mes points attendus (anticipation 1-ply). */
export function mcReussite(s: ReussiteState, me: PlayerId, rng: () => number): Action {
  const plays = legalReussitePlays(s, me);
  const actions: Action[] = plays.map((card) => ({ t: 'REUSSITE_PLAY', player: me, card }));
  if (canPass(s, me)) actions.push({ t: 'REUSSITE_PASS', player: me });
  if (actions.length === 1) return actions[0]!;

  const worlds: Card[][][] = [];
  for (let i = 0; i < IMPOSSIBLE.reussiteWorlds; i++) worlds.push(sampleReussiteWorld(s, me, rng));

  let best = actions[0]!;
  let bestEV = Infinity;
  for (const act of actions) {
    let sum = 0;
    for (const hands of worlds) {
      const world: ReussiteState = { ...s, hands: hands.map((h) => h.slice()) };
      const next = act.t === 'REUSSITE_PLAY' ? reussitePlay(world, me, act.card) : reussitePass(world, me);
      sum += playoutReussite(next)[me]!;
    }
    const ev = sum / worlds.length;
    if (ev < bestEV) {
      bestEV = ev;
      best = act;
    }
  }
  return best;
}

/** Cartes déjà posées en Réussite (files contiguës) — information publique. */
function reussiteSeen(s: ReussiteState): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) {
    const fan = s.files[suit];
    if (fan) for (let r = fan.low; r <= fan.high; r++) out.push({ suit, rank: r as Rank });
  }
  return out;
}

/** Monde Réussite : ma vraie main + mains adverses tirées (tailles publiques respectées). */
function sampleReussiteWorld(s: ReussiteState, me: PlayerId, rng: () => number): Card[][] {
  const myHand = s.hands[me]!;
  const blocked = new Set([...reussiteSeen(s), ...myHand].map(cardKey));
  const unseen = fullDeck().filter((c) => !blocked.has(cardKey(c)));
  const others = ALL_PLAYERS.filter((p) => p !== me);
  const cap: Record<number, number> = {};
  for (const o of others) cap[o] = s.hands[o]!.length; // seule la TAILLE (publique) est lue
  const dealt = distribute(unseen, others, cap, rng);
  const hands: Card[][] = [[], [], [], []];
  hands[me] = myHand.slice();
  for (const o of others) hands[o] = dealt[o]!;
  return hands;
}

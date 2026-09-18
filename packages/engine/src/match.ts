// Orchestration d'une partie complète : 28 manches, rotation du donneur,
// choix du contrat, phase de contre, jeu, agrégation des scores.
import { deal, fullDeck, shuffle } from './cards.js';
import { ALL_CONTRACTS, CONTRACTS } from './contracts.js';
import { applyContres } from './contre.js';
import {
  DEFAULT_MATCH_OPTIONS,
  initialDealer,
  normalizeMatchOptions,
  totalManches,
  type MatchOptions,
} from './options.js';
import { botChooseContract, botContre, botReussite, botTrickPlay, type Difficulty } from './bots.js';
import { scoreReussite, scoreTrickContracts } from './scoring.js';
import { currentPlayer, initTrickRound, playCard } from './trickRound.js';
import { initReussiteRound, reussitePass, reussitePlay } from './reussiteRound.js';
import type {
  Action,
  ContractId,
  MatchState,
  PlayerId,
  Rank,
  ReussiteState,
  TrickRoundState,
} from './types.js';

/** Durée d'une partie aux règles complètes : 4 donneurs × 7 contrats. */
export const TOTAL_MANCHES = totalManches(DEFAULT_MATCH_OPTIONS);

/** Distribue et ouvre la phase de choix du contrat pour le donneur courant. */
function startManche(base: Omit<MatchState, 'pendingHands' | 'phase' | 'currentContracts' | 'reussiteRank' | 'contres' | 'contreDecided' | 'round'>, rng: () => number): MatchState {
  return {
    ...base,
    pendingHands: deal(shuffle(fullDeck(), rng)),
    phase: 'CHOOSE_CONTRACT',
    currentContracts: [],
    reussiteRank: null,
    contres: [],
    contreDecided: [],
    round: null,
  };
}

/** Crée une partie neuve et distribue la 1re manche. */
export function createMatch(rng: () => number = Math.random, options?: unknown): MatchState {
  const opts = options === undefined ? DEFAULT_MATCH_OPTIONS : normalizeMatchOptions(options);
  return startManche(
    {
      options: opts,
      dealer: initialDealer(opts, rng),
      playedContracts: [[], [], [], []],
      scores: [0, 0, 0, 0],
      mancheCount: 0,
    },
    rng
  );
}

/**
 * Remet des options valides sur un état venu de l'extérieur : sauvegarde faite
 * avant l'ajout des options, ou état reçu d'un client. Sans ça, `s.options`
 * serait `undefined` et tout le reste planterait à la première manche.
 */
export function withMatchOptions(s: MatchState): MatchState {
  // Sauvegardes d'avant les manches combinées : un contrat unique y était porté
  // par `currentContract` / `round.contract`. On les replie sur les listes.
  const legacy = s as unknown as { currentContract?: ContractId | null };
  const currentContracts = Array.isArray(s.currentContracts)
    ? s.currentContracts
    : legacy.currentContract
      ? [legacy.currentContract]
      : [];
  let round = s.round;
  if (round && 'currentTrick' in round && !Array.isArray(round.contracts)) {
    const old = round as unknown as { contract: ContractId };
    round = { ...round, contracts: [old.contract] };
  }
  const options =
    s.options && Array.isArray(s.options.contracts) && typeof s.options.perDealer === 'number'
      ? s.options
      : normalizeMatchOptions(s.options);
  return { ...s, options, currentContracts, round };
}

/** Contrats que le donneur courant n'a pas encore donnés, parmi ceux en jeu. */
export function legalContracts(s: MatchState): ContractId[] {
  const done = s.playedContracts[s.dealer]!;
  const inPlay = s.options?.contracts ?? ALL_CONTRACTS;
  return ALL_CONTRACTS.filter((c) => inPlay.includes(c) && !done.includes(c));
}

/**
 * Annonces possibles pour le donneur : toutes les combinaisons de
 * `options.combine` contrats encore disponibles. À 1 contrat par manche, c'est
 * simplement `legalContracts` emballé un par un.
 */
export function legalContractSets(s: MatchState): ContractId[][] {
  const pool = legalContracts(s);
  const k = s.options?.combine ?? 1;
  if (k <= 1) return pool.map((c) => [c]);
  const out: ContractId[][] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) out.push([pool[i]!, pool[j]!]);
  }
  return out;
}

/** Prochain joueur devant répondre au contre (ordre : donneur+1, +2, +3). */
export function nextContreResponder(s: MatchState): PlayerId | null {
  for (let i = 1; i <= 3; i++) {
    const p = ((s.dealer + i) % 4) as PlayerId;
    if (!s.contreDecided.includes(p)) return p;
  }
  return null;
}

function initRound(s: MatchState): TrickRoundState | ReussiteState {
  const hands = s.pendingHands!;
  const contracts = s.currentContracts;
  if (contracts.length === 1 && CONTRACTS[contracts[0]!].kind === 'reussite') {
    return initReussiteRound(s.reussiteRank!, hands, s.dealer);
  }
  return initTrickRound(contracts, hands, s.dealer);
}

/** Calcule les points de la manche (contrat + contres) et clôt la manche. */
function scoreAndAdvance(s: MatchState, rng: () => number): MatchState {
  const round = s.round!;
  const contracts = s.currentContracts;
  const roundPoints =
    'currentTrick' in round
      ? scoreTrickContracts(contracts, { completedTricks: round.completedTricks, wonBy: round.wonBy })
      : scoreReussite(round.finishOrder);

  const withContres = applyContres(roundPoints, s.dealer, s.contres);
  const scores = s.scores.map((v, i) => v + withContres[i]!);
  const playedContracts = s.playedContracts.map((arr) => arr.slice());
  playedContracts[s.dealer]!.push(...contracts);
  const mancheCount = s.mancheCount + 1;

  if (mancheCount >= totalManches(s.options)) {
    return { ...s, scores, playedContracts, mancheCount, phase: 'DONE', round: null, pendingHands: null };
  }
  return startManche(
    { options: s.options, dealer: ((s.dealer + 1) % 4) as PlayerId, playedContracts, scores, mancheCount },
    rng
  );
}

/**
 * Réducteur global. Applique une action selon la phase. Lève si l'action est
 * invalide (mauvaise phase, coup illégal, contrat déjà donné…).
 */
export function applyMatchAction(s: MatchState, action: Action, rng: () => number = Math.random): MatchState {
  switch (s.phase) {
    case 'CHOOSE_CONTRACT': {
      if (action.t !== 'CHOOSE_CONTRACT') throw new Error('Attendu : choix du contrat');
      const chosen = action.contracts ?? [];
      const expected = s.options.combine ?? 1;
      if (chosen.length !== expected) {
        throw new Error(`Il faut annoncer ${expected} contrat(s), pas ${chosen.length}`);
      }
      if (new Set(chosen).size !== chosen.length) throw new Error('Deux fois le même contrat');
      const legal = legalContracts(s);
      if (chosen.some((c) => !legal.includes(c))) throw new Error('Contrat déjà donné ou invalide');
      const isReussite = chosen.length === 1 && CONTRACTS[chosen[0]!].kind === 'reussite';
      if (isReussite && action.rank == null) throw new Error('Réussite : hauteur (rank) requise');
      const next: MatchState = {
        ...s,
        currentContracts: chosen,
        reussiteRank: action.rank ?? null,
        phase: 'CONTRE',
        contres: [],
        contreDecided: [],
      };
      // Contre désactivé : on saute la phase et on distribue tout de suite.
      if (!s.options.contre) return { ...next, phase: 'PLAY', round: initRound(next) };
      return next;
    }

    case 'CONTRE': {
      if (action.t !== 'CONTRE') throw new Error('Attendu : décision de contre');
      const expected = nextContreResponder(s);
      if (action.player !== expected) throw new Error('Ce n’est pas au tour de ce joueur de répondre');
      const contreDecided = [...s.contreDecided, action.player];
      const contres = action.contre ? [...s.contres, action.player] : s.contres;
      const next: MatchState = { ...s, contres, contreDecided };
      if (nextContreResponder(next) === null) {
        return { ...next, phase: 'PLAY', round: initRound(next) };
      }
      return next;
    }

    case 'PLAY': {
      const round = s.round!;
      if ('currentTrick' in round) {
        if (action.t !== 'PLAY_CARD') throw new Error('Attendu : PLAY_CARD');
        const nr = playCard(round, action.player, action.card);
        const s2: MatchState = { ...s, round: nr };
        return nr.finished ? scoreAndAdvance({ ...s2, phase: 'SCORING' }, rng) : s2;
      } else {
        let nr: ReussiteState;
        if (action.t === 'REUSSITE_PLAY') nr = reussitePlay(round, action.player, action.card);
        else if (action.t === 'REUSSITE_PASS') nr = reussitePass(round, action.player);
        else throw new Error('Attendu : action de Réussite');
        const s2: MatchState = { ...s, round: nr };
        return nr.finished ? scoreAndAdvance({ ...s2, phase: 'SCORING' }, rng) : s2;
      }
    }

    default:
      throw new Error(`Aucune action acceptée en phase ${s.phase}`);
  }
}

/** Joueur qui doit agir maintenant (ou null si phase terminale). */
export function currentActor(s: MatchState): PlayerId | null {
  switch (s.phase) {
    case 'CHOOSE_CONTRACT':
      return s.dealer;
    case 'CONTRE':
      return nextContreResponder(s);
    case 'PLAY': {
      const r = s.round!;
      return 'currentTrick' in r ? currentPlayer(r) : r.turn;
    }
    default:
      return null;
  }
}

/**
 * Action automatique (bot) pour l'acteur courant, selon le niveau demandé.
 * Sert au mode solo et au remplissage de table en ligne.
 */
export function autoAction(s: MatchState, rng: () => number = Math.random, level: Difficulty = 'facile'): Action {
  switch (s.phase) {
    case 'CHOOSE_CONTRACT':
      return botChooseContract(s, level, rng);
    case 'CONTRE':
      return botContre(s, nextContreResponder(s)!, level, rng);
    case 'PLAY': {
      const r = s.round!;
      if ('currentTrick' in r) {
        const p = currentPlayer(r);
        return { t: 'PLAY_CARD', player: p, card: botTrickPlay(r, p, level, rng) };
      }
      return botReussite(r, r.turn, level, rng);
    }
    default:
      throw new Error(`Aucune action auto en phase ${s.phase}`);
  }
}

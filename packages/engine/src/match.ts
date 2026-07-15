// Orchestration d'une partie complète : 28 manches, rotation du donneur,
// choix du contrat, phase de contre, jeu, agrégation des scores.
import { deal, fullDeck, shuffle } from './cards.js';
import { ALL_CONTRACTS, CONTRACTS } from './contracts.js';
import { applyContres } from './contre.js';
import { botChooseContract, botContre, botReussite, botTrickPlay, type Difficulty } from './bots.js';
import { scoreReussite, scoreTrickContract } from './scoring.js';
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

export const TOTAL_MANCHES = 28; // 4 donneurs × 7 contrats

/** Distribue et ouvre la phase de choix du contrat pour le donneur courant. */
function startManche(base: Omit<MatchState, 'pendingHands' | 'phase' | 'currentContract' | 'reussiteRank' | 'contres' | 'contreDecided' | 'round'>, rng: () => number): MatchState {
  return {
    ...base,
    pendingHands: deal(shuffle(fullDeck(), rng)),
    phase: 'CHOOSE_CONTRACT',
    currentContract: null,
    reussiteRank: null,
    contres: [],
    contreDecided: [],
    round: null,
  };
}

/** Crée une partie neuve (donneur = joueur 0) et distribue la 1re manche. */
export function createMatch(rng: () => number = Math.random): MatchState {
  return startManche(
    {
      dealer: 0,
      playedContracts: [[], [], [], []],
      scores: [0, 0, 0, 0],
      mancheCount: 0,
    },
    rng
  );
}

/** Contrats que le donneur courant n'a pas encore donnés. */
export function legalContracts(s: MatchState): ContractId[] {
  const done = s.playedContracts[s.dealer]!;
  return ALL_CONTRACTS.filter((c) => !done.includes(c));
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
  const contract = s.currentContract!;
  if (CONTRACTS[contract].kind === 'reussite') {
    return initReussiteRound(s.reussiteRank!, hands, s.dealer);
  }
  return initTrickRound(contract, hands, s.dealer);
}

/** Calcule les points de la manche (contrat + contres) et clôt la manche. */
function scoreAndAdvance(s: MatchState, rng: () => number): MatchState {
  const round = s.round!;
  const contract = s.currentContract!;
  const roundPoints =
    CONTRACTS[contract].kind === 'reussite'
      ? scoreReussite((round as ReussiteState).finishOrder)
      : scoreTrickContract(contract, {
          completedTricks: (round as TrickRoundState).completedTricks,
          wonBy: (round as TrickRoundState).wonBy,
        });

  const withContres = applyContres(roundPoints, s.dealer, s.contres);
  const scores = s.scores.map((v, i) => v + withContres[i]!);
  const playedContracts = s.playedContracts.map((arr) => arr.slice());
  playedContracts[s.dealer]!.push(contract);
  const mancheCount = s.mancheCount + 1;

  if (mancheCount >= TOTAL_MANCHES) {
    return { ...s, scores, playedContracts, mancheCount, phase: 'DONE', round: null, pendingHands: null };
  }
  return startManche(
    { dealer: ((s.dealer + 1) % 4) as PlayerId, playedContracts, scores, mancheCount },
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
      if (!legalContracts(s).includes(action.contract)) throw new Error('Contrat déjà donné ou invalide');
      if (CONTRACTS[action.contract].kind === 'reussite' && action.rank == null) {
        throw new Error('Réussite : hauteur (rank) requise');
      }
      return {
        ...s,
        currentContract: action.contract,
        reussiteRank: action.rank ?? null,
        phase: 'CONTRE',
        contres: [],
        contreDecided: [],
      };
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

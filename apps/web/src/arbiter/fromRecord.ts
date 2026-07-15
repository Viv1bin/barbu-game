import type { ContractId } from '@barbu/engine';
import type { MatchRecord, Store } from '../profiles/store.js';
import type { ArbiterState } from './useArbiter.js';

/**
 * Reconstruit un ArbiterState terminé à partir d'une partie archivée,
 * pour réutiliser tels quels le tableau des scores et l'export PDF.
 */
export function stateFromRecord(store: Store, m: MatchRecord): ArbiterState {
  const playedContracts: ContractId[][] = [[], [], [], []];
  for (const manche of m.history) playedContracts[manche.dealer]!.push(manche.contract);

  const seated = m.seats.map((id) => store.profiles.find((p) => p.id === id));

  return {
    seats: m.seats,
    names: seated.map((p, i) => p?.name ?? `Joueur ${i + 1} (supprimé)`),
    avatars: seated.map((p) => p?.avatar ?? '👤'),
    dealer: 0,
    mancheCount: m.history.length,
    playedContracts,
    phase: 'DONE',
    currentContract: null,
    contres: [],
    contreDecided: [],
    scores: m.scores,
    history: m.history,
  };
}

/** Classement d'une partie archivée : le moins de points gagne. */
export function rankingOf(state: ArbiterState): { name: string; avatar: string; score: number }[] {
  return state.names
    .map((name, p) => ({ name, avatar: state.avatars[p]!, score: state.scores[p]! }))
    .sort((a, b) => a.score - b.score);
}

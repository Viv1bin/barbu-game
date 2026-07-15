import { useState } from 'react';
import { ALL_CONTRACTS, applyContres, type ContractId, type PlayerId } from '@barbu/engine';

export const TOTAL_MANCHES = 28;

export type ArbiterPhase = 'SETUP' | 'CONTRACT' | 'CONTRE' | 'RESULT' | 'DONE';

export interface MancheLog {
  dealer: PlayerId;
  contract: ContractId;
  contres: PlayerId[];
  points: number[]; // après contres
}

export interface ArbiterState {
  /** Ids des profils assis, par siège. */
  seats: string[];
  names: string[];
  avatars: string[];
  dealer: PlayerId;
  mancheCount: number;
  playedContracts: ContractId[][];
  phase: ArbiterPhase;
  currentContract: ContractId | null;
  contres: PlayerId[];
  contreDecided: PlayerId[];
  scores: number[];
  history: MancheLog[];
}

function initial(): ArbiterState {
  return {
    seats: [],
    names: ['Joueur 1', 'Joueur 2', 'Joueur 3', 'Joueur 4'],
    avatars: ['🙂', '🙂', '🙂', '🙂'],
    dealer: 0,
    mancheCount: 0,
    playedContracts: [[], [], [], []],
    phase: 'SETUP',
    currentContract: null,
    contres: [],
    contreDecided: [],
    scores: [0, 0, 0, 0],
    history: [],
  };
}

export function legalContracts(s: ArbiterState): ContractId[] {
  const done = s.playedContracts[s.dealer]!;
  return ALL_CONTRACTS.filter((c) => !done.includes(c));
}

export function nextResponder(s: ArbiterState): PlayerId | null {
  for (let i = 1; i <= 3; i++) {
    const p = ((s.dealer + i) % 4) as PlayerId;
    if (!s.contreDecided.includes(p)) return p;
  }
  return null;
}

export interface Seated {
  id: string;
  name: string;
  avatar: string;
}

export interface Arbiter {
  state: ArbiterState;
  start: (players: Seated[]) => void;
  chooseContract: (contract: ContractId) => void;
  respondContre: (contre: boolean) => void;
  submitResult: (rawPoints: number[]) => void;
  reset: () => void;
}

export function useArbiter(): Arbiter {
  const [state, setState] = useState<ArbiterState>(initial);

  return {
    state,
    start: (players) =>
      setState((s) => ({
        ...s,
        seats: players.map((p) => p.id),
        names: players.map((p, i) => p.name.trim() || `Joueur ${i + 1}`),
        avatars: players.map((p) => p.avatar),
        phase: 'CONTRACT',
      })),

    chooseContract: (contract) =>
      setState((s) => ({ ...s, currentContract: contract, phase: 'CONTRE', contres: [], contreDecided: [] })),

    respondContre: (contre) =>
      setState((s) => {
        const p = nextResponder(s);
        if (p === null) return s;
        const contreDecided = [...s.contreDecided, p];
        const contres = contre ? [...s.contres, p] : s.contres;
        const next = { ...s, contreDecided, contres };
        return nextResponder(next) === null ? { ...next, phase: 'RESULT' as const } : next;
      }),

    submitResult: (rawPoints) =>
      setState((s) => {
        const points = applyContres(rawPoints, s.dealer, s.contres);
        const scores = s.scores.map((v, i) => v + points[i]!);
        const playedContracts = s.playedContracts.map((a) => a.slice());
        playedContracts[s.dealer]!.push(s.currentContract!);
        const history = [...s.history, { dealer: s.dealer, contract: s.currentContract!, contres: s.contres, points }];
        const mancheCount = s.mancheCount + 1;
        if (mancheCount >= TOTAL_MANCHES) {
          return { ...s, scores, playedContracts, history, mancheCount, phase: 'DONE' as const, currentContract: null };
        }
        return {
          ...s,
          scores,
          playedContracts,
          history,
          mancheCount,
          dealer: ((s.dealer + 1) % 4) as PlayerId,
          phase: 'CONTRACT' as const,
          currentContract: null,
          contres: [],
          contreDecided: [],
        };
      }),

    reset: () => setState(initial()),
  };
}

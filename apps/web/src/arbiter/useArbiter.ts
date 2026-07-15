import { useEffect, useState } from 'react';
import { ALL_CONTRACTS, applyContres, type ContractId, type PlayerId } from '@barbu/engine';

export const TOTAL_MANCHES = 28;

const SAVE_KEY = 'barbu.arbiter.v1';

export type ArbiterPhase = 'SETUP' | 'CONTRACT' | 'CONTRE' | 'RESULT' | 'DONE';

export interface MancheLog {
  dealer: PlayerId;
  contract: ContractId;
  contres: PlayerId[];
  /** Points de la manche avant application des contres. */
  raw: number[];
  /** Points finalement comptés, contres appliqués. */
  points: number[];
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

/**
 * Recalcule tout ce qui se déduit de l'historique : scores cumulés, contrats
 * déjà donnés, nombre de manches, donneur courant. Seule source de vérité
 * après une édition ou une annulation de manche.
 */
export function derive(s: ArbiterState): ArbiterState {
  const scores = [0, 0, 0, 0];
  const playedContracts: ContractId[][] = [[], [], [], []];
  for (const m of s.history) {
    for (let p = 0; p < 4; p++) scores[p]! += m.points[p]!;
    playedContracts[m.dealer]!.push(m.contract);
  }
  const mancheCount = s.history.length;
  const done = mancheCount >= TOTAL_MANCHES;
  return {
    ...s,
    scores,
    playedContracts,
    mancheCount,
    dealer: done ? s.dealer : ((mancheCount % 4) as PlayerId),
    phase: done ? 'DONE' : s.phase,
  };
}

export function legalContracts(s: ArbiterState): ContractId[] {
  const done = s.playedContracts[s.dealer]!;
  return ALL_CONTRACTS.filter((c) => !done.includes(c));
}

/** Contrats possibles pour la manche `index` déjà jouée (le sien reste permis). */
export function legalContractsForEdit(s: ArbiterState, index: number): ContractId[] {
  const m = s.history[index];
  if (!m) return [];
  const used = s.history.filter((x, i) => i !== index && x.dealer === m.dealer).map((x) => x.contract);
  return ALL_CONTRACTS.filter((c) => !used.includes(c));
}

export function nextResponder(s: ArbiterState): PlayerId | null {
  for (let i = 1; i <= 3; i++) {
    const p = ((s.dealer + i) % 4) as PlayerId;
    if (!s.contreDecided.includes(p)) return p;
  }
  return null;
}

/** Seule une partie commencée mais pas finie mérite d'être reprise. */
function isResumable(s: ArbiterState): boolean {
  return s.phase !== 'SETUP' && s.phase !== 'DONE';
}

function load(): ArbiterState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ArbiterState;
    if (!s || typeof s !== 'object' || !Array.isArray(s.history) || !isResumable(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Une partie terminée n'est pas conservée : elle part dans l'historique des
 * profils au moment du DONE, et la reproposer ferait un doublon de stats.
 */
function persist(s: ArbiterState): void {
  try {
    if (isResumable(s)) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* quota / mode privé : la partie reste jouable, elle ne sera juste pas reprise */
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* rien à faire */
  }
}

export interface Seated {
  id: string;
  name: string;
  avatar: string;
}

export interface EditPayload {
  contract: ContractId;
  contres: PlayerId[];
  raw: number[];
}

export interface Arbiter {
  state: ArbiterState;
  /** Partie interrompue trouvée au chargement, en attente de reprise. */
  saved: ArbiterState | null;
  resume: () => void;
  discardSaved: () => void;
  start: (players: Seated[]) => void;
  chooseContract: (contract: ContractId) => void;
  respondContre: (contre: boolean) => void;
  submitResult: (rawPoints: number[]) => void;
  /** Repart au choix du contrat : annule contrat et contres de la manche en cours. */
  restartManche: () => void;
  /** Annule la dernière manche validée pour la rejouer. */
  undoLastManche: () => void;
  /** Réécrit une manche déjà jouée et recalcule tous les cumuls. */
  editManche: (index: number, payload: EditPayload) => void;
  reset: () => void;
}

export function useArbiter(): Arbiter {
  const [state, setState] = useState<ArbiterState>(initial);
  const [saved, setSaved] = useState<ArbiterState | null>(load);

  // Sauvegarde à chaque changement : fermer l'onglet ne perd pas la partie.
  useEffect(() => {
    persist(state);
  }, [state]);

  return {
    state,
    saved,

    resume: () => {
      if (saved) setState(saved);
      setSaved(null);
    },

    discardSaved: () => {
      clearSavedGame();
      setSaved(null);
    },

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
        const entry: MancheLog = {
          dealer: s.dealer,
          contract: s.currentContract!,
          contres: s.contres,
          raw: rawPoints,
          points: applyContres(rawPoints, s.dealer, s.contres),
        };
        return derive({
          ...s,
          history: [...s.history, entry],
          phase: 'CONTRACT',
          currentContract: null,
          contres: [],
          contreDecided: [],
        });
      }),

    restartManche: () =>
      setState((s) => ({ ...s, phase: 'CONTRACT', currentContract: null, contres: [], contreDecided: [] })),

    undoLastManche: () =>
      setState((s) => {
        if (s.history.length === 0) return s;
        return derive({
          ...s,
          history: s.history.slice(0, -1),
          phase: 'CONTRACT',
          currentContract: null,
          contres: [],
          contreDecided: [],
        });
      }),

    editManche: (index, { contract, contres, raw }) =>
      setState((s) => {
        const m = s.history[index];
        if (!m) return s;
        const entry: MancheLog = {
          dealer: m.dealer,
          contract,
          contres,
          raw,
          points: applyContres(raw, m.dealer, contres),
        };
        return derive({ ...s, history: s.history.map((x, i) => (i === index ? entry : x)) });
      }),

    reset: () => {
      clearSavedGame();
      setSaved(null);
      setState(initial());
    },
  };
}

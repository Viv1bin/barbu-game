import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMatchAction,
  autoAction,
  createMatch,
  currentActor,
  trickWinner,
  type Action,
  type Card,
  type ContractId,
  type Difficulty,
  type MatchState,
  type PlayedCard,
  type PlayerId,
  type Rank,
} from '@barbu/engine';

export const HUMAN = 0;

const BOT_DELAY = 650; // ms entre deux coups de bot (voir les cartes tomber)
const SHOW_MS = 1100; // ms d'affichage d'un pli complet
const COLLECT_MS = 550; // ms d'animation « le gagnant ramasse le pli »

/** RNG déterministe (mulberry32). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrickPause {
  trick: PlayedCard[];
  winner: PlayerId;
  /** true = phase « le gagnant ramasse » (cartes filent vers son siège). */
  collecting: boolean;
}

export interface SoloGame {
  state: MatchState;
  level: Difficulty;
  /**
   * Coup conseillé à l'humain (mode aide), calculé par l'IA « impossible » sur
   * la situation courante — ou null si l'aide est coupée / ce n'est pas à lui.
   */
  hint: Action | null;
  /** Pli complet figé en cours d'affichage (pause), ou null. */
  pause: TrickPause | null;
  /** Dernière donne complète (4 mains), pour le reveal de fin de partie. */
  lastDeal: Card[][] | null;
  /** true si l'humain ne peut pas agir (bot en cours ou pause). */
  busy: boolean;
  chooseContract: (contract: ContractId, rank?: Rank) => void;
  respondContre: (contre: boolean) => void;
  playCard: (card: Card) => void;
  reussitePlay: (card: Card) => void;
  reussitePass: () => void;
  newGame: () => void;
}

export function useSoloGame(level: Difficulty, aid = false): SoloGame {
  const rngRef = useRef<() => number>(mulberry((Math.random() * 2 ** 32) >>> 0));
  const [state, setState] = useState<MatchState>(() => createMatch(rngRef.current));
  const [pause, setPause] = useState<TrickPause | null>(null);
  const dealRef = useRef<Card[][] | null>(null);

  // Mémorise la donne complète tant qu'elle est disponible (avant le jeu).
  if (state.pendingHands) dealRef.current = state.pendingHands.map((h) => h.slice());

  const busy = pause !== null;

  // Coup conseillé : l'IA « impossible » joue à la place de l'humain sur l'état
  // courant. RNG dédié (ne consomme pas celui de la partie) ; recalculé une fois
  // par état grâce à useMemo. Coûteux (Monte-Carlo) → seulement quand utile.
  const hint = useMemo<Action | null>(() => {
    if (!aid || busy || state.phase === 'DONE' || currentActor(state) !== HUMAN) return null;
    try {
      return autoAction(state, mulberry((Math.random() * 2 ** 32) >>> 0), 'impossible');
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aid, state, busy]);

  // Applique une action ; si elle complète un pli, fige-le pour la pause.
  const step = (action: Parameters<typeof applyMatchAction>[1]) => {
    const r = state.round;
    let nextPause: TrickPause | null = null;
    if (
      state.phase === 'PLAY' &&
      r &&
      'currentTrick' in r &&
      action.t === 'PLAY_CARD' &&
      r.currentTrick.length === 3
    ) {
      const trick: PlayedCard[] = [...r.currentTrick, { player: action.player, card: action.card }];
      nextPause = { trick, winner: trickWinner(trick).player, collecting: false };
    }
    const next = applyMatchAction(state, action, rngRef.current);
    setState(next);
    if (nextPause) setPause(nextPause);
  };

  // Boucle bots : si pas occupé et que l'acteur n'est pas l'humain, joue après un délai.
  useEffect(() => {
    if (busy || state.phase === 'DONE' || currentActor(state) === HUMAN) return;
    const id = setTimeout(() => step(autoAction(state, rngRef.current, level)), BOT_DELAY);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy, level]);

  // Pause en deux temps : afficher le pli, puis le faire filer vers le gagnant.
  useEffect(() => {
    if (!pause) return;
    if (!pause.collecting) {
      const id = setTimeout(() => setPause((p) => (p ? { ...p, collecting: true } : p)), SHOW_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPause(null), COLLECT_MS);
    return () => clearTimeout(id);
  }, [pause]);

  return {
    state,
    level,
    hint,
    pause,
    lastDeal: dealRef.current,
    busy,
    chooseContract: (contract, rank) => step({ t: 'CHOOSE_CONTRACT', contract, rank }),
    respondContre: (contre) => step({ t: 'CONTRE', player: HUMAN, contre }),
    playCard: (card) => step({ t: 'PLAY_CARD', player: HUMAN, card }),
    reussitePlay: (card) => step({ t: 'REUSSITE_PLAY', player: HUMAN, card }),
    reussitePass: () => step({ t: 'REUSSITE_PASS', player: HUMAN }),
    newGame: () => {
      rngRef.current = mulberry((Math.random() * 2 ** 32) >>> 0);
      setPause(null);
      setState(createMatch(rngRef.current));
    },
  };
}

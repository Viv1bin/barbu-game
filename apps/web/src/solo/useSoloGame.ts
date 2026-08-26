import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMatchAction,
  autoAction,
  createMatch,
  currentActor,
  withMatchOptions,
  trickWinner,
  type Action,
  type Card,
  type ContractId,
  type Difficulty,
  type MatchOptions,
  type MatchState,
  type PlayedCard,
  type PlayerId,
  type Rank,
} from '@barbu/engine';

export const HUMAN = 0;

const BOT_DELAY = 650; // ms entre deux coups de bot (voir les cartes tomber)
const SHOW_MS = 1100; // ms d'affichage d'un pli complet
const COLLECT_MS = 550; // ms d'animation « le gagnant ramasse le pli »

/** Rythme des bots : multiplie tous les délais d'animation. */
export type BotSpeed = 'posee' | 'normale' | 'rapide';
const SPEED_FACTOR: Record<BotSpeed, number> = { posee: 1.6, normale: 1, rapide: 0.35 };

/** RNG déterministe (mulberry32) dont l'état interne est lisible/réglable (pour la sauvegarde). */
export interface Rng {
  (): number;
  state: number;
}
function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  const fn = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  Object.defineProperty(fn, 'state', { get: () => a >>> 0, set: (v: number) => (a = v >>> 0) });
  return fn;
}

export interface TrickPause {
  trick: PlayedCard[];
  winner: PlayerId;
  /** true = phase « le gagnant ramasse » (cartes filent vers son siège). */
  collecting: boolean;
}

/** Une manche terminée, pour le tableau des scores. */
export interface SoloManche {
  dealer: PlayerId;
  contract: ContractId;
  contres: PlayerId[];
  /** Points marqués par chaque joueur sur cette manche (contres appliqués). */
  points: number[];
}

/** Blob de sauvegarde d'une partie solo, persisté côté compte (opaque au serveur). */
export interface SoloSave {
  v: 1;
  level: Difficulty;
  /** État interne du RNG au point de reprise (début de manche). */
  rng: number;
  state: MatchState;
  history: SoloManche[];
}

/** Options de reprise / sauvegarde de la partie solo. */
export interface SoloOptions {
  /** Sauvegarde à reprendre au montage (sinon nouvelle partie). */
  resume?: SoloSave | null;
  /** Appelé à chaque nouvelle manche pour persister l'état (point de reprise). */
  onPersist?: (save: SoloSave) => void;
  /** Appelé quand la partie se termine ou est relancée (efface la sauvegarde). */
  onClear?: () => void;
  /** Règles de la partie (ignorées à la reprise : la sauvegarde porte les siennes). */
  options?: MatchOptions;
  /** Rythme des bots et des animations. */
  speed?: BotSpeed;
}

export interface SoloGame {
  state: MatchState;
  level: Difficulty;
  /**
   * Coup conseillé à l'humain (mode aide), calculé par l'IA « impossible » sur
   * la situation courante — ou null si l'aide est coupée / ce n'est pas à lui.
   */
  hint: Action | null;
  /** Manches terminées (pour le tableau des scores), dans l'ordre. */
  history: SoloManche[];
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
  /** Instantané reprenable de la partie à cet instant (pour sauvegarde manuelle). */
  snapshot: () => SoloSave;
}

export function useSoloGame(level: Difficulty, aid = false, opts: SoloOptions = {}): SoloGame {
  const resume = opts.resume;
  const rngRef = useRef<Rng>(mulberry((Math.random() * 2 ** 32) >>> 0));
  // Reprise : réinjecte l'état RNG sauvegardé (une seule fois, au tout premier rendu).
  const initedRef = useRef(false);
  if (!initedRef.current && resume) rngRef.current.state = resume.rng;
  const [state, setState] = useState<MatchState>(() =>
    // Une sauvegarde d'avant l'ajout des options n'en a pas : on la complète.
    resume ? withMatchOptions(resume.state) : createMatch(rngRef.current, opts.options)
  );
  const [pause, setPause] = useState<TrickPause | null>(null);
  const [history, setHistory] = useState<SoloManche[]>(() => (resume ? resume.history : []));
  const dealRef = useRef<Card[][] | null>(null);
  initedRef.current = true;

  // Mémorise la donne complète tant qu'elle est disponible (avant le jeu).
  if (state.pendingHands) dealRef.current = state.pendingHands.map((h) => h.slice());

  const busy = pause !== null;
  const factor = SPEED_FACTOR[opts.speed ?? 'normale'];

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
    // Manche bouclée : journaliser le contrat, les contres et le delta de score.
    if (next.mancheCount > state.mancheCount && state.currentContract) {
      const entry: SoloManche = {
        dealer: state.dealer,
        contract: state.currentContract,
        contres: state.contres,
        points: next.scores.map((sc, p) => sc - state.scores[p]!),
      };
      const nextHistory = [...history, entry];
      setHistory(nextHistory);
      // Fin de manche = point de reprise : on sauvegarde (ou on efface si partie finie).
      if (next.phase === 'DONE') opts.onClear?.();
      else opts.onPersist?.({ v: 1, level, rng: rngRef.current.state, state: next, history: nextHistory });
    }
    setState(next);
    if (nextPause) setPause(nextPause);
  };

  // Boucle bots : si pas occupé et que l'acteur n'est pas l'humain, joue après un délai.
  useEffect(() => {
    if (busy || state.phase === 'DONE' || currentActor(state) === HUMAN) return;
    const id = setTimeout(() => step(autoAction(state, rngRef.current, level)), BOT_DELAY * factor);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy, level, factor]);

  // Pause en deux temps : afficher le pli, puis le faire filer vers le gagnant.
  useEffect(() => {
    if (!pause) return;
    if (!pause.collecting) {
      const id = setTimeout(() => setPause((p) => (p ? { ...p, collecting: true } : p)), SHOW_MS * factor);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPause(null), COLLECT_MS * factor);
    return () => clearTimeout(id);
  }, [pause, factor]);

  return {
    state,
    level,
    hint,
    history,
    pause,
    lastDeal: dealRef.current,
    busy,
    chooseContract: (contract, rank) => step({ t: 'CHOOSE_CONTRACT', contract, rank }),
    respondContre: (contre) => step({ t: 'CONTRE', player: HUMAN, contre }),
    playCard: (card) => step({ t: 'PLAY_CARD', player: HUMAN, card }),
    reussitePlay: (card) => step({ t: 'REUSSITE_PLAY', player: HUMAN, card }),
    reussitePass: () => step({ t: 'REUSSITE_PASS', player: HUMAN }),
    newGame: () => {
      opts.onClear?.();
      rngRef.current = mulberry((Math.random() * 2 ** 32) >>> 0);
      setPause(null);
      setHistory([]);
      setState(createMatch(rngRef.current, state.options));
    },
    snapshot: () => ({ v: 1, level, rng: rngRef.current.state, state, history }),
  };
}

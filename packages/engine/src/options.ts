// Options de partie, partagées solo / en ligne. Elles vivent dans le
// `MatchState` : une partie sauvegardée ou reprise garde ses règles, et le
// serveur n'a pas à les mémoriser à côté de l'état.
import { ALL_CONTRACTS } from './contracts.js';
import type { ContractId, PlayerId } from './types.js';

export interface MatchOptions {
  /**
   * Contrats en jeu. Chaque joueur donne chaque contrat une fois : la partie
   * dure donc `contracts.length × 4` manches. C'est le seul levier de durée —
   * retirer des contrats est la façon « propre » de raccourcir une partie sans
   * casser la rotation du donneur.
   */
  contracts: ContractId[];
  /** Phase de contre. Coupée, on passe du choix du contrat au jeu. */
  contre: boolean;
  /** Donneur de départ tiré au sort plutôt que le joueur 0. */
  randomDealer: boolean;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  contracts: [...ALL_CONTRACTS],
  contre: true,
  randomDealer: false,
};

/** Nombre total de manches d'une partie jouée avec ces options. */
export function totalManches(o: MatchOptions): number {
  return o.contracts.length * 4;
}

/** Formats prêts à l'emploi proposés dans l'écran de configuration. */
export const MATCH_FORMATS: {
  id: string;
  title: string;
  desc: string;
  contracts: ContractId[];
}[] = [
  {
    id: 'complete',
    title: 'Partie complète',
    desc: 'Les 7 contrats, 28 manches. Le Barbu tel qu’il se joue à table.',
    contracts: [...ALL_CONTRACTS],
  },
  {
    id: 'courte',
    title: 'Partie courte',
    desc: '4 contrats, 16 manches. Environ deux fois plus rapide.',
    contracts: ['BARBU', 'COEUR', 'DAMES', 'PLIS'],
  },
  {
    id: 'eclair',
    title: 'Partie éclair',
    desc: '2 contrats, 8 manches. Pour une partie entre deux cours.',
    contracts: ['BARBU', 'PLIS'],
  },
];

/**
 * Rend des options sûres à partir de n'importe quelle entrée. Appelé côté
 * serveur sur ce que le client envoie (jamais faire confiance au client) et
 * côté client sur les sauvegardes d'avant l'ajout des options.
 */
export function normalizeMatchOptions(raw: unknown): MatchOptions {
  const o = (raw ?? {}) as Partial<MatchOptions>;
  const asked = Array.isArray(o.contracts) ? o.contracts : [];
  // Filtrer sur ALL_CONTRACTS garde l'ordre canonique et élimine doublons et
  // valeurs inventées ; une liste vide retomberait sur une partie de 0 manche.
  const contracts = ALL_CONTRACTS.filter((c) => asked.includes(c));
  return {
    contracts: contracts.length > 0 ? contracts : [...ALL_CONTRACTS],
    contre: o.contre !== false,
    randomDealer: o.randomDealer === true,
  };
}

/** Donneur de départ : tiré au sort si l'option est active. */
export function initialDealer(o: MatchOptions, rng: () => number): PlayerId {
  return o.randomDealer ? (Math.floor(rng() * 4) % 4 as PlayerId) : 0;
}

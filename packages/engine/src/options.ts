// Options de partie, partagées solo / en ligne. Elles vivent dans le
// `MatchState` : une partie sauvegardée ou reprise garde ses règles, et le
// serveur n'a pas à les mémoriser à côté de l'état.
import { ALL_CONTRACTS, CONTRACTS } from './contracts.js';
import type { ContractId, PlayerId } from './types.js';

export interface MatchOptions {
  /**
   * Contrats autorisés. C'est un vivier, pas un programme : le donneur y pioche
   * ce qu'il n'a pas encore donné. Combien il en donne au total, c'est
   * `perDealer` qui le dit.
   */
  contracts: ContractId[];
  /**
   * Manches données par chaque donneur, donc `perDealer × 4` manches en tout.
   * Plus petit que le vivier = partie raccourcie sans rien retirer du choix :
   * certains contrats ne sortiront simplement jamais, et personne ne sait
   * lesquels avant la fin.
   */
  perDealer: number;
  /**
   * Contrats annoncés d'un coup par le donneur (1 ou 2). À 2, la manche se joue
   * une seule fois et les deux barèmes s'additionnent — le Roi de cœur n'arrête
   * alors plus le jeu, l'autre contrat continue de tourner.
   */
  combine: number;
  /** Phase de contre. Coupée, on passe du choix du contrat au jeu. */
  contre: boolean;
  /** Donneur de départ tiré au sort plutôt que le joueur 0. */
  randomDealer: boolean;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  contracts: [...ALL_CONTRACTS],
  perDealer: ALL_CONTRACTS.length,
  combine: 1,
  contre: true,
  randomDealer: true,
};

/** Nombre total de manches d'une partie jouée avec ces options. */
export function totalManches(o: MatchOptions): number {
  return (o.perDealer ?? o.contracts.length) * 4;
}

/** Contrats jouables en manche combinée : la Réussite a sa propre mécanique. */
const COMBINABLE = ALL_CONTRACTS.filter((c) => CONTRACTS[c].kind === 'trick');

/** Formats prêts à l'emploi proposés dans l'écran de configuration. */
export const MATCH_FORMATS: {
  id: string;
  title: string;
  desc: string;
  contracts: ContractId[];
  perDealer: number;
  combine: number;
}[] = [
  {
    id: 'complete',
    title: 'Partie complète',
    desc: 'Les 7 contrats, 28 manches. Le Barbu tel qu’il se joue à table.',
    contracts: [...ALL_CONTRACTS],
    perDealer: 7,
    combine: 1,
  },
  {
    id: 'courte',
    title: 'Partie courte',
    desc: '16 manches. Chacun ne donne que 4 contrats, mais les choisit librement parmi les 7 : trois resteront au placard, et on ne sait pas lesquels d’avance.',
    contracts: [...ALL_CONTRACTS],
    perDealer: 4,
    combine: 1,
  },
  {
    id: 'eclair',
    title: 'Partie éclair',
    desc: '8 manches. Deux tours de table, deux contrats annoncés ensemble à chaque manche (points cumulés). Sans Salade ni Réussite.',
    contracts: COMBINABLE.filter((c) => c !== 'SALADE'),
    perDealer: 2,
    combine: 2,
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
  const pool = ALL_CONTRACTS.filter((c) => asked.includes(c));
  const combine = o.combine === 2 ? 2 : 1;
  // En manche combinée la Réussite ne peut pas suivre : elle ne se joue pas en plis.
  const contracts = (pool.length > 0 ? pool : [...ALL_CONTRACTS]).filter(
    (c) => combine === 1 || CONTRACTS[c].kind === 'trick'
  );
  // Un donneur ne redonne jamais un contrat : il ne peut pas en tenir plus que
  // ce que le vivier permet, sinon la partie se bloquerait en cours de route.
  const maxPerDealer = Math.max(1, Math.floor(contracts.length / combine));
  const askedPer = Number(o.perDealer);
  const perDealer = Number.isFinite(askedPer)
    ? Math.min(maxPerDealer, Math.max(1, Math.floor(askedPer)))
    : maxPerDealer;
  return {
    contracts: contracts.length > 0 ? contracts : [...ALL_CONTRACTS],
    perDealer,
    combine,
    contre: o.contre !== false,
    randomDealer: o.randomDealer !== false,
  };
}

/** Donneur de départ : tiré au sort si l'option est active. */
export function initialDealer(o: MatchOptions, rng: () => number): PlayerId {
  return o.randomDealer ? (Math.floor(rng() * 4) % 4 as PlayerId) : 0;
}

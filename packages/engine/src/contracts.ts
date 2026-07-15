import type { ContractId } from './types.js';

export interface ContractMeta {
  id: ContractId;
  label: string;
  /** Contrat « cœur » : interdiction d'entamer un pli avec un cœur (sauf main 100% cœur). */
  heartRestricted: boolean;
  /** Mécanique de la manche. */
  kind: 'trick' | 'reussite';
  /** Le Roi de cœur stoppe la manche (Barbu uniquement). */
  stopsOnKingOfHearts: boolean;
}

export const CONTRACTS: Record<ContractId, ContractMeta> = {
  BARBU: { id: 'BARBU', label: 'Barbu', heartRestricted: true, kind: 'trick', stopsOnKingOfHearts: true },
  COEUR: { id: 'COEUR', label: 'Cœur', heartRestricted: true, kind: 'trick', stopsOnKingOfHearts: false },
  DEUXDER: { id: 'DEUXDER', label: '2 der', heartRestricted: false, kind: 'trick', stopsOnKingOfHearts: false },
  DAMES: { id: 'DAMES', label: 'Dames', heartRestricted: false, kind: 'trick', stopsOnKingOfHearts: false },
  PLIS: { id: 'PLIS', label: 'Plis', heartRestricted: false, kind: 'trick', stopsOnKingOfHearts: false },
  SALADE: { id: 'SALADE', label: 'Salade', heartRestricted: true, kind: 'trick', stopsOnKingOfHearts: false },
  REUSSITE: { id: 'REUSSITE', label: 'Réussite', heartRestricted: false, kind: 'reussite', stopsOnKingOfHearts: false },
};

export const ALL_CONTRACTS: ContractId[] = Object.keys(CONTRACTS) as ContractId[];

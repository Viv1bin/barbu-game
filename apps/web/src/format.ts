import type { Card, ContractId, Rank, Suit } from '@barbu/engine';
import type { IconName } from './ui/Icon.js';

export const SUIT_SYMBOL: Record<Suit, string> = { H: '♥', S: '♠', D: '♦', C: '♣' };
export const SUIT_RED: Record<Suit, boolean> = { H: true, D: true, S: false, C: false };

export function rankLabel(r: Rank): string {
  return r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r);
}

export function cardLabel(c: Card): string {
  return `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;
}

export const CONTRACT_LABEL: Record<ContractId, string> = {
  BARBU: 'Barbu',
  COEUR: 'Cœur',
  DEUXDER: '2 der',
  DAMES: 'Dames',
  PLIS: 'Plis',
  SALADE: 'Salade',
  REUSSITE: 'Réussite',
};

export const CONTRACT_ABBR: Record<ContractId, string> = {
  BARBU: 'Ba',
  COEUR: 'Cœ',
  DEUXDER: '2D',
  DAMES: 'Da',
  PLIS: 'Pl',
  SALADE: 'Sa',
  REUSSITE: 'Ré',
};

/** Icône monochrome illustrant chaque contrat. */
export const CONTRACT_ICON: Record<ContractId, IconName> = {
  BARBU: 'crown',
  COEUR: 'heart',
  DEUXDER: 'skipEnd',
  DAMES: 'gem',
  PLIS: 'layers',
  SALADE: 'shuffle',
  REUSSITE: 'target',
};

/** Rappel de règle court, affiché sous le nom du contrat pour rester compréhensible. */
export const CONTRACT_HINT: Record<ContractId, string> = {
  BARBU: 'Éviter de prendre le Roi de ♥',
  COEUR: 'Éviter de ramasser des ♥',
  DEUXDER: 'Éviter les 2 derniers plis',
  DAMES: 'Éviter de ramasser les Dames',
  PLIS: 'Éviter de faire des plis',
  SALADE: 'Tout à éviter (cumul des contrats)',
  REUSSITE: 'Se débarrasser de ses cartes en premier',
};

export const PLAYER_NAMES = ['Vous', 'Bot Ouest', 'Bot Nord', 'Bot Est'];

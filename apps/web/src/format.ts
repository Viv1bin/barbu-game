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

/** Explication longue, affichée quand on sélectionne un contrat dans les règles. */
export const CONTRACT_DETAIL: Record<ContractId, string> = {
  BARBU: "Le Roi de cœur — « le Barbu » — coûte 80 points à qui remporte le pli où il tombe. Les autres cartes ne comptent pas, et la manche s’arrête aussitôt le Roi ramassé : une seule carte décide de tout.",
  COEUR: 'Chaque cœur ramassé coûte 10 points, et il y en a 13 dans le jeu. Le Roi de cœur ne vaut que 10 points ici, comme les autres. Mieux vaut se défausser tôt de ses cœurs hauts que de les garder pour la fin.',
  DEUXDER: "Seuls les deux derniers plis comptent : 20 points pour l’avant-dernier, 60 pour le dernier. Tout le début de la manche sert à garder des cartes assez basses pour ne pas être obligé de prendre à la fin.",
  DAMES: 'Chacune des quatre Dames coûte 20 points. Elles se répartissent dans les quatre couleurs : impossible de les éviter en jouant une seule couleur.',
  PLIS: 'Chaque pli ramassé coûte 10 points, quel que soit son contenu. Le but est simple : ne jamais remporter une levée, donc jouer bas dès qu’on le peut.',
  SALADE: 'Tous les contrats à pénalité comptent en même temps, chaque valeur divisée par deux. Une carte cumule ses effets : le Roi de cœur vaut 40 + 5 = 45, une Dame de cœur 10 + 5 = 15. Contrairement au Barbu, la manche va jusqu’au bout.',
  REUSSITE: "Ici on ne cherche pas à éviter, mais à finir. Les cartes se posent en quatre files, du 2 vers l’As, à partir d’une hauteur choisie par le donneur ; on doit jouer si on peut. Le premier à vider sa main prend le plus gros bonus.",
};

/** Une ligne du barème d'un contrat : ce qui coûte, et combien. */
export interface PointRule {
  what: string;
  points: string;
}

/**
 * Barème exact de chaque contrat, aligné sur `scoring.ts` (et sur regles.md).
 * Affiché tel quel dans les règles : les valeurs ne sont pas des approximations.
 */
export const CONTRACT_POINTS: Record<ContractId, PointRule[]> = {
  BARBU: [{ what: 'Roi de ♥ (le Barbu)', points: '80' }],
  COEUR: [{ what: 'Chaque ♥ ramassé', points: '10' }],
  DEUXDER: [
    { what: 'Avant-dernier pli', points: '20' },
    { what: 'Dernier pli', points: '60' },
  ],
  DAMES: [{ what: 'Chaque Dame', points: '20' }],
  PLIS: [{ what: 'Chaque pli remporté', points: '10' }],
  SALADE: [
    { what: 'Roi de ♥', points: '40' },
    { what: 'Chaque ♥', points: '5' },
    { what: 'Chaque Dame', points: '10' },
    { what: 'Chaque pli', points: '5' },
    { what: 'Avant-dernier pli', points: '10' },
    { what: 'Dernier pli', points: '30' },
  ],
  REUSSITE: [
    { what: '1er à finir', points: '−120' },
    { what: '2e', points: '−60' },
    { what: '3e', points: '−20' },
    { what: '4e', points: '0' },
  ],
};

/** Total distribué sur une manche, une fois toutes les cartes jouées. */
export const CONTRACT_TOTAL: Record<ContractId, string> = {
  BARBU: '80 pts en jeu',
  COEUR: '13 ♥ × 10 = 130 pts en jeu',
  DEUXDER: '80 pts en jeu',
  DAMES: '4 × 20 = 80 pts en jeu',
  PLIS: '13 plis × 10 = 130 pts en jeu',
  SALADE: '250 pts en jeu',
  REUSSITE: '−200 pts distribués',
};

export const PLAYER_NAMES = ['Vous', 'Bot Ouest', 'Bot Nord', 'Bot Est'];

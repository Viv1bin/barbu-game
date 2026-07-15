// Types de base du moteur Barbu — voir regles.md

export type Suit = 'H' | 'S' | 'D' | 'C'; // Cœur, Pique (Spades), Carreau (Diamonds), Trèfle (Clubs)

/** 2..10 = valeur faciale, 11=Valet, 12=Dame, 13=Roi, 14=As */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type PlayerId = 0 | 1 | 2 | 3;

export type ContractId =
  | 'BARBU'
  | 'COEUR'
  | 'DEUXDER'
  | 'DAMES'
  | 'PLIS'
  | 'SALADE'
  | 'REUSSITE';

/** Un pli en cours de constitution. */
export interface PlayedCard {
  player: PlayerId;
  card: Card;
}

/** État d'une manche à plis (tous contrats sauf Réussite). */
export interface TrickRoundState {
  contract: ContractId;
  hands: Card[][]; // hands[playerId]
  leader: PlayerId; // qui entame le pli courant
  currentTrick: PlayedCard[];
  completedTricks: PlayedCard[][]; // dans l'ordre de jeu
  wonBy: PlayerId[]; // wonBy[i] = gagnant du pli i (aligné sur completedTricks)
  heartsBroken: boolean; // un cœur a déjà été joué/défaussé
  finished: boolean;
}

/** Extension d'une file de couleur en Réussite (rangs posés, bornes incluses). */
export interface Fan {
  low: Rank;
  high: Rank;
}

export interface ReussiteState {
  rank: Rank; // hauteur d'ouverture choisie par le donneur
  files: Record<Suit, Fan | null>;
  hands: Card[][];
  turn: PlayerId;
  finishOrder: PlayerId[]; // ordre de sortie -> classement
  /** true quand le joueur courant vient de poser un As : il peut rejouer OU passer volontairement. */
  awaitingAceChoice: boolean;
  /** passes consécutifs de joueurs bloqués (anti-blocage). */
  consecutivePasses: number;
  finished: boolean;
}

export type RoundState = TrickRoundState | ReussiteState;

export type MatchPhase =
  | 'CHOOSE_CONTRACT'
  | 'CONTRE'
  | 'PLAY'
  | 'SCORING'
  | 'DONE';

export interface MatchState {
  dealer: PlayerId;
  /** playedContracts[playerId] = contrats déjà donnés par ce joueur. */
  playedContracts: ContractId[][];
  phase: MatchPhase;
  currentContract: ContractId | null; // contrat de la manche en cours
  reussiteRank: Rank | null; // hauteur choisie si contrat = REUSSITE
  pendingHands: Card[][] | null; // mains distribuées avant le début du jeu
  contres: PlayerId[]; // joueurs ayant contré le donneur pour la manche courante
  contreDecided: PlayerId[]; // joueurs ayant déjà répondu au contre (dans l'ordre)
  round: RoundState | null;
  scores: number[]; // cumul des 4 joueurs
  mancheCount: number; // manches terminées (0..28)
}

export type Action =
  | { t: 'CHOOSE_CONTRACT'; contract: ContractId; rank?: Rank }
  | { t: 'CONTRE'; player: PlayerId; contre: boolean }
  | { t: 'PLAY_CARD'; player: PlayerId; card: Card }
  | { t: 'REUSSITE_PLAY'; player: PlayerId; card: Card }
  | { t: 'REUSSITE_PASS'; player: PlayerId };

/** Vue caviardée envoyée à un joueur (info cachée retirée). */
export interface PlayerView {
  you: PlayerId;
  yourHand: Card[];
  handSizes: number[]; // nombre de cartes par joueur
  phase: MatchPhase;
  contract: ContractId | null;
  scores: number[];
  // détails de la manche (plis en cours / files réussite) ajoutés selon le contrat
}

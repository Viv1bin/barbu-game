// Types partagés serveur↔client pour le mode multijoueur en ligne.
// Aucune logique ici : uniquement le contrat de messages et les vues.
import type { Action, ContractId, MatchState, PlayedCard, PlayerId } from './types.js';
import type { Difficulty } from './bots.js';

/**
 * État de partie caviardé envoyé à un joueur : identique à `MatchState`, mais
 * les mains adverses (`pendingHands` / `round.hands`) sont vidées et seule la
 * taille de chaque main est exposée via `handSizes`. Voir `redactState`.
 */
export interface RedactedMatchState extends MatchState {
  /** Nombre de cartes en main par siège (les mains adverses sont vidées). */
  handSizes: number[];
}

/** Occupant d'un siège dans une salle en ligne. */
export interface SeatInfo {
  seat: PlayerId;
  kind: 'human' | 'bot' | 'open';
  /** Nom affiché (humain : profil ; bot : libellé). */
  name?: string;
  avatar?: string;
  /** Niveau du bot si `kind === 'bot'`. */
  level?: Difficulty;
  /** true si un humain est connecté sur ce siège. */
  connected?: boolean;
}

/** Pli complet figé le temps de l'animation (rejoue l'anim du solo). */
export interface TrickPause {
  trick: PlayedCard[];
  winner: PlayerId;
}

/** Une manche terminée, pour le tableau des scores en ligne. */
export interface MancheLog {
  dealer: PlayerId;
  contract: ContractId;
  contres: PlayerId[];
  /** Points marqués par chaque joueur sur cette manche (contres appliqués). */
  points: number[];
}

/** Messages client → serveur. */
export type ClientMsg =
  | { t: 'JOIN'; profileId: string; name: string; avatar: string }
  | { t: 'SEAT'; seat: PlayerId; kind: 'open' | 'bot'; level?: Difficulty }
  | { t: 'START' }
  | { t: 'ACTION'; action: Action }
  | { t: 'NEW_GAME' }
  | { t: 'LEAVE' };

/** Messages serveur → client. */
export type ServerMsg =
  | {
      t: 'LOBBY';
      code: string;
      seats: SeatInfo[];
      hostId: string | null;
      youSeat: PlayerId | null;
      started: boolean;
    }
  | {
      t: 'VIEW';
      view: RedactedMatchState;
      seats: SeatInfo[];
      youSeat: PlayerId | null;
      history: MancheLog[];
      pause: TrickPause | null;
    }
  | { t: 'ERROR'; msg: string };

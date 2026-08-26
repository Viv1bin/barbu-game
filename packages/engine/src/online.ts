// Types partagés serveur↔client pour le mode multijoueur en ligne.
// Aucune logique ici : uniquement le contrat de messages et les vues.
import type { Action, ContractId, MatchState, PlayedCard, PlayerId } from './types.js';
import type { Difficulty } from './bots.js';
import type { MatchOptions } from './options.js';

/** Compte joueur exposé au client (jamais le hash ni le sel du mot de passe). */
export interface Account {
  id: string;
  pseudo: string;
  avatar: string;
}

/** Réponse d'inscription / connexion : compte + token de session opaque. */
export interface AuthResponse {
  token: string;
  account: Account;
}

// --- Social : amis, stats, présence, sauvegarde (parties en ligne) ---------

/** Profil public d'un compte (amis, classements, demandes). */
export interface PublicProfile {
  id: string;
  pseudo: string;
  avatar: string;
}

/** Statistiques agrégées d'un compte — parties **en ligne** uniquement. */
export interface PlayerStats {
  games: number;
  wins: number;
  /** Cumul des points marqués (au Barbu, moins = mieux). */
  totalPoints: number;
  /** Meilleur (= plus bas) score obtenu sur une partie, ou null si aucune. */
  bestScore: number | null;
}

/** Un ami : profil + ses stats + son statut de présence. */
export interface FriendInfo extends PublicProfile {
  stats: PlayerStats;
  online: boolean;
}

/** Une demande d'ami en attente, entrante ou sortante. */
export interface FriendRequestInfo extends PublicProfile {
  direction: 'incoming' | 'outgoing';
}

/** Instantané social renvoyé au client (amis + demandes en attente). */
export interface SocialSnapshot {
  friends: FriendInfo[];
  requests: FriendRequestInfo[];
}

/** Sauvegarde d'une partie solo liée au compte (reprise ultérieure). */
export interface SavedGame {
  /** Identifiant de la partie (généré par le client, stable sur toute sa durée). */
  id: string;
  /** Blob d'état opaque (sérialisé par le client solo). */
  state: unknown;
  updatedAt: string;
}

/** Un participant d'une partie en ligne terminée, à enregistrer dans les stats. */
export interface GameResultEntry {
  accountId: string;
  score: number;
}

/** Un joueur dans l'historique d'une partie en ligne. `score` null tant qu'elle dure. */
export interface MatchPlayer extends PublicProfile {
  score: number | null;
}

/**
 * Une partie en ligne vue depuis l'historique d'un compte. Une salle peut
 * enchaîner plusieurs parties : `id` identifie la partie, `code` la salle (c'est
 * lui qu'on rejoint pour reprendre une partie encore en cours).
 */
export interface OnlineMatch {
  id: string;
  code: string;
  startedAt: string;
  /** null si la partie est encore en cours. */
  endedAt: string | null;
  players: MatchPlayer[];
}

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
  // L'identité n'est jamais déclarée par le client : il présente son token de
  // session, le serveur en dérive le compte (id, pseudo, avatar).
  | { t: 'JOIN'; token: string }
  | { t: 'SEAT'; seat: PlayerId; kind: 'open' | 'bot'; level?: Difficulty }
  // Les options sont proposées par l'hôte et renormalisées par le serveur.
  | { t: 'START'; options?: MatchOptions }
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
      /** Options avec lesquelles la partie a démarré (ou démarrera par défaut). */
      options: MatchOptions;
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

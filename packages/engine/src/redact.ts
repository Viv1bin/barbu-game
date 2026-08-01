// Caviardage de l'état pour le mode en ligne : retire les mains adverses.
// Fonction pure, sans dépendance — même garantie d'honnêteté que les bots.
import type { Card, MatchState, PlayerId, RoundState } from './types.js';
import type { RedactedMatchState } from './online.js';

/** Garde la main de `you`, vide les autres (mains adverses = secrètes). */
function redactHands(hands: Card[][], you: PlayerId): Card[][] {
  return hands.map((h, p) => (p === you ? h.slice() : []));
}

/** Tailles de main par siège, depuis la source disponible (round ou donne). */
function handSizesOf(state: MatchState): number[] {
  const round = state.round;
  if (round) return round.hands.map((h) => h.length);
  if (state.pendingHands) return state.pendingHands.map((h) => h.length);
  return [0, 0, 0, 0];
}

/**
 * Projette `state` pour le joueur `you` : structurellement identique à
 * `MatchState`, mains adverses vidées, `handSizes` renseigné. En fin de partie
 * (`DONE`), rien n'est caché (reveal des mains). Ne lit jamais autre chose que
 * l'état passé : le serveur reste la seule autorité.
 */
export function redactState(state: MatchState, you: PlayerId): RedactedMatchState {
  const handSizes = handSizesOf(state);

  // Partie finie : plus rien à cacher, on révèle tout pour l'écran de fin.
  if (state.phase === 'DONE') return { ...state, handSizes };

  const pendingHands = state.pendingHands ? redactHands(state.pendingHands, you) : null;

  let round: RoundState | null = state.round;
  if (round) {
    if ('currentTrick' in round) {
      round = { ...round, hands: redactHands(round.hands, you) };
    } else {
      round = { ...round, hands: redactHands(round.hands, you) };
    }
  }

  return { ...state, pendingHands, round, handSizes };
}

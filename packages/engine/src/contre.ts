import type { PlayerId } from './types.js';

/**
 * Applique les contres du donneur. Pour chaque contreur, on ajoute à son score
 * et retranche à celui du donneur l'écart `E = points_contreur − points_donneur`.
 *
 * Ex : donneur=Julien(20), contreur=Marc(40)
 *   Julien -> 20 + (20-40) = 0 ; Marc -> 40 + (40-20) = 60.
 */
export function applyContres(
  roundPoints: readonly number[],
  dealer: PlayerId,
  contres: readonly PlayerId[]
): number[] {
  const s = roundPoints.slice();
  for (const c of contres) {
    const e = roundPoints[c]! - roundPoints[dealer]!;
    s[c]! += e;
    s[dealer]! -= e;
  }
  return s;
}

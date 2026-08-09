import { ALL_CONTRACTS, type Difficulty } from '@barbu/engine';
import type { SoloSave } from './useSoloGame.js';

export const TOTAL_MANCHES = ALL_CONTRACTS.length * 4; // 7 contrats × 4 donneurs

/** Valide qu'un blob sauvegardé est bien une partie solo reprenable (non terminée). */
export function asSoloSave(blob: unknown): SoloSave | null {
  const s = blob as SoloSave | null;
  return s && s.v === 1 && s.state && s.state.phase !== 'DONE' ? s : null;
}

const LEVEL_LABEL: Record<Difficulty, string> = {
  facile: 'Facile',
  moyen: 'Moyen',
  difficile: 'Difficile',
  impossible: 'Impossible',
};

/** Résumé lisible d'une partie sauvegardée (niveau, avancement, date). */
export function describeSave(save: SoloSave, updatedAt?: string): { level: string; manche: number; when: string } {
  const when = updatedAt
    ? new Date(updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  return { level: LEVEL_LABEL[save.level], manche: save.state.mancheCount + 1, when };
}

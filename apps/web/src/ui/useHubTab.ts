import { useCallback } from 'react';

/**
 * Changement d'onglet dans un écran « hub ». Certains onglets (le Compte, par
 * exemple) sont bien plus hauts que le `min-height` de la zone de contenu : la
 * page défile, et sans remise à zéro la barre d'onglets se retrouve plus haut
 * — ou hors écran — après un changement. On repart donc toujours du haut.
 */
export function useHubTab<T>(setTab: (tab: T) => void): (tab: T) => void {
  return useCallback(
    (tab: T) => {
      setTab(tab);
      window.scrollTo({ top: 0 });
    },
    [setTab],
  );
}

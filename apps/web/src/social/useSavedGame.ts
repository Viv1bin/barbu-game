import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedGame } from '@barbu/engine';
import { apiFetch } from '../auth/api.js';

/** Parties solo sauvegardées, liées au compte (plusieurs par compte). */
export interface SavedGamesSlot {
  /** Parties en cours, plus récente d'abord. */
  saves: SavedGame[];
  loading: boolean;
  /** Écrit (ou remplace) l'état d'une partie identifiée par `id`. */
  save: (id: string, state: unknown) => void;
  /** Supprime la partie `id`. */
  remove: (id: string) => void;
  /** Recharge la liste depuis le serveur. */
  refresh: () => void;
}

export function useSavedGames(token: string | null): SavedGamesSlot {
  const [saves, setSaves] = useState<SavedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!token) {
      setSaves([]);
      setLoading(false);
      return;
    }
    try {
      const r = await apiFetch<{ saves: SavedGame[] }>('/social/games', { token });
      if (aliveRef.current) setSaves(r.saves ?? []);
    } catch {
      /* silencieux : la sauvegarde n'est pas critique */
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  const save = useCallback(
    (id: string, state: unknown) => {
      // Mise à jour optimiste de la liste locale (updatedAt approximatif).
      setSaves((cur) => {
        const now = new Date().toISOString();
        const rest = cur.filter((s) => s.id !== id);
        return [{ id, state, updatedAt: now }, ...rest];
      });
      if (!token) return;
      void apiFetch('/social/game', { token, body: { id, state } }).catch(() => {});
    },
    [token],
  );

  const remove = useCallback(
    (id: string) => {
      setSaves((cur) => cur.filter((s) => s.id !== id));
      if (!token) return;
      void apiFetch('/social/game/delete', { token, method: 'POST', body: { id } }).catch(() => {});
    },
    [token],
  );

  return { saves, loading, save, remove, refresh: () => void refresh() };
}

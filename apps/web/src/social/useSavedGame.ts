import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedGame } from '@barbu/engine';
import { apiFetch } from '../auth/api.js';

/** Emplacement de sauvegarde solo lié au compte (un seul par compte). */
export interface SavedGameSlot {
  /** Sauvegarde présente, ou null si aucune / pas encore chargée. */
  save: SavedGame | null;
  loading: boolean;
  /** Écrit l'état solo courant (blob opaque). */
  persist: (state: unknown) => void;
  /** Supprime la sauvegarde (partie terminée ou abandonnée). */
  clear: () => void;
  /** Recharge depuis le serveur. */
  refresh: () => void;
}

export function useSavedGame(token: string | null): SavedGameSlot {
  const [save, setSave] = useState<SavedGame | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const r = await apiFetch<{ save: SavedGame | null }>('/social/game', { token });
      if (aliveRef.current) setSave(r.save);
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

  const persist = useCallback(
    (state: unknown) => {
      if (!token) return;
      void apiFetch('/social/game', { token, body: { state } }).catch(() => {});
    },
    [token],
  );
  const clear = useCallback(() => {
    setSave(null);
    if (!token) return;
    void apiFetch('/social/game/delete', { token, method: 'POST', body: {} }).catch(() => {});
  }, [token]);

  return { save, loading, persist, clear, refresh: () => void refresh() };
}

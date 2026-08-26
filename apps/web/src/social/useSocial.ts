import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineMatch, PlayerStats, SocialSnapshot } from '@barbu/engine';
import { apiFetch, ApiError } from '../auth/api.js';

const EMPTY_SNAPSHOT: SocialSnapshot = { friends: [], requests: [] };
const EMPTY_STATS: PlayerStats = { games: 0, wins: 0, totalPoints: 0, bestScore: null };

/** Intervalle de rafraîchissement des amis (met aussi à jour la présence côté serveur). */
const POLL_MS = 25_000;

export interface Social {
  snapshot: SocialSnapshot;
  stats: PlayerStats;
  /** Parties en ligne du compte (en cours et terminées), plus récente d'abord. */
  matches: OnlineMatch[];
  loading: boolean;
  error: string | null;
  /** Recharge amis + stats depuis le serveur. */
  refresh: () => void;
  /** Envoie une demande d'ami par pseudo. Renvoie 'sent' ou 'accepted' (demande croisée). */
  addFriend: (pseudo: string) => Promise<'sent' | 'accepted'>;
  respond: (fromId: string, accept: boolean) => Promise<void>;
  cancel: (toId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * État social du compte connecté : liste d'amis (avec stats + présence),
 * demandes en attente, stats perso. Interroge le serveur au montage puis
 * périodiquement (chaque appel rafraîchit aussi la présence de l'utilisateur).
 */
export function useSocial(token: string | null): Social {
  const [snapshot, setSnapshot] = useState<SocialSnapshot>(EMPTY_SNAPSHOT);
  const [stats, setStats] = useState<PlayerStats>(EMPTY_STATS);
  const [matches, setMatches] = useState<OnlineMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [snap, st, mt] = await Promise.all([
        apiFetch<SocialSnapshot>('/social/snapshot', { token }),
        apiFetch<{ stats: PlayerStats }>('/social/stats', { token }),
        apiFetch<{ matches: OnlineMatch[] }>('/social/matches', { token }),
      ]);
      if (!aliveRef.current) return;
      setSnapshot(snap);
      setStats(st.stats);
      setMatches(mt.matches);
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  const addFriend = useCallback(
    async (pseudo: string) => {
      const r = await apiFetch<{ status: 'sent' | 'accepted' }>('/social/request', { token, body: { pseudo } });
      await load();
      return r.status;
    },
    [token, load],
  );
  const respond = useCallback(
    async (fromId: string, accept: boolean) => {
      await apiFetch('/social/respond', { token, body: { fromId, accept } });
      await load();
    },
    [token, load],
  );
  const cancel = useCallback(
    async (toId: string) => {
      await apiFetch('/social/cancel', { token, body: { toId } });
      await load();
    },
    [token, load],
  );
  const remove = useCallback(
    async (id: string) => {
      await apiFetch('/social/remove', { token, body: { id } });
      await load();
    },
    [token, load],
  );

  return { snapshot, stats, matches, loading, error, refresh: () => void load(), addFriend, respond, cancel, remove };
}

/**
 * Parties en ligne non terminées du compte, pour proposer la reprise depuis
 * l'onglet « Jouer ». Chargées une fois au montage : l'onglet est démonté quand
 * on le quitte, donc y revenir suffit à rafraîchir la liste.
 */
export function useLiveMatches(token: string | null): OnlineMatch[] {
  const [live, setLive] = useState<OnlineMatch[]>([]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<{ matches: OnlineMatch[] }>('/social/matches', { token })
      .then((r) => alive && setLive(r.matches.filter((m) => !m.endedAt)))
      .catch(() => {}); // pas de reprise proposée : l'écran « En ligne » reste accessible
    return () => {
      alive = false;
    };
  }, [token]);
  return live;
}

/**
 * Battement de présence global : signale l'utilisateur « en ligne » tant que
 * l'app est ouverte, quel que soit l'écran (les amis le voient connecté).
 */
export function usePresence(token: string | null): void {
  useEffect(() => {
    if (!token) return;
    const ping = () => void apiFetch('/social/ping', { token }).catch(() => {});
    ping();
    const id = setInterval(ping, 40_000);
    return () => clearInterval(id);
  }, [token]);
}

export { ApiError };

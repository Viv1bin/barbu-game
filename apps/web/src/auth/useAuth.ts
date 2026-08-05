import { useCallback, useEffect, useState } from 'react';
import type { Account, AuthResponse } from '@barbu/engine';
import { apiFetch, ApiError } from './api.js';

const TOKEN_KEY = 'barbu.auth.v1';

export interface Auth {
  /** Compte connecté, ou null si déconnecté. */
  account: Account | null;
  /** Token de session (pour les appels authentifiés /social/*), ou null. */
  token: string | null;
  /** true pendant la vérification initiale du token au démarrage. */
  loading: boolean;
  register: (pseudo: string, password: string, avatar: string) => Promise<void>;
  login: (pseudo: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (patch: { pseudo?: string; avatar?: string }) => Promise<void>;
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* mode privé / quota : la session ne survivra pas au refresh, tant pis */
  }
}

/** Gère l'identité serveur : token en localStorage + compte courant. */
export function useAuth(): Auth {
  const [token, setToken] = useState<string | null>(loadToken);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  // Au démarrage : valide le token stocké (si présent) via /auth/me.
  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<{ account: Account | null }>('/auth/me', { token })
      .then((r) => {
        if (!alive) return;
        if (r.account) setAccount(r.account);
        else {
          saveToken(null);
          setToken(null);
        }
      })
      .catch(() => {
        /* serveur injoignable : on garde le token, on retentera au prochain lancement */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (r: AuthResponse) => {
    saveToken(r.token);
    setToken(r.token);
    setAccount(r.account);
  };

  const register = useCallback(async (pseudo: string, password: string, avatar: string) => {
    apply(await apiFetch<AuthResponse>('/auth/register', { body: { pseudo, password, avatar } }));
  }, []);

  const login = useCallback(async (pseudo: string, password: string) => {
    apply(await apiFetch<AuthResponse>('/auth/login', { body: { pseudo, password } }));
  }, []);

  const logout = useCallback(() => {
    const t = token;
    saveToken(null);
    setToken(null);
    setAccount(null);
    if (t) apiFetch('/auth/logout', { token: t }).catch(() => {});
  }, [token]);

  const updateProfile = useCallback(
    async (patch: { pseudo?: string; avatar?: string }) => {
      const r = await apiFetch<{ account: Account }>('/auth/profile', { token, body: patch });
      setAccount(r.account);
    },
    [token],
  );

  return { account, token, loading, register, login, logout, updateProfile };
}

export { ApiError };

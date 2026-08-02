import { PARTYKIT_HOST } from '../online/useOnlineGame.js';

/** Base HTTP du serveur de comptes : même hôte que le temps réel (https en prod). */
const secure = !/^(127\.0\.0\.1|localhost)/.test(PARTYKIT_HOST);
export const API_BASE = `${secure ? 'https' : 'http'}://${PARTYKIT_HOST}`;

/** Erreur d'API portant le message serveur (affichable à l'utilisateur). */
export class ApiError extends Error {}

/** Appel JSON vers le Worker. Jette `ApiError(message)` sur réponse non-OK. */
export async function apiFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('Serveur injoignable. Réessaie dans un instant.');
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? 'Une erreur est survenue.');
  return data;
}

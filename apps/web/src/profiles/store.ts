import type { ContractId, PlayerId } from '@barbu/engine';

const KEY = 'barbu.profiles.v1';

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  createdAt: string;
}

/** Une manche archivée (miroir de MancheLog côté arbitre). */
export interface MancheRecord {
  dealer: PlayerId;
  contract: ContractId;
  contres: PlayerId[];
  points: number[];
}

/** Une partie terminée. `seats[i]` = id du profil assis au siège i. */
export interface MatchRecord {
  id: string;
  date: string;
  seats: string[];
  scores: number[];
  history: MancheRecord[];
}

export interface Store {
  profiles: Profile[];
  matches: MatchRecord[];
}

const EMPTY: Store = { profiles: [], matches: [] };

export const AVATARS = ['🙂', '😎', '🦊', '🐙', '🐧', '🦁', '🐻', '🦉', '🐸', '🦄', '👑', '🎩'];

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { profiles: parsed.profiles ?? [], matches: parsed.matches ?? [] };
  } catch {
    return EMPTY;
  }
}

export function saveStore(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota / mode privé : on ignore, la partie en cours reste jouable */
  }
}

export function createProfile(s: Store, name: string, avatar: string): { store: Store; profile: Profile } {
  const profile: Profile = { id: newId(), name: name.trim(), avatar, createdAt: new Date().toISOString() };
  return { store: { ...s, profiles: [...s.profiles, profile] }, profile };
}

/**
 * Retire le profil mais garde les parties : les stats des 3 autres joueurs
 * en dépendent. Le disparu apparaîtra comme « Inconnu » dans leurs face-à-face.
 */
export function deleteProfile(s: Store, id: string): Store {
  return { ...s, profiles: s.profiles.filter((p) => p.id !== id) };
}

export function recordMatch(s: Store, seats: string[], scores: number[], history: MancheRecord[]): Store {
  const match: MatchRecord = { id: newId(), date: new Date().toISOString(), seats, scores, history };
  return { ...s, matches: [...s.matches, match] };
}

export function profileById(s: Store, id: string): Profile | undefined {
  return s.profiles.find((p) => p.id === id);
}

export function deleteMatch(s: Store, id: string): Store {
  return { ...s, matches: s.matches.filter((m) => m.id !== id) };
}

export function clearMatches(s: Store): Store {
  return { ...s, matches: [] };
}

export function emptyStore(): Store {
  return { profiles: [], matches: [] };
}

/** Sauvegarde complète, versionnée pour pouvoir migrer plus tard. */
export interface Backup {
  app: 'barbu';
  version: 1;
  exportedAt: string;
  store: Store;
}

export function toBackup(s: Store): Backup {
  return { app: 'barbu', version: 1, exportedAt: new Date().toISOString(), store: s };
}

/** Valide une sauvegarde relue depuis un fichier. Jette si le contenu est inexploitable. */
export function parseBackup(text: string): Store {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas du JSON valide.");
  }
  const b = data as Partial<Backup>;
  if (b?.app !== 'barbu' || !b.store) throw new Error("Ce fichier n'est pas une sauvegarde Barbu.");
  const { profiles, matches } = b.store;
  if (!Array.isArray(profiles) || !Array.isArray(matches)) throw new Error('Sauvegarde incomplète.');
  const okProfile = (p: Profile) => typeof p?.id === 'string' && typeof p?.name === 'string';
  const okMatch = (m: MatchRecord) =>
    typeof m?.id === 'string' && Array.isArray(m?.seats) && Array.isArray(m?.scores) && Array.isArray(m?.history);
  if (!profiles.every(okProfile) || !matches.every(okMatch)) throw new Error('Sauvegarde corrompue.');
  return { profiles, matches };
}

/** Fusionne une sauvegarde avec l'existant : les ids déjà présents sont ignorés. */
export function mergeStore(current: Store, incoming: Store): Store {
  const pIds = new Set(current.profiles.map((p) => p.id));
  const mIds = new Set(current.matches.map((m) => m.id));
  return {
    profiles: [...current.profiles, ...incoming.profiles.filter((p) => !pIds.has(p.id))],
    matches: [...current.matches, ...incoming.matches.filter((m) => !mIds.has(m.id))],
  };
}

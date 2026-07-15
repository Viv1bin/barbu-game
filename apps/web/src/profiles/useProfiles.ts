import { useCallback, useState } from 'react';
import {
  clearMatches,
  createProfile,
  deleteMatch,
  deleteProfile,
  emptyStore,
  loadStore,
  mergeStore,
  recordMatch,
  saveStore,
  type MancheRecord,
  type Profile,
  type Store,
} from './store.js';

export interface Profiles {
  store: Store;
  create: (name: string, avatar: string) => Profile;
  remove: (id: string) => void;
  rename: (id: string, name: string, avatar: string) => void;
  record: (seats: string[], scores: number[], history: MancheRecord[]) => void;
  removeMatch: (id: string) => void;
  clearHistory: () => void;
  resetAll: () => void;
  /** Fusionne une sauvegarde importée avec les données présentes. */
  merge: (incoming: Store) => void;
  /** Remplace tout par une sauvegarde importée. */
  replace: (incoming: Store) => void;
}

export function useProfiles(): Profiles {
  const [store, setStore] = useState<Store>(loadStore);

  const commit = useCallback((next: Store) => {
    saveStore(next);
    setStore(next);
    return next;
  }, []);

  return {
    store,
    create: (name, avatar) => {
      const { store: next, profile } = createProfile(store, name, avatar);
      commit(next);
      return profile;
    },
    remove: (id) => commit(deleteProfile(store, id)),
    rename: (id, name, avatar) =>
      commit({
        ...store,
        profiles: store.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, avatar } : p)),
      }),
    record: (seats, scores, history) => commit(recordMatch(store, seats, scores, history)),
    removeMatch: (id) => commit(deleteMatch(store, id)),
    clearHistory: () => commit(clearMatches(store)),
    resetAll: () => commit(emptyStore()),
    merge: (incoming) => commit(mergeStore(store, incoming)),
    replace: (incoming) => commit(incoming),
  };
}

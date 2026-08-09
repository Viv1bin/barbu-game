import { useCallback, useEffect, useState } from 'react';
import type { Card, Suit } from '@barbu/engine';

// ---------------------------------------------------------------------------
// Préférence de tri automatique de la main, personnalisable dans les réglages.
// - `suitOrder` : ordre des couleurs, de gauche à droite.
// - `strongSide` : dans chaque couleur, côté où se trouve la carte forte.
// Stockée en localStorage (préférence d'affichage, propre au navigateur).
// ---------------------------------------------------------------------------

export type StrongSide = 'left' | 'right';

export interface CardSortPref {
  suitOrder: Suit[];
  strongSide: StrongSide;
}

const KEY = 'barbu.cardsort.v1';
const ALL_SUITS: Suit[] = ['S', 'H', 'C', 'D'];
export const DEFAULT_SORT: CardSortPref = { suitOrder: ['S', 'H', 'C', 'D'], strongSide: 'left' };
/** Événement interne pour propager un changement dans le même onglet. */
const EVENT = 'barbu:cardsort';

/** Nettoie/complète une préférence lue du stockage (couleurs manquantes/dupliquées). */
function normalize(pref: Partial<CardSortPref> | null): CardSortPref {
  const raw = Array.isArray(pref?.suitOrder) ? pref!.suitOrder.filter((s): s is Suit => ALL_SUITS.includes(s)) : [];
  const seen = new Set<Suit>();
  const suitOrder = [...raw.filter((s) => !seen.has(s) && seen.add(s)), ...ALL_SUITS.filter((s) => !raw.includes(s))];
  return { suitOrder, strongSide: pref?.strongSide === 'right' ? 'right' : 'left' };
}

function read(): CardSortPref {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SORT };
  }
}

/** Trie une main selon la préférence : couleurs dans l'ordre, rang selon `strongSide`. */
export function sortHand(cards: Card[], pref: CardSortPref = DEFAULT_SORT): Card[] {
  const rank = (s: Suit) => pref.suitOrder.indexOf(s);
  return [...cards].sort(
    (a, b) => rank(a.suit) - rank(b.suit) || (pref.strongSide === 'left' ? b.rank - a.rank : a.rank - b.rank),
  );
}

/** Lit/écrit la préférence de tri, synchronisée entre composants et onglets. */
export function useCardSort(): [CardSortPref, (next: CardSortPref) => void] {
  const [pref, setPref] = useState<CardSortPref>(read);

  useEffect(() => {
    const sync = () => setPref(read());
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const update = useCallback((next: CardSortPref) => {
    const clean = normalize(next);
    localStorage.setItem(KEY, JSON.stringify(clean));
    setPref(clean);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [pref, update];
}

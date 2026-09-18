import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Préférences d'affichage : taille des cartes et style visuel. Elles ne
// concernent que le rendu, pas les règles — d'où le stockage local, par
// navigateur, à côté du tri de la main (`cardSort.ts`).
//
// `onboarded` n'est pas une préférence mais un drapeau : il ne passe à true
// qu'une fois l'assistant de première configuration traversé. Il vit ici parce
// que c'est exactement ce que l'assistant règle.
//
// Il est faux par défaut, donc absent = assistant à montrer. C'est voulu : les
// comptes créés avant l'assistant n'ont pas de drapeau et le verront à leur
// prochaine connexion, une fois, comme tout le monde.
// ---------------------------------------------------------------------------

/** Style visuel de la table. `contraste` durcit bordures, fonds et couleurs. */
export type Theme = 'lite' | 'contraste';

export interface DisplayPref {
  /** Facteur appliqué à toutes les cartes (0.85 à 1.4). */
  cardScale: number;
  theme: Theme;
  /** true une fois l'assistant de première configuration fait (ou passé). */
  onboarded: boolean;
}

const KEY = 'barbu.display.v1';
const EVENT = 'barbu:display';

export const DEFAULT_DISPLAY: DisplayPref = { cardScale: 1, theme: 'lite', onboarded: false };

/** Tailles proposées par l'assistant et les réglages. */
export const CARD_SCALES: { id: number; label: string }[] = [
  { id: 0.85, label: 'Compactes' },
  { id: 1, label: 'Normales' },
  { id: 1.2, label: 'Grandes' },
  { id: 1.4, label: 'Très grandes' },
];

function normalize(p: Partial<DisplayPref> | null): DisplayPref {
  const n = Number(p?.cardScale);
  return {
    cardScale: Number.isFinite(n) ? Math.min(1.4, Math.max(0.85, n)) : 1,
    theme: p?.theme === 'contraste' ? 'contraste' : 'lite',
    onboarded: p?.onboarded === true,
  };
}

function read(): DisplayPref {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

function write(pref: DisplayPref): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    /* mode privé / quota : la préférence ne survivra pas au refresh, tant pis */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Redemande l'assistant de configuration. Appelé à l'inscription : un compte
 * tout neuf mérite qu'on lui demande ses préférences plutôt que de le laisser
 * les découvrir dans un onglet de réglages — y compris sur un navigateur où
 * quelqu'un d'autre a déjà répondu.
 */
export function requestOnboarding(): void {
  write({ ...read(), onboarded: false });
}

/** Applique les préférences au document (variables CSS lues par la feuille de style). */
function apply(pref: DisplayPref): void {
  const root = document.documentElement;
  root.style.setProperty('--card-scale', String(pref.cardScale));
  root.dataset.theme = pref.theme;
}

/** Lit/écrit les préférences d'affichage, synchronisées entre composants et onglets. */
export function useDisplay(): [DisplayPref, (next: Partial<DisplayPref>) => void] {
  const [pref, setPref] = useState<DisplayPref>(read);

  useEffect(() => {
    const sync = () => setPref(read());
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  useEffect(() => apply(pref), [pref]);

  const update = useCallback((patch: Partial<DisplayPref>) => {
    const next = normalize({ ...read(), ...patch });
    write(next);
    setPref(next);
  }, []);

  return [pref, update];
}

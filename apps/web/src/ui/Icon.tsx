// Jeu d'icônes maison : traits monochromes, une seule couleur (currentColor),
// aucun emoji. Chaque icône est un simple tracé sur une grille 24×24 — cohérent
// en épaisseur et en poids visuel quel que soit l'endroit où on l'affiche.

/** Nom d'une icône disponible. */
export type IconName = keyof typeof PATHS;

const PATHS = {
  // --- Navigation & actions ---
  cards: <><rect x="3" y="7" width="11" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2.4-2l7 1.5A2 2 0 0 1 19 7l-2 9" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.8" /><path d="M17.5 14.5A6 6 0 0 1 21 20" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" /></>,
  arrowLeft: <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  arrowRight: <path d="M5 12h14m0 0-6-6m6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 13 4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" /></>,
  archive: <><path d="M12 4v11m0 0 4-4m-4 4-4-4" /><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></>,
  logout: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8 6 12l4 4M6 12h10" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  warning: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17.2v.1" /></>,
  seat: <><path d="M7 4h10v7H7z" /><path d="M5 11h14v5H5z" /><path d="M7 16v4M17 16v4" /></>,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4" /><circle cx="9" cy="14" r="1.1" /><circle cx="15" cy="14" r="1.1" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" /></>,
  bulb: <><path d="M9 17h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1h6c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3" /></>,
  play: <path d="M8 5.5v13l11-6.5z" />,

  // --- Niveaux de bot ---
  leaf: <><path d="M4 20C4 11 10 5 20 4c1 10-5 16-13 16" /><path d="M4 20c4-4 7-6 11-8" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 14 9 5 9-5" /></>,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,

  // --- Contrats ---
  crown: <><path d="M4 18h16" /><path d="m3 7 4.5 4L12 5l4.5 6L21 7l-1.6 8H4.6z" /></>,
  heart: <path d="M12 20S3.5 14.7 3.5 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8.5 2.2C20.5 14.7 12 20 12 20" />,
  skipEnd: <><path d="M6 6v12l9-6z" /><path d="M18 5v14" /></>,
  gem: <><path d="m5 4h14l3 5-10 11L2 9z" /><path d="M2 9h20M9 4 7 9l5 11 5-11-2-5" /></>,
  shuffle: <><path d="M3 7h4l10 10h4" /><path d="M3 17h4L17 7h4" /><path d="m18 4 3 3-3 3M18 14l3 3-3 3" /></>,
  trophy: <><path d="M7 4h10v6a5 5 0 0 1-10 0z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" /><path d="M12 15v3M8 21h8" /></>,

  // --- Avatars : formes géométriques simples, sans figuratif ---
  circle: <circle cx="12" cy="12" r="8" />,
  square: <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />,
  triangle: <path d="M12 4 21 19H3z" />,
  diamond: <path d="m12 3 9 9-9 9-9-9z" />,
  hexagon: <path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9z" />,
  star: <path d="m12 3 2.7 6.1 6.6.6-5 4.4 1.5 6.5L12 17.2 6.2 20.6l1.5-6.5-5-4.4 6.6-.6z" />,
  spade: <><path d="M12 3c0 4-7 6-7 10.5a3.5 3.5 0 0 0 6 2.4 3.5 3.5 0 0 0 6-2.4C17 9 12 7 12 3" /><path d="M12 15v6M9.5 21h5" /></>,
  club: <><circle cx="12" cy="7.5" r="3.5" /><circle cx="7" cy="13" r="3.5" /><circle cx="17" cy="13" r="3.5" /><path d="M12 14v7M9.5 21h5" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" /></>,
  drop: <path d="M12 3c3.5 4.5 6 7.6 6 10.5a6 6 0 0 1-12 0C6 10.6 8.5 7.5 12 3" />,
  ring: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></>,
} as const;

/**
 * Icône monochrome. `size` en pixels (côté du carré), la couleur suit celle du
 * texte parent : aucune icône n'introduit sa propre teinte.
 */
export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** true si `name` correspond à une icône connue (avatars venus du serveur). */
export function isIconName(name: unknown): name is IconName {
  return typeof name === 'string' && name in PATHS;
}

import type { ReactNode } from 'react';
import { Icon, type IconName } from './ui/Icon.js';

/** Onglets du hub (hors partie) : jouer, profil, amis, règles. */
export type Tab = 'home' | 'profile' | 'friends' | 'rules';

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'home', icon: 'cards', label: 'Jouer' },
  { id: 'profile', icon: 'user', label: 'Profil' },
  { id: 'friends', icon: 'users', label: 'Amis' },
  { id: 'rules', icon: 'book', label: 'Règles' },
];

/**
 * Coquille de l'app connectée : en-tête minimal (titre seul) et barre
 * d'onglets fixée en bas. Le compte est un onglet, plus un bouton d'en-tête.
 */
export function AppShell({
  tab,
  onTab,
  children,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="shell-head">
        <span className="shell-brand">Barbu</span>
      </header>

      <main className="shell-body">{children}</main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tabitem ${tab === t.id ? 'on' : ''}`}
            // Comme pour les sous-onglets : on repart du haut, sinon la position
            // de défilement de l'écran précédent est conservée sur le nouveau.
            onClick={() => { onTab(t.id); window.scrollTo({ top: 0 }); }}
          >
            <Icon name={t.icon} size={20} className="tb-ic" />
            <span className="tb-lb">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

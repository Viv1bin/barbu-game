import type { ReactNode } from 'react';
import type { Auth } from './auth/useAuth.js';
import { Avatar } from './ui/Avatar.js';
import { Icon, type IconName } from './ui/Icon.js';

/** Onglets du hub (hors partie) : accueil, amis, règles. */
export type Tab = 'home' | 'friends' | 'rules';

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'home', icon: 'cards', label: 'Jouer' },
  { id: 'friends', icon: 'users', label: 'Amis' },
  { id: 'rules', icon: 'book', label: 'Règles' },
];

/**
 * Coquille de l'app connectée : en-tête (titre + bouton compte unique avec
 * avatar) et barre d'onglets fixée en bas. Donne le côté « app » à l'accueil.
 */
export function AppShell({
  tab,
  onTab,
  onAccount,
  auth,
  children,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onAccount: () => void;
  auth: Auth;
  children: ReactNode;
}) {
  const me = auth.account;
  return (
    <div className="shell">
      <header className="shell-head">
        <span className="shell-brand">Barbu</span>
        <button className="acctbtn" onClick={onAccount} title="Mon compte">
          <Avatar name={me?.avatar} size="sm" />
          <span className="acctname">{me?.pseudo}</span>
        </button>
      </header>

      <main className="shell-body">{children}</main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tabitem ${tab === t.id ? 'on' : ''}`} onClick={() => onTab(t.id)}>
            <Icon name={t.icon} size={20} className="tb-ic" />
            <span className="tb-lb">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

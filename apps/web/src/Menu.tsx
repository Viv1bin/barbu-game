import type { Auth } from './auth/useAuth.js';

export type Screen = 'menu' | 'solo' | 'online' | 'settings' | 'social' | 'rules';

const MODES: { id: Screen; icon: string; title: string; desc: string; disabled?: boolean }[] = [
  { id: 'solo', icon: '🤖', title: 'Solo', desc: 'Contre 3 bots. Partie complète, 28 manches.' },
  { id: 'online', icon: '🌐', title: 'En ligne', desc: 'À 4 en temps réel. Code de partie, sièges bots ou amis.' },
];

/** Onglet « Jouer » : choix du mode de jeu. */
export function Menu({ onPick, auth }: { onPick: (s: Screen) => void; auth: Auth }) {
  const me = auth.account;
  return (
    <div className="hub">
      <div className="hubhead">
        <h2>Bonjour {me?.pseudo} 👋</h2>
        <p className="muted">Prêt·e pour une partie ?</p>
      </div>

      <div className="modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`modecard ${m.disabled ? 'disabled' : ''}`}
            disabled={m.disabled}
            onClick={() => !m.disabled && onPick(m.id)}
          >
            <span className="micon">{m.icon}</span>
            <span className="mtitle">{m.title}{m.disabled && <em> — bientôt</em>}</span>
            <span className="mdesc">{m.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

import type { Auth } from './auth/useAuth.js';

export type Screen = 'menu' | 'solo' | 'online' | 'settings';

const MODES: { id: Screen; icon: string; title: string; desc: string; disabled?: boolean }[] = [
  { id: 'solo', icon: '🤖', title: 'Solo', desc: 'Jouer contre 3 bots. Partie complète, 28 manches.' },
  { id: 'online', icon: '🌐', title: 'En ligne', desc: 'Jouer à 4 à distance, temps réel. Codes de partie, sièges bots ou amis.' },
];

export function Menu({ onPick, auth }: { onPick: (s: Screen) => void; auth: Auth }) {
  const me = auth.account;
  return (
    <div className="menu">
      <div className="hero">
        <h1>Barbu</h1>
        <p>Le jeu de cartes de la famille — en solo contre des bots ou en ligne entre amis.</p>
      </div>

      {me && (
        <div className="whoami">
          <span className="avatar">{me.avatar}</span>
          <span className="pfname">{me.pseudo}</span>
          <button className="ghost tiny" onClick={auth.logout}>Se déconnecter</button>
        </div>
      )}

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
      <div className="menuactions">
        <button className="ghost" onClick={() => onPick('settings')}>⚙️ Mon compte</button>
      </div>
      <footer className="menufoot">Règles : contrat le plus bas gagne. 7 contrats, 28 manches.</footer>
    </div>
  );
}

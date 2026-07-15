export type Screen = 'menu' | 'solo' | 'arbiter' | 'online' | 'settings';

const MODES: { id: Screen; icon: string; title: string; desc: string; disabled?: boolean }[] = [
  { id: 'solo', icon: '🤖', title: 'Solo', desc: 'Jouer contre 3 bots. Partie complète, 28 manches.' },
  { id: 'arbiter', icon: '📋', title: 'Arbitre', desc: 'Accompagner une vraie partie : contrats, contres, saisie des résultats et compte des points.' },
  { id: 'online', icon: '🌐', title: 'En ligne', desc: 'Jouer à 4 à distance, temps réel.', disabled: true },
];

export function Menu({ onPick }: { onPick: (s: Screen) => void }) {
  return (
    <div className="menu">
      <div className="hero">
        <h1>Barbu</h1>
        <p>Le jeu de cartes de la famille — en ligne, en solo, ou en arbitre d'une vraie partie.</p>
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
      <div className="menuactions">
        <button className="ghost" onClick={() => onPick('settings')}>⚙️ Réglages — profils, historique, données</button>
      </div>
      <footer className="menufoot">Règles : contrat le plus bas gagne. 7 contrats, 28 manches.</footer>
    </div>
  );
}

import type { Auth } from './auth/useAuth.js';
import { Icon, type IconName } from './ui/Icon.js';
import { Avatar } from './ui/Avatar.js';
import { useLiveMatches } from './social/useSocial.js';

export type Screen = 'menu' | 'solo' | 'online' | 'settings' | 'social' | 'rules';

const MODES: { id: Screen; icon: IconName; title: string; desc: string; disabled?: boolean }[] = [
  { id: 'solo', icon: 'bot', title: 'Solo', desc: 'Contre 3 bots. Partie complète, 28 manches.' },
  { id: 'online', icon: 'globe', title: 'En ligne', desc: 'À 4 en temps réel. Code de partie, sièges bots ou amis.' },
];

/** Onglet « Jouer » : choix du mode, plus la reprise des parties en ligne en cours. */
export function Menu({
  onPick,
  auth,
  onJoinRoom,
}: {
  onPick: (s: Screen) => void;
  auth: Auth;
  /** Retourne directement dans une salle en ligne (partie quittée en cours de route). */
  onJoinRoom: (code: string) => void;
}) {
  const me = auth.account;
  // Quitter une partie en ligne renvoie au menu sans la clore : elle reste
  // ouverte côté serveur, on la propose donc ici plutôt que dans l'onglet Amis.
  const live = useLiveMatches(auth.token);

  return (
    <div className="hub">
      <div className="hubhead">
        <h2>Bonjour {me?.pseudo}</h2>
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
            <span className="micon"><Icon name={m.icon} size={22} /></span>
            <span className="mtitle">{m.title}{m.disabled && <em> — bientôt</em>}</span>
            <span className="mdesc">{m.desc}</span>
          </button>
        ))}
      </div>

      {live.length > 0 && (
        <div className="panel resumepanel">
          <div className="panelhead"><h3>Parties en cours</h3></div>
          {live.map((m) => (
            <div key={m.id} className="resumerow">
              <span className="resumewho">
                {m.players
                  .filter((p) => p.id !== me?.id)
                  .map((p) => (
                    <span key={p.id} className="mr-p"><Avatar name={p.avatar} size="sm" />{p.pseudo}</span>
                  ))}
              </span>
              <button className="tiny" onClick={() => onJoinRoom(m.code)}>
                <Icon name="play" size={14} />Reprendre
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

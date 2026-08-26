import { useState } from 'react';
import type { OnlineMatch } from '@barbu/engine';
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
  const { live, remove } = useLiveMatches(auth.token);
  // Partie dont la suppression attend confirmation (irréversible).
  const [confirm, setConfirm] = useState<OnlineMatch | null>(null);
  const [busy, setBusy] = useState(false);

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
            <LiveMatchRow
              key={m.id}
              match={m}
              meId={me?.id}
              onJoin={() => onJoinRoom(m.code)}
              onDelete={() => setConfirm(m)}
            />
          ))}
        </div>
      )}

      {confirm && (
        <div className="modal-back" onClick={() => !busy && setConfirm(null)}>
          <div className="modal leave-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Supprimer cette partie ?</h2>
            <p className="muted">
              La partie <b>{confirm.code}</b> disparaîtra pour tous les joueurs, avec sa progression.
              Cette action est irréversible.
            </p>
            <div className="leave-actions">
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await remove(confirm.id);
                    setConfirm(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Supprimer définitivement
              </button>
              <button className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Une partie encore ouverte : quand elle a commencé, où elle en est, contre qui.
 * Le bouton de suppression n'apparaît qu'au créateur de la salle — l'entrée est
 * partagée par tous les participants, le serveur refuse de toute façon les autres.
 */
function LiveMatchRow({
  match,
  meId,
  onJoin,
  onDelete,
}: {
  match: OnlineMatch;
  meId: string | undefined;
  onJoin: () => void;
  onDelete: () => void;
}) {
  const others = match.players.filter((p) => p.id !== meId);
  // Parties ouvertes avant l'enregistrement de l'avancement : total à 0.
  const pct = match.totalManches ? Math.round((match.manches / match.totalManches) * 100) : null;

  return (
    <div className="resumerow">
      <div className="resumemeta">
        <span className="mr-when">{DATE_FMT.format(new Date(match.startedAt))}</span>
        <span className="mr-code">{match.code}</span>
        {pct !== null && (
          <span className="resumeprog">Manche {Math.min(match.manches + 1, match.totalManches)}/{match.totalManches} · {pct}%</span>
        )}
      </div>
      <span className="resumewho">
        {others.map((p) => (
          <span key={p.id} className="mr-p"><Avatar name={p.avatar} size="sm" />{p.pseudo}</span>
        ))}
      </span>
      <div className="resumeactions">
        {match.ownerId === meId && (
          <button className="ghost tiny" onClick={onDelete}>Supprimer</button>
        )}
        <button className="tiny" onClick={onJoin}><Icon name="play" size={14} />Reprendre</button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { PlayerStats, PublicProfile } from '@barbu/engine';
import { apiFetch, ApiError } from '../auth/api.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

interface ProfileCard {
  profile: PublicProfile;
  stats: PlayerStats;
  friend: boolean;
}

/**
 * Fiche d'un joueur croisé en partie : profil et statistiques en ligne. Chargée
 * à l'ouverture (rien n'est préchargé pour les 3 adversaires : on ne paie la
 * requête que si on clique) et affichée en modale par-dessus la table.
 */
export function PlayerProfileModal({
  id,
  token,
  onClose,
}: {
  id: string;
  token: string | null;
  onClose: () => void;
}) {
  const [card, setCard] = useState<ProfileCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCard(null);
    setError(null);
    apiFetch<ProfileCard>('/social/profile', { token, body: { id } })
      .then((c) => alive && setCard(c))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Profil indisponible.'));
    return () => {
      alive = false;
    };
  }, [id, token]);

  const stats = card?.stats;
  const rate = stats?.games ? Math.round((stats.wins / stats.games) * 100) : 0;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="topbar">
          <button className="ghost" onClick={onClose}><Icon name="arrowLeft" size={16} />Fermer</button>
          <h2>Profil</h2>
        </div>

        {error && <p className="errline"><Icon name="warning" size={16} />{error}</p>}
        {!card && !error && <p className="muted">Chargement…</p>}

        {card && (
          <>
            <div className="whoami">
              <Avatar name={card.profile.avatar} size="lg" />
              <span className="pfname">{card.profile.pseudo}</span>
              {card.friend && <span className="mr-code">ami</span>}
            </div>
            <div className="statgrid">
              <Stat label="Parties" value={stats!.games} />
              <Stat label="Victoires" value={stats!.wins} />
              <Stat label="Taux" value={`${rate}%`} />
              <Stat label="Meilleur score" value={stats!.bestScore ?? '—'} />
            </div>
            <p className="muted">Statistiques des parties en ligne uniquement.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="statcell">
      <span className="statval">{value}</span>
      <span className="statlabel">{label}</span>
    </div>
  );
}

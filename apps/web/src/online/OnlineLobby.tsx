import { useEffect, useState } from 'react';
import {
  DEFAULT_MATCH_OPTIONS,
  totalManches,
  type Difficulty,
  type FriendInfo,
  type MatchOptions,
  type PlayerId,
  type SeatInfo,
  type SocialSnapshot,
} from '@barbu/engine';
import type { OnlineGame } from './useOnlineGame.js';
import { MatchOptionsForm } from '../game/MatchOptionsForm.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';
import { apiFetch } from '../auth/api.js';

const SEAT_LABEL = ['Siège 1', 'Siège 2', 'Siège 3', 'Siège 4'];
const LEVELS: { id: Difficulty; label: string }[] = [
  { id: 'facile', label: 'Facile' },
  { id: 'moyen', label: 'Moyen' },
  { id: 'difficile', label: 'Difficile' },
  { id: 'impossible', label: 'Impossible' },
];

/** Salon d'attente : code partageable + configuration des sièges par l'hôte. */
export function OnlineLobby({
  game,
  code,
  token,
  onBack,
  onShowProfile,
}: {
  game: OnlineGame;
  code: string;
  /** Session : sert à inviter des amis dans la salle. */
  token: string | null;
  onBack: () => void;
  /** Ouvre la fiche du joueur assis sur un siège. */
  onShowProfile: (profileId: string) => void;
}) {
  const { seats, youSeat, isHost, isOwner } = game;
  const [options, setOptions] = useState<MatchOptions>(DEFAULT_MATCH_OPTIONS);
  const link = `${location.origin}${location.pathname}?room=${code}`;
  const full = seats.length === 4 && seats.every((s) => s.kind !== 'open');

  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={onBack}><Icon name="arrowLeft" size={16} />Retour</button>
        <h1>Salon en ligne</h1>
      </div>

      <div className="picker setup-wide">
        <div className="roomcode">
          <span className="rclabel">Code de la partie</span>
          <span className="rccode">{code}</span>
          <button className="ghost tiny" onClick={() => navigator.clipboard?.writeText(link)}>
            <Icon name="copy" size={15} />Copier le lien
          </button>
        </div>

        {!game.connected && <p className="muted">Connexion au serveur…</p>}
        {game.error && <p className="errline"><Icon name="warning" size={16} />{game.error}</p>}

        <div className="seatgrid">
          {seats.map((s) => (
            <SeatSlot
              key={s.seat}
              seat={s}
              you={youSeat}
              isHost={isHost}
              isOwner={isOwner}
              onConfigure={game.configureSeat}
              onShowProfile={onShowProfile}
            />
          ))}
        </div>

        {/* Partie déjà lancée : on reprend là où elle en était, sans repasser
            par la configuration — les sièges et les bots sont déjà fixés. */}
        {game.started ? (
          <p className="muted">Reprise de la partie en cours…</p>
        ) : isHost ? (
          <>
            <p className="muted">Tu es l'hôte. Remplis chaque siège vide (place ouverte pour un ami, ou un bot), règle les options, puis lance la partie.</p>

            <InvitePanel token={token} code={code} seats={seats} />

            <div className="panel">
              <div className="panelhead"><h3>Règles de la partie</h3></div>
              <MatchOptionsForm value={options} onChange={setOptions} />
            </div>

            <button className="bigstart" disabled={!full} onClick={() => game.startMatch(options)}>
              <Icon name="play" size={18} />Démarrer — {totalManches(options)} manches
            </button>
          </>
        ) : (
          <p className="muted">En attente de l'hôte pour démarrer…</p>
        )}
      </div>
    </div>
  );
}

/**
 * Invitation d'amis à la salle qu'on vient de créer. L'invitation ne réserve pas
 * de siège : elle dépose le code chez l'ami, qui le retrouve sur son écran
 * d'accueil et entre quand il veut — la salle n'a rien à savoir de tout ça.
 */
function InvitePanel({ token, code, seats }: { token: string | null; code: string; seats: SeatInfo[] }) {
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!token) return;
    apiFetch<SocialSnapshot>('/social/snapshot', { token })
      .then((s) => alive && setFriends(s.friends))
      .catch(() => alive && setFriends([]));
    return () => {
      alive = false;
    };
  }, [token]);

  // Déjà à table : les réinviter n'aurait aucun sens.
  const seated = new Set(seats.map((s) => s.profileId).filter(Boolean));
  const list = friends.filter((f) => !seated.has(f.id));
  if (list.length === 0) return null;

  const invite = async (f: FriendInfo) => {
    setError(null);
    try {
      await apiFetch('/social/invite', { token, body: { id: f.id, code } });
      setSent((prev) => [...prev, f.id]);
    } catch {
      setError('Invitation impossible pour le moment.');
    }
  };

  return (
    <div className="panel">
      <div className="panelhead"><h3>Inviter des amis</h3></div>
      <p className="muted">Ils verront l'invitation sur leur écran d'accueil, avec le code de la partie.</p>
      {error && <p className="errmsg">{error}</p>}
      <div className="invitelist">
        {list.map((f) => (
          <div key={f.id} className="inviterow">
            <span className="mr-p"><Avatar name={f.avatar} size="sm" />{f.pseudo}</span>
            <span className="ivstate">
              <span className={`dot ${f.online ? 'online' : ''}`} title={f.online ? 'en ligne' : 'hors ligne'} />
              {sent.includes(f.id) ? (
                <span className="muted">Invité</span>
              ) : (
                <button className="ghost tiny" onClick={() => void invite(f)}>Inviter</button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeatSlot({
  seat,
  you,
  isHost,
  isOwner,
  onConfigure,
  onShowProfile,
}: {
  seat: SeatInfo;
  you: PlayerId | null;
  isHost: boolean;
  isOwner: boolean;
  onConfigure: (seat: PlayerId, kind: 'open' | 'bot', level?: Difficulty) => void;
  onShowProfile: (profileId: string) => void;
}) {
  const mine = seat.seat === you;
  return (
    <div className={`seatslot ${seat.kind !== 'open' ? 'filled' : ''} ${mine ? 'active' : ''}`}>
      <div className="slabel">{SEAT_LABEL[seat.seat]}{mine ? ' · vous' : ''}</div>

      {seat.kind === 'human' && (
        <>
          {/* Avatar cliquable : la fiche du joueur (stats en ligne) s'ouvre par-dessus. */}
          {seat.profileId ? (
            <button className="avatartap" onClick={() => onShowProfile(seat.profileId!)} aria-label={`Profil de ${seat.name}`}>
              <Avatar name={seat.avatar} size="lg" />
            </button>
          ) : (
            <Avatar name={seat.avatar} size="lg" />
          )}
          <div className="pfname">{seat.name}</div>
          {seat.connected === false && <div className="muted">déconnecté…</div>}
        </>
      )}
      {seat.kind === 'bot' && (
        <>
          <span className="avatar avatar-lg"><Icon name="bot" size={26} /></span>
          <div className="pfname">{seat.name ?? 'Bot'}</div>
          <div className="muted">{seat.level}</div>
        </>
      )}
      {seat.kind === 'open' && (
        <>
          <span className="avatar avatar-lg empty"><Icon name="seat" size={26} /></span>
          <div className="pfname muted">Libre</div>
        </>
      )}

      {/* Le siège d'un joueur déconnecté lui reste réservé : seul l'hôte peut le
          libérer, sinon une coupure d'une seconde coûterait sa place. */}
      {/* Libérer la place d'un joueur déconnecté est réservé au créateur : un
          hôte d'intérim ne doit pas pouvoir le déloger pendant sa coupure. */}
      {(seat.kind === 'human' ? isOwner : isHost) && (seat.kind !== 'human' || seat.connected === false) && (
        <div className="btnrow tight">
          {seat.kind === 'human' ? (
            <button className="ghost tiny" onClick={() => onConfigure(seat.seat, 'open')}>Libérer la place</button>
          ) : seat.kind === 'open' ? (
            <button className="ghost tiny" onClick={() => onConfigure(seat.seat, 'bot', 'difficile')}><Icon name="plus" size={15} />Bot</button>
          ) : (
            <>
              <button className="ghost tiny" onClick={() => onConfigure(seat.seat, 'open')}>Ouvrir</button>
              <select
                value={seat.level ?? 'difficile'}
                onChange={(e) => onConfigure(seat.seat, 'bot', e.target.value as Difficulty)}
              >
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
    </div>
  );
}

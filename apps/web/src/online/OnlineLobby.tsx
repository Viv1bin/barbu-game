import type { Difficulty, PlayerId, SeatInfo } from '@barbu/engine';
import type { OnlineGame } from './useOnlineGame.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

const SEAT_LABEL = ['Siège 1', 'Siège 2', 'Siège 3', 'Siège 4'];
const LEVELS: { id: Difficulty; label: string }[] = [
  { id: 'facile', label: 'Facile' },
  { id: 'moyen', label: 'Moyen' },
  { id: 'difficile', label: 'Difficile' },
  { id: 'impossible', label: 'Impossible' },
];

/** Salon d'attente : code partageable + configuration des sièges par l'hôte. */
export function OnlineLobby({ game, code, onBack }: { game: OnlineGame; code: string; onBack: () => void }) {
  const { seats, youSeat, isHost } = game;
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
            <SeatSlot key={s.seat} seat={s} you={youSeat} isHost={isHost} onConfigure={game.configureSeat} />
          ))}
        </div>

        {isHost ? (
          <>
            <p className="muted">Tu es l'hôte. Remplis chaque siège vide (place ouverte pour un ami, ou un bot), puis lance la partie.</p>
            <button disabled={!full} onClick={game.startMatch}>Démarrer la partie</button>
          </>
        ) : (
          <p className="muted">En attente de l'hôte pour démarrer…</p>
        )}
      </div>
    </div>
  );
}

function SeatSlot({
  seat,
  you,
  isHost,
  onConfigure,
}: {
  seat: SeatInfo;
  you: PlayerId | null;
  isHost: boolean;
  onConfigure: (seat: PlayerId, kind: 'open' | 'bot', level?: Difficulty) => void;
}) {
  const mine = seat.seat === you;
  return (
    <div className={`seatslot ${seat.kind !== 'open' ? 'filled' : ''} ${mine ? 'active' : ''}`}>
      <div className="slabel">{SEAT_LABEL[seat.seat]}{mine ? ' · vous' : ''}</div>

      {seat.kind === 'human' && (
        <>
          <Avatar name={seat.avatar} size="lg" />
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

      {isHost && seat.kind !== 'human' && (
        <div className="btnrow tight">
          {seat.kind === 'open' ? (
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

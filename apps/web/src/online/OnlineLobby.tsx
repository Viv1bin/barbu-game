import { useState } from 'react';
import {
  DEFAULT_MATCH_OPTIONS,
  totalManches,
  type Difficulty,
  type MatchOptions,
  type PlayerId,
  type SeatInfo,
} from '@barbu/engine';
import type { OnlineGame } from './useOnlineGame.js';
import { MatchOptionsForm } from '../game/MatchOptionsForm.js';
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
            <SeatSlot key={s.seat} seat={s} you={youSeat} isHost={isHost} onConfigure={game.configureSeat} />
          ))}
        </div>

        {/* Partie déjà lancée : on reprend là où elle en était, sans repasser
            par la configuration — les sièges et les bots sont déjà fixés. */}
        {game.started ? (
          <p className="muted">Reprise de la partie en cours…</p>
        ) : isHost ? (
          <>
            <p className="muted">Tu es l'hôte. Remplis chaque siège vide (place ouverte pour un ami, ou un bot), règle les options, puis lance la partie.</p>

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

      {/* Le siège d'un joueur déconnecté lui reste réservé : seul l'hôte peut le
          libérer, sinon une coupure d'une seconde coûterait sa place. */}
      {isHost && (seat.kind !== 'human' || seat.connected === false) && (
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

import { useState } from 'react';
import { currentActor, isValidRoomCode, randomRoomCode, ROOM_CODE_LENGTH, type Account } from '@barbu/engine';
import { GameTable, type SeatLabel, type TableView } from '../game/GameTable.js';
import { OnlineLobby } from './OnlineLobby.js';
import { useOnlineGame, type OnlineIdentity } from './useOnlineGame.js';

/** Dernière salle rejointe, mémorisée pour proposer la reprise en ligne. */
const LAST_ROOM_KEY = 'barbu.online.last';
const rememberRoom = (code: string) => {
  try {
    localStorage.setItem(LAST_ROOM_KEY, code);
  } catch {
    /* mode privé : tant pis */
  }
};
const lastRoom = (): string | null => {
  try {
    return localStorage.getItem(LAST_ROOM_KEY);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Écran « En ligne » : création/rejoint (identité = compte), puis salon/partie.
// ---------------------------------------------------------------------------
export function OnlineScreen({ onBack, account, token }: { onBack: () => void; account: Account; token: string | null }) {
  const me: OnlineIdentity = { profileId: account.id, token: token ?? '' };
  const [session, setSession] = useState<{ code: string } | null>(null);

  const enter = (code: string) => {
    rememberRoom(code);
    setSession({ code });
  };

  if (!session) return <OnlineLanding account={account} onBack={onBack} onEnter={enter} />;
  return <OnlineRoom code={session.code} me={me} onLeave={() => setSession(null)} onMenu={onBack} />;
}

function OnlineLanding({
  account,
  onBack,
  onEnter,
}: {
  account: Account;
  onBack: () => void;
  onEnter: (code: string) => void;
}) {
  const urlRoom = new URLSearchParams(location.search).get('room') ?? '';
  const [code, setCode] = useState(urlRoom.toUpperCase());
  // Une salle mémorisée avant le passage aux codes longs n'est plus joignable.
  const remembered = lastRoom();
  const resumeCode = remembered && isValidRoomCode(remembered) ? remembered : null;

  const enter = (roomCode: string) => {
    const clean = roomCode.trim().toUpperCase();
    if (!isValidRoomCode(clean)) return;
    onEnter(clean);
  };

  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={onBack}>← Menu</button>
        <h1>Jouer en ligne</h1>
      </div>

      <div className="picker setup-wide">
        <div className="whoami">
          <span className="avatar">{account.avatar}</span>
          <span className="pfname">{account.pseudo}</span>
        </div>
        <p>Crée une partie et partage le code, ou rejoins un code existant.</p>

        {resumeCode && (
          <button className="ghost resumeonline" onClick={() => enter(resumeCode)}>
            ⏯️ Reprendre la partie <b>{resumeCode}</b>
          </button>
        )}

        <div className="onlineactions">
          <button onClick={() => enter(randomRoomCode())}>Créer une partie</button>
          <div className="joinrow">
            <input
              value={code}
              placeholder="CODE"
              maxLength={ROOM_CODE_LENGTH}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="ghost" disabled={!isValidRoomCode(code.trim())} onClick={() => enter(code)}>Rejoindre</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnlineRoom({ code, me, onLeave, onMenu }: { code: string; me: OnlineIdentity; onLeave: () => void; onMenu: () => void }) {
  const game = useOnlineGame(code, me);

  if (!game.started || !game.view) return <OnlineLobby game={game} code={code} onBack={onLeave} />;

  const view = game.view;
  const seats: SeatLabel[] = [0, 1, 2, 3].map((i) => {
    const s = game.seats[i];
    return {
      name: s?.name ?? (s?.kind === 'bot' ? 'Bot' : 'Libre'),
      avatar: s?.avatar ?? (s?.kind === 'bot' ? '🤖' : '🪑'),
      bot: s?.kind !== 'human',
    };
  });

  const table: TableView = {
    state: view,
    you: game.youSeat ?? 0,
    seats,
    handSizes: view.handSizes,
    history: game.history,
    pause: game.pause,
    hint: null,
    actor: currentActor(view),
    busy: game.pause !== null,
    actions: {
      chooseContract: game.chooseContract,
      respondContre: game.respondContre,
      playCard: game.playCard,
      reussitePlay: game.reussitePlay,
      reussitePass: game.reussitePass,
    },
    lastDeal: null,
    onNewGame: game.isHost && view.phase === 'DONE' ? game.newGame : undefined,
  };

  return <GameTable view={table} title={`en ligne · ${code}`} onBack={onMenu} />;
}

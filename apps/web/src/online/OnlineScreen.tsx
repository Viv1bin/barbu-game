import { useState } from 'react';
import { currentActor, type Account } from '@barbu/engine';
import { GameTable, type SeatLabel, type TableView } from '../game/GameTable.js';
import { OnlineLobby } from './OnlineLobby.js';
import { useOnlineGame, type OnlineIdentity } from './useOnlineGame.js';

/** Génère un code de salle à 4 lettres. */
function randomCode(): string {
  return Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
}

// ---------------------------------------------------------------------------
// Écran « En ligne » : création/rejoint (identité = compte), puis salon/partie.
// ---------------------------------------------------------------------------
export function OnlineScreen({ onBack, account }: { onBack: () => void; account: Account }) {
  const me: OnlineIdentity = { profileId: account.id, name: account.pseudo, avatar: account.avatar };
  const [session, setSession] = useState<{ code: string } | null>(null);

  if (!session) return <OnlineLanding account={account} onBack={onBack} onEnter={(code) => setSession({ code })} />;
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

  const enter = (roomCode: string) => {
    if (!roomCode.trim()) return;
    onEnter(roomCode.trim().toUpperCase());
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

        <div className="onlineactions">
          <button onClick={() => enter(randomCode())}>Créer une partie</button>
          <div className="joinrow">
            <input
              value={code}
              placeholder="CODE"
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="ghost" disabled={code.trim().length < 4} onClick={() => enter(code)}>Rejoindre</button>
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

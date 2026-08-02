import { useState } from 'react';
import { currentActor } from '@barbu/engine';
import { GameTable, type SeatLabel, type TableView } from '../game/GameTable.js';
import { useProfiles } from '../profiles/useProfiles.js';
import { AVATARS, type Profile } from '../profiles/store.js';
import { OnlineLobby } from './OnlineLobby.js';
import { useOnlineGame, type OnlineIdentity } from './useOnlineGame.js';

/** Génère un code de salle à 4 lettres. */
function randomCode(): string {
  return Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
}

// ---------------------------------------------------------------------------
// Écran « En ligne » : choix du profil + création/rejoint, puis salon/partie.
// ---------------------------------------------------------------------------
export function OnlineScreen({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<{ code: string; me: OnlineIdentity } | null>(null);

  if (!session) return <OnlineLanding onBack={onBack} onEnter={(code, me) => setSession({ code, me })} />;
  return <OnlineRoom code={session.code} me={session.me} onLeave={() => setSession(null)} onMenu={onBack} />;
}

function OnlineLanding({ onBack, onEnter }: { onBack: () => void; onEnter: (code: string, me: OnlineIdentity) => void }) {
  const profiles = useProfiles();
  const urlRoom = new URLSearchParams(location.search).get('room') ?? '';

  const [profileId, setProfileId] = useState<string | null>(profiles.store.profiles[0]?.id ?? null);
  const [creating, setCreating] = useState(profiles.store.profiles.length === 0);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]!);
  const [code, setCode] = useState(urlRoom.toUpperCase());

  const identityFor = (p: Profile): OnlineIdentity => ({ profileId: p.id, name: p.name, avatar: p.avatar });

  const resolveProfile = (): Profile | null => {
    if (creating) {
      if (!name.trim()) return null;
      return profiles.create(name, avatar);
    }
    return profiles.store.profiles.find((p) => p.id === profileId) ?? null;
  };

  const enter = (roomCode: string) => {
    const p = resolveProfile();
    if (!p || !roomCode.trim()) return;
    onEnter(roomCode.trim().toUpperCase(), identityFor(p));
  };

  const ready = creating ? name.trim().length > 0 : profileId !== null;

  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={onBack}>← Menu</button>
        <h1>Jouer en ligne</h1>
      </div>

      <div className="picker setup-wide">
        <p>Choisis ton profil, puis crée une partie ou rejoins un code.</p>

        {!creating && profiles.store.profiles.length > 0 && (
          <div className="plist">
            {profiles.store.profiles.map((p) => (
              <button
                key={p.id}
                className={`pickbtn ${p.id === profileId ? 'on' : ''}`}
                onClick={() => setProfileId(p.id)}
              >
                <span className="avatar">{p.avatar}</span>
                <span className="pickinfo"><span className="pfname">{p.name}</span></span>
              </button>
            ))}
            <button className="ghost" onClick={() => setCreating(true)}>＋ Nouveau profil</button>
          </div>
        )}

        {creating && (
          <div className="newprofile">
            <input
              autoFocus
              value={name}
              placeholder="Prénom / pseudo"
              maxLength={18}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="avatars">
              {AVATARS.map((a) => (
                <button key={a} className={`avatarpick ${a === avatar ? 'on' : ''}`} onClick={() => setAvatar(a)}>{a}</button>
              ))}
            </div>
            {profiles.store.profiles.length > 0 && (
              <button className="ghost tiny" onClick={() => setCreating(false)}>← Choisir un profil existant</button>
            )}
          </div>
        )}

        <div className="onlineactions">
          <button disabled={!ready} onClick={() => enter(randomCode())}>Créer une partie</button>
          <div className="joinrow">
            <input
              value={code}
              placeholder="CODE"
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="ghost" disabled={!ready || code.trim().length < 4} onClick={() => enter(code)}>Rejoindre</button>
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

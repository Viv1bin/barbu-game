import { useEffect, useState } from 'react';
import { currentActor, type Difficulty } from '@barbu/engine';
import { HUMAN, useSoloGame, type SoloSave } from './useSoloGame.js';
import { useSavedGames } from '../social/useSavedGame.js';
import { SavedGamesList } from './SavedGamesList.js';
import { GameTable, type LeaveOptions, type SeatLabel, type TableView } from '../game/GameTable.js';
import { PLAYER_NAMES } from '../format.js';

const SEAT_AVATARS = ['🙂', '🤖', '🤖', '🤖'];

/** Identifiant de partie stable (crypto si dispo, sinon repli). */
function newGameId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface Session {
  gameId: string;
  level: Difficulty;
  resume: SoloSave | null;
}

// ---------------------------------------------------------------------------
// Écran solo : accueil (Nouvelle / Reprendre) → partie (<GameTable/>).
// `initialResumeId` permet de reprendre directement une partie ouverte depuis
// les réglages.
// ---------------------------------------------------------------------------
export function SoloScreen({
  onBack,
  token,
  initialResumeId,
}: {
  onBack: () => void;
  token: string | null;
  initialResumeId?: string | null;
}) {
  const games = useSavedGames(token);
  const [aid, setAid] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  // Reprise directe demandée depuis les réglages : ouvre la partie dès qu'elle
  // apparaît dans la liste chargée.
  useEffect(() => {
    if (!initialResumeId || session) return;
    const s = games.saves.find((g) => g.id === initialResumeId);
    if (s && s.state) {
      const save = s.state as SoloSave;
      setSession({ gameId: s.id, level: save.level, resume: save });
    }
  }, [initialResumeId, games.saves, session]);

  if (!session) {
    return (
      <SoloSetup
        aid={aid}
        onToggleAid={setAid}
        onBack={onBack}
        games={games}
        onResume={(id, save) => setSession({ gameId: id, level: save.level, resume: save })}
        onStart={(level) => setSession({ gameId: newGameId(), level, resume: null })}
      />
    );
  }
  return (
    <SoloGameView
      key={session.gameId}
      level={session.level}
      aid={aid}
      resume={session.resume}
      onPersist={(save) => games.save(session.gameId, save)}
      onClear={() => games.remove(session.gameId)}
      onBack={onBack}
    />
  );
}

const LEVELS: { id: Difficulty; icon: string; title: string; desc: string }[] = [
  { id: 'facile', icon: '🍀', title: 'Facile', desc: 'Coups au hasard. Pour découvrir le jeu.' },
  { id: 'moyen', icon: '🎯', title: 'Moyen', desc: 'Esquive les pénalités, défausse malin.' },
  { id: 'difficile', icon: '🧠', title: 'Difficile', desc: 'Compte les cartes, encaisse les couleurs mortes, contre finement.' },
  { id: 'impossible', icon: '💀', title: 'Impossible', desc: "Simule des milliers de coups, joue quasi parfaitement, contre à l'espérance. Ne voit jamais les mains adverses." },
];

type SetupTab = 'home' | 'new' | 'load';

function SoloSetup({
  aid,
  onToggleAid,
  onBack,
  games,
  onResume,
  onStart,
}: {
  aid: boolean;
  onToggleAid: (v: boolean) => void;
  onBack: () => void;
  games: ReturnType<typeof useSavedGames>;
  onResume: (id: string, save: SoloSave) => void;
  onStart: (l: Difficulty) => void;
}) {
  const [tab, setTab] = useState<SetupTab>('home');
  const count = games.saves.length;

  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={() => (tab === 'home' ? onBack() : setTab('home'))}>
          {tab === 'home' ? '← Menu' : '← Retour'}
        </button>
        <h1>
          Solo{' '}
          <span className="mode">{tab === 'new' ? 'niveau des bots' : tab === 'load' ? 'reprendre' : 'nouvelle ou reprise'}</span>
        </h1>
      </div>

      {tab === 'home' && (
        <div className="modes">
          <button className="modecard" onClick={() => setTab('new')}>
            <span className="micon">✨</span>
            <span className="mtitle">Nouvelle partie</span>
            <span className="mdesc">Choisis un niveau de difficulté et commence une partie contre 3 bots.</span>
          </button>
          <button className="modecard" disabled={count === 0} onClick={() => setTab('load')}>
            <span className="micon">⏯️</span>
            <span className="mtitle">Reprendre une partie{count > 0 && <em> — {count}</em>}</span>
            <span className="mdesc">
              {count > 0 ? 'Reprends une partie en cours là où tu t’es arrêté.' : 'Aucune partie en cours pour l’instant.'}
            </span>
          </button>
        </div>
      )}

      {tab === 'new' && (
        <>
          <label className={`aidtoggle ${aid ? 'on' : ''}`}>
            <input type="checkbox" checked={aid} onChange={(e) => onToggleAid(e.target.checked)} />
            <span className="aidmark">💡</span>
            <span className="aidtext">
              <b>Mode aide</b> — l'IA « impossible » surligne le meilleur coup à chaque décision.
            </span>
          </label>
          <div className="modes levelpick">
            {LEVELS.map((l) => (
              <button key={l.id} className="modecard" onClick={() => onStart(l.id)}>
                <span className="micon">{l.icon}</span>
                <span className="mtitle">{l.title}</span>
                <span className="mdesc">{l.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'load' && (
        <div className="panel">
          <SavedGamesList
            saves={games.saves}
            loading={games.loading}
            onResume={onResume}
            onDelete={games.remove}
            empty="Aucune partie en cours."
          />
        </div>
      )}
    </div>
  );
}

function SoloGameView({
  level,
  aid,
  resume,
  onPersist,
  onClear,
  onBack,
}: {
  level: Difficulty;
  aid: boolean;
  resume: SoloSave | null;
  onPersist: (save: SoloSave) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  const game = useSoloGame(level, aid, { resume, onPersist, onClear });
  const { state } = game;

  const seats: SeatLabel[] = PLAYER_NAMES.map((name, p) => ({
    name,
    avatar: SEAT_AVATARS[p]!,
    bot: p !== HUMAN,
  }));
  const handSizes = state.round
    ? state.round.hands.map((h) => h.length)
    : state.pendingHands?.map((h) => h.length) ?? [0, 0, 0, 0];

  const view: TableView = {
    state,
    you: HUMAN,
    seats,
    handSizes,
    history: game.history,
    pause: game.pause,
    hint: game.hint,
    actor: currentActor(state),
    busy: game.busy,
    actions: {
      chooseContract: game.chooseContract,
      respondContre: game.respondContre,
      playCard: game.playCard,
      reussitePlay: game.reussitePlay,
      reussitePass: game.reussitePass,
    },
    lastDeal: game.lastDeal,
    onNewGame: game.newGame,
  };

  // Bouton « Menu » en partie : popup Garder / Supprimer.
  const leaveOptions: LeaveOptions = {
    onSave: () => onPersist(game.snapshot()),
    onDiscard: onClear,
  };

  return <GameTable view={view} title={`solo · ${level}`} onBack={onBack} leaveOptions={leaveOptions} />;
}

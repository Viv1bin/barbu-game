import { useState } from 'react';
import { ALL_CONTRACTS, currentActor, type Difficulty } from '@barbu/engine';
import { HUMAN, useSoloGame, type SoloSave } from './useSoloGame.js';
import { useSavedGame } from '../social/useSavedGame.js';
import { GameTable, type SeatLabel, type TableView } from '../game/GameTable.js';
import { PLAYER_NAMES } from '../format.js';

const SEAT_AVATARS = ['🙂', '🤖', '🤖', '🤖'];
const TOTAL_MANCHES = ALL_CONTRACTS.length * 4; // 7 contrats × 4 donneurs

/** Valide qu'un blob sauvegardé est bien une partie solo reprenable (non terminée). */
function asSoloSave(blob: unknown): SoloSave | null {
  const s = blob as SoloSave | null;
  return s && s.v === 1 && s.state && s.state.phase !== 'DONE' ? s : null;
}

// ---------------------------------------------------------------------------
// Écran solo : reprise éventuelle → choix du niveau → partie (<GameTable/>).
// ---------------------------------------------------------------------------
export function SoloScreen({ onBack, token }: { onBack: () => void; token: string | null }) {
  const slot = useSavedGame(token);
  const [session, setSession] = useState<{ level: Difficulty; resume: SoloSave | null } | null>(null);
  const [aid, setAid] = useState(false);

  if (!session) {
    return (
      <SoloSetup
        aid={aid}
        onToggleAid={setAid}
        onBack={onBack}
        savedGame={slot.loading ? null : asSoloSave(slot.save?.state)}
        onResume={(save) => setSession({ level: save.level, resume: save })}
        onStart={(level) => {
          slot.clear(); // nouvelle partie : la sauvegarde précédente est abandonnée
          setSession({ level, resume: null });
        }}
      />
    );
  }
  return (
    <SoloGameView
      level={session.level}
      aid={aid}
      resume={session.resume}
      onPersist={slot.persist}
      onClear={slot.clear}
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

function SoloSetup({
  aid,
  onToggleAid,
  onBack,
  savedGame,
  onResume,
  onStart,
}: {
  aid: boolean;
  onToggleAid: (v: boolean) => void;
  onBack: () => void;
  savedGame: SoloSave | null;
  onResume: (save: SoloSave) => void;
  onStart: (l: Difficulty) => void;
}) {
  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={onBack}>← Menu</button>
        <h1>Solo — niveau des bots</h1>
      </div>

      {savedGame && (
        <button className="modecard resumecard" onClick={() => onResume(savedGame)}>
          <span className="micon">⏯️</span>
          <span className="mtitle">Reprendre la partie</span>
          <span className="mdesc">
            Niveau {savedGame.level} · manche {savedGame.state.mancheCount + 1}/{TOTAL_MANCHES}
          </span>
        </button>
      )}

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
  onPersist: (state: unknown) => void;
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

  return <GameTable view={view} title={`solo · ${level}`} onBack={onBack} />;
}

import { useState } from 'react';
import { currentActor, type Difficulty } from '@barbu/engine';
import { HUMAN, useSoloGame } from './useSoloGame.js';
import { GameTable, type SeatLabel, type TableView } from '../game/GameTable.js';
import { PLAYER_NAMES } from '../format.js';

const SEAT_AVATARS = ['🙂', '🤖', '🤖', '🤖'];

// ---------------------------------------------------------------------------
// Écran solo : choix du niveau puis partie (rendue par <GameTable/> partagé).
// ---------------------------------------------------------------------------
export function SoloScreen({ onBack }: { onBack: () => void }) {
  const [level, setLevel] = useState<Difficulty | null>(null);
  const [aid, setAid] = useState(false);
  if (!level) return <SoloSetup aid={aid} onToggleAid={setAid} onBack={onBack} onStart={setLevel} />;
  return <SoloGameView level={level} aid={aid} onBack={onBack} />;
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
  onStart,
}: {
  aid: boolean;
  onToggleAid: (v: boolean) => void;
  onBack: () => void;
  onStart: (l: Difficulty) => void;
}) {
  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={onBack}>← Menu</button>
        <h1>Solo — niveau des bots</h1>
      </div>
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

function SoloGameView({ level, aid, onBack }: { level: Difficulty; aid: boolean; onBack: () => void }) {
  const game = useSoloGame(level, aid);
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

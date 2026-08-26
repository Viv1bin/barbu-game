import { useEffect, useState } from 'react';
import { DEFAULT_MATCH_OPTIONS, currentActor, type Difficulty, type MatchOptions } from '@barbu/engine';
import { HUMAN, useSoloGame, type BotSpeed, type SoloSave } from './useSoloGame.js';
import { MatchOptionsForm, ToggleRow } from '../game/MatchOptionsForm.js';
import { useSavedGames } from '../social/useSavedGame.js';
import { SavedGamesList } from './SavedGamesList.js';
import { GameTable, type LeaveOptions, type SeatLabel, type TableView } from '../game/GameTable.js';
import { PLAYER_NAMES } from '../format.js';
import { Icon, type IconName } from '../ui/Icon.js';

const SEAT_AVATARS: IconName[] = ['person', 'bot', 'bot', 'bot'];

/** Identifiant de partie stable (crypto si dispo, sinon repli). */
function newGameId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Réglages de confort, hors moteur : ils ne sont pas sauvegardés avec la partie. */
interface Comfort {
  aid: boolean;
  speed: BotSpeed;
}

interface Session {
  gameId: string;
  level: Difficulty;
  options: MatchOptions;
  resume: SoloSave | null;
}

// ---------------------------------------------------------------------------
// Écran solo : accueil (Nouvelle / Reprendre) → configuration → partie.
// `initialResumeId` permet de reprendre directement une partie ouverte depuis
// le profil.
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
  const [comfort, setComfort] = useState<Comfort>({ aid: false, speed: 'normale' });
  const [session, setSession] = useState<Session | null>(null);

  // Reprise directe demandée depuis le profil : ouvre la partie dès qu'elle
  // apparaît dans la liste chargée.
  useEffect(() => {
    if (!initialResumeId || session) return;
    const s = games.saves.find((g) => g.id === initialResumeId);
    if (s && s.state) {
      const save = s.state as SoloSave;
      setSession({ gameId: s.id, level: save.level, options: DEFAULT_MATCH_OPTIONS, resume: save });
    }
  }, [initialResumeId, games.saves, session]);

  if (!session) {
    return (
      <SoloSetup
        comfort={comfort}
        onComfort={setComfort}
        onBack={onBack}
        games={games}
        onResume={(id, save) =>
          setSession({ gameId: id, level: save.level, options: DEFAULT_MATCH_OPTIONS, resume: save })
        }
        onStart={(level, options) => setSession({ gameId: newGameId(), level, options, resume: null })}
      />
    );
  }
  return (
    <SoloGameView
      key={session.gameId}
      level={session.level}
      options={session.options}
      comfort={comfort}
      resume={session.resume}
      onPersist={(save) => games.save(session.gameId, save)}
      onClear={() => games.remove(session.gameId)}
      onBack={onBack}
    />
  );
}

const LEVELS: { id: Difficulty; icon: IconName; title: string; desc: string }[] = [
  { id: 'facile', icon: 'leaf', title: 'Facile', desc: 'Coups au hasard. Pour découvrir le jeu.' },
  { id: 'moyen', icon: 'target', title: 'Moyen', desc: 'Esquive les pénalités, défausse malin.' },
  { id: 'difficile', icon: 'layers', title: 'Difficile', desc: 'Compte les cartes, encaisse les couleurs mortes, contre finement.' },
  { id: 'impossible', icon: 'bolt', title: 'Impossible', desc: "Simule des milliers de coups, joue quasi parfaitement, contre à l'espérance. Ne voit jamais les mains adverses." },
];

const SPEEDS: { id: BotSpeed; label: string }[] = [
  { id: 'posee', label: 'Posée' },
  { id: 'normale', label: 'Normale' },
  { id: 'rapide', label: 'Rapide' },
];

type SetupTab = 'home' | 'new' | 'load';

function SoloSetup({
  comfort,
  onComfort,
  onBack,
  games,
  onResume,
  onStart,
}: {
  comfort: Comfort;
  onComfort: (c: Comfort) => void;
  onBack: () => void;
  games: ReturnType<typeof useSavedGames>;
  onResume: (id: string, save: SoloSave) => void;
  onStart: (l: Difficulty, o: MatchOptions) => void;
}) {
  const [tab, setTab] = useState<SetupTab>('home');
  const [level, setLevel] = useState<Difficulty>('moyen');
  const [options, setOptions] = useState<MatchOptions>(DEFAULT_MATCH_OPTIONS);
  const count = games.saves.length;

  return (
    <div className="app">
      <div className="topbar">
        <button className="ghost" onClick={() => (tab === 'home' ? onBack() : setTab('home'))}>
          <Icon name="arrowLeft" size={16} />{tab === 'home' ? 'Menu' : 'Retour'}
        </button>
        <h1>
          Solo{' '}
          <span className="mode">{tab === 'new' ? 'configuration' : tab === 'load' ? 'reprendre' : 'nouvelle ou reprise'}</span>
        </h1>
      </div>

      {tab === 'home' && (
        <div className="modes">
          <button className="modecard" onClick={() => setTab('new')}>
            <span className="micon"><Icon name="plus" size={22} /></span>
            <span className="mtitle">Nouvelle partie</span>
            <span className="mdesc">Règle la difficulté, la durée et les options, puis lance la partie.</span>
          </button>
          <button className="modecard" disabled={count === 0} onClick={() => setTab('load')}>
            <span className="micon"><Icon name="play" size={22} /></span>
            <span className="mtitle">Reprendre une partie{count > 0 && <em> — {count}</em>}</span>
            <span className="mdesc">
              {count > 0 ? 'Reprends une partie en cours là où tu t’es arrêté.' : 'Aucune partie en cours pour l’instant.'}
            </span>
          </button>
        </div>
      )}

      {tab === 'new' && (
        <div className="setup">
          <div className="panel">
            <div className="panelhead"><h3>Niveau des bots</h3></div>
            <div className="optcards">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  className={`optcard ${level === l.id ? 'on' : ''}`}
                  onClick={() => setLevel(l.id)}
                >
                  <span className="oc-title"><Icon name={l.icon} size={16} /> {l.title}</span>
                  <span className="oc-desc">{l.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panelhead"><h3>Règles de la partie</h3></div>
            <MatchOptionsForm value={options} onChange={setOptions} />
          </div>

          <div className="panel">
            <div className="panelhead"><h3>Confort de jeu</h3></div>
            <div className="field">
              <label>Rythme des bots</label>
              <div className="tabs">
                {SPEEDS.map((s) => (
                  <button
                    key={s.id}
                    className={comfort.speed === s.id ? 'on' : 'ghost'}
                    onClick={() => onComfort({ ...comfort, speed: s.id })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <ToggleRow
              label="Mode aide"
              hint="L'IA « impossible » surligne le meilleur coup à chaque décision."
              checked={comfort.aid}
              onChange={(aid) => onComfort({ ...comfort, aid })}
            />
          </div>

          <button className="bigstart" onClick={() => onStart(level, options)}>
            <Icon name="play" size={18} />Lancer la partie
          </button>
        </div>
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
  options,
  comfort,
  resume,
  onPersist,
  onClear,
  onBack,
}: {
  level: Difficulty;
  options: MatchOptions;
  comfort: Comfort;
  resume: SoloSave | null;
  onPersist: (save: SoloSave) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  const game = useSoloGame(level, comfort.aid, {
    resume,
    onPersist,
    onClear,
    options,
    speed: comfort.speed,
  });
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

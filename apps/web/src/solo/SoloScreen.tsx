import { useMemo, useState, type CSSProperties } from 'react';
import {
  ALL_CONTRACTS,
  canPass,
  cardId,
  currentActor,
  legalContracts,
  legalPlays,
  legalReussitePlays,
  type Card,
  type ContractId,
  type Difficulty,
  type MatchState,
  type PlayedCard,
  type PlayerId,
  type Rank,
  type ReussiteState,
  type Suit,
  type TrickRoundState,
} from '@barbu/engine';
import { HUMAN, useSoloGame, type SoloGame } from './useSoloGame.js';
import {
  CONTRACT_ABBR,
  CONTRACT_LABEL,
  PLAYER_NAMES,
  SUIT_RED,
  SUIT_SYMBOL,
  cardLabel,
  rankLabel,
} from '../format.js';

const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D'];
const SEAT_CLASS = ['seat-bottom', 'seat-left', 'seat-top', 'seat-right'];
// Point d'arrivée d'une carte (petit décalage vers le siège du joueur) + point de départ (bord).
const CARD_TO: Record<number, [string, string]> = { 0: ['0', '38px'], 1: ['-52px', '0'], 2: ['0', '-38px'], 3: ['52px', '0'] };
const CARD_FROM: Record<number, [string, string]> = { 0: ['0', '240px'], 1: ['-320px', '0'], 2: ['0', '-240px'], 3: ['320px', '0'] };

function isTrick(r: MatchState['round']): r is TrickRoundState {
  return !!r && 'currentTrick' in r;
}
function isReussite(r: MatchState['round']): r is ReussiteState {
  return !!r && 'files' in r;
}
function sortHand(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || b.rank - a.rank
  );
}

// ---------------------------------------------------------------------------
// Écran solo : choix du niveau puis partie.
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
  const actor = currentActor(state);

  return (
    <div className="app solo">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={onBack}>← Menu</button>
          <h1>Barbu <span className="mode">solo · {level}</span></h1>
        </div>
        <div className="meta">
          <span>Manche {Math.min(state.mancheCount + 1, 28)}/28</span>
          <span>Contrat : {state.currentContract ? CONTRACT_LABEL[state.currentContract] : '—'}</span>
          <button className="ghost" onClick={game.newGame}>Nouvelle partie</button>
        </div>
      </header>

      <PokerTable game={game} actor={actor} />
      <HumanDock game={game} actor={actor} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table de poker : 4 sièges + centre.
// ---------------------------------------------------------------------------
function PokerTable({ game, actor }: { game: SoloGame; actor: PlayerId | null }) {
  const { state, pause } = game;
  const round = state.round;
  const activeSeat = pause ? null : actor;

  return (
    <div className="poker-table">
      {PLAYER_NAMES.map((name, p) => {
        const hand = isTrick(round) || isReussite(round) ? round.hands[p]! : state.pendingHands?.[p] ?? [];
        const done = state.playedContracts[p] ?? [];
        const remaining = ALL_CONTRACTS.filter((c) => !done.includes(c));
        return (
          <div
            key={p}
            className={`seat ${SEAT_CLASS[p]} ${activeSeat === p ? 'active' : ''} ${p === state.dealer ? 'dealer' : ''} ${pause?.winner === p ? 'won' : ''}`}
          >
            <div className="avatar">{p === HUMAN ? '🙂' : '🤖'}</div>
            <div className="sinfo">
              <div className="sname">{name}{p === state.dealer ? ' 👑' : ''}</div>
              <div className="sscore">{state.scores[p]} pts</div>
              <div className="scards">{hand.length} 🂠</div>
              <div className="contracts" title="Contrats restants à donner">
                {remaining.map((c) => (
                  <span key={c} className={`cabbr ${state.currentContract === c && p === state.dealer ? 'now' : ''}`}>
                    {CONTRACT_ABBR[c]}
                  </span>
                ))}
                {remaining.length === 0 && <span className="cabbr done">✓</span>}
              </div>
            </div>
            {state.contres.includes(p as PlayerId) && <div className="ctag">contre</div>}
          </div>
        );
      })}
      <div className="table-center">
        <Center game={game} actor={actor} />
      </div>
    </div>
  );
}

function Center({ game, actor }: { game: SoloGame; actor: PlayerId | null }) {
  const { state, pause } = game;
  if (pause) return <TrickCards trick={pause.trick} winner={pause.winner} collecting={pause.collecting} />;
  if (state.phase === 'DONE') return <DoneScreen game={game} />;
  if (state.phase === 'CHOOSE_CONTRACT') {
    if (state.dealer === HUMAN) return <ContractPicker game={game} />;
    return <Waiting text={`${PLAYER_NAMES[state.dealer]} choisit le contrat…`} />;
  }
  if (state.phase === 'CONTRE') {
    return (
      <div className="announce-wrap">
        <ContractAnnounce state={state} />
        {actor === HUMAN ? <ContrePanel game={game} /> : (
          <p className="muted">{PLAYER_NAMES[actor ?? 0]} décide de contrer…</p>
        )}
      </div>
    );
  }
  if (isTrick(state.round)) return <TrickCards trick={state.round.currentTrick} winner={null} collecting={false} />;
  if (isReussite(state.round)) return <ReussiteView round={state.round} />;
  return null;
}

/** Contrat annoncé, affiché en grand au centre de la table (+ hauteur si Réussite). */
function ContractAnnounce({ state }: { state: MatchState }) {
  const c = state.currentContract;
  if (!c) return null;
  return (
    <div className="announce">
      <div className="alabel">Contrat annoncé par {PLAYER_NAMES[state.dealer]}</div>
      <div className="abig">{CONTRACT_LABEL[c]}</div>
      {c === 'REUSSITE' && state.reussiteRank != null && (
        <div className="aheight">hauteur {rankLabel(state.reussiteRank)}</div>
      )}
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return <div className="waiting">{text}</div>;
}

/** Cartes du pli : projetées depuis le siège de leur joueur ; à la fin, ramassées par le gagnant. */
function TrickCards({ trick, winner, collecting }: { trick: PlayedCard[]; winner: PlayerId | null; collecting: boolean }) {
  if (trick.length === 0) return <div className="trick-hint">À l'entame…</div>;
  const win = winner != null ? CARD_FROM[winner]! : ['0', '0'];
  return (
    <div className="trick-zone">
      {trick.map((pc) => {
        const to = CARD_TO[pc.player]!;
        const from = CARD_FROM[pc.player]!;
        const style = {
          '--tx': to[0], '--ty': to[1], '--fx': from[0], '--fy': from[1],
          '--cx': win[0], '--cy': win[1],
        } as CSSProperties;
        return (
          <div
            key={cardId(pc.card)}
            className={`thrown ${winner === pc.player ? 'win' : ''} ${collecting ? 'collect' : ''}`}
            style={style}
          >
            <div className={`card ${SUIT_RED[pc.card.suit] ? 'red' : 'black'}`}>{cardLabel(pc.card)}</div>
          </div>
        );
      })}
    </div>
  );
}

function ReussiteView({ round }: { round: ReussiteState }) {
  return (
    <div className="reussite">
      <div className="tricklabel">Réussite — hauteur {rankLabel(round.rank)} · tour : {PLAYER_NAMES[round.turn]}</div>
      <div className="files">
        {SUIT_ORDER.map((s) => {
          const fan = round.files[s];
          return (
            <div key={s} className={`file ${SUIT_RED[s] ? 'red' : 'black'}`}>
              <div className="fsuit">{SUIT_SYMBOL[s]}</div>
              <div className="frange">{fan ? `${rankLabel(fan.low)} – ${rankLabel(fan.high)}` : '—'}</div>
            </div>
          );
        })}
      </div>
      <div className="finish">Sortis : {round.finishOrder.map((p) => PLAYER_NAMES[p]).join(' → ') || '—'}</div>
    </div>
  );
}

function ContractPicker({ game }: { game: SoloGame }) {
  const { state, hint } = game;
  const [reussite, setReussite] = useState(false);
  const options = legalContracts(state);
  const handRanks = [...new Set((state.pendingHands?.[HUMAN] ?? []).map((c) => c.rank))].sort((a, b) => b - a);
  const tip = hint?.t === 'CHOOSE_CONTRACT' ? hint : null;

  if (reussite) {
    return (
      <div className="picker">
        <p>Réussite — hauteur d'ouverture :</p>
        <div className="btnrow">
          {handRanks.map((r) => (
            <button
              key={r}
              className={tip?.contract === 'REUSSITE' && tip.rank === r ? 'hinted' : ''}
              onClick={() => game.chooseContract('REUSSITE', r as Rank)}
            >
              {rankLabel(r)}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => setReussite(false)}>← retour</button>
      </div>
    );
  }
  return (
    <div className="picker">
      <p>À toi de donner. Choisis un contrat :</p>
      {tip && (
        <p className="hinttip">
          💡 Conseil : <b>{CONTRACT_LABEL[tip.contract]}</b>
          {tip.contract === 'REUSSITE' && tip.rank != null ? ` (hauteur ${rankLabel(tip.rank)})` : ''}
        </p>
      )}
      <div className="btnrow">
        {options.map((c: ContractId) => (
          <button
            key={c}
            className={tip?.contract === c ? 'hinted' : ''}
            onClick={() => (c === 'REUSSITE' ? setReussite(true) : game.chooseContract(c))}
          >
            {CONTRACT_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContrePanel({ game }: { game: SoloGame }) {
  const { hint } = game;
  const tip = hint?.t === 'CONTRE' ? hint : null;
  return (
    <div className="picker">
      <p>Contrer le donneur ({PLAYER_NAMES[game.state.dealer]}) ?</p>
      {tip && <p className="hinttip">💡 Conseil : <b>{tip.contre ? 'Contre' : 'Passe'}</b></p>}
      <div className="btnrow">
        <button className={tip?.contre === true ? 'hinted' : ''} onClick={() => game.respondContre(true)}>Contre</button>
        <button className={`ghost ${tip?.contre === false ? 'hinted' : ''}`} onClick={() => game.respondContre(false)}>Passe</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main de l'humain.
// ---------------------------------------------------------------------------
function HumanDock({ game, actor }: { game: SoloGame; actor: PlayerId | null }) {
  const { state, busy, hint } = game;
  const round = state.round;
  const hand = isTrick(round) || isReussite(round) ? round.hands[HUMAN]! : state.pendingHands?.[HUMAN] ?? [];
  const myTurn = !busy && state.phase === 'PLAY' && actor === HUMAN;
  const hintCardId =
    hint?.t === 'PLAY_CARD' || hint?.t === 'REUSSITE_PLAY' ? cardId(hint.card) : null;
  const hintPass = hint?.t === 'REUSSITE_PASS';

  const legalIds = useMemo(() => {
    if (!myTurn) return new Set<string>();
    if (isTrick(round)) return new Set(legalPlays(round, HUMAN).map(cardId));
    if (isReussite(round)) return new Set(legalReussitePlays(round, HUMAN).map(cardId));
    return new Set<string>();
  }, [myTurn, round]);

  const canHumanPass = myTurn && isReussite(round) && canPass(round, HUMAN);
  const onCard = (card: Card) => {
    if (!myTurn) return;
    if (isTrick(round)) game.playCard(card);
    else if (isReussite(round)) game.reussitePlay(card);
  };

  return (
    <footer className="dock">
      <div className="handbar">
        <span className="handlabel">Votre main{myTurn ? ' · à vous' : ''}</span>
        {myTurn && hintCardId && <span className="handhint">💡 coup conseillé surligné</span>}
        {canHumanPass && (
          <button className={`pass ${hintPass ? 'hinted' : ''}`} onClick={game.reussitePass}>Passer</button>
        )}
      </div>
      <div className="hand">
        {sortHand(hand).map((card) => {
          const legal = legalIds.has(cardId(card));
          const hinted = myTurn && cardId(card) === hintCardId;
          return (
            <button
              key={cardId(card)}
              className={`card ${SUIT_RED[card.suit] ? 'red' : 'black'} ${myTurn && !legal ? 'faded' : ''} ${hinted ? 'hinted' : ''}`}
              onClick={() => onCard(card)}
              disabled={!myTurn || !legal}
            >
              {cardLabel(card)}
            </button>
          );
        })}
        {hand.length === 0 && <span className="muted">— main vide —</span>}
      </div>
    </footer>
  );
}

function DoneScreen({ game }: { game: SoloGame }) {
  const { state, lastDeal } = game;
  const [reveal, setReveal] = useState(false);
  const ranking = PLAYER_NAMES.map((name, p) => ({ name, p, score: state.scores[p]! })).sort((a, b) => a.score - b.score);
  return (
    <div className="done">
      <h2>Partie terminée</h2>
      <ol className="ranking">
        {ranking.map((r, i) => (
          <li key={r.name} className={i === 0 ? 'winner' : ''}>
            <span>{r.name}</span><span>{r.score} pts</span>
          </li>
        ))}
      </ol>
      <p className="winnote">🏆 {ranking[0]!.name} gagne (moins de points).</p>
      <div className="btnrow">
        {lastDeal && <button className="ghost" onClick={() => setReveal((v) => !v)}>{reveal ? 'Masquer' : 'Révéler'} les mains</button>}
        <button onClick={game.newGame}>Rejouer</button>
      </div>
      {reveal && lastDeal && (
        <div className="reveal">
          <div className="rlabel">Dernière donne :</div>
          {PLAYER_NAMES.map((name, p) => (
            <div key={p} className="rrow">
              <span className="rname">{name}</span>
              <span className="rhand">
                {sortHand(lastDeal[p] ?? []).map((c) => (
                  <span key={cardId(c)} className={`minicard ${SUIT_RED[c.suit] ? 'red' : ''}`}>{cardLabel(c)}</span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

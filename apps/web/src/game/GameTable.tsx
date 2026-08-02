import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ALL_CONTRACTS,
  canPass,
  cardId,
  legalContracts,
  legalPlays,
  legalReussitePlays,
  type Action,
  type Card,
  type ContractId,
  type MancheLog,
  type MatchState,
  type PlayedCard,
  type PlayerId,
  type Rank,
  type ReussiteState,
  type Suit,
  type TrickRoundState,
} from '@barbu/engine';
import {
  CONTRACT_ABBR,
  CONTRACT_LABEL,
  SUIT_RED,
  SUIT_SYMBOL,
  cardLabel,
  rankLabel,
} from '../format.js';

// ---------------------------------------------------------------------------
// Vue de table normalisée, partagée par le solo et le mode en ligne. Chaque
// mode construit un TableView depuis son hook et rend <GameTable/>. Le siège
// local `you` est toujours affiché en bas (rotation des positions visuelles).
// ---------------------------------------------------------------------------

/** Pli figé en cours d'animation (avec la sous-phase « ramassage »). */
export interface UiPause {
  trick: PlayedCard[];
  winner: PlayerId;
  /** true = phase « le gagnant ramasse » (cartes filent vers son siège). */
  collecting: boolean;
}

/** Libellé d'un siège (humain ou bot). */
export interface SeatLabel {
  name: string;
  avatar: string;
  bot: boolean;
}

export interface TableActions {
  chooseContract: (contract: ContractId, rank?: Rank) => void;
  respondContre: (contre: boolean) => void;
  playCard: (card: Card) => void;
  reussitePlay: (card: Card) => void;
  reussitePass: () => void;
}

export interface TableView {
  /** État public (solo : MatchState ; en ligne : RedactedMatchState, compatible). */
  state: MatchState;
  /** Siège du joueur local (solo : 0). */
  you: PlayerId;
  /** Libellés des 4 sièges. */
  seats: SeatLabel[];
  /** Nombre de cartes par siège (mains adverses vidées en ligne → on lit ceci). */
  handSizes: number[];
  /** Manches terminées, pour le tableau des scores. */
  history: MancheLog[];
  /** Pli en cours d'animation, ou null. */
  pause: UiPause | null;
  /** Coup conseillé (aide solo) ; null en ligne. */
  hint: Action | null;
  /** Acteur courant (currentActor de l'état). */
  actor: PlayerId | null;
  /** true si le joueur local ne peut pas agir (bot en cours / pause). */
  busy: boolean;
  actions: TableActions;
  /** Donne complète pour le reveal de fin (solo) ; null si indisponible. */
  lastDeal: Card[][] | null;
  /** Relance une partie (solo : toujours ; en ligne : hôte uniquement). */
  onNewGame?: () => void;
}

const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D'];
// Positions visuelles : 0 = bas (moi), 1 = gauche, 2 = haut, 3 = droite.
const SEAT_CLASS = ['seat-bottom', 'seat-left', 'seat-top', 'seat-right'];
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
// Racine : en-tête + table + dock + tableau des scores.
// ---------------------------------------------------------------------------
export function GameTable({ view, title, onBack }: { view: TableView; title: ReactNode; onBack: () => void }) {
  const { state } = view;
  const [showScores, setShowScores] = useState(false);

  return (
    <div className="app solo">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={onBack}>← Menu</button>
          <h1>Barbu <span className="mode">{title}</span></h1>
        </div>
        <div className="meta">
          <span>Manche {Math.min(state.mancheCount + 1, 28)}/28</span>
          <span>Contrat : {state.currentContract ? CONTRACT_LABEL[state.currentContract] : '—'}</span>
          <button className="ghost" onClick={() => setShowScores(true)}>📊 Scores</button>
          {view.onNewGame && <button className="ghost" onClick={view.onNewGame}>Nouvelle partie</button>}
        </div>
      </header>

      <PokerTable view={view} />
      <HumanDock view={view} />
      {showScores && <ScoresModal view={view} onClose={() => setShowScores(false)} />}
    </div>
  );
}

/** Tableau des scores : détail manche par manche + cumuls + totaux. */
function ScoresModal({ view, onClose }: { view: TableView; onClose: () => void }) {
  const { history, state, seats } = view;
  const totals: number[][] = [];
  const acc = [0, 0, 0, 0];
  for (const m of history) {
    for (let p = 0; p < 4; p++) acc[p]! += m.points[p]!;
    totals.push(acc.slice());
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="topbar">
          <h2>Tableau des scores</h2>
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
        {history.length === 0 ? (
          <p className="muted">Aucune manche terminée pour l'instant.</p>
        ) : (
          <div className="tablewrap">
            <table className="stable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Donneur</th>
                  <th>Contrat</th>
                  {seats.map((s, p) => (
                    <th key={p} className="pcol">{s.avatar} {s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((m, i) => (
                  <tr key={i}>
                    <td className="dim">{i + 1}</td>
                    <td>{seats[m.dealer]!.avatar}</td>
                    <td>
                      {CONTRACT_LABEL[m.contract]}
                      {m.contres.length > 0 && (
                        <span className="ctrtag" title={`Contré par ${m.contres.map((c) => seats[c]!.name).join(', ')}`}>
                          ×{m.contres.length}
                        </span>
                      )}
                    </td>
                    {seats.map((_, p) => (
                      <td key={p} className="pcol">
                        <span className={`pts ${m.points[p]! > 0 ? 'neg' : m.points[p]! < 0 ? 'pos' : 'zero'}`}>
                          {m.points[p]! > 0 ? '+' : ''}{m.points[p]}
                        </span>
                        <span className="cum">{totals[i]![p]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  {state.scores.map((s, p) => (
                    <td key={p} className="pcol total">{s}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table de poker : 4 sièges (le local en bas) + centre.
// ---------------------------------------------------------------------------
function PokerTable({ view }: { view: TableView }) {
  const { state, pause, actor, you, seats, handSizes } = view;
  const activeSeat = pause ? null : actor;
  const pos = (p: number) => (p - you + 4) % 4;

  return (
    <div className="poker-table">
      {seats.map((seat, p) => {
        const done = state.playedContracts[p] ?? [];
        const remaining = ALL_CONTRACTS.filter((c) => !done.includes(c));
        return (
          <div
            key={p}
            className={`seat ${SEAT_CLASS[pos(p)]} ${activeSeat === p ? 'active' : ''} ${p === state.dealer ? 'dealer' : ''} ${pause?.winner === p ? 'won' : ''}`}
          >
            <div className="avatar">{seat.avatar}</div>
            <div className="sinfo">
              <div className="sname">{seat.name}{p === state.dealer ? ' 👑' : ''}</div>
              <div className="sscore">{state.scores[p]} pts</div>
              <div className="scards">{handSizes[p] ?? 0} 🂠</div>
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
        <Center view={view} />
      </div>
    </div>
  );
}

function Center({ view }: { view: TableView }) {
  const { state, pause, actor, you, seats } = view;
  if (pause) return <TrickCards trick={pause.trick} winner={pause.winner} collecting={pause.collecting} you={you} />;
  if (state.phase === 'DONE') return <DoneScreen view={view} />;
  if (state.phase === 'CHOOSE_CONTRACT') {
    if (state.dealer === you) return <ContractPicker view={view} />;
    return <Waiting text={`${seats[state.dealer]!.name} choisit le contrat…`} />;
  }
  if (state.phase === 'CONTRE') {
    return (
      <div className="announce-wrap">
        <ContractAnnounce state={state} seats={seats} />
        {actor === you ? <ContrePanel view={view} /> : (
          <p className="muted">{seats[actor ?? 0]!.name} décide de contrer…</p>
        )}
      </div>
    );
  }
  if (isTrick(state.round)) return <TrickCards trick={state.round.currentTrick} winner={null} collecting={false} you={you} />;
  if (isReussite(state.round)) return <ReussiteView round={state.round} seats={seats} />;
  return null;
}

function ContractAnnounce({ state, seats }: { state: MatchState; seats: SeatLabel[] }) {
  const c = state.currentContract;
  if (!c) return null;
  return (
    <div className="announce">
      <div className="alabel">Contrat annoncé par {seats[state.dealer]!.name}</div>
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

/** Cartes du pli : projetées depuis le siège de leur joueur (position tournée selon `you`). */
function TrickCards({ trick, winner, collecting, you }: { trick: PlayedCard[]; winner: PlayerId | null; collecting: boolean; you: PlayerId }) {
  if (trick.length === 0) return <div className="trick-hint">À l'entame…</div>;
  const pos = (p: number) => (p - you + 4) % 4;
  const win = winner != null ? CARD_FROM[pos(winner)]! : ['0', '0'];
  return (
    <div className="trick-zone">
      {trick.map((pc) => {
        const to = CARD_TO[pos(pc.player)]!;
        const from = CARD_FROM[pos(pc.player)]!;
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

function ReussiteView({ round, seats }: { round: ReussiteState; seats: SeatLabel[] }) {
  return (
    <div className="reussite">
      <div className="tricklabel">Réussite — hauteur {rankLabel(round.rank)} · tour : {seats[round.turn]!.name}</div>
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
      <div className="finish">Sortis : {round.finishOrder.map((p) => seats[p]!.name).join(' → ') || '—'}</div>
    </div>
  );
}

function ContractPicker({ view }: { view: TableView }) {
  const { state, hint, you, actions } = view;
  const [reussite, setReussite] = useState(false);
  const options = legalContracts(state);
  const handRanks = [...new Set((state.pendingHands?.[you] ?? []).map((c) => c.rank))].sort((a, b) => b - a);
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
              onClick={() => actions.chooseContract('REUSSITE', r as Rank)}
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
            onClick={() => (c === 'REUSSITE' ? setReussite(true) : actions.chooseContract(c))}
          >
            {CONTRACT_LABEL[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContrePanel({ view }: { view: TableView }) {
  const { hint, seats, state, actions } = view;
  const tip = hint?.t === 'CONTRE' ? hint : null;
  return (
    <div className="picker">
      <p>Contrer le donneur ({seats[state.dealer]!.name}) ?</p>
      {tip && <p className="hinttip">💡 Conseil : <b>{tip.contre ? 'Contre' : 'Passe'}</b></p>}
      <div className="btnrow">
        <button className={tip?.contre === true ? 'hinted' : ''} onClick={() => actions.respondContre(true)}>Contre</button>
        <button className={`ghost ${tip?.contre === false ? 'hinted' : ''}`} onClick={() => actions.respondContre(false)}>Passe</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main du joueur local.
// ---------------------------------------------------------------------------
function HumanDock({ view }: { view: TableView }) {
  const { state, busy, hint, you, actor, actions } = view;
  const round = state.round;
  const hand = isTrick(round) || isReussite(round) ? round.hands[you]! : state.pendingHands?.[you] ?? [];
  const myTurn = !busy && state.phase === 'PLAY' && actor === you;
  const hintCardId =
    hint?.t === 'PLAY_CARD' || hint?.t === 'REUSSITE_PLAY' ? cardId(hint.card) : null;
  const hintPass = hint?.t === 'REUSSITE_PASS';

  const legalIds = useMemo(() => {
    if (!myTurn) return new Set<string>();
    if (isTrick(round)) return new Set(legalPlays(round, you).map(cardId));
    if (isReussite(round)) return new Set(legalReussitePlays(round, you).map(cardId));
    return new Set<string>();
  }, [myTurn, round, you]);

  const canHumanPass = myTurn && isReussite(round) && canPass(round, you);
  const onCard = (card: Card) => {
    if (!myTurn) return;
    if (isTrick(round)) actions.playCard(card);
    else if (isReussite(round)) actions.reussitePlay(card);
  };

  return (
    <footer className="dock">
      <div className="handbar">
        <span className="handlabel">Votre main{myTurn ? ' · à vous' : ''}</span>
        {myTurn && hintCardId && <span className="handhint">💡 coup conseillé surligné</span>}
        {canHumanPass && (
          <button className={`pass ${hintPass ? 'hinted' : ''}`} onClick={actions.reussitePass}>Passer</button>
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

function DoneScreen({ view }: { view: TableView }) {
  const { state, lastDeal, seats, onNewGame } = view;
  const [reveal, setReveal] = useState(false);
  const ranking = seats.map((s, p) => ({ name: s.name, p, score: state.scores[p]! })).sort((a, b) => a.score - b.score);
  return (
    <div className="done">
      <h2>Partie terminée</h2>
      <ol className="ranking">
        {ranking.map((r, i) => (
          <li key={r.p} className={i === 0 ? 'winner' : ''}>
            <span>{r.name}</span><span>{r.score} pts</span>
          </li>
        ))}
      </ol>
      <p className="winnote">🏆 {ranking[0]!.name} gagne (moins de points).</p>
      <div className="btnrow">
        {lastDeal && <button className="ghost" onClick={() => setReveal((v) => !v)}>{reveal ? 'Masquer' : 'Révéler'} les mains</button>}
        {onNewGame && <button onClick={onNewGame}>Rejouer</button>}
      </div>
      {reveal && lastDeal && (
        <div className="reveal">
          <div className="rlabel">Dernière donne :</div>
          {seats.map((s, p) => (
            <div key={p} className="rrow">
              <span className="rname">{s.name}</span>
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

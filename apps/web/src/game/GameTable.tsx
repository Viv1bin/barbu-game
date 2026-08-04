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
  CONTRACT_HINT,
  CONTRACT_ICON,
  CONTRACT_LABEL,
  SUIT_RED,
  SUIT_SYMBOL,
  rankLabel,
} from '../format.js';
import { PlayingCard } from './Card.js';

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
const CARD_TO: Record<number, [string, string]> = { 0: ['0', '44px'], 1: ['-60px', '0'], 2: ['0', '-44px'], 3: ['60px', '0'] };
const CARD_FROM: Record<number, [string, string]> = { 0: ['0', '260px'], 1: ['-340px', '0'], 2: ['0', '-260px'], 3: ['340px', '0'] };

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
// Racine : en-tête + table + dock + tableau des scores + modale de contrat.
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

/**
 * Feuille de match Barbu : matrice donneur × contrat (comme la feuille papier).
 * Colonnes groupées par donneur (4), chaque groupe = les 4 joueurs ; lignes = les
 * 7 contrats. Chaque case = points du joueur sur la manche donnée par ce donneur.
 * En tête : le classement. En pied de groupe : sous-total du donneur.
 */
function ScoresModal({ view, onClose }: { view: TableView; onClose: () => void }) {
  const { history, state, seats } = view;
  const you = view.you;

  // Index des manches par (donneur, contrat).
  const byKey = new Map<string, MancheLog>();
  for (const m of history) byKey.set(`${m.dealer}:${m.contract}`, m);

  // Sous-total d'un donneur pour un joueur (somme de ses contrats déjà joués).
  const groupSub = (dealer: number, player: number) => {
    let s = 0;
    for (const c of ALL_CONTRACTS) {
      const m = byKey.get(`${dealer}:${c}`);
      if (m) s += m.points[player]!;
    }
    return s;
  };

  const ranking = seats
    .map((s, p) => ({ name: s.name, avatar: s.avatar, p, score: state.scores[p]! }))
    .sort((a, b) => a.score - b.score);
  const best = ranking[0]!.score;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal scores-modal" onClick={(e) => e.stopPropagation()}>
        <div className="topbar">
          <h2>📊 Feuille de match</h2>
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>

        {/* Classement en un coup d'œil (le moins de points gagne). */}
        <div className="standings">
          {ranking.map((r, i) => (
            <div key={r.p} className={`stand ${r.score === best ? 'lead' : ''} ${r.p === you ? 'me' : ''}`}>
              <span className="stand-rank">{i + 1}</span>
              <span className="stand-av">{r.avatar}</span>
              <span className="stand-name">{r.name}</span>
              <span className="stand-score">{r.score}</span>
            </div>
          ))}
        </div>

        <div className="tablewrap">
          <table className="smatrix">
            <thead>
              <tr>
                <th className="corner-th" rowSpan={2}>Contrat</th>
                {seats.map((s, d) => (
                  <th key={d} className={`grp ${d === state.dealer ? 'now' : ''}`} colSpan={4} title={`Donne de ${s.name}`}>
                    <span className="grp-av">{s.avatar}</span> donne
                  </th>
                ))}
              </tr>
              <tr>
                {seats.map((_, d) =>
                  seats.map((s, p) => (
                    <th key={`${d}-${p}`} className={`ph ${p === you ? 'me' : ''}`} title={s.name}>
                      {s.avatar}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {ALL_CONTRACTS.map((c) => (
                <tr key={c}>
                  <th className="ctr-th" title={CONTRACT_LABEL[c]}>
                    <span className="ctr-ic">{CONTRACT_ICON[c]}</span>
                    <span className="ctr-nm">{CONTRACT_LABEL[c]}</span>
                  </th>
                  {seats.map((_, d) => {
                    const m = byKey.get(`${d}:${c}`);
                    const isNow = d === state.dealer && state.currentContract === c;
                    return seats.map((__, p) => {
                      const v = m?.points[p];
                      const contred = m?.contres.includes(p as PlayerId);
                      return (
                        <td
                          key={`${d}-${p}`}
                          className={`cell ${isNow ? 'now' : ''} ${p === you ? 'me' : ''} ${v == null ? 'empty' : v > 0 ? 'neg' : v < 0 ? 'pos' : 'zero'}`}
                        >
                          {v == null ? '' : v}
                          {contred && <sup className="ctr-mark" title="contré">×</sup>}
                        </td>
                      );
                    });
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="subtotal">
                <th>Sous-total</th>
                {seats.map((_, d) =>
                  seats.map((__, p) => (
                    <td key={`${d}-${p}`} className={`sub ${p === you ? 'me' : ''}`}>
                      {groupSub(d, p) || ''}
                    </td>
                  )),
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted matrix-note">Chaque case : points du joueur (colonne) sur la manche donnée par le donneur (groupe). Le moins de points gagne.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table de poker : 4 sièges (le local en bas) + centre. Sièges allégés :
// avatar, nom, score, nombre de cartes (les contrats sont dans la modale scores).
// ---------------------------------------------------------------------------
function PokerTable({ view }: { view: TableView }) {
  const { state, pause, actor, you, seats, handSizes } = view;
  const activeSeat = pause ? null : actor;
  const pos = (p: number) => (p - you + 4) % 4;

  return (
    <div className="poker-table">
      {seats.map((seat, p) => (
        <div
          key={p}
          className={`seat ${SEAT_CLASS[pos(p)]} ${activeSeat === p ? 'active' : ''} ${p === state.dealer ? 'dealer' : ''} ${pause?.winner === p ? 'won' : ''}`}
        >
          <div className="avatar">{seat.avatar}</div>
          <div className="sinfo">
            <div className="sname">{seat.name}{p === state.dealer ? ' 👑' : ''}</div>
            <div className="sscore">{state.scores[p]} pts</div>
            <div className="scards"><b>{handSizes[p] ?? 0}</b> 🂠</div>
          </div>
          {state.contres.includes(p as PlayerId) && <div className="ctag">contre</div>}
        </div>
      ))}
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
      <div className="abig">{CONTRACT_ICON[c]} {CONTRACT_LABEL[c]}</div>
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
            <PlayingCard card={pc.card} size="lg" />
          </div>
        );
      })}
    </div>
  );
}

/** Réussite : chaque couleur montre ses cartes limites (bas → haut) avec un peu de volume. */
function ReussiteView({ round, seats }: { round: ReussiteState; seats: SeatLabel[] }) {
  return (
    <div className="reussite">
      <div className="tricklabel">Réussite — hauteur {rankLabel(round.rank)} · tour : {seats[round.turn]!.name}</div>
      <div className="rfiles">
        {SUIT_ORDER.map((s) => {
          const fan = round.files[s];
          return (
            <div key={s} className={`rfile ${SUIT_RED[s] ? 'red' : 'black'}`}>
              {fan ? (
                <div className="rfan">
                  <PlayingCard card={{ suit: s, rank: fan.low }} size="sm" />
                  {fan.high !== fan.low && <PlayingCard card={{ suit: s, rank: fan.high }} size="sm" className="stacked" />}
                </div>
              ) : (
                <div className="rempty">{SUIT_SYMBOL[s]}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="finish">Sortis : {round.finishOrder.map((p) => seats[p]!.name).join(' → ') || '—'}</div>
    </div>
  );
}

/** Choix du contrat, inline au centre de la table (la table reste visible). */
function ContractPicker({ view }: { view: TableView }) {
  const { state, hint, you, actions } = view;
  const [reussite, setReussite] = useState(false);
  const options = legalContracts(state);
  const handRanks = [...new Set((state.pendingHands?.[you] ?? []).map((c) => c.rank))].sort((a, b) => b - a);
  const tip = hint?.t === 'CHOOSE_CONTRACT' ? hint : null;

  if (reussite) {
    return (
      <div className="picker">
        <p>🎯 Réussite — hauteur d'ouverture :</p>
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
          💡 <b>{CONTRACT_LABEL[tip.contract]}</b>
          {tip.contract === 'REUSSITE' && tip.rank != null ? ` (hauteur ${rankLabel(tip.rank)})` : ''}
        </p>
      )}
      <div className="btnrow contract-btns">
        {options.map((c: ContractId) => (
          <button
            key={c}
            className={`contract-btn ${tip?.contract === c ? 'hinted' : ''}`}
            title={CONTRACT_HINT[c]}
            onClick={() => (c === 'REUSSITE' ? setReussite(true) : actions.chooseContract(c))}
          >
            <span className="cb-ic">{CONTRACT_ICON[c]}</span> {CONTRACT_LABEL[c]}
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
// Main du joueur local : grandes cartes en éventail superposé.
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

  const cards = sortHand(hand);
  const n = cards.length;

  return (
    <footer className="dock">
      <div className="handbar">
        <span className="handlabel">Votre main{myTurn ? ' · à vous' : ''}</span>
        {myTurn && hintCardId && <span className="handhint">💡 coup conseillé surligné</span>}
        {canHumanPass && (
          <button className={`pass ${hintPass ? 'hinted' : ''}`} onClick={actions.reussitePass}>Passer</button>
        )}
      </div>
      <div className="hand fan">
        {cards.map((card, i) => {
          const legal = legalIds.has(cardId(card));
          const hinted = myTurn && cardId(card) === hintCardId;
          const off = i - (n - 1) / 2;
          const style = {
            '--rot': `${off * 3}deg`,
            '--lift': `${Math.abs(off) * 5}px`,
            zIndex: i,
          } as CSSProperties;
          return (
            <button
              key={cardId(card)}
              className={`handcard ${myTurn && !legal ? 'faded' : ''} ${myTurn && legal ? 'playable' : ''} ${hinted ? 'hinted' : ''}`}
              style={style}
              onClick={() => onCard(card)}
              disabled={!myTurn || !legal}
            >
              <PlayingCard card={card} size="md" />
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
                  <PlayingCard key={cardId(c)} card={c} size="sm" />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

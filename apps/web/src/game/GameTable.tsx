import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ALL_CONTRACTS,
  canPass,
  cardId,
  legalContracts,
  legalPlays,
  legalReussitePlays,
  totalManches,
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
  CONTRACT_HINT,
  CONTRACT_ICON,
  CONTRACT_LABEL,
  SUIT_RED,
  SUIT_SYMBOL,
  rankLabel,
} from '../format.js';
import { PlayingCard } from './Card.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';
import { sortHand, useCardSort } from './cardSort.js';

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

/**
 * Dernier pli ramassé, gardé après l'animation pour pouvoir le revoir. Remis à
 * zéro à chaque manche : un pli de la manche précédente ne dit plus rien du
 * contrat en cours.
 */
export interface LastTrick {
  trick: PlayedCard[];
  winner: PlayerId;
}

/** Libellé d'un siège (humain ou bot). */
export interface SeatLabel {
  name: string;
  avatar: string;
  bot: boolean;
  /** Compte du joueur (en ligne, humains seulement) : ouvre sa fiche au clic. */
  profileId?: string;
}

export interface TableActions {
  chooseContract: (contract: ContractId, rank?: Rank) => void;
  respondContre: (contre: boolean) => void;
  playCard: (card: Card) => void;
  reussitePlay: (card: Card) => void;
  reussitePass: () => void;
}

/**
 * Administration d'une partie en ligne. Le créateur de la salle en est l'hôte :
 * lui seul met en pause, reprend, et décide de confier à un bot le siège d'un
 * joueur parti. Les autres peuvent seulement *demander* une pause.
 */
export interface RoomControl {
  isHost: boolean;
  /**
   * Créateur de la salle. L'hôte n'est qu'un intérim pendant son absence :
   * remplacer un joueur par un bot lui est réservé, sinon un remplaçant de
   * passage pouvait éjecter le titulaire d'un siège.
   */
  isOwner: boolean;
  /** Pause décidée par l'hôte. */
  paused: boolean;
  /** Sièges humains déconnectés : la partie est suspendue tant qu'ils manquent. */
  absent: PlayerId[];
  /** Demandes de pause en attente de la décision de l'hôte. */
  asks: PlayerId[];
  setPaused: (paused: boolean) => void;
  askPause: () => void;
  denyPause: () => void;
  fillBot: (seat: PlayerId) => void;
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
  /** Dernier pli terminé de la manche, consultable à la demande. */
  lastTrick: LastTrick | null;
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
  /** Contrôles de salle (mode en ligne uniquement ; absent en solo). */
  room?: RoomControl;
  /** Ouvre la fiche d'un joueur (en ligne). Absent → les sièges ne sont pas cliquables. */
  onShowProfile?: (profileId: string) => void;
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

// ---------------------------------------------------------------------------
// Racine : en-tête + table + dock + tableau des scores + modale de contrat.
// ---------------------------------------------------------------------------
/** Options de sortie d'une partie solo : le bouton « Menu » ouvre alors une
 *  popup Sauvegarder / Supprimer plutôt que de quitter directement. */
export interface LeaveOptions {
  onSave: () => void;
  onDiscard: () => void;
}

export function GameTable({
  view,
  title,
  onBack,
  leaveOptions,
}: {
  view: TableView;
  title: ReactNode;
  onBack: () => void;
  leaveOptions?: LeaveOptions;
}) {
  const { state } = view;
  const [showScores, setShowScores] = useState(false);
  const [showTrick, setShowTrick] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const choosing = state.phase === 'CHOOSE_CONTRACT' && state.dealer === view.you && !view.pause;
  const done = state.phase === 'DONE';
  const manches = totalManches(state.options);
  const recap = useMancheRecap(view);

  return (
    <div className="app solo">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={() => (leaveOptions && !done ? setLeaving(true) : onBack())}><Icon name="arrowLeft" size={16} />Menu</button>
          <h1>Barbu <span className="mode">{title}</span></h1>
        </div>
        <div className="meta">
          {/* Le total dépend des règles choisies : une partie éclair n'a que 8
              manches, afficher 28 en dur donnait un avancement faux. */}
          <span>Manche {Math.min(state.mancheCount + 1, manches)}/{manches}</span>
          <span>Contrat : {state.currentContract ? CONTRACT_LABEL[state.currentContract] : '—'}</span>
          <button className="ghost" onClick={() => setShowScores(true)}><Icon name="chart" size={16} />Scores</button>
          {/* Revoir le pli précédent : à quatre joueurs, une carte tombe vite et
              on n'a pas toujours le temps de lire ce qui vient de passer. */}
          <button className="ghost" disabled={!view.lastTrick} onClick={() => setShowTrick(true)}>
            <Icon name="cards" size={16} />Dernier pli
          </button>
          {view.room && !done && <PauseButton room={view.room} />}
        </div>
      </header>

      <PokerTable view={view} />
      {view.room && !done && <RoomBanner view={view} room={view.room} />}
      {choosing && <ContractBar view={view} />}
      <HumanDock view={view} />
      {showScores && <ScoresModal view={view} onClose={() => setShowScores(false)} />}
      {showTrick && view.lastTrick && (
        <LastTrickModal view={view} trick={view.lastTrick} onClose={() => setShowTrick(false)} />
      )}
      {recap.log && <MancheRecap view={view} index={recap.index} onClose={recap.close} />}
      {leaving && leaveOptions && (
        <LeaveDialog
          onSave={() => { leaveOptions.onSave(); onBack(); }}
          onDiscard={() => { leaveOptions.onDiscard(); onBack(); }}
          onCancel={() => setLeaving(false)}
        />
      )}
    </div>
  );
}

/** Bouton d'en-tête : pause/reprise pour l'hôte, simple demande pour les autres. */
function PauseButton({ room }: { room: RoomControl }) {
  if (room.isHost) {
    return (
      <button className="ghost" onClick={() => room.setPaused(!room.paused)}>
        <Icon name={room.paused ? 'play' : 'pause'} size={16} />
        {room.paused ? 'Reprendre' : 'Pause'}
      </button>
    );
  }
  if (room.paused) return <span className="pausetag">en pause</span>;
  return (
    <button className="ghost" onClick={room.askPause} disabled={room.asks.length > 0}>
      <Icon name="pause" size={16} />{room.asks.length > 0 ? 'Pause demandée' : 'Demander une pause'}
    </button>
  );
}

/**
 * Bandeau d'état de la salle : pause de l'hôte, joueur absent (la partie
 * s'arrête, elle ne passe **pas** en pilote automatique), demande de pause en
 * attente. Les boutons de décision n'apparaissent que chez l'hôte.
 */
function RoomBanner({ view, room }: { view: TableView; room: RoomControl }) {
  const { seats } = view;
  const name = (p: PlayerId) => seats[p]?.name ?? `Siège ${p + 1}`;
  const asks = room.asks.filter((p) => p !== view.you);
  // Siège dont le remplacement par un bot attend confirmation (le joueur perd
  // sa place pour de bon dans cette partie).
  const [botSeat, setBotSeat] = useState<PlayerId | null>(null);

  if (room.absent.length > 0) {
    return (
      <div className="roombanner warn">
        <span>
          <Icon name="warning" size={16} />
          Partie suspendue — {room.absent.map(name).join(', ')} {room.absent.length > 1 ? 'sont partis' : 'est parti'}.
          {room.isOwner
            ? ' Attends son retour, ou confie sa place à un bot.'
            : ' Le créateur de la partie peut le remplacer par un bot.'}
        </span>
        {room.isOwner && (
          <span className="rb-actions">
            {room.absent.map((p) => (
              <button key={p} className="tiny" onClick={() => setBotSeat(p)}>
                <Icon name="bot" size={14} />
                {room.absent.length > 1 ? `Bot à la place de ${name(p)}` : 'Remplacer par un bot'}
              </button>
            ))}
          </span>
        )}
        {botSeat !== null && (
          <div className="modal-back" onClick={() => setBotSeat(null)}>
            <div className="modal leave-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Remplacer {name(botSeat)} par un bot ?</h2>
              <p className="muted">
                Un bot prend la main de {name(botSeat)} et la partie repart aussitôt. S'il revient,
                il retrouve son siège, mais les coups joués par le bot resteront joués.
              </p>
              <div className="leave-actions">
                <button
                  onClick={() => {
                    room.fillBot(botSeat);
                    setBotSeat(null);
                  }}
                >
                  <Icon name="bot" size={16} />Confier à un bot
                </button>
                <button className="ghost" onClick={() => setBotSeat(null)}>Annuler</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (room.paused) {
    return (
      <div className="roombanner">
        <span><Icon name="pause" size={16} />Partie en pause{room.isHost ? '' : " — l'hôte doit la relancer"}.</span>
        {room.isHost && (
          <span className="rb-actions">
            <button className="tiny" onClick={() => room.setPaused(false)}><Icon name="play" size={14} />Reprendre</button>
          </span>
        )}
      </div>
    );
  }

  if (asks.length > 0 && room.isHost) {
    return (
      <div className="roombanner">
        <span><Icon name="pause" size={16} />{asks.map(name).join(', ')} demande une pause.</span>
        <span className="rb-actions">
          <button className="tiny" onClick={() => room.setPaused(true)}>Accepter</button>
          <button className="ghost tiny" onClick={room.denyPause}>Refuser</button>
        </span>
      </div>
    );
  }

  return null;
}

/** Popup à la sortie d'une partie solo : garder (reprendre plus tard) ou supprimer. */
function LeaveDialog({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal leave-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Quitter la partie ?</h2>
        <p className="muted">Tu peux la garder pour la reprendre plus tard, ou la supprimer définitivement.</p>
        <div className="leave-actions">
          <button onClick={onSave}><Icon name="archive" size={16} />Garder et quitter</button>
          <button className="danger" onClick={onDiscard}><Icon name="trash" size={16} />Supprimer la partie</button>
          <button className="ghost" onClick={onCancel}>Continuer à jouer</button>
        </div>
      </div>
    </div>
  );
}

/** Tableau des scores quasi plein écran : manche par manche + cumuls + contrats restants. */
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
      <div className="modal scores-modal" onClick={(e) => e.stopPropagation()}>
        <div className="topbar">
          <h2>Tableau des scores</h2>
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>

        {history.length === 0 ? (
          <p className="muted">Aucune manche terminée pour l'instant.</p>
        ) : (
          <div className="tablewrap">
            <table className="stable big">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Donneur</th>
                  <th>Contrat</th>
                  {seats.map((s, p) => (
                    <th key={p} className="pcol"><Avatar name={s.avatar} size="sm" /> {s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((m, i) => (
                  <tr key={i}>
                    <td className="dim">{i + 1}</td>
                    <td><Avatar name={seats[m.dealer]!.avatar} size="sm" /></td>
                    <td>
                      <Icon name={CONTRACT_ICON[m.contract]} size={15} /> {CONTRACT_LABEL[m.contract]}
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

        <ContractsOverview view={view} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fin de manche : récapitulatif animé (points de la manche, puis classement qui
// se réordonne). Non bloquant — la partie continue derrière, le panneau se
// referme tout seul.
// ---------------------------------------------------------------------------
/** Durée d'affichage du récapitulatif de manche avant fermeture automatique. */
const RECAP_MS = 6500;
/** Délai avant l'application des nouveaux totaux (le temps de lire les points). */
const RECAP_SETTLE_MS = 900;
/** Hauteur d'une ligne du classement : sert au calcul des positions animées. */
const RECAP_ROW = 44;

/** Rang (0 = premier) de chaque joueur pour un tableau de totaux. Moins = mieux. */
function rankOf(totals: number[]): number[] {
  const order = [0, 1, 2, 3].sort((a, b) => totals[a]! - totals[b]! || a - b);
  const ranks = [0, 0, 0, 0];
  order.forEach((p, i) => (ranks[p] = i));
  return ranks;
}

/**
 * Ouvre le récapitulatif dès qu'une manche s'ajoute à l'historique. La toute
 * dernière n'en déclenche pas : la fin de partie a déjà son propre écran.
 */
function useMancheRecap(view: TableView): { log: MancheLog | null; index: number; close: () => void } {
  const [index, setIndex] = useState(-1);
  // Initialisé à l'historique du premier rendu : rejoindre une partie déjà
  // avancée ne doit pas rejouer le récapitulatif d'une manche qu'on a ratée.
  const seen = useRef(view.history.length);
  const done = view.state.phase === 'DONE';

  useEffect(() => {
    const n = view.history.length;
    const grew = n > seen.current;
    seen.current = n;
    if (grew && !done) setIndex(n - 1);
  }, [view.history.length, done]);

  useEffect(() => {
    if (index < 0) return;
    const id = setTimeout(() => setIndex(-1), RECAP_MS);
    return () => clearTimeout(id);
  }, [index]);

  return { log: index >= 0 ? view.history[index] ?? null : null, index, close: () => setIndex(-1) };
}

/** Total qui défile de `from` à `to` quand `run` passe à true. */
function useCountUp(from: number, to: number, run: boolean): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!run) return setValue(from);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setValue(Math.round(from + (to - from) * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, run]);
  return value;
}

function MancheRecap({ view, index, onClose }: { view: TableView; index: number; onClose: () => void }) {
  const { history, seats } = view;
  const log = history[index]!;
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setSettled(false);
    const id = setTimeout(() => setSettled(true), RECAP_SETTLE_MS);
    return () => clearTimeout(id);
  }, [index]);

  const before = [0, 0, 0, 0];
  for (const m of history.slice(0, index)) for (let p = 0; p < 4; p++) before[p]! += m.points[p]!;
  const after = before.map((v, p) => v + log.points[p]!);
  // Les places se recalculent une fois les points encaissés : c'est ce
  // glissement d'une ligne à l'autre qui montre qui vient de doubler qui.
  const ranks = rankOf(settled ? after : before);

  return (
    <div className="recap-back">
      <div className="recap">
        <div className="rc-head">
          <span className="rc-step">Manche {index + 1} terminée</span>
          <h3>
            <Icon name={CONTRACT_ICON[log.contract]} size={18} /> {CONTRACT_LABEL[log.contract]}
          </h3>
          <span className="rc-dealer">
            donneur : {seats[log.dealer]!.name}
            {log.contres.length > 0 && ` · contré par ${log.contres.map((c) => seats[c]!.name).join(', ')}`}
          </span>
        </div>
        <div className="rc-board" style={{ height: 4 * RECAP_ROW }}>
          {seats.map((s, p) => (
            <RecapRow
              key={p}
              seat={s}
              rank={ranks[p]!}
              delta={log.points[p]!}
              before={before[p]!}
              after={after[p]!}
              settled={settled}
              you={p === view.you}
            />
          ))}
        </div>
        <button className="ghost tiny rc-close" onClick={onClose}>Continuer</button>
      </div>
    </div>
  );
}

function RecapRow({
  seat,
  rank,
  delta,
  before,
  after,
  settled,
  you,
}: {
  seat: SeatLabel;
  rank: number;
  delta: number;
  before: number;
  after: number;
  settled: boolean;
  you: boolean;
}) {
  const total = useCountUp(before, after, settled);
  const style = { transform: `translateY(${rank * RECAP_ROW}px)`, '--d': `${rank * 0.09}s` } as CSSProperties;
  return (
    <div className={`rc-row ${you ? 'me' : ''} ${rank === 0 && settled ? 'lead' : ''}`} style={style}>
      <span className="rc-pos">{rank + 1}</span>
      <Avatar name={seat.avatar} size="sm" />
      <span className="rc-name">{seat.name}</span>
      <span className={`rc-delta ${delta > 0 ? 'neg' : delta < 0 ? 'pos' : 'zero'}`}>
        {delta > 0 ? '+' : ''}{delta}
      </span>
      <span className="rc-total">{total} pts</span>
    </div>
  );
}

/**
 * Le pli précédent, rejoué au ralenti : les cartes reviennent une à une depuis
 * le siège de leur joueur, dans l'ordre où elles ont été posées.
 */
function LastTrickModal({ view, trick, onClose }: { view: TableView; trick: LastTrick; onClose: () => void }) {
  const { seats, you } = view;
  const pos = (p: number) => (p - you + 4) % 4;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal lasttrick-modal" onClick={(e) => e.stopPropagation()}>
        <div className="topbar">
          <h2>Dernier pli</h2>
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
        <div className="lt-zone">
          {trick.trick.map((pc, i) => {
            const to = CARD_TO[pos(pc.player)]!;
            const from = CARD_FROM[pos(pc.player)]!;
            const style = {
              '--tx': to[0], '--ty': to[1], '--fx': from[0], '--fy': from[1],
              '--d': `${i * 0.14}s`,
            } as CSSProperties;
            return (
              <div key={cardId(pc.card)} className={`lt-card ${trick.winner === pc.player ? 'win' : ''}`} style={style}>
                <PlayingCard card={pc.card} size="lg" />
                <span className="lt-who">{seats[pc.player]!.name}{i === 0 && ' · entame'}</span>
              </div>
            );
          })}
        </div>
        <p className="lt-note"><Icon name="trophy" size={16} /> Pli pour {seats[trick.winner]!.name}.</p>
      </div>
    </div>
  );
}

/** Contrats restant à donner par joueur — déplacé ici depuis les sièges (allégés). */
function ContractsOverview({ view }: { view: TableView }) {
  const { state, seats } = view;
  return (
    <div className="contracts-overview">
      <h3>Contrats restant à donner</h3>
      <div className="cov-grid">
        {seats.map((s, p) => {
          const done = state.playedContracts[p] ?? [];
          const remaining = ALL_CONTRACTS.filter((c) => !done.includes(c));
          return (
            <div key={p} className="cov-player">
              <div className="cov-name"><Avatar name={s.avatar} size="sm" /> {s.name}</div>
              <div className="cov-chips">
                {remaining.length === 0 ? (
                  <span className="cabbr done"><Icon name="check" size={13} /> terminé</span>
                ) : (
                  remaining.map((c) => (
                    <span
                      key={c}
                      className={`cabbr ${state.currentContract === c && p === state.dealer ? 'now' : ''}`}
                      title={CONTRACT_LABEL[c]}
                    >
                      <Icon name={CONTRACT_ICON[c]} size={13} /> {CONTRACT_ABBR[c]}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
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
          {/* Zone cliquable posée par-dessus la plaque plutôt qu'un bouton
              autour du contenu : la fiche s'ouvre au clic sans que le siège
              change d'un pixel (la table est déjà juste sur mobile). */}
          {view.onShowProfile && seat.profileId && (
            <button
              className="seattap"
              aria-label={`Profil de ${seat.name}`}
              onClick={() => view.onShowProfile!(seat.profileId!)}
            />
          )}
          <Avatar name={seat.avatar} />
          <div className="sinfo">
            <div className="sname">{seat.name}{p === state.dealer && <Icon name="crown" size={13} className="dealermark" />}</div>
            <div className="sscore">{state.scores[p]} pts</div>
            <div className="scards"><b>{handSizes[p] ?? 0}</b> cartes</div>
          </div>
          {state.contres.includes(p as PlayerId) && <div className="ctag">contre</div>}
          {/* Le siège signale l'absence, sans plus : y loger un bouton élargirait
              la plaque du joueur, et la table déborde sur mobile. La décision est
              dans le bandeau du bas, avec la pause. */}
          {view.room?.absent.includes(p as PlayerId) && <div className="gonetag">parti</div>}
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
    if (state.dealer === you) return <Waiting text="Choisis ton contrat ci-dessous" />;
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
      <div className="abig"><Icon name={CONTRACT_ICON[c]} size={26} /> {CONTRACT_LABEL[c]}</div>
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
      <div className="finish">Sortis : {round.finishOrder.map((p) => seats[p]!.name).join(', ') || '—'}</div>
    </div>
  );
}

/**
 * Choix du contrat : barre compacte posée au-dessus de la main, sans voile ni
 * scrim — la table et tes cartes restent visibles pendant que tu choisis.
 */
function ContractBar({ view }: { view: TableView }) {
  const { state, hint, you, actions } = view;
  const [reussite, setReussite] = useState(false);
  const options = legalContracts(state);
  const handRanks = [...new Set((state.pendingHands?.[you] ?? []).map((c) => c.rank))].sort((a, b) => b - a);
  const tip = hint?.t === 'CHOOSE_CONTRACT' ? hint : null;

  if (reussite) {
    return (
      <div className="contract-bar">
        <div className="cb-head">
          <b>Réussite — hauteur d'ouverture ?</b>
          <button className="ghost tiny" onClick={() => setReussite(false)}><Icon name="arrowLeft" size={14} />retour</button>
        </div>
        <div className="cb-row">
          {handRanks.map((r) => (
            <button
              key={r}
              className={`cb-chip cb-height ${tip?.contract === 'REUSSITE' && tip.rank === r ? 'hinted' : ''}`}
              onClick={() => actions.chooseContract('REUSSITE', r as Rank)}
            >
              {rankLabel(r)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="contract-bar">
      <div className="cb-head">
        <b>À toi de donner — choisis un contrat</b>
        {tip && (
          <span className="cb-tip"><Icon name="bulb" size={15} /> {CONTRACT_LABEL[tip.contract]}{tip.contract === 'REUSSITE' && tip.rank != null ? ` (${rankLabel(tip.rank)})` : ''}</span>
        )}
      </div>
      <div className="cb-row">
        {options.map((c: ContractId) => (
          <button
            key={c}
            className={`cb-chip ${tip?.contract === c ? 'hinted' : ''}`}
            title={CONTRACT_HINT[c]}
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
      {tip && <p className="hinttip"><Icon name="bulb" size={15} /> Conseil : <b>{tip.contre ? 'Contre' : 'Passe'}</b></p>}
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
  const [sortPref] = useCardSort();
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

  const cards = sortHand(hand, sortPref);
  const n = cards.length;

  return (
    <footer className="dock">
      <div className="handbar">
        <span className="handlabel">Votre main{myTurn ? ' · à vous' : ''}</span>
        {myTurn && hintCardId && <span className="handhint"><Icon name="bulb" size={14} /> coup conseillé surligné</span>}
        {canHumanPass && (
          <button className={`pass ${hintPass ? 'hinted' : ''}`} onClick={actions.reussitePass}>Passer</button>
        )}
      </div>
      {/* `--n` sert au calcul CSS du chevauchement : l'éventail occupe toute la
          largeur disponible, quel que soit le nombre de cartes restantes. */}
      <div className="hand fan" style={{ '--n': Math.max(n, 2) } as CSSProperties}>
        {cards.map((card, i) => {
          const legal = legalIds.has(cardId(card));
          const hinted = myTurn && cardId(card) === hintCardId;
          // L'angle de l'éventail est un facteur CSS (`--fanrot`) : il se réduit
          // sur écran étroit, où la rotation coûte de la largeur utile.
          const off = i - (n - 1) / 2;
          const style = {
            '--off': off,
            // Descente quadratique : la main suit un arc de cercle plutôt qu'un
            // simple V, les cartes des bords plongent comme dans une vraie main.
            '--lift': `${off * off * 1.3}px`,
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
  const [sortPref] = useCardSort();
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
      <p className="winnote"><Icon name="trophy" size={17} /> {ranking[0]!.name} gagne (moins de points).</p>
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
                {sortHand(lastDeal[p] ?? [], sortPref).map((c) => (
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

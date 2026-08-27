import { useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import type {
  Card,
  ClientMsg,
  ContractId,
  Difficulty,
  MancheLog,
  MatchOptions,
  PlayerId,
  Rank,
  RedactedMatchState,
  RoomHalt,
  SeatInfo,
  ServerMsg,
} from '@barbu/engine';
import type { UiPause } from '../game/GameTable.js';

/** Hôte du serveur temps réel (Cloudflare Workers) : env de build en prod, `wrangler dev` local par défaut. */
export const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? '127.0.0.1:8787';

const COLLECT_MS = 900; // ms avant la sous-phase « ramassage » du pli

/** Aucune suspension. Sert aussi de repli si le serveur est plus ancien que le front. */
const NO_HALT: RoomHalt = { paused: false, absent: [], asks: [] };

export interface OnlineGame {
  connected: boolean;
  error: string | null;
  started: boolean;
  seats: SeatInfo[];
  youSeat: PlayerId | null;
  hostId: string | null;
  isHost: boolean;
  /** Créateur de la salle : l'hôte peut changer pendant son absence, pas lui. */
  ownerId: string | null;
  isOwner: boolean;
  view: RedactedMatchState | null;
  history: MancheLog[];
  pause: UiPause | null;
  /** Suspension de la partie : pause de l'hôte, absents, demandes en attente. */
  halt: RoomHalt;
  // Actions lobby (hôte)
  configureSeat: (seat: PlayerId, kind: 'open' | 'bot', level?: Difficulty) => void;
  startMatch: (options: MatchOptions) => void;
  newGame: () => void;
  // Administration de la partie
  setPaused: (paused: boolean) => void;
  askPause: () => void;
  denyPause: () => void;
  fillBot: (seat: PlayerId, level?: Difficulty) => void;
  // Actions de jeu
  chooseContract: (contract: ContractId, rank?: Rank) => void;
  respondContre: (contre: boolean) => void;
  playCard: (card: Card) => void;
  reussitePlay: (card: Card) => void;
  reussitePass: () => void;
}

/**
 * Identité locale. Seul le `token` part sur le fil : le serveur en dérive le
 * compte. `profileId` ne sert qu'à l'affichage local (savoir si on est hôte).
 */
export interface OnlineIdentity {
  profileId: string;
  token: string;
}

export function useOnlineGame(code: string, me: OnlineIdentity): OnlineGame {
  const sockRef = useRef<PartySocket | null>(null);
  const collectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [youSeat, setYouSeat] = useState<PlayerId | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [view, setView] = useState<RedactedMatchState | null>(null);
  const [history, setHistory] = useState<MancheLog[]>([]);
  const [pause, setPause] = useState<UiPause | null>(null);
  const [halt, setHalt] = useState<RoomHalt>(NO_HALT);

  useEffect(() => {
    const socket = new PartySocket({ host: PARTYKIT_HOST, room: code });
    sockRef.current = socket;

    const send = (m: ClientMsg) => socket.send(JSON.stringify(m));

    const onOpen = () => {
      setConnected(true);
      setError(null);
      send({ t: 'JOIN', token: me.token });
    };
    const onClose = () => setConnected(false);
    const onError = () => setError('Connexion au serveur impossible.');
    const onMessage = (ev: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'ERROR') {
        setError(msg.msg);
        return;
      }
      if (msg.t === 'LOBBY') {
        setStarted(msg.started);
        setSeats(msg.seats);
        setYouSeat(msg.youSeat);
        setHostId(msg.hostId);
        setOwnerId(msg.ownerId ?? null);
        setHalt(msg.halt ?? NO_HALT);
        if (!msg.started) setView(null);
        return;
      }
      // VIEW
      setStarted(true);
      setSeats(msg.seats);
      setYouSeat(msg.youSeat);
      setHostId(msg.hostId);
      setOwnerId(msg.ownerId ?? null);
      setHalt(msg.halt ?? NO_HALT);
      setView(msg.view);
      setHistory(msg.history);
      if (collectTimer.current) clearTimeout(collectTimer.current);
      if (msg.pause) {
        setPause({ ...msg.pause, collecting: false });
        collectTimer.current = setTimeout(
          () => setPause((p) => (p ? { ...p, collecting: true } : p)),
          COLLECT_MS
        );
      } else {
        setPause(null);
      }
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    socket.addEventListener('message', onMessage);

    return () => {
      if (collectTimer.current) clearTimeout(collectTimer.current);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('message', onMessage);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, me.profileId]);

  const send = (m: ClientMsg) => sockRef.current?.send(JSON.stringify(m));

  return {
    connected,
    error,
    started,
    seats,
    youSeat,
    hostId,
    isHost: hostId !== null && hostId === me.profileId,
    ownerId,
    isOwner: ownerId !== null && ownerId === me.profileId,
    view,
    history,
    pause,
    halt,
    configureSeat: (seat, kind, level) => send({ t: 'SEAT', seat, kind, level }),
    startMatch: (options) => send({ t: 'START', options }),
    newGame: () => send({ t: 'NEW_GAME' }),
    setPaused: (paused) => send(paused ? { t: 'PAUSE' } : { t: 'RESUME' }),
    askPause: () => send({ t: 'ASK_PAUSE' }),
    denyPause: () => send({ t: 'DENY_PAUSE' }),
    fillBot: (seat, level) => send({ t: 'FILL_BOT', seat, level }),
    chooseContract: (contract, rank) => send({ t: 'ACTION', action: { t: 'CHOOSE_CONTRACT', contract, rank } }),
    respondContre: (contre) =>
      send({ t: 'ACTION', action: { t: 'CONTRE', player: youSeat ?? 0, contre } }),
    playCard: (card) => send({ t: 'ACTION', action: { t: 'PLAY_CARD', player: youSeat ?? 0, card } }),
    reussitePlay: (card) => send({ t: 'ACTION', action: { t: 'REUSSITE_PLAY', player: youSeat ?? 0, card } }),
    reussitePass: () => send({ t: 'ACTION', action: { t: 'REUSSITE_PASS', player: youSeat ?? 0 } }),
  };
}

import { useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import type {
  Card,
  ClientMsg,
  ContractId,
  Difficulty,
  MancheLog,
  PlayerId,
  Rank,
  RedactedMatchState,
  SeatInfo,
  ServerMsg,
} from '@barbu/engine';
import type { UiPause } from '../game/GameTable.js';

/** Hôte PartyKit : env de build en prod, dev-server local par défaut. */
export const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST ?? '127.0.0.1:1999';

const COLLECT_MS = 900; // ms avant la sous-phase « ramassage » du pli

export interface OnlineGame {
  connected: boolean;
  error: string | null;
  started: boolean;
  seats: SeatInfo[];
  youSeat: PlayerId | null;
  hostId: string | null;
  isHost: boolean;
  view: RedactedMatchState | null;
  history: MancheLog[];
  pause: UiPause | null;
  // Actions lobby (hôte)
  configureSeat: (seat: PlayerId, kind: 'open' | 'bot', level?: Difficulty) => void;
  startMatch: () => void;
  newGame: () => void;
  // Actions de jeu
  chooseContract: (contract: ContractId, rank?: Rank) => void;
  respondContre: (contre: boolean) => void;
  playCard: (card: Card) => void;
  reussitePlay: (card: Card) => void;
  reussitePass: () => void;
}

/** Identité locale envoyée au serveur (profil réutilisé). */
export interface OnlineIdentity {
  profileId: string;
  name: string;
  avatar: string;
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
  const [view, setView] = useState<RedactedMatchState | null>(null);
  const [history, setHistory] = useState<MancheLog[]>([]);
  const [pause, setPause] = useState<UiPause | null>(null);

  useEffect(() => {
    const socket = new PartySocket({ host: PARTYKIT_HOST, room: code });
    sockRef.current = socket;

    const send = (m: ClientMsg) => socket.send(JSON.stringify(m));

    const onOpen = () => {
      setConnected(true);
      setError(null);
      send({ t: 'JOIN', profileId: me.profileId, name: me.name, avatar: me.avatar });
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
        if (!msg.started) setView(null);
        return;
      }
      // VIEW
      setStarted(true);
      setSeats(msg.seats);
      setYouSeat(msg.youSeat);
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
    view,
    history,
    pause,
    configureSeat: (seat, kind, level) => send({ t: 'SEAT', seat, kind, level }),
    startMatch: () => send({ t: 'START' }),
    newGame: () => send({ t: 'NEW_GAME' }),
    chooseContract: (contract, rank) => send({ t: 'ACTION', action: { t: 'CHOOSE_CONTRACT', contract, rank } }),
    respondContre: (contre) =>
      send({ t: 'ACTION', action: { t: 'CONTRE', player: youSeat ?? 0, contre } }),
    playCard: (card) => send({ t: 'ACTION', action: { t: 'PLAY_CARD', player: youSeat ?? 0, card } }),
    reussitePlay: (card) => send({ t: 'ACTION', action: { t: 'REUSSITE_PLAY', player: youSeat ?? 0, card } }),
    reussitePass: () => send({ t: 'ACTION', action: { t: 'REUSSITE_PASS', player: youSeat ?? 0 } }),
  };
}

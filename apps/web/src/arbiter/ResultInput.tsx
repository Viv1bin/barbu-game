import { useState } from 'react';
import {
  scoreBarbuHolder,
  scoreCoeurCounts,
  scoreDamesCounts,
  scoreDeuxDerWinners,
  scorePlisCounts,
  scoreReussite,
  scoreSaladeCounts,
  type ContractId,
  type PlayerId,
} from '@barbu/engine';

const PLAYERS: PlayerId[] = [0, 1, 2, 3];

/**
 * Saisie du résultat d'une manche. Remonte les points bruts (avant contres),
 * ou null tant que la saisie est incomplète ou incohérente.
 * `key` sur le contrat suffit à repartir d'une saisie vierge.
 */
export function ResultInput({
  contract,
  names,
  onRaw,
}: {
  contract: ContractId;
  names: string[];
  onRaw: (raw: number[] | null) => void;
}) {
  if (contract === 'BARBU') return <BarbuInput names={names} onRaw={onRaw} />;
  if (contract === 'COEUR') return <CountsInput names={names} onRaw={onRaw} expected={13} unit="cœurs" score={scoreCoeurCounts} />;
  if (contract === 'DAMES') return <CountsInput names={names} onRaw={onRaw} expected={4} unit="dames" score={scoreDamesCounts} />;
  if (contract === 'PLIS') return <CountsInput names={names} onRaw={onRaw} expected={13} unit="plis" score={scorePlisCounts} />;
  if (contract === 'DEUXDER') return <DeuxDerInput names={names} onRaw={onRaw} />;
  if (contract === 'SALADE') return <SaladeInput names={names} onRaw={onRaw} />;
  return <ReussiteInput names={names} onRaw={onRaw} />;
}

/** Sélecteur d'un joueur unique. */
export function PickPlayer({
  names,
  value,
  onChange,
  label,
}: {
  names: string[];
  value: PlayerId | null;
  onChange: (p: PlayerId) => void;
  label: string;
}) {
  return (
    <div className="pickfield">
      <label>{label}</label>
      <div className="btnrow">
        {PLAYERS.map((p) => (
          <button key={p} className={value === p ? '' : 'ghost'} onClick={() => onChange(p)}>{names[p]}</button>
        ))}
      </div>
    </div>
  );
}

/** 4 compteurs (cœurs, dames, plis…) avec contrôle de somme. */
function Counts({
  names,
  values,
  onChange,
  expected,
  unit,
}: {
  names: string[];
  values: number[];
  onChange: (v: number[]) => void;
  expected: number;
  unit: string;
}) {
  const sum = values.reduce((a, b) => a + b, 0);
  return (
    <div className="counts">
      {names.map((n, p) => (
        <div key={p} className="countrow">
          <span>{n}</span>
          <input
            type="number"
            min={0}
            value={values[p]}
            onChange={(e) => onChange(values.map((v, j) => (j === p ? Math.max(0, Number(e.target.value) || 0) : v)))}
          />
        </div>
      ))}
      <div className={`sumline ${sum === expected ? 'ok' : 'bad'}`}>
        Total {unit} : {sum} / {expected} {sum === expected ? '✓' : ''}
      </div>
    </div>
  );
}

function BarbuInput({ names, onRaw }: { names: string[]; onRaw: (r: number[] | null) => void }) {
  const [kh, setKh] = useState<PlayerId | null>(null);
  return (
    <PickPlayer
      names={names}
      value={kh}
      label="Qui a ramassé le Roi de cœur ?"
      onChange={(p) => {
        setKh(p);
        onRaw(scoreBarbuHolder(p));
      }}
    />
  );
}

function CountsInput({
  names,
  onRaw,
  expected,
  unit,
  score,
}: {
  names: string[];
  onRaw: (r: number[] | null) => void;
  expected: number;
  unit: string;
  score: (c: number[]) => number[];
}) {
  const [vals, setVals] = useState([0, 0, 0, 0]);
  const update = (v: number[]) => {
    setVals(v);
    onRaw(v.reduce((a, b) => a + b, 0) === expected ? score(v) : null);
  };
  return <Counts names={names} values={vals} onChange={update} expected={expected} unit={unit} />;
}

function DeuxDerInput({ names, onRaw }: { names: string[]; onRaw: (r: number[] | null) => void }) {
  const [sl, setSl] = useState<PlayerId | null>(null);
  const [last, setLast] = useState<PlayerId | null>(null);
  const emit = (a: PlayerId | null, b: PlayerId | null) => onRaw(a !== null && b !== null ? scoreDeuxDerWinners(a, b) : null);
  return (
    <>
      <PickPlayer names={names} value={sl} label="Avant-dernier pli (20) :" onChange={(p) => { setSl(p); emit(p, last); }} />
      <PickPlayer names={names} value={last} label="Dernier pli (60) :" onChange={(p) => { setLast(p); emit(sl, p); }} />
    </>
  );
}

function SaladeInput({ names, onRaw }: { names: string[]; onRaw: (r: number[] | null) => void }) {
  const [hearts, setHearts] = useState([0, 0, 0, 0]);
  const [dames, setDames] = useState([0, 0, 0, 0]);
  const [plis, setPlis] = useState([0, 0, 0, 0]);
  const [kh, setKh] = useState<PlayerId | null>(null);
  const [sl, setSl] = useState<PlayerId | null>(null);
  const [last, setLast] = useState<PlayerId | null>(null);

  const recompute = (h = hearts, d = dames, pl = plis, k = kh, s = sl, l = last) => {
    const ok =
      h.reduce((a, b) => a + b, 0) === 13 &&
      d.reduce((a, b) => a + b, 0) === 4 &&
      pl.reduce((a, b) => a + b, 0) === 13 &&
      k !== null &&
      s !== null &&
      l !== null;
    onRaw(ok ? scoreSaladeCounts({ hearts: h, dames: d, plis: pl, khHolder: k!, secondLast: s!, last: l! }) : null);
  };

  return (
    <div className="salade">
      <p className="muted">Cœurs :</p>
      <Counts names={names} values={hearts} expected={13} unit="cœurs" onChange={(v) => { setHearts(v); recompute(v); }} />
      <p className="muted">Dames :</p>
      <Counts names={names} values={dames} expected={4} unit="dames" onChange={(v) => { setDames(v); recompute(hearts, v); }} />
      <p className="muted">Plis :</p>
      <Counts names={names} values={plis} expected={13} unit="plis" onChange={(v) => { setPlis(v); recompute(hearts, dames, v); }} />
      <PickPlayer names={names} value={kh} label="Roi de cœur :" onChange={(p) => { setKh(p); recompute(hearts, dames, plis, p); }} />
      <PickPlayer names={names} value={sl} label="Avant-dernier pli :" onChange={(p) => { setSl(p); recompute(hearts, dames, plis, kh, p); }} />
      <PickPlayer names={names} value={last} label="Dernier pli :" onChange={(p) => { setLast(p); recompute(hearts, dames, plis, kh, sl, p); }} />
    </div>
  );
}

function ReussiteInput({ names, onRaw }: { names: string[]; onRaw: (r: number[] | null) => void }) {
  // ordre[position] = joueur (1er, 2e, 3e, 4e)
  const [order, setOrder] = useState<(PlayerId | null)[]>([null, null, null, null]);
  const set = (pos: number, p: PlayerId) => {
    const next = order.map((v, i) => (i === pos ? p : v));
    setOrder(next);
    const filled = next.filter((v): v is PlayerId => v !== null);
    const distinct = new Set(filled).size === 4 && filled.length === 4;
    onRaw(distinct ? scoreReussite(next as PlayerId[]) : null);
  };
  const labels = ['1er (−120)', '2e (−60)', '3e (−20)', '4e (0)'];
  return (
    <>
      {labels.map((lab, pos) => (
        <PickPlayer key={pos} names={names} value={order[pos] ?? null} label={lab} onChange={(p) => set(pos, p)} />
      ))}
      <p className="muted">Chaque joueur doit occuper une position unique.</p>
    </>
  );
}

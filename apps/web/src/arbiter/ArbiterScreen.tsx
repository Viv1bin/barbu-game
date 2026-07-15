import { useEffect, useRef, useState } from 'react';
import {
  applyContres,
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
import { CONTRACT_LABEL } from '../format.js';
import { ProfileCard } from '../profiles/ProfileCard.js';
import { ProfileSetup } from '../profiles/ProfileSetup.js';
import { useProfiles, type Profiles } from '../profiles/useProfiles.js';
import { LastManche, ScoreTable, Tracking } from './Tracking.js';
import {
  legalContracts,
  nextResponder,
  useArbiter,
  type ArbiterState,
} from './useArbiter.js';

const PLAYERS: PlayerId[] = [0, 1, 2, 3];

export function ArbiterScreen({ onBack }: { onBack: () => void }) {
  const profiles = useProfiles();
  const arb = useArbiter();
  const { state } = arb;

  // Archive la partie une seule fois, quand elle se termine.
  const savedRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== 'DONE' || state.seats.length !== 4) return;
    const key = state.seats.join('|') + state.history.length;
    if (savedRef.current === key) return;
    savedRef.current = key;
    profiles.record(state.seats, state.scores, state.history);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const start = (ids: string[]) =>
    arb.start(
      ids.map((id) => {
        const p = profiles.store.profiles.find((x) => x.id === id);
        return { id, name: p?.name ?? 'Joueur', avatar: p?.avatar ?? '🙂' };
      }),
    );

  const reset = () => {
    savedRef.current = null;
    arb.reset();
  };

  return (
    <div className="app">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={onBack}>← Menu</button>
          <h1>Barbu <span className="mode">arbitre — partie réelle</span></h1>
        </div>
        {state.phase !== 'SETUP' && (
          <div className="meta">
            <span>Manche {Math.min(state.mancheCount + 1, 28)}/28</span>
            <span>Donneur : {state.names[state.dealer]}</span>
            <span>Contrat : {state.currentContract ? CONTRACT_LABEL[state.currentContract] : '—'}</span>
            <button className="ghost" onClick={reset}>Recommencer</button>
          </div>
        )}
      </header>

      {state.phase === 'SETUP' ? (
        <ProfileSetup profiles={profiles} onStart={start} />
      ) : (
        <>
          <Scores state={state} />
          {state.phase !== 'DONE' && (
            <>
              <Progress state={state} />
              <Tracking state={state} />
              <LastManche state={state} />
            </>
          )}
          <main>
            {state.phase === 'CONTRACT' && <ContractStep arb={arb} />}
            {state.phase === 'CONTRE' && <ContreStep arb={arb} />}
            {state.phase === 'RESULT' && <ResultStep arb={arb} />}
            {state.phase === 'DONE' && <Done state={state} profiles={profiles} onReset={reset} />}
          </main>
        </>
      )}
    </div>
  );
}

function Progress({ state }: { state: ArbiterState }) {
  const pct = (state.mancheCount / 28) * 100;
  return (
    <div className="progress" title={`${state.mancheCount}/28 manches`}>
      <div className="pfill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Scores({ state }: { state: ArbiterState }) {
  const sorted = [...state.scores].sort((a, b) => a - b);
  return (
    <div className="scoreboard">
      {state.names.map((name, p) => {
        const rank = sorted.indexOf(state.scores[p]!) + 1;
        const left = 7 - state.playedContracts[p]!.length;
        return (
          <div key={p} className={`player ${p === state.dealer && state.phase !== 'DONE' ? 'dealer' : ''}`}>
            <div className="pav">{state.avatars[p]}</div>
            <div className="pname">{name}{p === state.dealer && state.phase !== 'DONE' ? ' (D)' : ''}</div>
            <div className="pscore">{state.scores[p]}</div>
            <div className="pcards">{rank === 1 ? '🥇 ' : ''}{left} contrat{left > 1 ? 's' : ''} à donner</div>
            {state.contres.includes(p as PlayerId) && <div className="ptag">contre</div>}
          </div>
        );
      })}
    </div>
  );
}

function ContractStep({ arb }: { arb: ReturnType<typeof useArbiter> }) {
  const options = legalContracts(arb.state);
  return (
    <div className="picker">
      <p><b>{arb.state.names[arb.state.dealer]}</b> donne. Quel contrat annonce-t-il ?</p>
      <div className="btnrow">
        {options.map((c: ContractId) => (
          <button key={c} onClick={() => arb.chooseContract(c)}>{CONTRACT_LABEL[c]}</button>
        ))}
      </div>
      <p className="muted">Contrats restants pour ce donneur : {options.length}/7</p>
    </div>
  );
}

function ContreStep({ arb }: { arb: ReturnType<typeof useArbiter> }) {
  const p = nextResponder(arb.state);
  if (p === null) return null;
  return (
    <div className="picker">
      <p><b>{arb.state.names[p]}</b> : contre-t-il le donneur ({arb.state.names[arb.state.dealer]}) sur <b>{CONTRACT_LABEL[arb.state.currentContract!]}</b> ?</p>
      <div className="btnrow">
        <button onClick={() => arb.respondContre(true)}>Contre</button>
        <button className="ghost" onClick={() => arb.respondContre(false)}>Passe</button>
      </div>
      <p className="muted">Déjà contré : {arb.state.contres.map((c) => arb.state.names[c]).join(', ') || 'personne'}</p>
    </div>
  );
}

// ---- Saisie du résultat ----

function ResultStep({ arb }: { arb: ReturnType<typeof useArbiter> }) {
  const { state } = arb;
  const contract = state.currentContract!;
  const [raw, setRaw] = useState<number[] | null>(null);

  const preview = raw ? applyContres(raw, state.dealer, state.contres) : null;

  return (
    <div className="result">
      <h3>Résultat — {CONTRACT_LABEL[contract]}</h3>
      <ResultInput contract={contract} names={state.names} onRaw={setRaw} />

      {preview && (
        <div className="preview">
          <div className="prow head"><span>Joueur</span><span>Manche</span><span>+ contre</span></div>
          {state.names.map((n, p) => (
            <div className="prow" key={p}>
              <span>{n}</span>
              <span>{raw![p]}</span>
              <span className={preview[p]! !== raw![p] ? 'diff' : ''}>{preview[p]}</span>
            </div>
          ))}
        </div>
      )}

      <button disabled={!raw} onClick={() => raw && arb.submitResult(raw)}>Valider la manche</button>
    </div>
  );
}

/** Sélecteur d'un joueur unique. */
function PickPlayer({ names, value, onChange, label }: { names: string[]; value: PlayerId | null; onChange: (p: PlayerId) => void; label: string }) {
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
function Counts({ names, values, onChange, expected, unit }: { names: string[]; values: number[]; onChange: (v: number[]) => void; expected: number; unit: string }) {
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

function ResultInput({ contract, names, onRaw }: { contract: ContractId; names: string[]; onRaw: (raw: number[] | null) => void }) {
  // Chaque contrat gère son propre état local et remonte `raw` (ou null si invalide).
  if (contract === 'BARBU') return <BarbuInput names={names} onRaw={onRaw} />;
  if (contract === 'COEUR') return <CountsInput names={names} onRaw={onRaw} expected={13} unit="cœurs" score={(c) => scoreCoeurCounts(c)} />;
  if (contract === 'DAMES') return <CountsInput names={names} onRaw={onRaw} expected={4} unit="dames" score={(c) => scoreDamesCounts(c)} />;
  if (contract === 'PLIS') return <CountsInput names={names} onRaw={onRaw} expected={13} unit="plis" score={(c) => scorePlisCounts(c)} />;
  if (contract === 'DEUXDER') return <DeuxDerInput names={names} onRaw={onRaw} />;
  if (contract === 'SALADE') return <SaladeInput names={names} onRaw={onRaw} />;
  return <ReussiteInput names={names} onRaw={onRaw} />;
}

function BarbuInput({ names, onRaw }: { names: string[]; onRaw: (r: number[] | null) => void }) {
  const [kh, setKh] = useState<PlayerId | null>(null);
  return (
    <PickPlayer names={names} value={kh} label="Qui a ramassé le Roi de cœur ?" onChange={(p) => { setKh(p); onRaw(scoreBarbuHolder(p)); }} />
  );
}

function CountsInput({ names, onRaw, expected, unit, score }: { names: string[]; onRaw: (r: number[] | null) => void; expected: number; unit: string; score: (c: number[]) => number[] }) {
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
    const ok = h.reduce((a, b) => a + b, 0) === 13 && d.reduce((a, b) => a + b, 0) === 4 && pl.reduce((a, b) => a + b, 0) === 13 && k !== null && s !== null && l !== null;
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

function Done({ state, profiles, onReset }: { state: ArbiterState; profiles: Profiles; onReset: () => void }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  // jsPDF (~400 ko) n'est chargé qu'au clic, pas au démarrage de l'app.
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const { exportScoresPdf } = await import('./pdf.js');
      exportScoresPdf(state);
    } finally {
      setPdfBusy(false);
    }
  };

  const ranking = state.names
    .map((name, p) => ({ name, avatar: state.avatars[p]!, id: state.seats[p]!, score: state.scores[p]! }))
    .sort((a, b) => a.score - b.score);

  // Podium : 2e à gauche, 1er au centre, 3e à droite. Le 4e est listé dessous.
  const podium = [ranking[1], ranking[0], ranking[2]];
  const steps = ['2', '1', '3'];
  const medals = ['🥈', '🥇', '🥉'];
  const viewed = viewing ? profiles.store.profiles.find((p) => p.id === viewing) : undefined;

  return (
    <div className="done">
      <h2>Partie terminée</h2>
      <p className="muted">Au Barbu, le moins de points gagne.</p>

      <div className="podium">
        {podium.map((r, i) =>
          r ? (
            <div key={r.id} className={`pod pod-${steps[i]}`}>
              <div className="podmedal">{medals[i]}</div>
              <div className="avatar big">{r.avatar}</div>
              <div className="podname">{r.name}</div>
              <div className="podscore">{r.score}</div>
              <div className={`podstep step-${steps[i]}`}>{steps[i]}</div>
            </div>
          ) : null,
        )}
      </div>

      {ranking[3] && (
        <p className="muted">4e — {ranking[3].avatar} {ranking[3].name} · {ranking[3].score} pts</p>
      )}
      <p className="winnote">🏆 {ranking[0]!.avatar} {ranking[0]!.name} gagne avec {ranking[0]!.score} points.</p>

      <div className="btnrow">
        <button disabled={pdfBusy} onClick={downloadPdf}>
          {pdfBusy ? 'Génération…' : '⬇ Télécharger le tableau (PDF)'}
        </button>
        <button className="ghost" onClick={onReset}>Nouvelle partie</button>
      </div>

      <p className="muted">Partie enregistrée dans les statistiques des 4 profils.</p>
      <div className="btnrow tight">
        {ranking.map((r) => (
          <button key={r.id} className="ghost tiny" onClick={() => setViewing(r.id)}>{r.avatar} Stats de {r.name}</button>
        ))}
      </div>

      <h3>Détail des manches</h3>
      <ScoreTable state={state} />

      {viewed && <ProfileCard store={profiles.store} profile={viewed} onClose={() => setViewing(null)} />}
    </div>
  );
}

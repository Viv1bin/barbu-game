import { useEffect, useRef, useState } from 'react';
import { applyContres, type ContractId, type PlayerId } from '@barbu/engine';
import { CONTRACT_LABEL } from '../format.js';
import { ProfileCard } from '../profiles/ProfileCard.js';
import { ProfileSetup } from '../profiles/ProfileSetup.js';
import { useProfiles, type Profiles } from '../profiles/useProfiles.js';
import { EditManche } from './EditManche.js';
import { rankingOf } from './fromRecord.js';
import { ResultInput } from './ResultInput.js';
import { LastManche, ScoreTable, Tracking } from './Tracking.js';
import { legalContracts, nextResponder, useArbiter, type Arbiter, type ArbiterState } from './useArbiter.js';

export function ArbiterScreen({ onBack }: { onBack: () => void }) {
  const profiles = useProfiles();
  const arb = useArbiter();
  const { state, saved } = arb;
  const [editing, setEditing] = useState<number | null>(null);

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
    <div className="app arbiter">
      <header>
        <div className="topbar">
          <button className="ghost" onClick={onBack}>← Menu</button>
          <h1>Barbu <span className="mode">arbitre — partie réelle</span></h1>
        </div>
        {state.phase !== 'SETUP' && <MetaBar arb={arb} onReset={reset} />}
      </header>

      {state.phase === 'SETUP' ? (
        <>
          {saved && <ResumeBanner arb={arb} />}
          <ProfileSetup profiles={profiles} onStart={start} />
        </>
      ) : state.phase === 'DONE' ? (
        <main>
          <Done state={state} profiles={profiles} onReset={reset} />
        </main>
      ) : (
        <>
          <Scores state={state} />
          <Progress state={state} />
          <div className="arbiter-body">
            <main>
              {state.phase === 'CONTRACT' && <ContractStep arb={arb} />}
              {state.phase === 'CONTRE' && <ContreStep arb={arb} />}
              {state.phase === 'RESULT' && <ResultStep arb={arb} />}
            </main>
            <aside className="arbiter-aside">
              <Tracking state={state} onEdit={(i) => setEditing(i)} />
              <LastManche state={state} />
            </aside>
          </div>
        </>
      )}

      {editing !== null && state.history[editing] && (
        <EditManche arb={arb} index={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Partie interrompue retrouvée au chargement. */
function ResumeBanner({ arb }: { arb: Arbiter }) {
  const s = arb.saved!;
  const ranking = rankingOf(s);
  return (
    <div className="resume">
      <div className="resumeinfo">
        <div className="dtitle">Partie en cours retrouvée</div>
        <div className="muted">
          {s.avatars.join(' ')} · manche {Math.min(s.mancheCount + 1, 28)}/28 · {ranking[0]!.name} en tête ({ranking[0]!.score} pts)
        </div>
      </div>
      <button onClick={arb.resume}>Reprendre</button>
      <button className="ghost" onClick={arb.discardSaved}>Ignorer</button>
    </div>
  );
}

function MetaBar({ arb, onReset }: { arb: Arbiter; onReset: () => void }) {
  const { state } = arb;
  const [confirm, setConfirm] = useState<'reset' | null>(null);
  const canRestart = state.phase === 'CONTRE' || state.phase === 'RESULT';

  return (
    <>
      <div className="meta">
        <span>Manche {Math.min(state.mancheCount + 1, 28)}/28</span>
        <span>Donneur : {state.avatars[state.dealer]} {state.names[state.dealer]}</span>
        <span>Contrat : {state.currentContract ? CONTRACT_LABEL[state.currentContract] : '—'}</span>
        <span className="spacer" />
        {canRestart && (
          <button className="ghost" onClick={arb.restartManche} title="Se tromper de contrat ou de contre arrive">
            ↺ Recommencer la manche
          </button>
        )}
        {state.phase === 'CONTRACT' && state.history.length > 0 && (
          <button className="ghost" onClick={arb.undoLastManche}>↶ Annuler la manche {state.history.length}</button>
        )}
        <button className="ghost danger" onClick={() => setConfirm('reset')}>Nouvelle partie</button>
      </div>

      {confirm && (
        <div className="modal-back" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modhead">
              <h3>Abandonner la partie ?</h3>
              <button className="ghost close" onClick={() => setConfirm(null)}>✕</button>
            </div>
            <p>Les {state.history.length} manche(s) jouée(s) seront perdues et ne seront pas enregistrées dans les statistiques.</p>
            <div className="btnrow">
              <button className="danger-solid" onClick={() => { onReset(); setConfirm(null); }}>Oui, tout effacer</button>
              <button className="ghost" onClick={() => setConfirm(null)}>Continuer la partie</button>
            </div>
          </div>
        </div>
      )}
    </>
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

function ContractStep({ arb }: { arb: Arbiter }) {
  const options = legalContracts(arb.state);
  return (
    <div className="picker">
      <p><b>{arb.state.avatars[arb.state.dealer]} {arb.state.names[arb.state.dealer]}</b> donne. Quel contrat annonce-t-il ?</p>
      <div className="btnrow">
        {options.map((c: ContractId) => (
          <button key={c} onClick={() => arb.chooseContract(c)}>{CONTRACT_LABEL[c]}</button>
        ))}
      </div>
      <p className="muted">Contrats restants pour ce donneur : {options.length}/7</p>
    </div>
  );
}

function ContreStep({ arb }: { arb: Arbiter }) {
  const p = nextResponder(arb.state);
  if (p === null) return null;
  return (
    <div className="picker">
      <p>
        <b>{arb.state.avatars[p]} {arb.state.names[p]}</b> : contre-t-il le donneur ({arb.state.names[arb.state.dealer]}) sur{' '}
        <b>{CONTRACT_LABEL[arb.state.currentContract!]}</b> ?
      </p>
      <div className="btnrow">
        <button onClick={() => arb.respondContre(true)}>Contre</button>
        <button className="ghost" onClick={() => arb.respondContre(false)}>Passe</button>
      </div>
      <p className="muted">Déjà contré : {arb.state.contres.map((c) => arb.state.names[c]).join(', ') || 'personne'}</p>
    </div>
  );
}

function ResultStep({ arb }: { arb: Arbiter }) {
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
              <span>{state.avatars[p]} {n}</span>
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

function Done({ state, profiles, onReset }: { state: ArbiterState; profiles: Profiles; onReset: () => void }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const ranking = state.names
    .map((name, p) => ({ name, avatar: state.avatars[p]!, id: state.seats[p]!, score: state.scores[p]! }))
    .sort((a, b) => a.score - b.score);

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

      {ranking[3] && <p className="muted">4e — {ranking[3].avatar} {ranking[3].name} · {ranking[3].score} pts</p>}
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

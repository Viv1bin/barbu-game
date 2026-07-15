import { useMemo, useState } from 'react';
import { ALL_CONTRACTS, type ContractId, type PlayerId } from '@barbu/engine';
import { CONTRACT_ABBR, CONTRACT_LABEL } from '../format.js';
import type { ArbiterState } from './useArbiter.js';

/** Cumuls après chaque manche : rows[i][p] = score du joueur p après la manche i. */
function runningTotals(state: ArbiterState): number[][] {
  const acc = [0, 0, 0, 0];
  return state.history.map((m) => {
    for (let p = 0; p < 4; p++) acc[p]! += m.points[p]!;
    return acc.slice();
  });
}

type Tab = 'table' | 'contracts';

/** Panneau de suivi : tableau détaillé + contrats restants. */
export function Tracking({ state }: { state: ArbiterState }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('table');

  return (
    <section className="tracking">
      <button className="ghost trackhead" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Suivi de la partie
        <span className="muted"> — {state.history.length} manche(s) jouée(s)</span>
      </button>

      {open && (
        <div className="trackbody">
          <div className="tabs">
            <button className={tab === 'table' ? '' : 'ghost'} onClick={() => setTab('table')}>Tableau des scores</button>
            <button className={tab === 'contracts' ? '' : 'ghost'} onClick={() => setTab('contracts')}>Contrats restants</button>
          </div>
          {tab === 'table' ? <ScoreTable state={state} /> : <ContractsGrid state={state} />}
        </div>
      )}
    </section>
  );
}

export function ScoreTable({ state }: { state: ArbiterState }) {
  const totals = useMemo(() => runningTotals(state), [state]);

  if (state.history.length === 0) {
    return <p className="muted">Aucune manche terminée pour l'instant.</p>;
  }

  return (
    <div className="tablewrap">
      <table className="stable">
        <thead>
          <tr>
            <th>#</th>
            <th>Donneur</th>
            <th>Contrat</th>
            {state.names.map((n, p) => (
              <th key={p} className="pcol">{state.avatars[p]} {n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.history.map((m, i) => (
            <tr key={i}>
              <td className="dim">{i + 1}</td>
              <td>{state.avatars[m.dealer]}</td>
              <td>
                {CONTRACT_LABEL[m.contract]}
                {m.contres.length > 0 && (
                  <span className="ctrtag" title={`Contré par ${m.contres.map((c) => state.names[c]).join(', ')}`}>
                    ×{m.contres.length}
                  </span>
                )}
              </td>
              {state.names.map((_, p) => (
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
  );
}

export function ContractsGrid({ state }: { state: ArbiterState }) {
  return (
    <div className="tablewrap">
      <table className="stable cgrid">
        <thead>
          <tr>
            <th>Joueur</th>
            {ALL_CONTRACTS.map((c) => (
              <th key={c} title={CONTRACT_LABEL[c]}>{CONTRACT_ABBR[c]}</th>
            ))}
            <th>Reste</th>
          </tr>
        </thead>
        <tbody>
          {state.names.map((n, p) => {
            const done = state.playedContracts[p]!;
            return (
              <tr key={p} className={p === state.dealer && state.phase !== 'DONE' ? 'isdealer' : ''}>
                <td className="pname-cell">
                  {state.avatars[p]} {n}
                  {p === state.dealer && state.phase !== 'DONE' && <span className="dtag">donne</span>}
                </td>
                {ALL_CONTRACTS.map((c: ContractId) => {
                  const isDone = done.includes(c);
                  const isNow = state.currentContract === c && p === state.dealer;
                  return (
                    <td key={c} className={`cell ${isDone ? 'done' : ''} ${isNow ? 'now' : ''}`}>
                      {isDone ? '✓' : isNow ? '●' : '·'}
                    </td>
                  );
                })}
                <td className="dim">{7 - done.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">✓ contrat déjà donné · ● en cours · · reste à donner</p>
    </div>
  );
}

/** Rappel de la manche précédente, sous le titre. */
export function LastManche({ state }: { state: ArbiterState }) {
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const contres = last.contres.length ? ` (contré par ${last.contres.map((c: PlayerId) => state.names[c]).join(', ')})` : '';
  return (
    <p className="muted lastm">
      Manche précédente : {CONTRACT_LABEL[last.contract]} par {state.names[last.dealer]}{contres} —{' '}
      {last.points.map((pt, p) => `${state.names[p]} ${pt > 0 ? '+' : ''}${pt}`).join(' · ')}
    </p>
  );
}

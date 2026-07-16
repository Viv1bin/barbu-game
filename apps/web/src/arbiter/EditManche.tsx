import { useState } from 'react';
import { applyContres, type ContractId, type PlayerId } from '@barbu/engine';
import { CONTRACT_LABEL } from '../format.js';
import { ResultInput } from './ResultInput.js';
import { legalContractsForEdit, type Arbiter } from './useArbiter.js';

/**
 * Corrige une manche déjà validée : contrat, contres, comptage.
 * Tant que le comptage n'est pas refait, l'ancien résultat est conservé si le
 * contrat n'a pas changé — corriger un simple contre ne force pas à tout ressaisir.
 */
export function EditManche({ arb, index, onClose }: { arb: Arbiter; index: number; onClose: () => void }) {
  const { state } = arb;
  const manche = state.history[index]!;
  const options = legalContractsForEdit(state, index);

  const [contract, setContract] = useState<ContractId>(manche.contract);
  const [contres, setContres] = useState<PlayerId[]>(manche.contres);
  const [raw, setRaw] = useState<number[] | null>(manche.raw ?? manche.points);

  // Changer de contrat invalide le comptage : les points ne veulent plus rien dire.
  const pickContract = (c: ContractId) => {
    setContract(c);
    setRaw(c === manche.contract ? (manche.raw ?? manche.points) : null);
  };

  const toggleContre = (p: PlayerId) =>
    setContres((cs) => (cs.includes(p) ? cs.filter((x) => x !== p) : [...cs, p]));

  const preview = raw ? applyContres(raw, manche.dealer, contres) : null;
  const others = [0, 1, 2, 3].filter((p) => p !== manche.dealer) as PlayerId[];
  const changed =
    contract !== manche.contract ||
    JSON.stringify([...contres].sort()) !== JSON.stringify([...manche.contres].sort()) ||
    JSON.stringify(raw) !== JSON.stringify(manche.raw ?? manche.points);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modhead">
          <h3>Manche {index + 1} — {state.avatars[manche.dealer]} {state.names[manche.dealer]} donne</h3>
          <button className="ghost close" onClick={onClose}>✕</button>
        </div>

        <div className="editfield">
          <label>Contrat annoncé</label>
          <div className="btnrow">
            {options.map((c) => (
              <button key={c} className={c === contract ? '' : 'ghost'} onClick={() => pickContract(c)}>
                {CONTRACT_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="editfield">
          <label>Qui a contré {state.names[manche.dealer]} ?</label>
          <div className="btnrow">
            {others.map((p) => (
              <button key={p} className={contres.includes(p) ? '' : 'ghost'} onClick={() => toggleContre(p)}>
                {contres.includes(p) ? '✓ ' : ''}{state.avatars[p]} {state.names[p]}
              </button>
            ))}
          </div>
          <p className="muted">Clique pour activer ou retirer un contre.</p>
        </div>

        <div className="editfield">
          <label>Comptage — {CONTRACT_LABEL[contract]}</label>
          {raw && contract === manche.contract ? (
            <div className="keepresult">
              <p className="muted">Résultat actuel conservé. Refais le comptage seulement si les points sont faux.</p>
              <button className="ghost" onClick={() => setRaw(null)}>Refaire le comptage</button>
            </div>
          ) : (
            <ResultInput key={contract} contract={contract} names={state.names} onRaw={setRaw} />
          )}
        </div>

        {preview ? (
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
        ) : (
          <p className="muted">Comptage incomplet — renseigne le résultat pour pouvoir enregistrer.</p>
        )}

        <div className="btnrow">
          <button
            disabled={!raw || !changed}
            onClick={() => {
              if (!raw) return;
              arb.editManche(index, { contract, contres, raw });
              onClose();
            }}
          >
            Enregistrer la correction
          </button>
          <button className="ghost" onClick={onClose}>Annuler</button>
        </div>
        <p className="muted">Les scores de toute la partie seront recalculés.</p>
      </div>
    </div>
  );
}

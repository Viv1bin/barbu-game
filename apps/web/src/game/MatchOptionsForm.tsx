import {
  ALL_CONTRACTS,
  MATCH_FORMATS,
  totalManches,
  type ContractId,
  type MatchOptions,
} from '@barbu/engine';
import { CONTRACT_HINT, CONTRACT_LABEL } from '../format.js';

/** true si `o` correspond exactement au jeu de contrats d'un format prédéfini. */
function formatOf(o: MatchOptions): string {
  const key = o.contracts.join(',');
  return MATCH_FORMATS.find((f) => f.contracts.join(',') === key)?.id ?? 'perso';
}

/**
 * Réglages d'une partie, communs au solo et à l'en ligne : durée (via les
 * contrats en jeu), contre, donneur de départ. Le composant est contrôlé —
 * l'appelant décide quoi faire des options (les passer au moteur en solo, les
 * envoyer au serveur en ligne).
 */
export function MatchOptionsForm({
  value,
  onChange,
  disabled = false,
}: {
  value: MatchOptions;
  onChange: (o: MatchOptions) => void;
  disabled?: boolean;
}) {
  const format = formatOf(value);

  const toggleContract = (c: ContractId) => {
    const has = value.contracts.includes(c);
    // On ne descend jamais sous un contrat : une partie de 0 manche n'existe pas.
    if (has && value.contracts.length === 1) return;
    const contracts = ALL_CONTRACTS.filter((x) => (x === c ? !has : value.contracts.includes(x)));
    onChange({ ...value, contracts });
  };

  return (
    <div className="optform">
      <div className="field">
        <label>Format</label>
        <div className="optcards">
          {MATCH_FORMATS.map((f) => (
            <button
              key={f.id}
              className={`optcard ${format === f.id ? 'on' : ''}`}
              disabled={disabled}
              onClick={() => onChange({ ...value, contracts: [...f.contracts] })}
            >
              <span className="oc-title">{f.title}</span>
              <span className="oc-desc">{f.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>
          Contrats en jeu — {value.contracts.length} × 4 donneurs = <b>{totalManches(value)} manches</b>
        </label>
        <div className="chipgrid">
          {ALL_CONTRACTS.map((c) => {
            const on = value.contracts.includes(c);
            return (
              <button
                key={c}
                className={`optchip ${on ? 'on' : ''}`}
                disabled={disabled}
                title={CONTRACT_HINT[c]}
                onClick={() => toggleContract(c)}
              >
                {CONTRACT_LABEL[c]}
              </button>
            );
          })}
        </div>
      </div>

      <ToggleRow
        label="Phase de contre"
        hint="Les adversaires peuvent doubler les points du donneur. Coupe-la pour des parties plus simples."
        checked={value.contre}
        disabled={disabled}
        onChange={(contre) => onChange({ ...value, contre })}
      />
      <ToggleRow
        label="Donneur de départ au hasard"
        hint="Sinon, c'est toujours toi qui ouvres la partie."
        checked={value.randomDealer}
        disabled={disabled}
        onChange={(randomDealer) => onChange({ ...value, randomDealer })}
      />
    </div>
  );
}

/** Interrupteur libellé, réutilisé pour toutes les options booléennes. */
export function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`togglerow ${checked ? 'on' : ''} ${disabled ? 'off' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="tr-text">
        <b>{label}</b>
        {hint && <em>{hint}</em>}
      </span>
      <span className="tr-switch" aria-hidden="true" />
    </label>
  );
}

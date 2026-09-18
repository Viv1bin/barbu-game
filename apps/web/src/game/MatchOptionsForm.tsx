import {
  ALL_CONTRACTS,
  MATCH_FORMATS,
  totalManches,
  type ContractId,
  type MatchOptions,
} from '@barbu/engine';
import { CONTRACT_HINT, CONTRACT_LABEL } from '../format.js';

/** true si `o` correspond exactement à un format prédéfini (vivier + durée + combinaison). */
function formatOf(o: MatchOptions): string {
  const key = o.contracts.join(',');
  const f = MATCH_FORMATS.find(
    (x) => x.contracts.join(',') === key && x.perDealer === o.perDealer && x.combine === o.combine
  );
  return f?.id ?? 'perso';
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

  // Un donneur ne redonne jamais un contrat : retirer des contrats du vivier
  // peut donc raccourcir la partie de force.
  const maxPerDealer = Math.max(1, Math.floor(value.contracts.length / value.combine));

  const toggleContract = (c: ContractId) => {
    const has = value.contracts.includes(c);
    // On ne descend jamais sous un contrat : une partie de 0 manche n'existe pas.
    if (has && value.contracts.length === 1) return;
    const contracts = ALL_CONTRACTS.filter((x) => (x === c ? !has : value.contracts.includes(x)));
    const perDealer = Math.min(value.perDealer, Math.max(1, Math.floor(contracts.length / value.combine)));
    onChange({ ...value, contracts, perDealer });
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
              onClick={() =>
                onChange({ ...value, contracts: [...f.contracts], perDealer: f.perDealer, combine: f.combine })
              }
            >
              <span className="oc-title">{f.title}</span>
              <span className="oc-desc">{f.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>
          Durée — {value.perDealer} manche(s) par donneur = <b>{totalManches(value)} manches</b>
        </label>
        <div className="tabs">
          {Array.from({ length: maxPerDealer }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={value.perDealer === n ? 'on' : 'ghost'}
              disabled={disabled}
              onClick={() => onChange({ ...value, perDealer: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <ToggleRow
        label="Deux contrats par manche"
        hint="Le donneur en annonce deux d'un coup, joués sur la même donne, points cumulés. Le Roi de cœur n'arrête plus la manche. Incompatible avec la Réussite."
        checked={value.combine === 2}
        disabled={disabled}
        onChange={(on) => {
          const combine = on ? 2 : 1;
          const contracts = on ? value.contracts.filter((c) => c !== 'REUSSITE') : value.contracts;
          const perDealer = Math.min(value.perDealer, Math.max(1, Math.floor(contracts.length / combine)));
          onChange({ ...value, combine, contracts, perDealer });
        }}
      />

      <div className="field">
        <label>
          Contrats disponibles — {value.contracts.length} au choix
          {value.perDealer * value.combine < value.contracts.length &&
            ` (${value.perDealer * value.combine} donnés par joueur)`}
        </label>
        <div className="chipgrid">
          {ALL_CONTRACTS.map((c) => {
            const on = value.contracts.includes(c);
            return (
              <button
                key={c}
                className={`optchip ${on ? 'on' : ''}`}
                // La Réussite ne se joue pas en plis : elle ne peut pas partager
                // une donne avec un autre contrat.
                disabled={disabled || (value.combine === 2 && c === 'REUSSITE')}
                title={value.combine === 2 && c === 'REUSSITE' ? 'Indisponible en manche combinée' : CONTRACT_HINT[c]}
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
        label="Remplacement par un bot"
        hint="En ligne : si un joueur part, le créateur de la partie peut confier son siège à un bot. Sinon la partie l'attend."
        checked={value.allowBots}
        disabled={disabled}
        onChange={(allowBots) => onChange({ ...value, allowBots })}
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

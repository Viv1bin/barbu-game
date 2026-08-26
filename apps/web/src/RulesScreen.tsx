import { ALL_CONTRACTS } from '@barbu/engine';
import { CONTRACT_HINT, CONTRACT_ICON, CONTRACT_LABEL } from './format.js';
import { Icon } from './ui/Icon.js';

/** Onglet Règles : rappel du principe et des 7 contrats (icône + but à éviter). */
export function RulesScreen() {
  return (
    <div className="hub">
      <div className="hubhead">
        <h2>Règles</h2>
        <p className="muted">Le contrat le plus bas gagne. 7 contrats, 28 manches.</p>
      </div>

      <div className="panel">
        <p className="rules-intro">
          Chaque contrat désigne ce qu'il faut <b>éviter</b> de ramasser. À chaque manche, le donneur
          choisit un contrat qu'il n'a pas encore donné. On additionne les pénalités&nbsp;: à la fin,
          le joueur avec le <b>moins de points</b> l'emporte.
        </p>
      </div>

      <div className="ruleslist">
        {ALL_CONTRACTS.map((c) => (
          <div key={c} className="rulecard">
            <span className="rc-ic"><Icon name={CONTRACT_ICON[c]} size={20} /></span>
            <div className="rc-body">
              <div className="rc-name">{CONTRACT_LABEL[c]}</div>
              <div className="rc-hint">{CONTRACT_HINT[c]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

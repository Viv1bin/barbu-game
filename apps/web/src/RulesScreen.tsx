import { useState } from 'react';
import { ALL_CONTRACTS, CONTRACTS, type ContractId } from '@barbu/engine';
import {
  CONTRACT_DETAIL,
  CONTRACT_HINT,
  CONTRACT_LABEL,
  CONTRACT_POINTS,
  CONTRACT_TOTAL,
} from './format.js';

/**
 * Onglet Règles : la liste des 7 contrats à gauche, le détail du contrat
 * sélectionné à droite (sous la liste sur petit écran). Le barème affiché vient
 * de `format.ts`, qui recopie les valeurs de `scoring.ts` : ce qu'on lit ici est
 * exactement ce que le moteur compte.
 */
export function RulesScreen() {
  const [picked, setPicked] = useState<ContractId>(ALL_CONTRACTS[0]!);
  const meta = CONTRACTS[picked];

  return (
    <div className="hub">
      <div className="hubhead">
        <h2>Règles</h2>
        <p className="muted">Le score le plus bas gagne. 7 contrats, 28 manches.</p>
      </div>

      <div className="panel">
        <p className="rules-intro">
          Chaque contrat désigne ce qu'il faut <b>éviter</b> de ramasser. À chaque manche, le donneur
          choisit un contrat qu'il n'a pas encore donné, puis entame le premier pli. On doit toujours
          <b> fournir la couleur demandée</b>&nbsp;; sinon on défausse ce qu'on veut, et une défausse
          ne gagne jamais un pli. À la fin des 28 manches, le joueur avec le <b>moins de points</b>
          {' '}l'emporte.
        </p>
      </div>

      <div className="rulessplit">
        <div className="ruleslist">
          {ALL_CONTRACTS.map((c) => (
            <button
              key={c}
              className={`rulecard ${c === picked ? 'on' : ''}`}
              onClick={() => setPicked(c)}
            >
              <span className="rc-name">{CONTRACT_LABEL[c]}</span>
            </button>
          ))}
        </div>

        <div className="panel ruledetail">
          <div className="rd-head">
            <h3>{CONTRACT_LABEL[picked]}</h3>
          </div>
          <p className="rd-hint">{CONTRACT_HINT[picked]}</p>
          <p className="rd-text">{CONTRACT_DETAIL[picked]}</p>

          <div className="rd-points">
            <span className="rd-plabel">Barème</span>
            {CONTRACT_POINTS[picked].map((r) => (
              <div key={r.what} className="rd-prow">
                <span>{r.what}</span>
                <b>{r.points}</b>
              </div>
            ))}
            <p className="rd-total">{CONTRACT_TOTAL[picked]}</p>
          </div>

          {meta.heartRestricted && (
            <p className="rd-note">
              Contrat « cœur »&nbsp;: interdit d'<b>entamer</b> un pli avec un cœur, sauf s'il ne
              reste que des cœurs en main.
            </p>
          )}
          {meta.stopsOnKingOfHearts && (
            <p className="rd-note">La manche s'arrête dès que le Roi de cœur est ramassé.</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panelhead"><h3>Le contre</h3></div>
        <p className="rules-intro">
          Quand le donneur annonce son contrat, chaque autre joueur dit à son tour s'il le
          <b> contre</b>. C'est un pari en tête-à-tête&nbsp;: le contreur affirme qu'il finira la
          manche avec <b>moins de points</b> que le donneur. En fin de manche, chacun des deux ajoute
          à son score l'écart <b>(ses points − ceux de l'autre)</b>.
        </p>
        <p className="rd-note">
          Exemple&nbsp;: Marc contre Julien (donneur). Julien finit à 20, Marc à 40. Julien marque
          20 + (20 − 40) = <b>0</b>, Marc marque 40 + (40 − 20) = <b>60</b>. Chaque contre se résout
          séparément contre le donneur, Réussite comprise.
        </p>
      </div>
    </div>
  );
}

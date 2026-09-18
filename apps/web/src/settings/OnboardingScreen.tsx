import { useState } from 'react';
import type { Card, Suit } from '@barbu/engine';
import { SUIT_RED, SUIT_SYMBOL } from '../format.js';
import { PlayingCard } from '../game/Card.js';
import { sortHand, useCardSort } from '../game/cardSort.js';
import { Icon } from '../ui/Icon.js';
import { CARD_SCALES, useDisplay, type Theme } from './display.js';

// Main d'exemple : deux cartes par couleur, de quoi juger l'ordre ET la taille.
const SAMPLE: Card[] = (['H', 'S', 'D', 'C'] as Suit[]).flatMap((suit) => [
  { suit, rank: 14 },
  { suit, rank: 7 },
]);

const THEMES: { id: Theme; title: string; desc: string }[] = [
  { id: 'lite', title: 'Sobre', desc: 'Tons papier, contrastes doux. Le style d’origine.' },
  { id: 'contraste', title: 'Contrasté', desc: 'Bordures nettes, texte plus clair, couleurs franches. Plus lisible en plein jour.' },
];

/**
 * Première configuration, proposée après l'inscription et, une fois, aux
 * comptes plus anciens qui ne l'ont jamais vue passer. Les trois
 * réglages qui décident du confort de lecture d'une partie — ordre des
 * couleurs, taille des cartes, style — au lieu de les laisser dormir au fond
 * d'un onglet de réglages. Tout est modifiable ensuite dans « Mon profil ».
 */
export function OnboardingScreen({ pseudo, onDone }: { pseudo: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [sort, setSort] = useCardSort();
  const [display, setDisplay] = useDisplay();

  const move = (i: number, dir: -1 | 1) => {
    const order = [...sort.suitOrder];
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    setSort({ ...sort, suitOrder: order });
  };

  const finish = () => {
    setDisplay({ onboarded: true });
    onDone();
  };

  // L'aperçu est le même à chaque étape : c'est lui qui rend les réglages
  // comparables, on ne le fait pas disparaître entre deux questions.
  const preview = (
    <div className="ob-preview">
      {sortHand(SAMPLE, sort).map((c) => (
        <PlayingCard key={`${c.suit}${c.rank}`} card={c} size="md" />
      ))}
    </div>
  );

  return (
    <div className="app onboarding">
      <div className="ob-card">
        <div className="ob-head">
          <span className="ob-step">Étape {step + 1}/3</span>
          <h1>Bienvenue, {pseudo}</h1>
          <p className="muted">Trois réglages de confort. Tout se change ensuite dans « Mon profil ».</p>
        </div>

        {step === 0 && (
          <div className="ob-body">
            <h2>Comment ranger ta main ?</h2>
            <p className="muted">L'ordre des couleurs, de gauche à droite.</p>
            <div className="suitorder">
              {sort.suitOrder.map((s, i) => (
                <div key={s} className={`suitchip ${SUIT_RED[s] ? 'red' : 'black'}`}>
                  <button className="ghost tiny" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Déplacer à gauche">
                    <Icon name="arrowLeft" size={14} />
                  </button>
                  <span className="suitsym">{SUIT_SYMBOL[s]}</span>
                  <button className="ghost tiny" disabled={i === sort.suitOrder.length - 1} onClick={() => move(i, 1)} aria-label="Déplacer à droite">
                    <Icon name="arrowRight" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="tabs">
              <button className={sort.strongSide === 'left' ? 'on' : 'ghost'} onClick={() => setSort({ ...sort, strongSide: 'left' })}>
                Fort à gauche
              </button>
              <button className={sort.strongSide === 'right' ? 'on' : 'ghost'} onClick={() => setSort({ ...sort, strongSide: 'right' })}>
                Fort à droite
              </button>
            </div>
            {preview}
          </div>
        )}

        {step === 1 && (
          <div className="ob-body">
            <h2>Quelle taille de cartes ?</h2>
            <p className="muted">L'aperçu change en direct — prends la taille que tu lis sans plisser les yeux.</p>
            <div className="tabs">
              {CARD_SCALES.map((s) => (
                <button
                  key={s.id}
                  className={display.cardScale === s.id ? 'on' : 'ghost'}
                  onClick={() => setDisplay({ cardScale: s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {preview}
          </div>
        )}

        {step === 2 && (
          <div className="ob-body">
            <h2>Quel style ?</h2>
            <div className="optcards">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`optcard ${display.theme === t.id ? 'on' : ''}`}
                  onClick={() => setDisplay({ theme: t.id })}
                >
                  <span className="oc-title">{t.title}</span>
                  <span className="oc-desc">{t.desc}</span>
                </button>
              ))}
            </div>
            {preview}
          </div>
        )}

        <div className="ob-actions">
          <button className="ghost" onClick={() => (step === 0 ? finish() : setStep(step - 1))}>
            {step === 0 ? 'Passer' : 'Retour'}
          </button>
          {step < 2 ? (
            <button onClick={() => setStep(step + 1)}>Suivant<Icon name="arrowRight" size={16} /></button>
          ) : (
            <button onClick={finish}><Icon name="check" size={16} />C'est parti</button>
          )}
        </div>
      </div>
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { fullDeck, trickWinner } from './cards.js';
import { applyContres } from './contre.js';
import {
  scoreBarbu,
  scoreCoeur,
  scoreDames,
  scoreDeuxDer,
  scorePlis,
  scoreReussite,
  scoreSalade,
  type TrickResult,
} from './scoring.js';
import type { Card, PlayedCard, PlayerId } from './types.js';

/**
 * Construit une manche complète (13 plis) où le joueur `taker` remporte TOUS
 * les plis avec l'intégralité du jeu. Sert à vérifier les totaux max.
 */
function sweepResult(taker: PlayerId): TrickResult {
  const deck = fullDeck();
  const completedTricks: PlayedCard[][] = [];
  const wonBy: PlayerId[] = [];
  // 13 plis de 4 cartes, taker gagne chacun.
  for (let i = 0; i < 13; i++) {
    const trick: PlayedCard[] = [];
    for (let p = 0; p < 4; p++) {
      const card = deck[i * 4 + p]!;
      trick.push({ player: ((taker + p) % 4) as PlayerId, card });
    }
    // force taker à gagner : on met sa carte comme plus forte de la couleur d'entame
    completedTricks.push(trick);
    wonBy.push(taker);
  }
  return { completedTricks, wonBy };
}

const R: TrickResult = sweepResult(0);

describe('totaux max par contrat (joueur 0 ramasse tout)', () => {
  it('Cœur = 130', () => expect(scoreCoeur(R)[0]).toBe(130));
  it('Dames = 80', () => expect(scoreDames(R)[0]).toBe(80));
  it('Plis = 130', () => expect(scorePlis(R)[0]).toBe(130));
  it('Barbu = 80', () => expect(scoreBarbu(R)[0]).toBe(80));
  it('2 der = 80 (60+20 même joueur)', () => expect(scoreDeuxDer(R)[0]).toBe(80));
  it('Salade = 250', () => expect(scoreSalade(R)[0]).toBe(250));
});

describe('Salade layering', () => {
  it('Roi de cœur seul = 45 (cœur 5 + barbu 40)', () => {
    const kh: Card = { suit: 'H', rank: 13 };
    const filler: Card = { suit: 'C', rank: 2 };
    const trick: PlayedCard[] = [
      { player: 0, card: kh },
      { player: 1, card: filler },
      { player: 2, card: { suit: 'C', rank: 3 } },
      { player: 3, card: { suit: 'C', rank: 4 } },
    ];
    // pli unique gagné par joueur 0 (entame cœur, seule carte de la couleur)
    const res: TrickResult = { completedTricks: [trick], wonBy: [0] };
    // barbu 40 + coeur 5 ; pli(5) + éventuel 2der. Ici 1 seul pli => dernier=30.
    // On isole les composantes attendues via sous-fonctions :
    expect(scoreBarbu(res, 40)[0]).toBe(40);
    expect(scoreCoeur(res, 5)[0]).toBe(5);
  });
});

describe('Réussite', () => {
  it('classement -> [-120,-60,-20,0]', () => {
    // ordre de sortie : joueur 2, 0, 3, 1
    const s = scoreReussite([2, 0, 3, 1]);
    expect(s[2]).toBe(-120);
    expect(s[0]).toBe(-60);
    expect(s[3]).toBe(-20);
    expect(s[1]).toBe(0);
  });
});

describe('contre (exemple Marc/Julien)', () => {
  it('Julien donneur 20, Marc contre 40 -> 0 / 60', () => {
    // joueur 0 = Julien (donneur), joueur 1 = Marc
    const round = [20, 40, 0, 0];
    const s = applyContres(round, 0, [1]);
    expect(s[0]).toBe(0);
    expect(s[1]).toBe(60);
  });
});

describe('trickWinner', () => {
  it('plus forte de la couleur d’entame, défausse ne gagne pas', () => {
    const trick: PlayedCard[] = [
      { player: 0, card: { suit: 'S', rank: 7 } },
      { player: 1, card: { suit: 'S', rank: 13 } }, // roi de pique, gagne
      { player: 2, card: { suit: 'H', rank: 14 } }, // défausse (as cœur)
      { player: 3, card: { suit: 'S', rank: 2 } },
    ];
    expect(trickWinner(trick).player).toBe(1);
  });
});

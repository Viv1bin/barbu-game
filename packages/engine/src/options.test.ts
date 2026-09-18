import { describe, expect, it } from 'vitest';
import { ALL_CONTRACTS, CONTRACTS } from './contracts.js';
import { randomBot } from './bots.js';
import { currentPlayer } from './trickRound.js';
import { applyMatchAction, createMatch, legalContractSets, nextContreResponder } from './match.js';
import {
  DEFAULT_MATCH_OPTIONS,
  normalizeMatchOptions,
  totalManches,
  type MatchOptions,
} from './options.js';
import type { MatchState, ReussiteState, TrickRoundState } from './types.js';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Joue une partie entière avec des bots, sous les options données. */
function playWith(options: Partial<MatchOptions>, seed = 7): MatchState {
  const r = rng(seed);
  let s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, ...options });
  let guard = 0;
  while (s.phase !== 'DONE' && guard++ < 20000) {
    if (s.phase === 'CHOOSE_CONTRACT') {
      const set = legalContractSets(s)[0]!;
      const rank = set.length === 1 && CONTRACTS[set[0]!].kind === 'reussite' ? 7 : undefined;
      s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contracts: set, rank }, r);
    } else if (s.phase === 'CONTRE') {
      const p = nextContreResponder(s)!;
      s = applyMatchAction(s, { t: 'CONTRE', player: p, contre: r() < 0.25 }, r);
    } else {
      const round = s.round!;
      if ('currentTrick' in round) {
        const tr = round as TrickRoundState;
        const p = currentPlayer(tr);
        s = applyMatchAction(s, { t: 'PLAY_CARD', player: p, card: randomBot.trickPlay(tr, p, r) }, r);
      } else {
        const rr = round as ReussiteState;
        s = applyMatchAction(s, randomBot.reussite(rr, rr.turn, r), r);
      }
    }
  }
  return s;
}

describe('normalizeMatchOptions', () => {
  it('retombe sur les règles complètes si l’entrée est absurde', () => {
    expect(normalizeMatchOptions(undefined)).toEqual(DEFAULT_MATCH_OPTIONS);
    expect(normalizeMatchOptions({ contracts: [] }).contracts).toEqual(ALL_CONTRACTS);
    expect(normalizeMatchOptions({ contracts: ['PIZZA'] }).contracts).toEqual(ALL_CONTRACTS);
  });

  it('élimine doublons et intrus, garde l’ordre canonique', () => {
    const o = normalizeMatchOptions({ contracts: ['PLIS', 'BARBU', 'PLIS', 'X'] });
    expect(o.contracts).toEqual(['BARBU', 'PLIS']);
  });

  it('contre et donneur aléatoire activés par défaut', () => {
    const o = normalizeMatchOptions({ contracts: ['BARBU'] });
    expect(o.contre).toBe(true);
    expect(o.randomDealer).toBe(true);
  });

  it('borne perDealer à ce que le vivier permet', () => {
    expect(normalizeMatchOptions({ contracts: ['BARBU', 'PLIS'], perDealer: 5 }).perDealer).toBe(2);
    expect(normalizeMatchOptions({ perDealer: 4 }).perDealer).toBe(4);
    // Une sauvegarde d'avant l'option : un tour complet du vivier.
    expect(normalizeMatchOptions({ contracts: ['BARBU', 'PLIS'] }).perDealer).toBe(2);
  });

  it('exclut la Réussite et divise la capacité en manche combinée', () => {
    const o = normalizeMatchOptions({ combine: 2 });
    expect(o.contracts).not.toContain('REUSSITE');
    expect(o.perDealer).toBe(3); // 6 contrats à plis, 2 par manche
  });
});

describe('parties raccourcies', () => {
  it('une partie à 2 contrats dure 8 manches', () => {
    const s = playWith({ contracts: ['BARBU', 'PLIS'] });
    expect(s.phase).toBe('DONE');
    expect(s.mancheCount).toBe(8);
    expect(totalManches(s.options)).toBe(8);
    for (const p of [0, 1, 2, 3]) {
      expect([...s.playedContracts[p]!].sort()).toEqual(['BARBU', 'PLIS']);
    }
  });

  it('ne propose jamais un contrat hors des options', () => {
    const r = rng(3);
    const s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, contracts: ['COEUR', 'DAMES'] });
    expect(legalContractSets(s)).toEqual([['COEUR'], ['DAMES']]);
  });

  it('partie courte : 4 manches par donneur, contrats librement choisis parmi les 7', () => {
    const s = playWith({ perDealer: 4 });
    expect(s.phase).toBe('DONE');
    expect(s.mancheCount).toBe(16);
    for (const p of [0, 1, 2, 3]) expect(s.playedContracts[p]!.length).toBe(4);
  });
});

describe('manches combinées (partie éclair)', () => {
  const ECLAIR: Partial<MatchOptions> = {
    contracts: ['BARBU', 'COEUR', 'DEUXDER', 'DAMES', 'PLIS'],
    perDealer: 2,
    combine: 2,
  };

  it('annonce deux contrats par manche et en consomme deux', () => {
    const r = rng(4);
    let s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, ...ECLAIR });
    expect(legalContractSets(s)[0]).toHaveLength(2);
    s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contracts: ['BARBU', 'DAMES'] }, r);
    expect(s.currentContracts).toEqual(['BARBU', 'DAMES']);
  });

  it('refuse une annonce d’un seul contrat', () => {
    const r = rng(4);
    const s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, ...ECLAIR });
    expect(() => applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contracts: ['BARBU'] }, r)).toThrow();
  });

  it('le Roi de cœur n’interrompt plus la manche : les 13 plis se jouent', () => {
    const r = rng(9);
    let s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, ...ECLAIR, contre: false });
    s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contracts: ['BARBU', 'PLIS'] }, r);
    let guard = 0;
    while (s.phase === 'PLAY' && guard++ < 200) {
      const round = s.round as TrickRoundState;
      const p = currentPlayer(round);
      s = applyMatchAction(s, { t: 'PLAY_CARD', player: p, card: randomBot.trickPlay(round, p, r) }, r);
    }
    // La manche est finie (on est passé à la suivante) et elle a bien duré 13 plis :
    // chaque joueur a marqué au moins les 10 pts/pli du contrat PLIS sur ses levées.
    expect(s.mancheCount).toBe(1);
    const total = s.scores.reduce((a, b) => a + b, 0);
    expect(total).toBe(13 * 10 + 80); // 13 plis à 10 pts + le Barbu à 80
  });

  it('joue une partie éclair complète en 8 manches, 2 contrats consommés par manche', () => {
    const s = playWith(ECLAIR, 12);
    expect(s.phase).toBe('DONE');
    expect(s.mancheCount).toBe(8);
    for (const p of [0, 1, 2, 3]) {
      expect(s.playedContracts[p]!.length).toBe(4);
      expect(new Set(s.playedContracts[p]!).size).toBe(4); // jamais deux fois le même
    }
  });
});

describe('contre désactivé', () => {
  it('passe directement du choix du contrat au jeu', () => {
    const r = rng(11);
    let s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, contre: false });
    s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contracts: ['PLIS'] }, r);
    expect(s.phase).toBe('PLAY');
    expect(s.round).not.toBeNull();
  });

  it('joue une partie entière sans jamais passer en phase CONTRE', () => {
    const s = playWith({ contracts: ['BARBU', 'PLIS'], contre: false });
    expect(s.phase).toBe('DONE');
    expect(s.mancheCount).toBe(8);
  });
});

describe('donneur de départ aléatoire', () => {
  it('reste le joueur 0 quand l’option est coupée', () => {
    const opts = { ...DEFAULT_MATCH_OPTIONS, randomDealer: false };
    expect(createMatch(rng(5), opts).dealer).toBe(0);
  });

  it('produit des donneurs variés quand l’option est active', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(createMatch(rng(seed), { ...DEFAULT_MATCH_OPTIONS, randomDealer: true }).dealer);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

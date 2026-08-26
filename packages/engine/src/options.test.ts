import { describe, expect, it } from 'vitest';
import { ALL_CONTRACTS, CONTRACTS } from './contracts.js';
import { randomBot } from './bots.js';
import { currentPlayer } from './trickRound.js';
import { applyMatchAction, createMatch, legalContracts, nextContreResponder } from './match.js';
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
      const c = legalContracts(s)[0]!;
      const rank = CONTRACTS[c].kind === 'reussite' ? 7 : undefined;
      s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contract: c, rank }, r);
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

  it('contre activé par défaut, donneur aléatoire désactivé par défaut', () => {
    const o = normalizeMatchOptions({ contracts: ['BARBU'] });
    expect(o.contre).toBe(true);
    expect(o.randomDealer).toBe(false);
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
    expect(legalContracts(s)).toEqual(['COEUR', 'DAMES']);
  });
});

describe('contre désactivé', () => {
  it('passe directement du choix du contrat au jeu', () => {
    const r = rng(11);
    let s = createMatch(r, { ...DEFAULT_MATCH_OPTIONS, contre: false });
    s = applyMatchAction(s, { t: 'CHOOSE_CONTRACT', contract: 'PLIS' }, r);
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
    expect(createMatch(rng(5)).dealer).toBe(0);
  });

  it('produit des donneurs variés quand l’option est active', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(createMatch(rng(seed), { ...DEFAULT_MATCH_OPTIONS, randomDealer: true }).dealer);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

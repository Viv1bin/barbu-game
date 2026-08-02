import { describe, expect, it } from 'vitest';
import { applyMatchAction, autoAction, createMatch, currentActor } from './match.js';
import { redactState } from './redact.js';
import type { MatchState, PlayerId } from './index.js';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Avance la partie de `n` actions automatiques (difficile). */
function advance(s: MatchState, rng: () => number, n: number): MatchState {
  for (let i = 0; i < n && s.phase !== 'DONE'; i++) {
    s = applyMatchAction(s, autoAction(s, rng, 'difficile'), rng);
  }
  return s;
}

describe('redactState — caviardage honnête', () => {
  it('à la donne (CHOOSE_CONTRACT) : seule ma main est visible', () => {
    const rng = mulberry(1);
    const s = createMatch(rng);
    expect(s.pendingHands).not.toBeNull();
    for (const you of [0, 1, 2, 3] as PlayerId[]) {
      const v = redactState(s, you);
      expect(v.handSizes).toEqual([13, 13, 13, 13]);
      expect(v.pendingHands![you]).toHaveLength(13);
      for (const opp of [0, 1, 2, 3] as PlayerId[]) {
        if (opp !== you) expect(v.pendingHands![opp]).toHaveLength(0);
      }
    }
  });

  it('en jeu (PLAY) : mains adverses vidées, tailles exactes, ma main intacte', () => {
    const rng = mulberry(42);
    let s = createMatch(rng);
    s = advance(s, rng, 40); // dépasse contrat + contres, entre dans le jeu
    expect(s.phase).toBe('PLAY');
    const round = s.round!;
    const you: PlayerId = (currentActor(s) ?? 0) as PlayerId;
    const v = redactState(s, you);
    expect(v.handSizes).toEqual(round.hands.map((h) => h.length));
    expect(v.round!.hands[you]).toEqual(round.hands[you]);
    let leaked = 0;
    for (const opp of [0, 1, 2, 3] as PlayerId[]) {
      if (opp !== you) leaked += v.round!.hands[opp]!.length;
    }
    expect(leaked).toBe(0); // aucune carte adverse ne fuit
  });

  it('à DONE : mains révélées (reveal de fin)', () => {
    const rng = mulberry(7);
    let s = createMatch(rng);
    let guard = 0;
    while (s.phase !== 'DONE') {
      if (guard++ > 100000) throw new Error('boucle infinie');
      s = applyMatchAction(s, autoAction(s, rng, 'difficile'), rng);
    }
    const v = redactState(s, 2);
    expect(v.phase).toBe('DONE');
    expect(v.handSizes).toHaveLength(4);
  });
});

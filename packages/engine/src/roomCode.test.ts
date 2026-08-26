import { describe, expect, it } from 'vitest';
import { isValidRoomCode, randomRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './roomCode.js';

describe('codes de salle', () => {
  it('génère des codes valides et non répétitifs', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = randomRoomCode();
      expect(c).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(c)).toBe(true);
      codes.add(c);
    }
    // 32^6 combinaisons : 500 tirages ne doivent pas produire de collision.
    expect(codes.size).toBe(500);
  });

  it('rejette les formes invalides', () => {
    expect(isValidRoomCode('ABCD')).toBe(false); // trop court (ancien format)
    expect(isValidRoomCode('ABCDEFG')).toBe(false); // trop long
    expect(isValidRoomCode('abcdef')).toBe(false); // minuscules
    expect(isValidRoomCode('ABCDE0')).toBe(false); // caractère ambigu exclu
    expect(isValidRoomCode('ABC-EF')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });

  it('l’alphabet évite les caractères ambigus', () => {
    for (const c of 'O0I1') expect(ROOM_CODE_ALPHABET).not.toContain(c);
  });
});

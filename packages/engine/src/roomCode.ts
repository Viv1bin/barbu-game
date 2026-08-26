// Codes de salle en ligne. Partagé client/serveur : le client génère, le
// serveur valide — une salle ne s'ouvre que sur un code de la bonne forme.
//
// Un code de salle est le seul secret qui protège une partie : sans lui, on ne
// peut pas la rejoindre. Il doit donc être assez large pour qu'un balayage
// exhaustif ne soit pas envisageable.

/** Alphabet sans caractères ambigus (ni O/0, ni I/1) : dictable à l'oral. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** true si `code` a exactement la forme attendue (déjà en majuscules). */
export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code);
}

/**
 * Code de salle aléatoire. Utilise le CSPRNG de la plateforme (WebCrypto,
 * présent en navigateur comme en Workers) : `Math.random` serait prédictible et
 * réduirait à néant l'intérêt d'un code long.
 *
 * 32^6 ≈ 1,07 milliard de combinaisons.
 */
export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let out = '';
  // 256 % 32 === 0 → le modulo ne biaise pas la distribution.
  for (const b of bytes) out += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return out;
}

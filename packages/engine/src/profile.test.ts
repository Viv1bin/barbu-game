import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, MAX_AVATAR_BYTES, isAvatarImage, isValidAvatar } from './profile.js';

const png = (payload: string) => `data:image/png;base64,${payload}`;
const ok = png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

describe('avatars', () => {
  it('accepte la silhouette par défaut, et elle seule comme icône', () => {
    expect(isValidAvatar(DEFAULT_AVATAR)).toBe(true);
    // Les anciennes formes géométriques ne sont plus proposées ni acceptées.
    expect(isValidAvatar('circle')).toBe(false);
    expect(isValidAvatar('star')).toBe(false);
  });

  it('accepte une photo en data URL bitmap', () => {
    expect(isAvatarImage(ok)).toBe(true);
    expect(isValidAvatar(ok)).toBe(true);
  });

  it('refuse une photo au-delà de la taille maximale', () => {
    const gros = png('A'.repeat(MAX_AVATAR_BYTES));
    expect(isAvatarImage(gros)).toBe(false);
    expect(isValidAvatar(gros)).toBe(false);
  });

  it('refuse le SVG et les schémas non-image', () => {
    // Un SVG est un document actif : jamais accepté comme avatar.
    expect(isValidAvatar('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isValidAvatar('data:text/html;base64,PGgxPmhpPC9oMT4=')).toBe(false);
    expect(isValidAvatar('https://exemple.fr/photo.png')).toBe(false);
    expect(isValidAvatar('javascript:alert(1)')).toBe(false);
  });

  it('refuse une charge utile qui n’est pas du base64', () => {
    expect(isValidAvatar('data:image/png;base64,<script>alert(1)</script>')).toBe(false);
    expect(isValidAvatar('data:image/png;base64,')).toBe(false);
  });

  it('refuse les non-chaînes et les avatars inconnus', () => {
    expect(isValidAvatar(undefined)).toBe(false);
    expect(isValidAvatar(42)).toBe(false);
    expect(isValidAvatar('licorne')).toBe(false);
  });
});

import { DEFAULT_AVATAR } from '@barbu/engine';
import { Icon, isIconName } from './Icon.js';

/**
 * Avatar d'un compte : une forme géométrique monochrome, jamais un emoji.
 * Un avatar inconnu (compte créé avant le changement de jeu d'icônes) retombe
 * sur le défaut plutôt que d'afficher un carré vide.
 */
export function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const icon = isIconName(name) ? name : (DEFAULT_AVATAR as 'circle');
  const px = size === 'sm' ? 16 : size === 'lg' ? 26 : 20;
  return (
    <span className={`avatar avatar-${size}`}>
      <Icon name={icon} size={px} />
    </span>
  );
}

import { isAvatarImage } from '@barbu/engine';
import { Icon } from './Icon.js';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const PX: Record<AvatarSize, number> = { sm: 16, md: 20, lg: 26, xl: 40 };

/**
 * Avatar d'un compte : la photo si le joueur en a envoyé une, sinon la
 * silhouette anonyme. Tout ce qui n'est pas une photo valide tombe sur la
 * silhouette — y compris les avatars des comptes créés avant les photos.
 */
export function Avatar({ name, size = 'md' }: { name?: string | null; size?: AvatarSize }) {
  const isBot = name === 'bot';
  if (isAvatarImage(name)) {
    return (
      <span className={`avatar avatar-${size} photo`}>
        <img src={name} alt="" />
      </span>
    );
  }
  // `bot` n'est pas un avatar de compte mais le marqueur d'un siège tenu par
  // l'ordinateur : il garde son icône propre.
  return (
    <span className={`avatar avatar-${size}`}>
      <Icon name={isBot ? 'bot' : 'person'} size={PX[size]} />
    </span>
  );
}

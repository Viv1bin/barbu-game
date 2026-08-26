// Règles de profil partagées client/serveur : l'UI les applique pour guider la
// saisie, le serveur les applique pour de vrai. Toute règle qui n'existe que
// côté client ne protège rien — un client modifié l'ignore.

/**
 * Avatar par défaut : la silhouette anonyme, seule alternative à une photo. Ce
 * n'est pas un emoji mais un nom d'icône, rendu en SVG par le client. Les
 * comptes créés avant (formes géométriques : `circle`, `star`…) gardent leur
 * valeur en base ; le client ne la connaît plus et affiche la silhouette.
 */
export const DEFAULT_AVATAR = 'person';

/**
 * Taille maximale d'une photo de profil, data URL comprise (~24 Ko). L'avatar
 * voyage dans chaque snapshot d'amis et chaque lobby : au-delà, on paierait la
 * photo à chaque rafraîchissement. Le client redimensionne avant d'envoyer.
 */
export const MAX_AVATAR_BYTES = 24_000;

/** Côté client : dimension cible de la photo une fois recadrée (carré). */
export const AVATAR_IMAGE_SIZE = 128;

/**
 * Formats bitmap acceptés. Le SVG est volontairement exclu : c'est un document
 * actif (scripts, entités externes), pas une image inerte.
 */
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]{16,}={0,2}$/;

/** true si `avatar` est une photo de profil : data URL bitmap de taille bornée. */
export function isAvatarImage(avatar: unknown): avatar is string {
  return (
    typeof avatar === 'string' &&
    avatar.length <= MAX_AVATAR_BYTES &&
    AVATAR_DATA_URL.test(avatar)
  );
}

/** true si `avatar` est l'avatar par défaut (silhouette). */
export function isAvatarIcon(avatar: unknown): avatar is string {
  return avatar === DEFAULT_AVATAR;
}

/** true si `avatar` est acceptable : silhouette par défaut ou photo bornée. */
export function isValidAvatar(avatar: unknown): avatar is string {
  return isAvatarIcon(avatar) || isAvatarImage(avatar);
}

/** Longueur minimale d'un mot de passe nouvellement choisi (partagée UI/serveur). */
export const MIN_PASSWORD_LENGTH = 8;

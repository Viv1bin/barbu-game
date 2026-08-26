// Règles de profil partagées client/serveur : l'UI les applique pour guider la
// saisie, le serveur les applique pour de vrai. Toute règle qui n'existe que
// côté client ne protège rien — un client modifié l'ignore.

/** Avatars proposés à l'inscription et dans « Mon compte ». */
export const AVATARS = ['🙂', '😎', '🦊', '🐙', '🐧', '🦁', '🐻', '🦉', '🐸', '🦄', '👑', '🎩'];

/** Avatar par défaut si aucun n'est choisi. */
export const DEFAULT_AVATAR = AVATARS[0]!;

/** Longueur minimale d'un mot de passe nouvellement choisi (partagée UI/serveur). */
export const MIN_PASSWORD_LENGTH = 8;

/** true si `avatar` fait partie de la liste autorisée. */
export function isValidAvatar(avatar: unknown): avatar is string {
  return typeof avatar === 'string' && AVATARS.includes(avatar);
}

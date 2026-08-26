import { AVATAR_IMAGE_SIZE, MAX_AVATAR_BYTES } from '@barbu/engine';

/** Qualités JPEG essayées successivement jusqu'à tenir sous la limite. */
const QUALITIES = [0.82, 0.7, 0.58, 0.45, 0.34];

/**
 * Convertit un fichier image choisi par le joueur en data URL JPEG carrée et
 * légère, prête à être stockée telle quelle dans le profil.
 *
 * Le recadrage est un « cover » centré : on prend le plus grand carré possible
 * au milieu de la photo, sans déformer. La compression descend en qualité tant
 * que le résultat dépasse `MAX_AVATAR_BYTES` — le serveur refuse au-delà, donc
 * mieux vaut échouer ici avec un message clair que se faire jeter.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  const bitmap = await loadBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_IMAGE_SIZE;
    canvas.height = AVATAR_IMAGE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Impossible de préparer l'image.");
    // Fond blanc : un PNG transparent aplati en JPEG donnerait du noir.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE);

    for (const q of QUALITIES) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= MAX_AVATAR_BYTES) return url;
    }
    throw new Error('Image trop lourde, essaie une autre photo.');
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}

/** Décode le fichier, via `createImageBitmap` si dispo, sinon via `<img>`. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Format refusé par le décodeur natif : on retente avec <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Longest side of a compressed receipt photo (ADR-0021 §5). */
export const RECEIPT_MAX_SIDE = 1280;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrinks a photo in the browser to at most `targetBytes` (JPEG/WebP, longest side `maxSide`).
 * Lowers quality first, then the size, until it fits; a file that already fits is returned as is.
 * Throws when the browser cannot decode or re-encode the image.
 */
export async function compressImage(
  file: File,
  targetBytes: number,
  maxSide: number = RECEIPT_MAX_SIDE,
): Promise<File> {
  if (file.size <= targetBytes && file.type !== 'image/png') return file;
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Foto tidak bisa diproses di perangkat ini.');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.65, 0.5]) {
        const blob = await toBlob(canvas, 'image/jpeg', quality);
        if (!blob) throw new Error('Foto tidak bisa diproses di perangkat ini.');
        if (blob.size <= targetBytes) {
          return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
            type: 'image/jpeg',
          });
        }
      }
      scale *= 0.75;
    }
    throw new Error('Foto terlalu besar, coba ambil ulang.');
  } finally {
    bitmap.close();
  }
}

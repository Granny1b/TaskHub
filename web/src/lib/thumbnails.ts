import { decodeScaled, scaleWithin } from './decodeImage.js';

/**
 * Client-side thumbnail generation.
 *
 * Done on a canvas in the browser rather than server-side, because server-side
 * image processing means Function execution time and a library — both real
 * money on a footprint budgeted below €2/month, for something the browser can
 * already do.
 */

export const THUMBNAIL_MAX_EDGE = 400;
const THUMBNAIL_QUALITY = 0.72;

/**
 * Scale an image so its longest edge is at most `maxEdge`, preserving aspect
 * ratio. Never enlarges — a 200px image stays 200px rather than being blown up
 * into a blurry 400px one.
 *
 * The rule itself lives in decodeImage.ts, because the decoder needs it before
 * any of this module's work begins. This keeps the name the tests and callers
 * already use, and keeps the import going one way.
 */
export function thumbnailSize(
  width: number,
  height: number,
  maxEdge = THUMBNAIL_MAX_EDGE,
): { width: number; height: number } {
  return scaleWithin(width, height, maxEdge);
}

/**
 * Render a thumbnail for an image file.
 *
 * Returns null rather than throwing when the file is not a decodable image —
 * a HEIC that this browser cannot decode, or a file whose extension lies. A
 * missing thumbnail is a cosmetic loss; a failed upload is not.
 */
export async function generateThumbnail(
  file: Blob,
  maxEdge = THUMBNAIL_MAX_EDGE,
): Promise<Blob | null> {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') return null;

  /*
    Decoded at thumbnail size rather than full size.

    This path matters most when compression was skipped — a HEIC the browser
    cannot re-encode, or someone who chose "keep original" — because then the
    file reaching here is the untouched 50MP photo, and decoding it whole is
    what ran a phone out of memory.
  */
  const bitmap = await decodeScaled(file, maxEdge);
  if (bitmap === null) return null;

  try {
    const { width, height } = bitmap;
    if (width === 0 || height === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (context === null) return null;

    context.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', THUMBNAIL_QUALITY);
    });
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * A filename for a pasted screenshot.
 *
 * Clipboard images arrive as `image.png` or with no name at all, so a paste of
 * three screenshots would otherwise produce three identically-named
 * attachments. The timestamp makes them distinguishable in the list.
 */
export function pastedFileName(contentType: string, at: Date = new Date()): string {
  const extension = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] ?? 'png');
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `skarmklipp-${stamp}.${extension}`;
}

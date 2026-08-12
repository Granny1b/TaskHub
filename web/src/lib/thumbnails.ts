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
 */
export function thumbnailSize(
  width: number,
  height: number,
  maxEdge = THUMBNAIL_MAX_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };

  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
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

  let bitmap: ImageBitmap;
  try {
    // Without `from-image` a portrait phone photo — landscape pixels plus an
    // EXIF rotation flag — can thumbnail sideways while the full-size version
    // opens upright. Browsers have disagreed about the default, so it is stated.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }

  try {
    const { width, height } = thumbnailSize(bitmap.width, bitmap.height, maxEdge);
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

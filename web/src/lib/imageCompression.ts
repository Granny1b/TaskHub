import { decodeScaled } from './decodeImage.js';

/**
 * Shrink photographs before they are uploaded.
 *
 * A phone photograph is 3–5 MB and roughly 4000px on its longest edge. Nothing
 * in this app ever displays one at more than a fraction of that: the grid shows
 * a 400px thumbnail and opening one fills a laptop screen at most. The extra
 * pixels are paid for three times over — upload time on workshop wifi, storage
 * at rest every month, and egress every time someone opens the photo.
 *
 * Storage at rest is the largest single line in docs/COSTS.md, so this is the
 * one change that moves the bill rather than shaving it.
 *
 * Done on a canvas in the browser for the same reason thumbnails are:
 * server-side image processing means Function execution time and a dependency,
 * for something the browser already does.
 *
 * What is deliberately *not* compressed:
 *
 *  - **GIF** — a canvas takes the first frame, so re-encoding silently destroys
 *    an animation.
 *  - **WebP** — already an efficient codec, and it may be animated.
 *  - **Anything under {@link SKIP_BELOW_BYTES}** — a screenshot or a small
 *    photo has nothing worth taking, and re-encoding only loses quality.
 *  - **Non-images** — a PDF drawing must arrive byte for byte.
 *
 * The user can turn the whole thing off; see `imageQuality` in preferences.ts.
 */

/**
 * Longest edge after resizing.
 *
 * 2560px is a deliberate compromise, not a round number: it is above a 1440p
 * screen, so a photo still fills any monitor in the building at full quality,
 * while cutting a 12MP camera photo to about a third of its pixels. Someone
 * documenting a scratch can still zoom into it.
 */
export const COMPRESSION_MAX_EDGE = 2560;

/** JPEG quality. Above ~0.85 the file grows fast for differences nobody sees. */
export const COMPRESSION_QUALITY = 0.82;

/** Below this there is nothing worth taking, and re-encoding only loses quality. */
export const SKIP_BELOW_BYTES = 256 * 1024;

/**
 * Keep the original unless the candidate is at least 10% smaller.
 *
 * Re-encoding an already-optimised JPEG can easily produce a *larger* file.
 * Without this check the "compression" step would sometimes cost bytes, which
 * is worse than doing nothing and much harder to notice.
 */
export const MIN_SAVING_RATIO = 0.9;

/**
 * What each input type is re-encoded as.
 *
 * HEIC becomes JPEG rather than staying HEIC, and that is a feature: a HEIC
 * from an iPhone will not open on a Windows desktop without a codec pack, so
 * the phone-to-desk handoff quietly fails today. Transcoding only works on a
 * browser that can decode HEIC at all (Safari can, Chrome cannot) — elsewhere
 * the decode fails and the original is uploaded untouched.
 */
const OUTPUT_TYPE_BY_INPUT: Readonly<Record<string, 'image/jpeg' | 'image/png'>> = {
  'image/jpeg': 'image/jpeg',
  'image/heic': 'image/jpeg',
  'image/heif': 'image/jpeg',
  // PNG stays PNG: screenshots of drawings and error dialogues are mostly text,
  // and JPEG makes text edges mushy. Resizing alone is the win here.
  'image/png': 'image/png',
};

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export type CompressionPlan =
  | { readonly action: 'skip'; readonly reason: 'unsupported-type' | 'already-small' }
  | { readonly action: 'compress'; readonly outputType: 'image/jpeg' | 'image/png' };

/**
 * Decide whether a file is worth re-encoding, before anything is decoded.
 *
 * Separate from the canvas work so the rules can be tested without a browser,
 * and so an unnecessary decode — the expensive part, and the part that can
 * exhaust memory on a phone — is skipped rather than done and thrown away.
 */
export function planCompression(contentType: string, sizeBytes: number): CompressionPlan {
  const outputType = OUTPUT_TYPE_BY_INPUT[contentType.toLowerCase()];
  if (outputType === undefined) return { action: 'skip', reason: 'unsupported-type' };
  if (sizeBytes <= SKIP_BELOW_BYTES) return { action: 'skip', reason: 'already-small' };
  return { action: 'compress', outputType };
}

/**
 * Rename a file to match what it now contains.
 *
 * `IMG_4821.HEIC` re-encoded as JPEG must not still be called `.heic`: the
 * extension is what the allowlist checks, what Windows opens it with, and what
 * the user sees in the grid. Returns null for a type we have no extension for,
 * which is the caller's signal to keep the original file instead.
 */
export function renameForType(fileName: string, contentType: string): string | null {
  const extension = EXTENSION_BY_TYPE[contentType.toLowerCase()];
  if (extension === undefined) return null;

  const lastDot = fileName.lastIndexOf('.');
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  return `${base}.${extension}`;
}

/** Whether a re-encoded candidate saves enough to be worth using. */
export function isWorthKeeping(originalBytes: number, candidateBytes: number): boolean {
  return candidateBytes > 0 && candidateBytes <= originalBytes * MIN_SAVING_RATIO;
}

/**
 * Re-encode an image smaller.
 *
 * Returns null — never throws — when the file should not, or could not, be
 * compressed. Null means "upload the original", so every failure path here is
 * a missed saving rather than a failed upload.
 */
export async function compressImage(
  file: File,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<File | null> {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') return null;

  const plan = planCompression(file.type, file.size);
  if (plan.action === 'skip') return null;

  /*
    Decoded straight to the target size, never at full resolution.

    A 50MP photo is a 191 MB bitmap, and allocating that on a phone with other
    tabs open does not fail politely — the browser aborts the action outright.
    `decodeScaled` asks the decoder for the size we actually want, so peak
    memory is the output's, not the camera's. See decodeImage.ts.
  */
  const bitmap = await decodeScaled(file, options.maxEdge ?? COMPRESSION_MAX_EDGE);
  if (bitmap === null) return null;

  try {
    // Already at the target size; the canvas only re-encodes it.
    const { width, height } = bitmap;
    if (width === 0 || height === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (context === null) return null;

    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, plan.outputType, options.quality ?? COMPRESSION_QUALITY);
    });
    if (blob === null) return null;

    // `toBlob` falls back to PNG when it cannot encode the type it was asked
    // for, so the returned blob is the authority on what was produced — not
    // what we requested. Naming a PNG `.jpg` would be a lie the allowlist
    // happily accepts and no viewer forgives.
    const fileName = renameForType(file.name, blob.type);
    if (fileName === null) return null;

    if (!isWorthKeeping(file.size, blob.size)) return null;

    return new File([blob], fileName, { type: blob.type, lastModified: file.lastModified });
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

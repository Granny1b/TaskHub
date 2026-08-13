/**
 * Decode an image straight to the size we need, never at full size.
 *
 * This exists because of an out-of-memory crash on a real phone. A modern
 * camera photo is 12–50 megapixels, and a decoded bitmap costs 4 bytes a pixel
 * whatever the file weighed:
 *
 *     12MP (4000×3000)   →  46 MB
 *     50MP (8160×6120)   → 191 MB
 *
 * The first version decoded at full size and *then* scaled to 2560px on a
 * canvas. On a phone with other tabs open, allocating 191 MB does not throw
 * something catchable — Chromium aborts the action and shows its own "too
 * little memory" toast, so the upload simply never happened and no error ever
 * reached the app.
 *
 * `createImageBitmap` accepts `resizeWidth`/`resizeHeight`, and the decoder can
 * downsample while decoding (JPEG stores its data in a form that scales by
 * halves almost for free). The full bitmap is then never materialised at all:
 * peak memory becomes the size of the *output*, about 19 MB, regardless of how
 * large the photo was.
 */

/**
 * Fit a size inside a square of `maxEdge`, preserving aspect ratio and never
 * enlarging. Enlarging would cost memory and quality for a photo that needed
 * neither.
 */
export function scaleWithin(
  width: number,
  height: number,
  maxEdge: number,
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
 * Intrinsic size, read from the file header rather than by decoding it.
 *
 * An `<img>` that is never inserted into the document parses the header for its
 * dimensions and defers the pixel decode, so this costs roughly the file size
 * rather than the bitmap size — which is the entire point.
 *
 * `naturalWidth`/`naturalHeight` already account for EXIF orientation in
 * current browsers, which is what keeps these numbers consistent with the
 * `imageOrientation: 'from-image'` decode below.
 */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof Image !== 'function' || typeof URL.createObjectURL !== 'function') return null;

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number } | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode `file` so that its longest edge is at most `maxEdge`.
 *
 * Returns null rather than throwing for anything undecodable, so every caller's
 * failure path is "use the original" instead of "fail the upload".
 */
export async function decodeScaled(file: Blob, maxEdge: number): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;

  const size = await readImageSize(file);

  /*
    Without dimensions there is nothing safe to ask for: requesting a fixed
    `resizeWidth` would upscale a small image, wasting both memory and quality
    on a photo that needed neither. Fall back to a plain decode, which is what
    the app did before and is fine for anything a header parse failed on —
    those are small or exotic, not 50MP.
  */
  if (size === null || size.width <= 0 || size.height <= 0) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return null;
    }
  }

  const target = scaleWithin(size.width, size.height, maxEdge);
  if (target.width === 0 || target.height === 0) return null;

  try {
    return await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    });
  } catch {
    /*
      Older Safari accepts `createImageBitmap` but not every option in the
      dictionary. A browser that refuses the resize still deserves a working
      upload, so try once more without it — the memory cost is the old one,
      which is what those browsers were living with anyway.
    */
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return null;
    }
  }
}

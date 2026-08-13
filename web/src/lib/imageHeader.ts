/**
 * Read an image's dimensions out of its header, without decoding it.
 *
 * The previous attempt loaded the file into an `<img>` and read
 * `naturalWidth`. The comment claimed that defers the pixel decode. On
 * Chromium for Android it does not reliably do so — loading an image into an
 * `<img>` generally decodes it — so the function written to *avoid* a
 * full-resolution decode was performing one, on the largest image the phone can
 * produce, at the exact moment the camera hands it over.
 *
 * A header is a few hundred bytes and says the same thing with certainty.
 *
 * Note what these numbers are *not*: they ignore EXIF orientation, so a
 * portrait photograph stored as landscape pixels reports landscape. That is
 * harmless here — the caller only needs a box to fit the image into, and a
 * rotated box has the same longest edge either way.
 */

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * JPEG: walk the segment chain to the frame header.
 *
 * Every segment is `FF <marker> <length:2> <payload>`, so the whole chain can be
 * skipped through without understanding any of it. The Start Of Frame markers
 * carry the size; SOF4, SOF8 and SOF12 are excluded because those are
 * table-definition markers that happen to sit in the same numeric range.
 */
function jpegSize(view: DataView): ImageSize | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);
    const isFrameHeader =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isFrameHeader) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }

    // Markers without a payload: padding, start-of-image, restart markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }

  return null;
}

/** PNG: fixed layout — the IHDR chunk always starts at byte 16. */
function pngSize(view: DataView): ImageSize | null {
  if (view.byteLength < 24) return null;
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** WebP: three container variants, each storing the size differently. */
function webpSize(view: DataView): ImageSize | null {
  if (view.byteLength < 30) return null;
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null;

  const chunk = view.getUint32(12);

  // VP8X: an extended container, 24-bit sizes stored minus one.
  if (chunk === 0x56503858) {
    const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
    const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
    return { width, height };
  }

  // VP8 (lossy): sizes are little-endian 14-bit values after the start code.
  if (chunk === 0x56503820) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  // VP8L (lossless): 14 bits each, packed across four bytes, minus one.
  if (chunk === 0x5650384c) {
    const bits =
      view.getUint8(21) |
      (view.getUint8(22) << 8) |
      (view.getUint8(23) << 16) |
      (view.getUint8(24) << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }

  return null;
}

/** Dimensions from a header, or null for a format this does not parse. */
export function sizeFromHeader(bytes: ArrayBuffer): ImageSize | null {
  const view = new DataView(bytes);

  for (const parse of [jpegSize, pngSize, webpSize]) {
    try {
      // A truncated or malformed header reads past the end of the view and
      // throws. Not worth propagating — the next parser, or the caller's
      // refusal to decode, handles it.
      const size = parse(view);
      if (size !== null && size.width > 0 && size.height > 0) return size;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * How much of the file to read.
 *
 * A JPEG's frame header sits after its EXIF block, and a phone photo's EXIF can
 * carry a full-size thumbnail, so this has to be generous. 256 KB covers every
 * camera JPEG in practice while being a rounding error against decoding one.
 */
export const HEADER_BYTES = 256 * 1024;

export async function readImageHeaderSize(file: Blob): Promise<ImageSize | null> {
  try {
    return sizeFromHeader(await file.slice(0, HEADER_BYTES).arrayBuffer());
  } catch {
    return null;
  }
}

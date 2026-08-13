import { describe, expect, it } from 'vitest';
import { sizeFromHeader } from './imageHeader.js';

/** A JPEG header: SOI, an EXIF-sized segment to skip, then the frame header. */
function jpeg(width: number, height: number, padding = 0): ArrayBuffer {
  const parts: number[] = [0xff, 0xd8];

  if (padding > 0) {
    const length = padding + 2;
    parts.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...new Array(padding).fill(0));
  }

  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff);
  parts.push(...new Array(8).fill(0));
  return new Uint8Array(parts).buffer;
}

function png(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes.buffer;
}

describe('sizeFromHeader', () => {
  it('reads a JPEG frame header', () => {
    expect(sizeFromHeader(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });

  it('skips the EXIF block a phone photo carries', () => {
    // A camera JPEG puts a full thumbnail in EXIF before the frame header, so
    // a parser that only looks at the first bytes finds nothing.
    expect(sizeFromHeader(jpeg(8160, 6120, 20_000))).toEqual({ width: 8160, height: 6120 });
  });

  it('reads a progressive JPEG, which uses a different frame marker', () => {
    const bytes = new Uint8Array(jpeg(1600, 1200));
    bytes[3 + 0] = 0xc2; // SOF2 rather than SOF0
    expect(sizeFromHeader(bytes.buffer)).toEqual({ width: 1600, height: 1200 });
  });

  it('reads a PNG', () => {
    expect(sizeFromHeader(png(2400, 1080))).toEqual({ width: 2400, height: 1080 });
  });

  it('returns null for something it cannot parse', () => {
    // The caller treats null as "do not decode this", which is the safe answer.
    expect(sizeFromHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toBeNull();
    expect(sizeFromHeader(new Uint8Array(0).buffer)).toBeNull();
  });

  it('returns null for a truncated header rather than throwing', () => {
    const short = new Uint8Array(jpeg(4000, 3000)).slice(0, 6);
    expect(sizeFromHeader(short.buffer)).toBeNull();
  });
});

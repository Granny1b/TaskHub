import { describe, expect, it } from 'vitest';
import {
  MIN_SAVING_RATIO,
  SKIP_BELOW_BYTES,
  isWorthKeeping,
  planCompression,
  renameForType,
} from './imageCompression.js';

const BIG = SKIP_BELOW_BYTES * 10;

describe('planCompression', () => {
  it('re-encodes a phone photograph as JPEG', () => {
    expect(planCompression('image/jpeg', BIG)).toEqual({
      action: 'compress',
      outputType: 'image/jpeg',
    });
  });

  it('transcodes HEIC to JPEG so a Windows desktop can open it', () => {
    // An iPhone HEIC will not open on a Windows PC without a codec pack, which
    // makes the phone-to-desk handoff fail silently.
    expect(planCompression('image/heic', BIG)).toEqual({
      action: 'compress',
      outputType: 'image/jpeg',
    });
    expect(planCompression('image/heif', BIG)).toEqual({
      action: 'compress',
      outputType: 'image/jpeg',
    });
  });

  it('keeps PNG as PNG', () => {
    // Screenshots of drawings and error dialogues are mostly text, and JPEG
    // makes text edges mushy. Resizing alone is the win.
    expect(planCompression('image/png', BIG)).toEqual({
      action: 'compress',
      outputType: 'image/png',
    });
  });

  it('leaves GIF alone, because a canvas would keep only the first frame', () => {
    expect(planCompression('image/gif', BIG)).toEqual({
      action: 'skip',
      reason: 'unsupported-type',
    });
  });

  it('leaves WebP alone', () => {
    expect(planCompression('image/webp', BIG)).toEqual({
      action: 'skip',
      reason: 'unsupported-type',
    });
  });

  it('never touches a document', () => {
    // A PDF drawing has to arrive byte for byte.
    expect(planCompression('application/pdf', BIG)).toEqual({
      action: 'skip',
      reason: 'unsupported-type',
    });
  });

  it('skips a file too small to be worth re-encoding', () => {
    expect(planCompression('image/jpeg', SKIP_BELOW_BYTES)).toEqual({
      action: 'skip',
      reason: 'already-small',
    });
    expect(planCompression('image/jpeg', SKIP_BELOW_BYTES + 1).action).toBe('compress');
  });

  it('matches the content type case-insensitively', () => {
    expect(planCompression('IMAGE/JPEG', BIG).action).toBe('compress');
  });
});

describe('renameForType', () => {
  it('renames a HEIC that has become a JPEG', () => {
    // The extension is what the allowlist checks and what Windows opens it
    // with, so a re-encoded file must not keep the old one.
    expect(renameForType('IMG_4821.HEIC', 'image/jpeg')).toBe('IMG_4821.jpg');
  });

  it('normalises jpeg to jpg, matching the extension allowlist', () => {
    expect(renameForType('photo.jpeg', 'image/jpeg')).toBe('photo.jpg');
  });

  it('keeps the rest of a name that contains dots', () => {
    expect(renameForType('maskin.7.axel.png', 'image/png')).toBe('maskin.7.axel.png');
  });

  it('adds an extension to a name that has none', () => {
    expect(renameForType('photo', 'image/jpeg')).toBe('photo.jpg');
  });

  it('returns null for a type it has no extension for', () => {
    // `toBlob` silently falls back to PNG when it cannot encode what it was
    // asked for; a type we cannot name is the signal to keep the original
    // rather than to guess.
    expect(renameForType('photo.jpg', 'image/avif')).toBeNull();
  });
});

describe('isWorthKeeping', () => {
  it('keeps a candidate that saves more than the threshold', () => {
    expect(isWorthKeeping(1000, 400)).toBe(true);
  });

  it('rejects a candidate that is barely smaller', () => {
    // Re-encoding an already-optimised JPEG for a 2% saving is a quality loss
    // for nothing.
    expect(isWorthKeeping(1000, 999)).toBe(false);
  });

  it('rejects a candidate that grew', () => {
    // Canvas re-encoding can genuinely produce a larger file, and a
    // "compression" step that costs bytes is worse than doing nothing.
    expect(isWorthKeeping(1000, 1400)).toBe(false);
  });

  it('accepts a candidate exactly at the threshold', () => {
    expect(isWorthKeeping(1000, 1000 * MIN_SAVING_RATIO)).toBe(true);
  });

  it('rejects an empty result', () => {
    expect(isWorthKeeping(1000, 0)).toBe(false);
  });
});

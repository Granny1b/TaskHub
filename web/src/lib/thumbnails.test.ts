import { describe, expect, it } from 'vitest';
import { THUMBNAIL_MAX_EDGE, pastedFileName, thumbnailSize } from './thumbnails.js';

describe('thumbnailSize', () => {
  it('scales a landscape image to the max edge, preserving aspect ratio', () => {
    expect(thumbnailSize(4000, 3000)).toEqual({ width: 400, height: 300 });
  });

  it('scales a portrait image by its longest edge', () => {
    expect(thumbnailSize(3000, 4000)).toEqual({ width: 300, height: 400 });
  });

  it('never enlarges a small image', () => {
    // Blowing a 200px photo up to 400px produces a blurry thumbnail and a
    // bigger upload for strictly worse quality.
    expect(thumbnailSize(200, 150)).toEqual({ width: 200, height: 150 });
  });

  it('leaves an image exactly at the limit alone', () => {
    expect(thumbnailSize(400, 400)).toEqual({ width: 400, height: 400 });
  });

  it('keeps at least one pixel on an extreme aspect ratio', () => {
    // A 10000x1 panorama would otherwise round to zero height and produce an
    // invalid canvas.
    const size = thumbnailSize(10_000, 1);
    expect(size.width).toBe(THUMBNAIL_MAX_EDGE);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('returns zero for a degenerate image rather than dividing by zero', () => {
    expect(thumbnailSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(thumbnailSize(-5, 100)).toEqual({ width: 0, height: 0 });
  });

  it('honours a custom max edge', () => {
    expect(thumbnailSize(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });
});

describe('pastedFileName', () => {
  const at = new Date('2026-08-11T09:30:15Z');

  it('names a pasted screenshot with a timestamp', () => {
    // Clipboard images arrive as "image.png" or unnamed, so pasting three
    // screenshots would otherwise produce three identical names.
    expect(pastedFileName('image/png', at)).toBe('skarmklipp-2026-08-11-09-30-15.png');
  });

  it('uses jpg rather than jpeg, matching the extension allowlist', () => {
    expect(pastedFileName('image/jpeg', at)).toBe('skarmklipp-2026-08-11-09-30-15.jpg');
  });

  it('falls back to png for an unrecognisable type', () => {
    expect(pastedFileName('', at)).toMatch(/\.png$/);
  });

  it('produces distinct names one second apart', () => {
    const later = new Date('2026-08-11T09:30:16Z');
    expect(pastedFileName('image/png', at)).not.toBe(pastedFileName('image/png', later));
  });
});

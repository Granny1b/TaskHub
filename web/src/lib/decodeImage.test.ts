import { describe, expect, it } from 'vitest';
import { scaleWithin } from './decodeImage.js';

describe('scaleWithin', () => {
  it('fits a landscape photo inside the box', () => {
    expect(scaleWithin(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
  });

  it('fits a portrait photo by its longest edge', () => {
    expect(scaleWithin(3000, 4000, 2560)).toEqual({ width: 1920, height: 2560 });
  });

  it('never enlarges', () => {
    /*
      The memory point, not just a quality one. `createImageBitmap` allocates
      four bytes a pixel for whatever it is asked for, so requesting 2560 for a
      1200px photo would cost more memory than decoding it untouched — on the
      device least able to spare it.
    */
    expect(scaleWithin(1200, 900, 2560)).toEqual({ width: 1200, height: 900 });
  });

  it('leaves an image exactly at the limit alone', () => {
    expect(scaleWithin(2560, 2560, 2560)).toEqual({ width: 2560, height: 2560 });
  });

  it('keeps at least one pixel on an extreme panorama', () => {
    // A 20000x1 panorama would otherwise round to zero height and produce an
    // invalid decode request.
    const size = scaleWithin(20_000, 1, 2560);
    expect(size.width).toBe(2560);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('returns zero for a degenerate size rather than dividing by zero', () => {
    expect(scaleWithin(0, 0, 2560)).toEqual({ width: 0, height: 0 });
    expect(scaleWithin(-5, 100, 2560)).toEqual({ width: 0, height: 0 });
  });

  it('cuts a 50MP photo to a bitmap a phone can hold', () => {
    // 8160x6120 decodes to 191 MB at full size; the box brings that to 19 MB,
    // which is the whole reason this function is called before the decode
    // rather than after it.
    const target = scaleWithin(8160, 6120, 2560);
    const megabytes = (target.width * target.height * 4) / 1024 / 1024;
    expect(megabytes).toBeLessThan(25);
  });
});

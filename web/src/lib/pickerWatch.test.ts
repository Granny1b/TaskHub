/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPickerOpen, consumePickerInterrupted, markPickerOpen } from './pickerWatch.js';

describe('pickerWatch', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('reports nothing when no picker was ever opened', () => {
    expect(consumePickerInterrupted()).toBe(false);
  });

  it('reports an interruption when the marker survived a reload', () => {
    // Writing the marker and finding it on the next page load is exactly the
    // shape of the phone killing the tab while the camera app was in front.
    markPickerOpen();
    expect(consumePickerInterrupted()).toBe(true);
  });

  it('reports nothing when the picker came back normally', () => {
    markPickerOpen();
    clearPickerOpen();
    expect(consumePickerInterrupted()).toBe(false);
  });

  it('explains itself once, not on every later navigation', () => {
    markPickerOpen();
    expect(consumePickerInterrupted()).toBe(true);
    expect(consumePickerInterrupted()).toBe(false);
  });
});

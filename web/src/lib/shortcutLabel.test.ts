import { describe, expect, it } from 'vitest';
import { shortcutLabelFor } from './shortcutLabel.js';

describe('shortcutLabelFor', () => {
  it('writes Ctrl on Windows, which is who this is for', () => {
    expect(shortcutLabelFor('Win32')).toBe('Ctrl K');
    expect(shortcutLabelFor('Windows')).toBe('Ctrl K');
  });

  it('writes the command symbol on a Mac', () => {
    // Printing "Ctrl" on a Mac is worse than printing nothing: the key really
    // is Cmd, so the hint would simply be wrong.
    expect(shortcutLabelFor('MacIntel')).toBe('⌘K');
    expect(shortcutLabelFor('macOS')).toBe('⌘K');
    expect(shortcutLabelFor('iPad')).toBe('⌘K');
  });

  it('falls back to Ctrl for anything it does not recognise', () => {
    expect(shortcutLabelFor('Linux x86_64')).toBe('Ctrl K');
    expect(shortcutLabelFor('')).toBe('Ctrl K');
  });
});

import { describe, expect, it } from 'vitest';
import { filesFromPaste, pastedFileName } from './pasteFiles.js';

const at = new Date('2026-08-11T09:30:15Z');
const image = (name: string, type = 'image/png'): File => new File(['x'], name, { type });

describe('pastedFileName', () => {
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

describe('filesFromPaste', () => {
  it('attaches a screenshot and gives it a real name', () => {
    const [file] = filesFromPaste(
      { files: [image('image.png')], text: '', intoEditable: false },
      at,
    );
    expect(file?.name).toBe('skarmklipp-2026-08-11-09-30-15.png');
    expect(file?.type).toBe('image/png');
  });

  it('attaches a screenshot even when the cursor is in a text field', () => {
    // The Snipping Tool flow: typing a title, snip, Ctrl+V. There is no text on
    // the clipboard, so there is nothing else the paste could have meant.
    const files = filesFromPaste({ files: [image('image.png')], text: '', intoEditable: true }, at);
    expect(files).toHaveLength(1);
  });

  it('lets text win inside a text field', () => {
    // Excel and Word put a picture of the selection next to its text. Pasting
    // that into Kommentarer must paste the words.
    const files = filesFromPaste(
      { files: [image('image.png')], text: 'A1\tB1', intoEditable: true },
      at,
    );
    expect(files).toEqual([]);
  });

  it('keeps the name of a real file copied from a folder', () => {
    const [file] = filesFromPaste(
      { files: [image('ritning-4b.pdf', 'application/pdf')], text: '', intoEditable: false },
      at,
    );
    expect(file?.name).toBe('ritning-4b.pdf');
  });

  it('numbers several unnamed images from the same paste', () => {
    const names = filesFromPaste(
      { files: [image('image.png'), image('image.png')], text: '', intoEditable: false },
      at,
    ).map((file) => file.name);
    expect(new Set(names).size).toBe(2);
  });

  it('returns nothing when the clipboard holds no file', () => {
    expect(filesFromPaste({ files: [], text: 'hello', intoEditable: false }, at)).toEqual([]);
  });
});

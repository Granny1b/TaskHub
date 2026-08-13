import { describe, expect, it } from 'vitest';
import { previewKind } from './FilePreview.js';

describe('previewKind', () => {
  it('previews the image formats a browser can decode', () => {
    expect(previewKind('image/jpeg', 'foto.jpg')).toBe('image');
    expect(previewKind('image/png', 'skarmklipp.png')).toBe('image');
    expect(previewKind('image/webp', 'a.webp')).toBe('image');
    expect(previewKind('image/gif', 'a.gif')).toBe('image');
  });

  it('refuses HEIC, which only Safari decodes', () => {
    // An <img> pointing at a HEIC renders as a broken icon in Chrome. Saying
    // "cannot be shown here" and offering the download is the honest version.
    expect(previewKind('image/heic', 'IMG_4821.heic')).toBe('none');
    expect(previewKind('image/heif', 'IMG_4821.heif')).toBe('none');
  });

  it('previews PDFs', () => {
    expect(previewKind('application/pdf', 'ritning-4b.pdf')).toBe('pdf');
  });

  it('falls back to the extension when the content type is vague', () => {
    // Some uploads arrive as octet-stream; a drawing should not lose its
    // preview because the browser was unspecific about the type.
    expect(previewKind('application/octet-stream', 'ritning.pdf')).toBe('pdf');
    expect(previewKind('application/octet-stream', 'foto.JPG')).toBe('image');
  });

  it('offers no preview for things the browser cannot render', () => {
    expect(previewKind('application/vnd.ms-outlook', 'mail.msg')).toBe('none');
    expect(previewKind('application/octet-stream', 'del.step')).toBe('none');
    expect(
      previewKind(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'matning.xlsx',
      ),
    ).toBe('none');
  });

  it('matches the content type case-insensitively', () => {
    expect(previewKind('IMAGE/JPEG', 'a.jpg')).toBe('image');
    expect(previewKind('APPLICATION/PDF', 'a.pdf')).toBe('pdf');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addAttachment,
  assertUploadAllowed,
  attachmentBlobPath,
  extensionOf,
  isAllowedExtension,
  isImageContentType,
  removeAttachment,
  sanitizeFileName,
  thumbnailBlobPath,
} from './attachments.js';
import { ATTACHMENT_MAX_BYTES } from './constants.js';
import { DomainError } from './errors.js';
import type { Attachment } from './schemas.js';
import { ctx, mainTask } from './__testing__/fixtures.js';

const attachment: Attachment = {
  id: '01JGZ0000000000000000ZZZ1',
  fileName: 'ritning.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  blobPath: 'task/att/ritning.pdf',
  thumbnailPath: null,
  uploadedAt: '2026-08-11T09:30:00.000Z',
  uploadedBy: 'anna',
};

describe('extensions', () => {
  it('reads the extension case-insensitively', () => {
    expect(extensionOf('Ritning.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('returns empty for a name with no extension', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  it('allows the shop-floor formats and refuses executables', () => {
    expect(isAllowedExtension('foto.jpg')).toBe(true);
    expect(isAllowedExtension('ritning.dxf')).toBe(true);
    expect(isAllowedExtension('modell.step')).toBe(true);
    expect(isAllowedExtension('virus.exe')).toBe(false);
    expect(isAllowedExtension('script.sh')).toBe(false);
    expect(isAllowedExtension('noextension')).toBe(false);
  });

  it('identifies image content types for the thumbnail path', () => {
    expect(isImageContentType('image/JPEG')).toBe(true);
    expect(isImageContentType('application/pdf')).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('transliterates Swedish letters rather than dropping them', () => {
    expect(sanitizeFileName('Färdig-Ritning.pdf')).toBe('Fardig-Ritning.pdf');
    expect(sanitizeFileName('växellåda.png')).toBe('vaxellada.png');
  });

  it('collapses unsafe characters', () => {
    expect(sanitizeFileName('a b/c:d*e.pdf')).toBe('a-b-c-d-e.pdf');
  });

  it('strips leading and trailing punctuation', () => {
    expect(sanitizeFileName('---file.pdf---')).toBe('file.pdf');
  });

  it('never returns an empty name', () => {
    expect(sanitizeFileName('***')).toBe('file');
    expect(sanitizeFileName('')).toBe('file');
  });

  it('caps the length', () => {
    expect(sanitizeFileName(`${'a'.repeat(300)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});

describe('blob paths', () => {
  it('keys attachments by task so a task delete can prefix-delete its files', () => {
    expect(attachmentBlobPath('task-1', 'att-1', 'Ritning Färdig.pdf')).toBe(
      'task-1/att-1/Ritning-Fardig.pdf',
    );
  });

  it('puts the thumbnail beside its attachment', () => {
    expect(thumbnailBlobPath('task-1', 'att-1')).toBe('task-1/att-1/thumb.jpg');
  });
});

describe('assertUploadAllowed', () => {
  const valid = { fileName: 'foto.jpg', contentType: 'image/jpeg', sizeBytes: 1024 };

  it('accepts a valid upload', () => {
    expect(() => assertUploadAllowed(valid)).not.toThrow();
  });

  it('rejects a disallowed type', () => {
    expect(() => assertUploadAllowed({ ...valid, fileName: 'x.exe' })).toThrow(DomainError);
  });

  it('rejects an empty filename', () => {
    expect(() => assertUploadAllowed({ ...valid, fileName: '   ' })).toThrow(DomainError);
  });

  it('rejects a non-positive size', () => {
    expect(() => assertUploadAllowed({ ...valid, sizeBytes: 0 })).toThrow(DomainError);
    expect(() => assertUploadAllowed({ ...valid, sizeBytes: Number.NaN })).toThrow(DomainError);
  });

  it('rejects an oversized file with payload_too_large', () => {
    try {
      assertUploadAllowed({ ...valid, sizeBytes: ATTACHMENT_MAX_BYTES + 1 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('payload_too_large');
    }
  });

  it('accepts a file exactly at the limit', () => {
    expect(() =>
      assertUploadAllowed({ ...valid, fileName: 'big.pdf', sizeBytes: ATTACHMENT_MAX_BYTES }),
    ).not.toThrow();
  });
});

describe('attaching to nodes', () => {
  it('adds and stamps the audit fields', () => {
    const updated = addAttachment(mainTask(), attachment, ctx({ actor: 'anna' }));
    expect(updated.attachments).toHaveLength(1);
    expect(updated.updatedBy).toBe('anna');
  });

  it('removes by id, leaving others intact', () => {
    const withTwo = addAttachment(
      addAttachment(mainTask(), attachment, ctx()),
      { ...attachment, id: '01JGZ0000000000000000ZZZ2' },
      ctx(),
    );

    const removed = removeAttachment(withTwo, attachment.id, ctx());
    expect(removed.attachments.map((item) => item.id)).toEqual(['01JGZ0000000000000000ZZZ2']);
  });

  it('is a safe no-op for an unknown id', () => {
    const node = addAttachment(mainTask(), attachment, ctx());
    expect(removeAttachment(node, 'nope', ctx()).attachments).toHaveLength(1);
  });
});

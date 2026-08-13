import { describe, expect, it } from 'vitest';
import type { StoredFile } from '@taskhub/shared';
import { kindOf, matchesSearch, totalBytes } from './FilesView.js';

function file(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    taskId: '01TASK',
    attachmentId: '01ATT',
    taskTitle: 'Byt växellåda på maskin 7',
    fileName: 'slitage.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    uploadedAt: '2026-08-13T09:00:00.000Z',
    blobPath: '01TASK/01ATT/slitage.jpg',
    ...overrides,
  };
}

describe('matchesSearch', () => {
  it('matches on the filename', () => {
    expect(matchesSearch(file(), 'slitage')).toBe(true);
  });

  it('matches on the task title', () => {
    // People remember "the photo from the gearbox job" more reliably than they
    // remember what the file was called.
    expect(matchesSearch(file(), 'växellåda')).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(matchesSearch(file(), '  SLITAGE  ')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matchesSearch(file(), '')).toBe(true);
    expect(matchesSearch(file(), '   ')).toBe(true);
  });

  it('does not throw on a file whose task is gone', () => {
    // Orphans have no title, and they are exactly the rows people search for
    // when clearing space.
    expect(matchesSearch(file({ taskTitle: null }), 'slitage')).toBe(true);
    expect(matchesSearch(file({ taskTitle: null }), 'växellåda')).toBe(false);
  });

  it('returns false for a miss', () => {
    expect(matchesSearch(file(), 'ritning')).toBe(false);
  });
});

describe('kindOf', () => {
  it('classifies images by content type', () => {
    expect(kindOf(file({ contentType: 'image/jpeg' }))).toBe('image');
    expect(kindOf(file({ contentType: 'image/heic' }))).toBe('image');
  });

  it('classifies documents by content type', () => {
    expect(kindOf(file({ contentType: 'application/pdf' }))).toBe('document');
    expect(
      kindOf(
        file({
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe('document');
  });

  it('falls back to the extension when the content type is useless', () => {
    // Uploads from some browsers arrive as application/octet-stream, and a CAD
    // file landing in "Övrigt" while its neighbour lands in "Dokument" looks
    // arbitrary to the person looking at the list.
    expect(kindOf(file({ contentType: 'application/octet-stream', fileName: 'a.pdf' }))).toBe(
      'document',
    );
  });

  it('puts anything unrecognised in other rather than hiding it', () => {
    expect(kindOf(file({ contentType: 'application/octet-stream', fileName: 'part.step' }))).toBe(
      'other',
    );
  });
});

describe('totalBytes', () => {
  it('sums what is actually being paid for', () => {
    expect(totalBytes([file({ sizeBytes: 1000 }), file({ sizeBytes: 2500 })])).toBe(3500);
  });

  it('is zero for nothing', () => {
    expect(totalBytes([])).toBe(0);
  });
});

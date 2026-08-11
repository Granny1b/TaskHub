import { describe, expect, it } from 'vitest';
import { setComplete } from './completion.js';
import {
  TASK_METADATA_KEYS,
  TASK_TAG_KEYS,
  decodeMetadataText,
  encodeMetadataText,
  fromBlobMetadata,
  toBlobMetadata,
  toBlobTags,
} from './metadata.js';
import { ctx, document, mainTask, taskWithChildren } from './__testing__/fixtures.js';

describe('metadata text encoding', () => {
  it('round-trips Swedish characters, which are not header-safe raw', () => {
    const title = 'Färdigställ växellådan — Åke';
    expect(decodeMetadataText(encodeMetadataText(title))).toBe(title);
  });

  it('produces pure ASCII output', () => {
    const encoded = encodeMetadataText('Färdig datum för åtgärd');
    expect(/^[A-Za-z0-9+/=]*$/.test(encoded)).toBe(true);
  });

  it('round-trips emoji and other astral-plane characters', () => {
    expect(decodeMetadataText(encodeMetadataText('kontroll ✅ 🔧'))).toBe('kontroll ✅ 🔧');
  });

  it('round-trips an empty string', () => {
    expect(decodeMetadataText(encodeMetadataText(''))).toBe('');
  });
});

describe('toBlobMetadata', () => {
  it('denormalises exactly what the list view needs', () => {
    const doc = document(taskWithChildren(4, 1));
    const metadata = toBlobMetadata(doc);

    expect(metadata[TASK_METADATA_KEYS.childCount]).toBe('4');
    expect(metadata[TASK_METADATA_KEYS.childDoneCount]).toBe('1');
    expect(metadata[TASK_METADATA_KEYS.isComplete]).toBe('false');
    expect(metadata[TASK_METADATA_KEYS.attachmentCount]).toBe('0');
    expect(metadata[TASK_METADATA_KEYS.schemaVersion]).toBe('1');
  });

  it('omits absent values rather than writing empty strings', () => {
    const metadata = toBlobMetadata(document(mainTask()));
    expect(metadata[TASK_METADATA_KEYS.completedDate]).toBeUndefined();
    expect(metadata[TASK_METADATA_KEYS.listId]).toBeUndefined();
  });

  it('includes the list id when the task is grouped', () => {
    const listId = '01JGZ0000000000000000ZZZ2';
    expect(toBlobMetadata(document(mainTask(), listId))[TASK_METADATA_KEYS.listId]).toBe(listId);
  });

  it('is entirely ASCII, even for a Swedish title', () => {
    const metadata = toBlobMetadata(document(mainTask({ title: 'Byt växellåda på maskin 7' })));
    for (const value of Object.values(metadata)) {
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(value)).toBe(true);
    }
  });
});

describe('toBlobTags', () => {
  it('emits the filterable facets and stays well under the 10-tag limit', () => {
    const tags = toBlobTags(document(mainTask(), '01JGZ0000000000000000ZZZ2'));
    expect(tags[TASK_TAG_KEYS.isComplete]).toBe('false');
    expect(tags[TASK_TAG_KEYS.deleted]).toBe('false');
    expect(tags[TASK_TAG_KEYS.listId]).toBe('01JGZ0000000000000000ZZZ2');
    expect(Object.keys(tags).length).toBeLessThanOrEqual(10);
  });

  it('marks soft-deleted documents so the listing can skip them cheaply', () => {
    const doc = { ...document(), deletedAt: '2026-08-11T09:30:00.000Z' };
    expect(toBlobTags(doc)[TASK_TAG_KEYS.deleted]).toBe('true');
  });

  it('uses only characters Azure permits in tag values', () => {
    for (const value of Object.values(toBlobTags(document(taskWithChildren(2, 1))))) {
      expect(/^[A-Za-z0-9 +\-./:=_]*$/.test(value)).toBe(true);
    }
  });
});

describe('fromBlobMetadata', () => {
  it('reconstructs a summary without opening the document', () => {
    const doc = document(setComplete(taskWithChildren(4, 2), true, ctx()));
    const summary = fromBlobMetadata(doc.id, toBlobMetadata(doc), '"etag-1"');

    expect(summary).not.toBeNull();
    expect(summary?.id).toBe(doc.id);
    expect(summary?.childCount).toBe(4);
    expect(summary?.childDoneCount).toBe(2);
    expect(summary?.isComplete).toBe(true);
    expect(summary?.completedDate).toBe('2026-08-11');
    expect(summary?.etag).toBe('"etag-1"');
  });

  it('carries a Kommentarer preview, so the list row is populated by the listing alone', () => {
    const doc = document(mainTask({ comments: 'Se ritning 4b. Reservdelar beställda vecka 32.' }));
    const summary = fromBlobMetadata(doc.id, toBlobMetadata(doc));
    expect(summary?.commentsPreview).toBe('Se ritning 4b. Reservdelar beställda vecka 32.');
  });

  it('truncates a long Kommentarer rather than blowing the metadata budget', () => {
    const doc = document(mainTask({ comments: 'x'.repeat(5000) }));
    const summary = fromBlobMetadata(doc.id, toBlobMetadata(doc));
    expect(summary?.commentsPreview).toHaveLength(200);
  });

  it('stays well inside the 8 KB metadata limit at maximum field lengths', () => {
    const doc = document(
      mainTask({ title: 'å'.repeat(200), comments: 'ö'.repeat(5000) }),
      '01JGZ0000000000000000ZZZ2',
    );
    const metadata = toBlobMetadata(doc);
    const bytes = Object.entries(metadata).reduce(
      (total, [key, value]) => total + key.length + value.length,
      0,
    );
    expect(bytes).toBeLessThan(8 * 1024);
  });

  it('preserves a Swedish title through the round trip', () => {
    const doc = document(mainTask({ title: 'Kontrollera oljenivå — spindel' }));
    expect(fromBlobMetadata(doc.id, toBlobMetadata(doc))?.title).toBe(
      'Kontrollera oljenivå — spindel',
    );
  });

  it('returns null when metadata is absent, so the caller can fall back to a read', () => {
    expect(fromBlobMetadata('id', undefined)).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    const doc = document();
    const metadata = toBlobMetadata(doc);
    delete metadata[TASK_METADATA_KEYS.titleB64];
    expect(fromBlobMetadata(doc.id, metadata)).toBeNull();
  });

  it('returns null when the stored date is not a real calendar date', () => {
    const doc = document();
    const metadata = { ...toBlobMetadata(doc), [TASK_METADATA_KEYS.date]: '2026-02-31' };
    expect(fromBlobMetadata(doc.id, metadata)).toBeNull();
  });

  it('degrades to defaults rather than throwing on a corrupt count', () => {
    const doc = document(taskWithChildren(3, 1));
    const metadata = { ...toBlobMetadata(doc), [TASK_METADATA_KEYS.childCount]: 'not-a-number' };
    expect(fromBlobMetadata(doc.id, metadata)?.childCount).toBe(0);
  });

  it('ignores an unparseable completedDate instead of failing the whole row', () => {
    const doc = document();
    const metadata = { ...toBlobMetadata(doc), [TASK_METADATA_KEYS.completedDate]: 'garbage' };
    expect(fromBlobMetadata(doc.id, metadata)?.completedDate).toBeNull();
  });
});

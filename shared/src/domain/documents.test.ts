import { describe, expect, it } from 'vitest';
import { setComplete } from './completion.js';
import {
  createTaskDocument,
  isDeleted,
  restoreDocument,
  setDocumentList,
  softDeleteDocument,
  toTaskSummary,
} from './documents.js';
import { CURRENT_SCHEMA_VERSION } from './schemas.js';
import { addChild } from './tree.js';
import { ctx, document, mainTask, taskWithChildren } from './__testing__/fixtures.js';

describe('createTaskDocument', () => {
  it('creates a versioned aggregate whose id matches its root', () => {
    const doc = createTaskDocument({ title: 'Byt växellåda' }, ctx());
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.id).toBe(doc.root.id);
    expect(doc.deletedAt).toBeNull();
  });

  it('creates a main task with percent completion, per policy', () => {
    expect(createTaskDocument({ title: 'X' }, ctx()).root.completion.kind).toBe('percent');
  });

  it('is ungrouped unless a list is given', () => {
    expect(createTaskDocument({ title: 'X' }, ctx()).listId).toBeNull();
    expect(createTaskDocument({ title: 'X', listId: 'list-1' }, ctx()).listId).toBe('list-1');
  });

  it('carries optional comments and date through', () => {
    const doc = createTaskDocument(
      { title: 'X', comments: 'Se ritning 4b', date: '2026-03-04' },
      ctx(),
    );
    expect(doc.root.comments).toBe('Se ritning 4b');
    expect(doc.root.date).toBe('2026-03-04');
  });
});

describe('toTaskSummary', () => {
  it('computes counts from children rather than reading a stored field', () => {
    const summary = toTaskSummary(document(taskWithChildren(7, 3)));
    expect(summary.childCount).toBe(7);
    expect(summary.childDoneCount).toBe(3);
  });

  it('reflects the real percent even when the task is complete', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 40, isComplete: true, percentSource: 'manual' },
    });
    const summary = toTaskSummary(document(task));
    expect(summary.isComplete).toBe(true);
    expect(summary.percent).toBe(40);
  });

  it('includes a Kommentarer preview for the list row', () => {
    const summary = toTaskSummary(document(mainTask({ comments: 'Se ritning 4b' })));
    expect(summary.commentsPreview).toBe('Se ritning 4b');
  });

  it('carries the ETag when one is supplied', () => {
    expect(toTaskSummary(document(), '"etag-9"').etag).toBe('"etag-9"');
    expect(toTaskSummary(document()).etag).toBeUndefined();
  });

  it('tracks counts after a subtask is added', () => {
    const doc = createTaskDocument({ title: 'X' }, ctx());
    const { root } = addChild(doc.root, doc.root.id, { title: 'Del' }, ctx());
    expect(toTaskSummary({ ...doc, root }).childCount).toBe(1);
  });
});

describe('soft delete', () => {
  it('marks rather than destroys', () => {
    const deleted = softDeleteDocument(document(), ctx());
    expect(isDeleted(deleted)).toBe(true);
    expect(deleted.root).toBeDefined();
  });

  it('restores', () => {
    expect(isDeleted(restoreDocument(softDeleteDocument(document(), ctx())))).toBe(false);
  });
});

describe('setDocumentList', () => {
  it('moves a task between user-defined lists', () => {
    const moved = setDocumentList(document(), '01JGZ0000000000000000ZZZ3', ctx());
    expect(moved.listId).toBe('01JGZ0000000000000000ZZZ3');
  });

  it('can return a task to ungrouped', () => {
    const grouped = document(mainTask(), 'list-1');
    expect(setDocumentList(grouped, null, ctx()).listId).toBeNull();
  });

  it('touches the audit stamp', () => {
    const moved = setDocumentList(
      document(),
      'list-1',
      ctx({ actor: 'anna', now: '2026-09-01T00:00:00.000Z' }),
    );
    expect(moved.root.updatedBy).toBe('anna');
    expect(moved.root.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not disturb completion state', () => {
    const doc = document(setComplete(mainTask(), true, ctx()));
    expect(setDocumentList(doc, 'list-1', ctx()).root.completion.isComplete).toBe(true);
  });
});

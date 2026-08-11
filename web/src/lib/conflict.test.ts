import { describe, expect, it } from 'vitest';
import {
  createContext,
  createTaskDocument,
  addChild as addChildToTree,
  setComplete,
  updateNode,
  type TaskDocument,
} from '@taskhub/shared';
import type { PatchNode } from './apiClient.js';
import { analyseConflict, patchedFields } from './conflict.js';

/**
 * The retry decision from §7, tested directly.
 *
 * This is the client's most consequential piece of logic: getting it wrong
 * either interrupts people constantly for edits that never collided, or
 * silently overwrites a colleague's change. Neither is visible in a screenshot.
 */

const ctx = () => createContext('anna', new Date('2026-08-11T09:30:00Z'));

function seed(title = 'Byt växellåda'): TaskDocument {
  return createTaskDocument({ title, comments: 'Ursprunglig kommentar' }, ctx());
}

function withChild(document: TaskDocument, title: string) {
  const { root, child } = addChildToTree(document.root, document.root.id, { title }, ctx());
  return { document: { ...document, root }, childId: child.id };
}

describe('patchedFields', () => {
  it('lists only the fields actually being changed', () => {
    // A patch built by spreading optional fields can carry explicit undefined
    // values; those are not changes and must not be reported as such.
    // The double assertion is the price of exactOptionalPropertyTypes: the type
    // forbids an explicit undefined, but a spread-built patch can still contain
    // one at runtime, which is exactly the case being tested.
    const sparse = { title: 'x', comments: undefined } as unknown as PatchNode;
    expect(patchedFields(sparse)).toEqual(['title']);
    expect(patchedFields({})).toEqual([]);
  });
});

describe('analyseConflict', () => {
  it('retries when the other person changed a different field', () => {
    const base = seed();
    // They edited the comments; we are editing the title.
    const latest = {
      ...base,
      root: { ...base.root, comments: 'Deras kommentar' },
    };

    const result = analyseConflict(base, latest, base.root.id, { title: 'Vårt namn' });
    expect(result.canRetry).toBe(true);
    expect(result.collidingFields).toEqual([]);
  });

  it('refuses to retry when the same field was changed', () => {
    const base = seed();
    const latest = { ...base, root: { ...base.root, title: 'Deras namn' } };

    const result = analyseConflict(base, latest, base.root.id, { title: 'Vårt namn' });
    expect(result.canRetry).toBe(false);
    expect(result.collidingFields).toEqual(['title']);
  });

  it('detects a completion collision', () => {
    const base = seed();
    const latest = {
      ...base,
      root: setComplete(base.root, true, ctx()),
    };

    const result = analyseConflict(base, latest, base.root.id, { isComplete: false });
    expect(result.canRetry).toBe(false);
    expect(result.collidingFields).toContain('isComplete');
  });

  it('retries a subtask edit when the collision is on a different subtask', () => {
    // The expected case: two people ticking different subtasks of one task.
    const { document: withFirst, childId: first } = withChild(seed(), 'Demontera');
    const { document: base, childId: second } = withChild(withFirst, 'Provkör');

    const latest = {
      ...base,
      root: updateNode(base.root, second, (node) => setComplete(node, true, ctx()), ctx()),
    };

    const result = analyseConflict(base, latest, first, { isComplete: true });
    expect(result.canRetry).toBe(true);
  });

  it('refuses to retry when the same subtask was changed', () => {
    const { document: base, childId } = withChild(seed(), 'Demontera');
    const latest = {
      ...base,
      root: updateNode(base.root, childId, (node) => setComplete(node, true, ctx()), ctx()),
    };

    const result = analyseConflict(base, latest, childId, { isComplete: true });
    expect(result.canRetry).toBe(false);
  });

  it('refuses to retry when the node no longer exists', () => {
    // They deleted the subtask we were editing. That is not something to paper
    // over — the user needs to see it.
    const { document: base, childId } = withChild(seed(), 'Demontera');
    const latest = seed();

    expect(analyseConflict(base, latest, childId, { title: 'x' }).canRetry).toBe(false);
  });

  it('refuses to retry when there is no baseline to compare against', () => {
    // Without the version we started from we cannot prove the fields are
    // untouched, so we do not guess.
    const latest = seed();
    expect(analyseConflict(undefined, latest, latest.root.id, { title: 'x' }).canRetry).toBe(false);
  });

  it('treats an empty patch as safe', () => {
    const base = seed();
    expect(analyseConflict(base, base, base.root.id, {}).canRetry).toBe(true);
  });

  it('reports every colliding field, not just the first', () => {
    const base = seed();
    const latest = {
      ...base,
      root: { ...base.root, title: 'Deras namn', comments: 'Deras kommentar' },
    };

    const result = analyseConflict(base, latest, base.root.id, {
      title: 'Vårt namn',
      comments: 'Vår kommentar',
      date: base.root.date,
    });

    expect(result.collidingFields.sort()).toEqual(['comments', 'title']);
  });

  it('does not treat a field we changed to the same value as a collision', () => {
    const base = seed();
    const latest = { ...base, root: { ...base.root, comments: 'Deras kommentar' } };

    // We are "changing" the title to what it already is; they changed comments.
    const result = analyseConflict(base, latest, base.root.id, { title: base.root.title });
    expect(result.canRetry).toBe(true);
  });
});

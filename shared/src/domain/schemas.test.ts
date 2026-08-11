import { describe, expect, it } from 'vitest';
import { completionKindForDepth } from '../config/completionPolicy.js';
import { MAX_TASK_DEPTH } from './constants.js';
import {
  attachmentSchema,
  completionSchema,
  taskNodeSchema,
  validatedTaskDocumentSchema,
  type TaskNode,
} from './schemas.js';
import { document, mainTask, subtask, taskWithChildren } from './__testing__/fixtures.js';

describe('completionSchema', () => {
  it('accepts both members of the union', () => {
    expect(completionSchema.safeParse({ kind: 'checkbox', isComplete: true }).success).toBe(true);
    expect(
      completionSchema.safeParse({
        kind: 'percent',
        percent: 50,
        isComplete: false,
        percentSource: 'derived',
      }).success,
    ).toBe(true);
  });

  it('refuses a percent on a checkbox — the union is what makes that impossible', () => {
    const result = completionSchema.parse({ kind: 'checkbox', isComplete: false, percent: 50 });
    expect(result).not.toHaveProperty('percent');
  });

  it('rejects an out-of-range or fractional percent', () => {
    const base = { kind: 'percent', isComplete: false, percentSource: 'manual' };
    expect(completionSchema.safeParse({ ...base, percent: 101 }).success).toBe(false);
    expect(completionSchema.safeParse({ ...base, percent: -1 }).success).toBe(false);
    expect(completionSchema.safeParse({ ...base, percent: 33.5 }).success).toBe(false);
  });

  it('rejects an unknown percentSource', () => {
    expect(
      completionSchema.safeParse({
        kind: 'percent',
        percent: 0,
        isComplete: false,
        percentSource: 'automatic',
      }).success,
    ).toBe(false);
  });
});

describe('taskNodeSchema', () => {
  it('validates a node and its children recursively', () => {
    expect(taskNodeSchema.safeParse(taskWithChildren(2, 1)).success).toBe(true);
  });

  it('rejects an empty or overlong title', () => {
    expect(taskNodeSchema.safeParse(mainTask({ title: '' })).success).toBe(false);
    expect(taskNodeSchema.safeParse(mainTask({ title: 'x'.repeat(201) })).success).toBe(false);
  });

  it('rejects an invalid Datum', () => {
    expect(taskNodeSchema.safeParse(mainTask({ date: '2026-02-31' })).success).toBe(false);
  });

  it('rejects a malformed child while accepting a valid parent', () => {
    const root = mainTask({ children: [subtask({ title: '' })] });
    expect(taskNodeSchema.safeParse(root).success).toBe(false);
  });

  it('infers a usable recursive type rather than any', () => {
    const parsed: TaskNode = taskNodeSchema.parse(taskWithChildren(1));
    // If inference had collapsed to `any`, this would not type-check.
    const childTitle: string | undefined = parsed.children[0]?.title;
    expect(childTitle).toBe('Deluppgift 1');
  });
});

describe('attachmentSchema', () => {
  it('rejects a file above the size cap', () => {
    const oversized = {
      id: '01JGZ0000000000000000ZZZ1',
      fileName: 'big.pdf',
      contentType: 'application/pdf',
      sizeBytes: 26 * 1024 * 1024,
      blobPath: 'a/b/c.pdf',
      thumbnailPath: null,
      uploadedAt: '2026-08-11T09:30:00.000Z',
      uploadedBy: 'anna',
    };
    expect(attachmentSchema.safeParse(oversized).success).toBe(false);
  });
});

describe('taskDocumentSchema', () => {
  it('accepts a well-formed document', () => {
    expect(validatedTaskDocumentSchema.safeParse(document()).success).toBe(true);
  });

  it('rejects a document whose id disagrees with its root', () => {
    const doc = { ...document(), id: '01JGZ0000000000000000ZZZ9' };
    expect(validatedTaskDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('strips unknown top-level keys rather than failing the read', () => {
    const parsed = validatedTaskDocumentSchema.parse({ ...document(), leftoverField: 'x' });
    expect(parsed).not.toHaveProperty('leftoverField');
  });
});

describe('completion policy', () => {
  it('gives main tasks a percent and subtasks a checkbox', () => {
    expect(completionKindForDepth(0)).toBe('percent');
    expect(completionKindForDepth(1)).toBe('checkbox');
  });

  it('falls back to checkbox past the configured depths', () => {
    expect(completionKindForDepth(2)).toBe('checkbox');
    expect(completionKindForDepth(99)).toBe('checkbox');
  });

  it('has a policy entry for every depth the cap allows', () => {
    for (let depth = 0; depth < MAX_TASK_DEPTH; depth += 1) {
      expect(['percent', 'checkbox']).toContain(completionKindForDepth(depth));
    }
  });
});

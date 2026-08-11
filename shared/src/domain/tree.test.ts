import { describe, expect, it } from 'vitest';
import {
  getPercent,
  isPercentDerived,
  isTaskComplete,
  recomputeDerivedPercent,
  setComplete,
} from './completion.js';
import { DEEPEST_TASK_DEPTH } from './constants.js';
import { DomainError } from './errors.js';
import {
  addChild,
  countNodes,
  createTaskNode,
  findNode,
  orderedChildren,
  removeNode,
  reorderChildren,
  totalAttachmentCount,
  updateNode,
  visitNodes,
} from './tree.js';
import { ctx, mainTask, subtask, taskWithChildren } from './__testing__/fixtures.js';

describe('navigation', () => {
  it('finds the root at depth 0 with no parent', () => {
    const root = mainTask();
    expect(findNode(root, root.id)).toEqual({ node: root, parent: null, depth: 0 });
  });

  it('finds a child at depth 1 with its parent', () => {
    const root = taskWithChildren(3);
    const child = root.children[1];
    const found = findNode(root, child?.id ?? '');

    expect(found?.depth).toBe(1);
    expect(found?.parent?.id).toBe(root.id);
  });

  it('returns null for an unknown id', () => {
    expect(findNode(mainTask(), 'nope')).toBeNull();
  });

  it('counts every node in the tree', () => {
    expect(countNodes(taskWithChildren(4))).toBe(5);
  });

  it('walks depth-first in pre-order', () => {
    const root = taskWithChildren(2);
    const seen: number[] = [];
    visitNodes(root, (_node, depth) => seen.push(depth));
    expect(seen).toEqual([0, 1, 1]);
  });
});

describe('createTaskNode', () => {
  it('takes its completion kind from policy at that depth', () => {
    expect(createTaskNode({ title: 'Huvud' }, 0, ctx()).completion.kind).toBe('percent');
    expect(createTaskNode({ title: 'Del' }, 1, ctx()).completion.kind).toBe('checkbox');
  });

  it('defaults Datum to today, since it records when the task was raised', () => {
    expect(createTaskNode({ title: 'X' }, 0, ctx({ today: '2026-08-11' })).date).toBe('2026-08-11');
  });

  it('accepts an explicit date', () => {
    expect(createTaskNode({ title: 'X', date: '2026-01-02' }, 0, ctx()).date).toBe('2026-01-02');
  });

  it('starts with empty comments, no attachments and no children', () => {
    const node = createTaskNode({ title: 'X' }, 0, ctx());
    expect(node.comments).toBe('');
    expect(node.attachments).toEqual([]);
    expect(node.children).toEqual([]);
    expect(node.completedDate).toBeNull();
    expect(node.custom).toEqual({});
  });

  it('stamps the actor on both created and updated', () => {
    const node = createTaskNode({ title: 'X' }, 0, ctx({ actor: 'anna' }));
    expect(node.createdBy).toBe('anna');
    expect(node.updatedBy).toBe('anna');
  });
});

describe('addChild', () => {
  it('adds a subtask under the root', () => {
    const parent = mainTask();
    const { root, child } = addChild(parent, parent.id, { title: 'Deluppgift' }, ctx());

    expect(root.children).toHaveLength(1);
    expect(child.title).toBe('Deluppgift');
    expect(root.children[0]?.id).toBe(child.id);
  });

  it('gives the new child a checkbox completion, per policy at depth 1', () => {
    const parent = mainTask();
    const { child } = addChild(parent, parent.id, { title: 'Deluppgift' }, ctx());
    expect(child.completion.kind).toBe('checkbox');
  });

  it('orders new children after existing ones', () => {
    const parent = taskWithChildren(2);
    const { root } = addChild(parent, parent.id, { title: 'Tredje' }, ctx());
    const orders = root.children.map((item) => item.order);
    expect(orders[2]).toBeGreaterThan(orders[1] ?? 0);
  });

  it('refuses to nest past the configured depth cap', () => {
    const parent = taskWithChildren(1);
    const child = parent.children[0];

    expect(() => addChild(parent, child?.id ?? '', { title: 'För djupt' }, ctx())).toThrow(
      DomainError,
    );
    expect(DEEPEST_TASK_DEPTH).toBe(1);
  });

  it('throws when the parent does not exist', () => {
    expect(() => addChild(mainTask(), 'nope', { title: 'x' }, ctx())).toThrow(DomainError);
  });

  it('drives the parent derived percent immediately', () => {
    const parent = mainTask();
    const first = addChild(parent, parent.id, { title: 'A' }, ctx());
    expect(getPercent(first.root)).toBe(0);

    const completed = updateNode(
      first.root,
      first.child.id,
      (node) => setComplete(node, true, ctx()),
      ctx(),
    );
    expect(getPercent(completed)).toBe(100);
  });
});

describe('updateNode', () => {
  it('recomputes an ancestor derived percent when a child completes', () => {
    const root = taskWithChildren(4, 0);
    const child = root.children[1];

    const updated = updateNode(
      root,
      child?.id ?? '',
      (node) => setComplete(node, true, ctx()),
      ctx(),
    );

    expect(getPercent(updated)).toBe(25);
    expect(isTaskComplete(updated)).toBe(false);
  });

  it('leaves a manual parent percent alone when a child completes', () => {
    const root = {
      ...taskWithChildren(4, 0),
      completion: {
        kind: 'percent' as const,
        percent: 90,
        isComplete: false,
        percentSource: 'manual' as const,
      },
    };
    const child = root.children[0];

    const updated = updateNode(
      root,
      child?.id ?? '',
      (node) => setComplete(node, true, ctx()),
      ctx(),
    );
    expect(getPercent(updated)).toBe(90);
    expect(isPercentDerived(updated)).toBe(false);
  });

  it('throws not_found for an unknown node', () => {
    expect(() => updateNode(mainTask(), 'nope', (node) => node, ctx())).toThrow(DomainError);
  });

  it('does not mutate the original tree', () => {
    const root = taskWithChildren(2, 0);
    const child = root.children[0];
    updateNode(root, child?.id ?? '', (node) => setComplete(node, true, ctx()), ctx());
    expect(isTaskComplete(root.children[0] as never)).toBe(false);
  });
});

describe('removeNode', () => {
  it('removes a subtask and recomputes the parent', () => {
    const root = taskWithChildren(4, 2);
    const child = root.children[3];

    const updated = removeNode(root, child?.id ?? '', ctx());
    expect(updated.children).toHaveLength(3);
    expect(getPercent(updated)).toBe(67);
  });

  it('switches a derived parent to manual when its last child goes, keeping the value', () => {
    // Bring the parent into the consistent state a real flow would leave it in:
    // one child, complete, so the derived percent has actually been computed.
    const root = recomputeDerivedPercent(taskWithChildren(1, 1), ctx());
    expect(getPercent(root)).toBe(100);

    const child = root.children[0];
    const updated = removeNode(root, child?.id ?? '', ctx());
    expect(updated.children).toHaveLength(0);
    expect(isPercentDerived(updated)).toBe(false);
    expect(getPercent(updated)).toBe(100);
  });

  it('refuses to remove the root', () => {
    const root = mainTask();
    expect(() => removeNode(root, root.id, ctx())).toThrow(DomainError);
  });

  it('throws for an unknown node', () => {
    expect(() => removeNode(taskWithChildren(1), 'nope', ctx())).toThrow(DomainError);
  });
});

describe('reorderChildren', () => {
  it('moves a subtask to a new position', () => {
    const root = taskWithChildren(3);
    const moved = root.children[2];

    const updated = reorderChildren(root, root.id, moved?.id ?? '', 0, ctx());
    expect(orderedChildren(updated)[0]?.id).toBe(moved?.id);
  });

  it('leaves completion state untouched', () => {
    const root = taskWithChildren(3, 1);
    const updated = reorderChildren(root, root.id, root.children[2]?.id ?? '', 0, ctx());
    expect(updated.children.filter(isTaskComplete)).toHaveLength(1);
  });
});

describe('attachment counting', () => {
  it('sums attachments across the whole tree', () => {
    const attachment = {
      id: '01JGZ0000000000000000ZZZ1',
      fileName: 'ritning.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      blobPath: 'a/b/ritning.pdf',
      thumbnailPath: null,
      uploadedAt: '2026-08-11T09:30:00.000Z',
      uploadedBy: 'anna',
    };

    const root = mainTask({
      attachments: [attachment],
      children: [subtask({ attachments: [attachment, attachment] })],
    });

    expect(totalAttachmentCount(root)).toBe(3);
  });
});

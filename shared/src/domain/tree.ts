import { completionKindForDepth } from '../config/completionPolicy.js';
import { DEEPEST_TASK_DEPTH } from './constants.js';
import { createCompletion, recomputeDerivedPercent } from './completion.js';
import type { MutationContext } from './context.js';
import { depthExceeded, notFound } from './errors.js';
import { newTaskId } from './ids.js';
import { nextOrder, reorderSiblings, sortByOrder } from './ordering.js';
import type { TaskNode } from './schemas.js';

/**
 * Tree operations over a task aggregate.
 *
 * Everything here is immutable: operations return a new root and never mutate
 * in place. That is not ceremony — the aggregate is handed straight to React
 * state on the client and serialised under an ETag on the server, and both are
 * far easier to reason about when a node's identity changes exactly when its
 * contents do.
 *
 * Every mutation that touches a node's children recomputes derived percent on
 * each ancestor on the way back up, so a subtask tick is immediately reflected
 * in its parent's bar without a caller ever remembering to ask for it.
 */

export interface NodeLocation {
  readonly node: TaskNode;
  readonly parent: TaskNode | null;
  readonly depth: number;
}

/** Depth-first pre-order walk. */
export function visitNodes(
  root: TaskNode,
  visit: (node: TaskNode, depth: number, parent: TaskNode | null) => void,
): void {
  const walk = (node: TaskNode, depth: number, parent: TaskNode | null): void => {
    visit(node, depth, parent);
    for (const child of node.children) walk(child, depth + 1, node);
  };
  walk(root, 0, null);
}

export function findNode(root: TaskNode, id: string): NodeLocation | null {
  let found: NodeLocation | null = null;
  visitNodes(root, (node, depth, parent) => {
    if (found === null && node.id === id) found = { node, parent, depth };
  });
  return found;
}

export function countNodes(root: TaskNode): number {
  let count = 0;
  visitNodes(root, () => {
    count += 1;
  });
  return count;
}

export function totalAttachmentCount(root: TaskNode): number {
  let count = 0;
  visitNodes(root, (node) => {
    count += node.attachments.length;
  });
  return count;
}

/**
 * Rebuild the tree with `updater` applied to the node with `id`.
 *
 * Returns a new root. Ancestors along the path are rebuilt and have their
 * derived percent recomputed; untouched subtrees keep their existing object
 * identity so React can skip them.
 *
 * Throws `not_found` rather than silently no-op'ing: a caller asking to update
 * a node that has been deleted by someone else is a real condition the HTTP
 * layer needs to turn into a 404, not something to swallow.
 */
export function updateNode(
  root: TaskNode,
  id: string,
  updater: (node: TaskNode, depth: number) => TaskNode,
  ctx: MutationContext,
): TaskNode {
  const apply = (node: TaskNode, depth: number): TaskNode | null => {
    if (node.id === id) return updater(node, depth);

    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      if (child === undefined) continue;

      const updatedChild = apply(child, depth + 1);
      if (updatedChild === null) continue;

      const children = [...node.children];
      children[index] = updatedChild;
      return recomputeDerivedPercent({ ...node, children }, ctx);
    }

    return null;
  };

  const result = apply(root, 0);
  if (result === null) {
    throw notFound(`No node with id ${id} in this task`, { nodeId: id });
  }
  return result;
}

/** Build a new node at `depth`, taking its completion shape from policy. */
export function createTaskNode(
  input: { title: string; date?: string; comments?: string; order?: number },
  depth: number,
  ctx: MutationContext,
): TaskNode {
  return {
    id: newTaskId(),
    title: input.title,
    // Datum defaults to today: it records when the task was raised (ADR-0005).
    date: input.date ?? ctx.today,
    comments: input.comments ?? '',
    completion: createCompletion(completionKindForDepth(depth)),
    completedDate: null,
    order: input.order ?? 0,
    attachments: [],
    children: [],
    createdAt: ctx.now,
    createdBy: ctx.actor,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
    custom: {},
  };
}

/**
 * Add a child under `parentId`.
 *
 * Enforces the depth cap from config. Nothing here knows the words "main task"
 * or "subtask" — raising `MAX_TASK_DEPTH` to 3 needs no change in this file.
 */
export function addChild(
  root: TaskNode,
  parentId: string,
  input: { title: string; date?: string; comments?: string },
  ctx: MutationContext,
): { root: TaskNode; child: TaskNode } {
  const location = findNode(root, parentId);
  if (location === null) {
    throw notFound(`No node with id ${parentId} in this task`, { nodeId: parentId });
  }

  const childDepth = location.depth + 1;
  if (childDepth > DEEPEST_TASK_DEPTH) {
    throw depthExceeded(
      `Cannot nest deeper than ${DEEPEST_TASK_DEPTH + 1} levels (attempted depth ${childDepth})`,
      { parentId, attemptedDepth: childDepth, maxDepth: DEEPEST_TASK_DEPTH },
    );
  }

  const child = createTaskNode(
    { ...input, order: nextOrder(location.node.children) },
    childDepth,
    ctx,
  );

  const nextRoot = updateNode(
    root,
    parentId,
    (node) => ({ ...node, children: [...node.children, child] }),
    ctx,
  );

  // The parent's own derived percent must react to gaining a child. updateNode
  // recomputes ancestors, but not the node the updater itself returned.
  return { root: recomputeAt(nextRoot, parentId, ctx), child };
}

/** Remove a node and everything under it. The root itself cannot be removed. */
export function removeNode(root: TaskNode, id: string, ctx: MutationContext): TaskNode {
  if (root.id === id) {
    throw notFound('Cannot remove the root node of a task; delete the task instead', {
      nodeId: id,
    });
  }

  const location = findNode(root, id);
  if (location === null) {
    throw notFound(`No node with id ${id} in this task`, { nodeId: id });
  }
  const parent = location.parent;
  if (parent === null) {
    throw notFound(`No parent for node ${id}`, { nodeId: id });
  }

  const nextRoot = updateNode(
    root,
    parent.id,
    (node) => ({ ...node, children: node.children.filter((child) => child.id !== id) }),
    ctx,
  );

  return recomputeAt(nextRoot, parent.id, ctx);
}

/** Move a child to a new position among its siblings. */
export function reorderChildren(
  root: TaskNode,
  parentId: string,
  movedId: string,
  toIndex: number,
  ctx: MutationContext,
): TaskNode {
  return updateNode(
    root,
    parentId,
    (node) => {
      const { items } = reorderSiblings(node.children, movedId, toIndex);
      return { ...node, children: items };
    },
    ctx,
  );
}

/** Children in display order. The stored array order is not authoritative. */
export function orderedChildren(node: TaskNode): TaskNode[] {
  return sortByOrder(node.children);
}

/**
 * Recompute derived percent at one specific node.
 *
 * Needed because `updateNode` recomputes *ancestors* of the target, and adding
 * or removing a child changes the target's own ratio too.
 */
function recomputeAt(root: TaskNode, id: string, ctx: MutationContext): TaskNode {
  return updateNode(root, id, (node) => recomputeDerivedPercent(node, ctx), ctx);
}

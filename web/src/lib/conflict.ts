import type { TaskDocument, TaskNode } from '@taskhub/shared';
import type { PatchNode } from './apiClient.js';

/**
 * Conflict resolution (§7).
 *
 * When a write is rejected because someone else got there first, the client
 * refetches and asks one question: *did their change touch the same fields as
 * mine?*
 *
 * - No overlap → replay the change against the fresh ETag, once. Two people
 *   editing different subtasks of the same task is the expected case, and it
 *   should not surface as an error the user has to think about.
 * - Overlap → stop and show a non-destructive banner. The user's pending edit
 *   is preserved and shown alongside the other version.
 *
 * The rule that governs everything here: **never discard the user's typing.**
 * A retry that silently overwrote someone else's work would be worse than the
 * lost update we are preventing.
 */

export type PatchField = keyof PatchNode;

/** Which fields a patch actually touches. */
export function patchedFields(patch: PatchNode): PatchField[] {
  return (Object.keys(patch) as PatchField[]).filter((key) => patch[key] !== undefined);
}

function findNodeById(root: TaskNode, id: string): TaskNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found !== null) return found;
  }
  return null;
}

/** The value a patch field corresponds to on a stored node. */
function currentValue(node: TaskNode, field: PatchField): unknown {
  switch (field) {
    case 'title':
      return node.title;
    case 'date':
      return node.date;
    case 'comments':
      return node.comments;
    case 'completedDate':
      return node.completedDate;
    case 'isComplete':
      return node.completion.isComplete;
    case 'percent':
      return node.completion.kind === 'percent' ? node.completion.percent : null;
    case 'percentSource':
      return node.completion.kind === 'percent' ? node.completion.percentSource : null;
    default:
      return undefined;
  }
}

export interface ConflictAnalysis {
  /** Safe to replay the same patch against the newer version. */
  readonly canRetry: boolean;
  /** Fields where the other person's value differs from what we started from. */
  readonly collidingFields: PatchField[];
}

/**
 * Compare the version we based our edit on with the version that is now stored.
 *
 * A field collides when the other writer changed it *and* we are also trying to
 * change it. Them changing a field we are not touching is not a collision; nor
 * is us changing a field they left alone.
 *
 * When we cannot find the node in one of the versions — it was deleted, say —
 * we refuse to retry. That is a change the user needs to see.
 */
export function analyseConflict(
  base: TaskDocument | undefined,
  latest: TaskDocument,
  nodeId: string,
  patch: PatchNode,
): ConflictAnalysis {
  const fields = patchedFields(patch);
  if (fields.length === 0) return { canRetry: true, collidingFields: [] };

  if (base === undefined) {
    // No baseline to compare against: we cannot prove the fields are untouched,
    // so we do not guess.
    return { canRetry: false, collidingFields: fields };
  }

  const baseNode = findNodeById(base.root, nodeId);
  const latestNode = findNodeById(latest.root, nodeId);

  if (baseNode === null || latestNode === null) {
    return { canRetry: false, collidingFields: fields };
  }

  const collidingFields = fields.filter((field) => {
    const before = currentValue(baseNode, field);
    const after = currentValue(latestNode, field);
    return !Object.is(before, after);
  });

  return { canRetry: collidingFields.length === 0, collidingFields };
}

/** Details the conflict banner needs to explain itself. */
export interface PendingConflict {
  readonly taskId: string;
  readonly nodeId: string;
  readonly collidingFields: PatchField[];
  /** What the user was trying to save. Preserved, never discarded. */
  readonly attemptedPatch: PatchNode;
  readonly latest: TaskDocument;
  readonly latestETag: string;
}

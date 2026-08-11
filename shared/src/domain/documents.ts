import { countChildren, getPercent, isTaskComplete } from './completion.js';
import type { MutationContext } from './context.js';
import { totalAttachmentCount, createTaskNode } from './tree.js';
import { ORDER_STEP } from './ordering.js';
import { COMMENTS_PREVIEW_LENGTH } from './constants.js';
import { CURRENT_SCHEMA_VERSION, type TaskDocument, type TaskSummary } from './schemas.js';

/**
 * The aggregate: a main task and its subtasks, written together, read together,
 * versioned together under one ETag (§3, decision 1).
 */

export function createTaskDocument(
  input: {
    title: string;
    date?: string;
    comments?: string;
    listId?: string | null;
    /**
     * Sort position among the other main tasks. The caller passes
     * `nextOrder(existing)` so a new task lands at the end with a value of its
     * own; without it every task would share `ORDER_STEP` and the first drag
     * would have to renumber the lot (ADR-0034).
     */
    order?: number;
  },
  ctx: MutationContext,
): TaskDocument {
  const root = createTaskNode(
    {
      title: input.title,
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.comments !== undefined ? { comments: input.comments } : {}),
      order: input.order ?? ORDER_STEP,
    },
    0,
    ctx,
  );

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: root.id,
    listId: input.listId ?? null,
    root,
    deletedAt: null,
  };
}

/**
 * Project an aggregate down to what the list view shows.
 *
 * The counts here are computed from `children` every time. They are never
 * stored in the document — only the blob metadata cache holds a denormalised
 * copy, and that cache is explicitly disposable (§4 "Rollup rule").
 */
export function toTaskSummary(document: TaskDocument, etag?: string): TaskSummary {
  const { root } = document;
  const { total, done } = countChildren(root);

  return {
    id: document.id,
    listId: document.listId,
    title: root.title,
    commentsPreview: root.comments.slice(0, COMMENTS_PREVIEW_LENGTH),
    date: root.date,
    isComplete: isTaskComplete(root),
    percent: getPercent(root) ?? (isTaskComplete(root) ? 100 : 0),
    completedDate: root.completedDate,
    childCount: total,
    childDoneCount: done,
    attachmentCount: totalAttachmentCount(root),
    updatedAt: root.updatedAt,
    order: root.order,
    ...(etag !== undefined ? { etag } : {}),
  };
}

export function isDeleted(document: TaskDocument): boolean {
  return document.deletedAt !== null;
}

/** Soft delete (§5). v1 never hard-deletes on a user action. */
export function softDeleteDocument(document: TaskDocument, ctx: MutationContext): TaskDocument {
  return { ...document, deletedAt: ctx.now };
}

export function restoreDocument(document: TaskDocument): TaskDocument {
  return { ...document, deletedAt: null };
}

/** Move a task to a different user-defined list, or to none. */
export function setDocumentList(
  document: TaskDocument,
  listId: string | null,
  ctx: MutationContext,
): TaskDocument {
  return {
    ...document,
    listId,
    root: { ...document.root, updatedAt: ctx.now, updatedBy: ctx.actor },
  };
}

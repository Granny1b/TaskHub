import type { MutationContext } from './context.js';
import { DomainError, notFound } from './errors.js';
import { newTaskListId } from './ids.js';
import { nextOrder, reorderSiblings, sortByOrder } from './ordering.js';
import {
  CURRENT_SCHEMA_VERSION,
  taskListsDocumentSchema,
  type TaskList,
  type TaskListsDocument,
} from './schemas.js';

/**
 * User-definable lists — the grouping level above a main task.
 *
 * The user creates as many as they like and names them whatever they like
 * ("Maskin 7", "Kundprojekt Volvo", "Att göra"), and they drive the left panel.
 *
 * All lists live in **one** blob, unlike tasks which get one blob each. The
 * reasoning is the same reasoning that put subtasks inside their parent: they
 * are read together, reordered together, and versioned together. Reordering
 * lists across separate blobs would need exactly the cross-blob transaction
 * that §3 rejected for subtasks. Writes here are rare — creating or renaming a
 * list, not saving a task — so the single-blob write hotspot that ruled out a
 * shared task index does not apply. See docs/DECISIONS.md ADR-0004.
 */

export function createTaskListsDocument(): TaskListsDocument {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, lists: [] };
}

/** Lists in display order, excluding soft-deleted ones. */
export function activeLists(document: TaskListsDocument): TaskList[] {
  return sortByOrder(document.lists.filter((list) => list.deletedAt === null));
}

export function findList(document: TaskListsDocument, id: string): TaskList | null {
  return document.lists.find((list) => list.id === id) ?? null;
}

export function createTaskList(
  document: TaskListsDocument,
  input: { name: string; colorToken?: string | null },
  ctx: MutationContext,
): { document: TaskListsDocument; list: TaskList } {
  const list: TaskList = {
    id: newTaskListId(),
    name: input.name.trim(),
    order: nextOrder(activeLists(document)),
    colorToken: input.colorToken ?? null,
    createdAt: ctx.now,
    createdBy: ctx.actor,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
    deletedAt: null,
  };

  return { document: { ...document, lists: [...document.lists, list] }, list };
}

export function renameTaskList(
  document: TaskListsDocument,
  id: string,
  name: string,
  ctx: MutationContext,
): TaskListsDocument {
  return updateList(document, id, (list) => ({
    ...list,
    name: name.trim(),
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  }));
}

export function setTaskListColor(
  document: TaskListsDocument,
  id: string,
  colorToken: string | null,
  ctx: MutationContext,
): TaskListsDocument {
  return updateList(document, id, (list) => ({
    ...list,
    colorToken,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  }));
}

/**
 * Soft delete, consistent with tasks (§5).
 *
 * Tasks that referenced this list keep their `listId`. They surface as
 * ungrouped because the list no longer resolves, and restoring the list
 * restores them to it — which is the forgiving behaviour for an action a user
 * can take by accident.
 */
export function softDeleteTaskList(
  document: TaskListsDocument,
  id: string,
  ctx: MutationContext,
): TaskListsDocument {
  return updateList(document, id, (list) => ({
    ...list,
    deletedAt: ctx.now,
    updatedBy: ctx.actor,
  }));
}

export function restoreTaskList(
  document: TaskListsDocument,
  id: string,
  ctx: MutationContext,
): TaskListsDocument {
  return updateList(document, id, (list) => ({
    ...list,
    deletedAt: null,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  }));
}

export function reorderTaskLists(
  document: TaskListsDocument,
  movedId: string,
  toIndex: number,
  _ctx: MutationContext,
): TaskListsDocument {
  const active = activeLists(document);
  if (!active.some((list) => list.id === movedId)) {
    throw notFound(`No list with id ${movedId}`, { listId: movedId });
  }

  const { items } = reorderSiblings(active, movedId, toIndex);
  const reordered = new Map(items.map((list) => [list.id, list.order]));

  return {
    ...document,
    lists: document.lists.map((list) => {
      const order = reordered.get(list.id);
      return order === undefined ? list : { ...list, order };
    }),
  };
}

/** Read path for the lists blob: validate, and treat an absent blob as empty. */
export function parseTaskListsDocument(raw: unknown): TaskListsDocument {
  const parsed = taskListsDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError('validation_failed', 'Task lists document failed validation', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function updateList(
  document: TaskListsDocument,
  id: string,
  updater: (list: TaskList) => TaskList,
): TaskListsDocument {
  let found = false;
  const lists = document.lists.map((list) => {
    if (list.id !== id) return list;
    found = true;
    return updater(list);
  });

  if (!found) {
    throw notFound(`No list with id ${id}`, { listId: id });
  }
  return { ...document, lists };
}

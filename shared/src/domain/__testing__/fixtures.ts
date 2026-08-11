import { completionKindForDepth } from '../../config/completionPolicy.js';
import { createCompletion } from '../completion.js';
import type { MutationContext } from '../context.js';
import { newTaskId } from '../ids.js';
import { ORDER_STEP } from '../ordering.js';
import { CURRENT_SCHEMA_VERSION, type TaskDocument, type TaskNode } from '../schemas.js';

/**
 * Test fixtures.
 *
 * Excluded from the build (see tsconfig `exclude`) so nothing here can be
 * imported by production code by accident.
 */

export const TEST_ACTOR = 'test-user-object-id';

/** A frozen context, so completedDate assertions are exact rather than "today-ish". */
export function ctx(overrides: Partial<MutationContext> = {}): MutationContext {
  return {
    actor: TEST_ACTOR,
    now: '2026-08-11T09:30:00.000Z',
    today: '2026-08-11',
    ...overrides,
  };
}

export function node(overrides: Partial<TaskNode> = {}, depth = 0): TaskNode {
  const context = ctx();
  return {
    id: newTaskId(),
    title: 'Uppgift',
    date: context.today,
    comments: '',
    completion: createCompletion(completionKindForDepth(depth)),
    completedDate: null,
    order: ORDER_STEP,
    attachments: [],
    children: [],
    createdAt: context.now,
    createdBy: context.actor,
    updatedAt: context.now,
    updatedBy: context.actor,
    custom: {},
    ...overrides,
  };
}

/** A main task (depth 0, percent completion). */
export function mainTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return node(overrides, 0);
}

/** A subtask (depth 1, checkbox completion). */
export function subtask(overrides: Partial<TaskNode> = {}): TaskNode {
  return node(overrides, 1);
}

/** A main task with `count` subtasks, the first `doneCount` of them complete. */
export function taskWithChildren(count: number, doneCount = 0): TaskNode {
  const children = Array.from({ length: count }, (_, index) =>
    subtask({
      title: `Deluppgift ${index + 1}`,
      order: (index + 1) * ORDER_STEP,
      completion: { kind: 'checkbox', isComplete: index < doneCount },
      completedDate: index < doneCount ? '2026-08-11' : null,
    }),
  );
  return mainTask({ children });
}

export function document(root: TaskNode = mainTask(), listId: string | null = null): TaskDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: root.id,
    listId,
    root,
    deletedAt: null,
  };
}

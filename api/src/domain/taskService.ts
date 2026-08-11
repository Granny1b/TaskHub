import {
  DomainError,
  EventBus,
  addChild,
  createTaskDocument,
  findNode,
  indexAfter,
  isTaskComplete,
  nextOrder,
  removeNode,
  reorderChildren,
  reorderSiblings,
  setComplete,
  setCompletedDate,
  setDocumentList,
  setPercent,
  setPercentToAuto,
  softDeleteDocument,
  updateNode,
  type DomainEvent,
  type MutationContext,
  type TaskDocument,
  type TaskNode,
  type TaskSummary,
} from '@taskhub/shared';
import type { ETagged, ITaskRepository, ListTasksFilter } from '../repositories/ITaskRepository.js';
import type {
  AddChildRequest,
  CreateTaskRequest,
  PatchNodeRequest,
  PatchTaskRequest,
  ReorderRequest,
  ReorderTasksRequest,
} from './requests.js';

/**
 * Business orchestration.
 *
 * Handlers do not contain business logic; they authenticate, validate, call
 * one of these, and map errors. Everything here composes pure domain functions
 * with the repository and emits the events that Phase 2+ features subscribe to.
 *
 * No Azure SDK import appears in this file or anywhere else under
 * `api/src/domain/` — enforced by ESLint (ADR-0003).
 */
export class TaskService {
  constructor(
    private readonly repository: ITaskRepository,
    private readonly events: EventBus = new EventBus(),
  ) {}

  private publish(event: DomainEvent): void {
    this.events.publish(event);
  }

  async list(filter: ListTasksFilter): Promise<TaskSummary[]> {
    return this.repository.list(filter);
  }

  /** Throws `not_found` for a missing or soft-deleted task. */
  async get(id: string, includeDeleted = false): Promise<ETagged<TaskDocument>> {
    const entry = await this.repository.get(id);
    if (entry === null) {
      throw new DomainError('not_found', `Task ${id} does not exist`, { taskId: id });
    }
    if (entry.document.deletedAt !== null && !includeDeleted) {
      throw new DomainError('not_found', `Task ${id} has been deleted`, { taskId: id });
    }
    return entry;
  }

  async create(input: CreateTaskRequest, ctx: MutationContext): Promise<ETagged<TaskDocument>> {
    /*
      One extra listing per create, to place the task at the end of the manual
      order with a value of its own.

      The alternative — every task created with the same `ORDER_STEP` — is
      cheaper by one request and worse in practice: the first drag on such a
      list finds no gap anywhere and has to renumber every task in one go
      (ADR-0034). The listing is already the cheapest call in the API and a
      create is not a hot path.

      Two creates racing get the same order. That is harmless: they tie, and the
      id tie-break puts the older one first.
    */
    const existing = await this.repository.list({});

    const document = createTaskDocument(
      {
        title: input.title,
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.comments !== undefined ? { comments: input.comments } : {}),
        listId: input.listId ?? null,
        order: nextOrder(existing),
      },
      ctx,
    );

    const saved = await this.repository.create(document);
    this.publish({ type: 'TaskCreated', at: ctx.now, actor: ctx.actor, taskId: saved.document.id });
    return saved;
  }

  /** Replace the whole aggregate. The caller must have sent a full document. */
  async replace(
    document: TaskDocument,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const saved = await this.repository.replace(document, ifMatch);
    this.publish({ type: 'TaskUpdated', at: ctx.now, actor: ctx.actor, taskId: document.id });
    return saved;
  }

  async patch(
    id: string,
    patch: PatchTaskRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const current = await this.get(id);
    let document = current.document;

    if (patch.node !== undefined) {
      document = {
        ...document,
        root: applyNodePatch(document.root, document.root.id, patch.node, ctx),
      };
    }

    if (patch.listId !== undefined) {
      document = setDocumentList(document, patch.listId, ctx);
    }

    const saved = await this.repository.replace(document, ifMatch);
    this.publishCompletionChange(current.document.root, saved.document.root, ctx, id, null);
    this.publish({ type: 'TaskUpdated', at: ctx.now, actor: ctx.actor, taskId: id });
    return saved;
  }

  /** Soft delete. v1 never hard-deletes on a user action (§5). */
  async softDelete(
    id: string,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const current = await this.get(id);
    const saved = await this.repository.replace(softDeleteDocument(current.document, ctx), ifMatch);
    this.publish({ type: 'TaskDeleted', at: ctx.now, actor: ctx.actor, taskId: id });
    return saved;
  }

  /* ------------------------------------------------------------------ */
  /* Children                                                            */
  /* ------------------------------------------------------------------ */

  async addChild(
    id: string,
    input: AddChildRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<{ saved: ETagged<TaskDocument>; child: TaskNode }> {
    const current = await this.get(id);
    const parentId = input.parentId ?? current.document.root.id;

    const { root, child } = addChild(
      current.document.root,
      parentId,
      {
        title: input.title,
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.comments !== undefined ? { comments: input.comments } : {}),
      },
      ctx,
    );

    const saved = await this.repository.replace({ ...current.document, root }, ifMatch);
    this.publish({
      type: 'SubtaskAdded',
      at: ctx.now,
      actor: ctx.actor,
      taskId: id,
      childId: child.id,
    });
    return { saved, child };
  }

  async patchChild(
    id: string,
    childId: string,
    patch: PatchNodeRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const current = await this.get(id);

    if (childId === current.document.root.id) {
      throw new DomainError(
        'invalid_operation',
        'Use PATCH /api/tasks/{id} to change the main task',
        { taskId: id },
      );
    }

    const root = applyNodePatch(current.document.root, childId, patch, ctx);
    const saved = await this.repository.replace({ ...current.document, root }, ifMatch);

    const before = findNode(current.document.root, childId);
    const after = findNode(saved.document.root, childId);
    if (before !== null && after !== null) {
      this.publishCompletionChange(before.node, after.node, ctx, id, childId);
    }
    this.publish({
      type: 'SubtaskUpdated',
      at: ctx.now,
      actor: ctx.actor,
      taskId: id,
      childId,
    });
    return saved;
  }

  async removeChild(
    id: string,
    childId: string,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const current = await this.get(id);
    const root = removeNode(current.document.root, childId, ctx);

    const saved = await this.repository.replace({ ...current.document, root }, ifMatch);
    this.publish({
      type: 'SubtaskRemoved',
      at: ctx.now,
      actor: ctx.actor,
      taskId: id,
      childId,
    });
    return saved;
  }

  async reorder(
    id: string,
    input: ReorderRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const current = await this.get(id);
    const parentId = input.parentId ?? current.document.root.id;

    const root = reorderChildren(
      current.document.root,
      parentId,
      input.movedId,
      input.toIndex,
      ctx,
    );
    const saved = await this.repository.replace({ ...current.document, root }, ifMatch);

    this.publish({
      type: 'ChildrenReordered',
      at: ctx.now,
      actor: ctx.actor,
      taskId: id,
      parentId,
    });
    return saved;
  }

  /* ------------------------------------------------------------------ */
  /* Manual order of main tasks                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Move a main task in the manual order, placing it after `afterId`
   * (`null` = first).
   *
   * Normally one blob write: the moved task gets an order value between its new
   * neighbours and nothing else is touched. See ADR-0034 for why this is not
   * simply `reorderChildren` — main tasks are separate blobs, so there is no
   * single ETag covering the sequence and no way to renumber them atomically.
   *
   * `renumbered` in the result is the number of *other* tasks rewritten. It is
   * 0 for essentially every real move, and non-zero only when the float gap
   * between two neighbours closed and the list had to be renumbered.
   */
  async reorderTasks(
    input: ReorderTasksRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<{ saved: ETagged<TaskDocument>; renumbered: number }> {
    if (input.afterId === input.movedId) {
      throw new DomainError('invalid_operation', 'A task cannot be placed after itself', {
        taskId: input.movedId,
      });
    }

    // The full order, not the caller's filtered view: a search or an open-only
    // filter hides tasks that still have to keep their place in the sequence.
    const all = await this.repository.list({});
    if (!all.some((summary) => summary.id === input.movedId)) {
      throw new DomainError('not_found', `Task ${input.movedId} does not exist`, {
        taskId: input.movedId,
      });
    }

    const toIndex = indexAfter(all, input.movedId, input.afterId);
    const { items, renormalised } = reorderSiblings(all, input.movedId, toIndex);

    const moved = items.find((item) => item.id === input.movedId);
    /* c8 ignore next -- reorderSiblings returns every input item; guard for the type. */
    if (moved === undefined) throw new DomainError('not_found', 'Task vanished mid-reorder');

    /*
      The moved task goes first, and with the caller's If-Match.

      Doing it in this order means a stale client is rejected before anything
      else has been rewritten — the user's own edit is the one that has to be
      guarded, and a 409 here leaves the list exactly as it was.
    */
    const saved = await this.writeOrder(input.movedId, moved.order, ifMatch, ctx, true);

    let renumbered = 0;
    if (renormalised) {
      renumbered = await this.renumberOthers(items, input.movedId, ctx);
    }

    this.publish({
      type: 'TasksReordered',
      at: ctx.now,
      actor: ctx.actor,
      taskId: input.movedId,
      renumbered,
    });
    return { saved, renumbered };
  }

  /**
   * Rewrite the order of every task except the moved one, after the float gap
   * ran out.
   *
   * Deliberately best effort. There is no transaction across blobs, so each task
   * is read and conditionally written on its own ETag; one that loses a race
   * with a concurrent edit is left alone rather than clobbered. Order values are
   * self-healing — the next move renumbers again from whatever is there — so a
   * partial pass costs a little sort precision, never a user's words.
   *
   * The count of tasks actually rewritten is returned so the caller can report
   * it rather than pretend the pass was complete.
   */
  private async renumberOthers(
    items: readonly TaskSummary[],
    movedId: string,
    ctx: MutationContext,
  ): Promise<number> {
    let renumbered = 0;

    for (const item of items) {
      if (item.id === movedId) continue;

      const current = await this.repository.get(item.id);
      if (current === null) continue;
      if (current.document.root.order === item.order) continue;

      try {
        // Not stamped as updated: a renumber is a change of representation, not
        // of the task. Stamping would show every task as edited by whoever
        // happened to drag one row.
        await this.writeOrder(item.id, item.order, current.etag, ctx, false, current);
        renumbered += 1;
      } catch (error) {
        if (error instanceof DomainError && error.code === 'concurrency_conflict') continue;
        throw error;
      }
    }

    return renumbered;
  }

  private async writeOrder(
    id: string,
    order: number,
    ifMatch: string,
    ctx: MutationContext,
    stamp: boolean,
    known?: ETagged<TaskDocument>,
  ): Promise<ETagged<TaskDocument>> {
    const current = known ?? (await this.get(id));
    const root = {
      ...current.document.root,
      order,
      ...(stamp ? { updatedAt: ctx.now, updatedBy: ctx.actor } : {}),
    };
    return this.repository.replace({ ...current.document, root }, ifMatch);
  }

  /**
   * Emit the completion events an audit log will want, by comparing before and
   * after rather than by trusting the request's intent. A patch that sets
   * `isComplete: true` on an already-complete task is not a completion.
   */
  private publishCompletionChange(
    before: TaskNode,
    after: TaskNode,
    ctx: MutationContext,
    taskId: string,
    childId: string | null,
  ): void {
    const wasComplete = isTaskComplete(before);
    const nowComplete = isTaskComplete(after);
    if (wasComplete === nowComplete) return;

    if (childId === null) {
      if (nowComplete) {
        const percent = after.completion.kind === 'percent' ? after.completion.percent : 100;
        this.publish({
          type: 'TaskCompleted',
          at: ctx.now,
          actor: ctx.actor,
          taskId,
          percentAtCompletion: percent,
        });
      } else {
        this.publish({ type: 'TaskReopened', at: ctx.now, actor: ctx.actor, taskId });
      }
      return;
    }

    this.publish({
      type: nowComplete ? 'SubtaskCompleted' : 'SubtaskReopened',
      at: ctx.now,
      actor: ctx.actor,
      taskId,
      childId,
    });
  }
}

/**
 * Apply a field patch to one node.
 *
 * Order matters here and is not arbitrary. `percent` is applied before
 * `isComplete` so that a client sending both ends up with the percent it asked
 * for *and* the completion it asked for — applying completion first would let
 * the percent write clobber `percentSource`. `completedDate` is applied last so
 * an explicit date always wins over the automatic stamp, honouring the rule
 * that a user's manual correction is never overwritten.
 */
function applyNodePatch(
  root: TaskNode,
  nodeId: string,
  patch: PatchNodeRequest,
  ctx: MutationContext,
): TaskNode {
  return updateNode(
    root,
    nodeId,
    (node) => {
      let next = node;

      if (patch.title !== undefined) next = { ...next, title: patch.title };
      if (patch.date !== undefined) next = { ...next, date: patch.date };
      if (patch.comments !== undefined) next = { ...next, comments: patch.comments };
      if (patch.custom !== undefined) next = { ...next, custom: patch.custom };

      if (patch.percent !== undefined) next = setPercent(next, patch.percent, ctx);

      // 'derived' is the "back to auto" affordance and recomputes immediately.
      // 'manual' needs no action: setPercent already moved it there, and asking
      // for manual without a value should not disturb a derived value.
      if (patch.percentSource === 'derived') next = setPercentToAuto(next, ctx);

      if (patch.isComplete !== undefined) next = setComplete(next, patch.isComplete, ctx);
      if (patch.completedDate !== undefined) {
        next = setCompletedDate(next, patch.completedDate, ctx);
      }

      return { ...next, updatedAt: ctx.now, updatedBy: ctx.actor };
    },
    ctx,
  );
}

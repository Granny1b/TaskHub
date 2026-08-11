import {
  DomainError,
  EventBus,
  activeLists,
  createTaskList,
  renameTaskList,
  reorderTaskLists,
  setTaskListColor,
  softDeleteTaskList,
  type DomainEvent,
  type MutationContext,
  type TaskList,
  type TaskListsDocument,
} from '@taskhub/shared';
import type { ETagged, ITaskListRepository } from '../repositories/ITaskRepository.js';
import type { CreateListRequest, PatchListRequest } from './requests.js';

/**
 * The user-definable lists that drive the left panel.
 *
 * All lists share one blob and therefore one ETag (ADR-0004), so every mutation
 * here is a read-modify-write against that single document. Concurrent renames
 * produce a 409, which is correct and rare.
 */
export class ListService {
  constructor(
    private readonly repository: ITaskListRepository,
    private readonly events: EventBus = new EventBus(),
  ) {}

  private publish(event: DomainEvent): void {
    this.events.publish(event);
  }

  /** Active lists in display order, with the ETag for subsequent mutations. */
  async list(): Promise<{ lists: TaskList[]; etag: string }> {
    const { document, etag } = await this.repository.get();
    return { lists: activeLists(document), etag };
  }

  async create(
    input: CreateListRequest,
    ifMatch: string | null,
    ctx: MutationContext,
  ): Promise<{ list: TaskList; etag: string }> {
    const current = await this.load(ifMatch);

    const { document, list } = createTaskList(
      current.document,
      {
        name: input.name,
        ...(input.colorToken !== undefined ? { colorToken: input.colorToken } : {}),
      },
      ctx,
    );

    const saved = await this.repository.save(
      document,
      current.etag.length === 0 ? null : current.etag,
    );
    this.publish({ type: 'TaskListCreated', at: ctx.now, actor: ctx.actor, listId: list.id });
    return { list, etag: saved.etag };
  }

  async patch(
    id: string,
    patch: PatchListRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<{ document: TaskListsDocument; etag: string }> {
    const current = await this.repository.get();
    let document = current.document;

    if (patch.name !== undefined) document = renameTaskList(document, id, patch.name, ctx);
    if (patch.colorToken !== undefined) {
      document = setTaskListColor(document, id, patch.colorToken, ctx);
    }

    const saved = await this.repository.save(document, ifMatch);
    this.publish({ type: 'TaskListRenamed', at: ctx.now, actor: ctx.actor, listId: id });
    return saved;
  }

  /**
   * Soft delete. Tasks keep their `listId` and surface as ungrouped, so
   * restoring the list restores their grouping — the forgiving behaviour for
   * an action someone can take by accident.
   */
  async softDelete(id: string, ifMatch: string, ctx: MutationContext): Promise<{ etag: string }> {
    const current = await this.repository.get();
    const saved = await this.repository.save(
      softDeleteTaskList(current.document, id, ctx),
      ifMatch,
    );
    this.publish({ type: 'TaskListDeleted', at: ctx.now, actor: ctx.actor, listId: id });
    return saved;
  }

  async reorder(
    movedId: string,
    toIndex: number,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<{ lists: TaskList[]; etag: string }> {
    const current = await this.repository.get();
    const document = reorderTaskLists(current.document, movedId, toIndex, ctx);

    const saved = await this.repository.save(document, ifMatch);
    this.publish({ type: 'TaskListsReordered', at: ctx.now, actor: ctx.actor });
    return { lists: activeLists(saved.document), etag: saved.etag };
  }

  /**
   * Creating the first list has no prior ETag, because the blob does not exist
   * yet. Accept that case rather than making the client discover it.
   */
  private async load(ifMatch: string | null): Promise<ETagged<TaskListsDocument>> {
    const current = await this.repository.get();
    if (ifMatch !== null && ifMatch.length > 0 && current.etag !== ifMatch) {
      throw new DomainError('concurrency_conflict', 'Task lists were modified by someone else');
    }
    return current;
  }
}

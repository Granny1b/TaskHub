import {
  DomainError,
  createTaskListsDocument,
  isDeleted,
  toTaskSummary,
  type TaskDocument,
  type TaskListsDocument,
  type TaskSummary,
} from '@taskhub/shared';
import type {
  ETagged,
  ITaskListRepository,
  ITaskRepository,
  ListTasksFilter,
} from './ITaskRepository.js';

/**
 * In-memory implementation, used by unit tests and by local development without
 * Azurite running.
 *
 * It is not a stub: it models ETag concurrency with the same semantics as the
 * blob implementation, because tests that do not exercise conflict handling are
 * tests that will not catch the bug this whole design exists to prevent.
 */
export class InMemoryTaskRepository implements ITaskRepository {
  private readonly documents = new Map<string, { document: TaskDocument; etag: string }>();
  private etagCounter = 0;

  private nextETag(): string {
    this.etagCounter += 1;
    return `"mem-${this.etagCounter}"`;
  }

  async list(filter: ListTasksFilter = {}): Promise<TaskSummary[]> {
    const summaries: TaskSummary[] = [];

    for (const entry of this.documents.values()) {
      const { document } = entry;

      if (isDeleted(document) && filter.includeDeleted !== true) continue;
      if (filter.listId !== undefined && document.listId !== filter.listId) continue;

      const summary = toTaskSummary(document, entry.etag);

      if (filter.isComplete !== undefined && summary.isComplete !== filter.isComplete) continue;
      if (
        filter.q !== undefined &&
        filter.q.length > 0 &&
        !summary.title.toLowerCase().includes(filter.q.toLowerCase())
      ) {
        continue;
      }

      summaries.push(summary);
    }

    // ULIDs sort by creation time, so this is newest-last without a sort key.
    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<ETagged<TaskDocument> | null> {
    const entry = this.documents.get(id);
    if (entry === undefined) return null;
    return { document: structuredClone(entry.document), etag: entry.etag };
  }

  async create(document: TaskDocument): Promise<ETagged<TaskDocument>> {
    if (this.documents.has(document.id)) {
      throw new DomainError('concurrency_conflict', `Task ${document.id} already exists`, {
        taskId: document.id,
      });
    }
    const etag = this.nextETag();
    this.documents.set(document.id, { document: structuredClone(document), etag });
    return { document: structuredClone(document), etag };
  }

  async replace(document: TaskDocument, ifMatch: string): Promise<ETagged<TaskDocument>> {
    const entry = this.documents.get(document.id);
    if (entry === undefined) {
      throw new DomainError('not_found', `Task ${document.id} does not exist`, {
        taskId: document.id,
      });
    }
    if (entry.etag !== ifMatch) {
      throw new DomainError(
        'concurrency_conflict',
        `Task ${document.id} was modified by someone else`,
        { taskId: document.id, expected: ifMatch, actual: entry.etag },
      );
    }

    const etag = this.nextETag();
    this.documents.set(document.id, { document: structuredClone(document), etag });
    return { document: structuredClone(document), etag };
  }

  async purge(id: string): Promise<void> {
    this.documents.delete(id);
  }

  /** Test helper. Not part of the interface. */
  get size(): number {
    return this.documents.size;
  }
}

export class InMemoryTaskListRepository implements ITaskListRepository {
  private entry: { document: TaskListsDocument; etag: string } | null = null;
  private etagCounter = 0;

  private nextETag(): string {
    this.etagCounter += 1;
    return `"mem-lists-${this.etagCounter}"`;
  }

  async get(): Promise<ETagged<TaskListsDocument>> {
    if (this.entry === null) {
      // An absent blob is an empty set of lists, not an error. The caller then
      // saves with ifMatch === null to create it.
      return { document: createTaskListsDocument(), etag: '' };
    }
    return { document: structuredClone(this.entry.document), etag: this.entry.etag };
  }

  async save(
    document: TaskListsDocument,
    ifMatch: string | null,
  ): Promise<ETagged<TaskListsDocument>> {
    const isCreate = ifMatch === null || ifMatch === '';

    if (isCreate && this.entry !== null) {
      throw new DomainError('concurrency_conflict', 'Task lists document already exists');
    }
    if (!isCreate) {
      if (this.entry === null) {
        throw new DomainError('not_found', 'Task lists document does not exist');
      }
      if (this.entry.etag !== ifMatch) {
        throw new DomainError('concurrency_conflict', 'Task lists were modified by someone else', {
          expected: ifMatch,
          actual: this.entry.etag,
        });
      }
    }

    const etag = this.nextETag();
    this.entry = { document: structuredClone(document), etag };
    return { document: structuredClone(document), etag };
  }
}

import type { TaskDocument, TaskListsDocument, TaskSummary } from '@taskhub/shared';

/**
 * The database-migration seam (§3, decision 3) — the single most important
 * interface in the codebase.
 *
 * Nothing above this line knows that storage is Blob Storage. When a real
 * database arrives, `SqlTaskRepository` implements this and one line of DI
 * wiring changes. Handlers and domain code are untouched.
 *
 * ESLint enforces the other half of the bargain: `api/src/domain/` and
 * `api/src/functions/` cannot import `@azure/*` at all.
 */

/** A document together with the concurrency token that guards it. */
export interface ETagged<T> {
  readonly document: T;
  /** Opaque to callers. Comes back from storage; goes out as an HTTP ETag. */
  readonly etag: string;
}

export interface ListTasksFilter {
  /** Filter to one user-defined list. `null` means ungrouped tasks only. */
  readonly listId?: string | null;
  readonly isComplete?: boolean;
  /** Soft-deleted tasks are excluded unless this is true. */
  readonly includeDeleted?: boolean;
  /** Free-text match against the title. Case-insensitive, client-side scope. */
  readonly q?: string;
}

/**
 * Storage for task aggregates.
 *
 * Every mutating method takes an ETag and is expected to fail rather than
 * overwrite. That is not an implementation detail — two people editing subtasks
 * on the same task is the expected case, so "last write wins" is a correctness
 * bug, not a simplification (§7).
 */
export interface ITaskRepository {
  /**
   * Summaries for the list view.
   *
   * Implementations must satisfy this from denormalised metadata where they
   * can, without opening each document — see the SCALE note in metadata.ts.
   */
  list(filter?: ListTasksFilter): Promise<TaskSummary[]>;

  /** Null when the task does not exist. Callers map that to 404. */
  get(id: string): Promise<ETagged<TaskDocument> | null>;

  /** Fails with `concurrency_conflict` if a task with this id already exists. */
  create(document: TaskDocument): Promise<ETagged<TaskDocument>>;

  /**
   * Conditional replace. Throws `DomainError('concurrency_conflict')` when the
   * stored ETag has moved on — never a silent overwrite.
   */
  replace(document: TaskDocument, ifMatch: string): Promise<ETagged<TaskDocument>>;

  /**
   * Hard removal. Not reachable from any v1 user action — soft delete is a
   * normal `replace` with `deletedAt` set. This exists for the Phase-2
   * scheduled cleanup job and for test teardown.
   */
  purge(id: string): Promise<void>;
}

/**
 * Storage for the user-definable lists.
 *
 * A single aggregate, so it gets a single ETag. Same concurrency contract.
 */
export interface ITaskListRepository {
  /** Returns an empty document (not null) when nothing has been created yet. */
  get(): Promise<ETagged<TaskListsDocument>>;

  /** Pass an empty `ifMatch` to create the blob for the first time. */
  save(document: TaskListsDocument, ifMatch: string | null): Promise<ETagged<TaskListsDocument>>;
}

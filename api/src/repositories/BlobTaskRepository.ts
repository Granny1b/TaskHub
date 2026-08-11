import type { ContainerClient } from '@azure/storage-blob';
import { RestError } from '@azure/storage-blob';
import {
  DomainError,
  TASK_TAG_KEYS,
  fromBlobMetadata,
  migrate,
  toBlobMetadata,
  toBlobTags,
  toTaskSummary,
  type TaskDocument,
  type TaskSummary,
} from '@taskhub/shared';
import type { ETagged, ITaskRepository, ListTasksFilter } from './ITaskRepository.js';

/**
 * Blob-backed task storage: one blob per main task, containing its subtasks.
 *
 * This file and its siblings in this directory are the only place in the API
 * that knows Azure Blob Storage exists.
 */
export class BlobTaskRepository implements ITaskRepository {
  constructor(private readonly container: ContainerClient) {}

  private blobName(id: string): string {
    return `${id}.json`;
  }

  /**
   * The list view, served from blob metadata returned inline by the listing —
   * no per-task blob reads (§3, decision 2).
   *
   * // SCALE: fine to roughly 1,000 tasks. Past that the listing itself becomes
   * // the cost, and the swap is a projection blob rebuilt by a queue-triggered
   * // function. Only this method changes.
   */
  async list(filter: ListTasksFilter = {}): Promise<TaskSummary[]> {
    const summaries: TaskSummary[] = [];

    for await (const blob of this.container.listBlobsFlat({
      includeMetadata: true,
      includeTags: true,
    })) {
      if (!blob.name.endsWith('.json')) continue;

      const id = blob.name.slice(0, -'.json'.length);
      const tags = blob.tags ?? {};

      // Soft-deleted tasks are filtered from the tag, so a deleted task costs
      // nothing to skip.
      const isSoftDeleted = tags[TASK_TAG_KEYS.deleted] === 'true';
      if (isSoftDeleted && filter.includeDeleted !== true) continue;

      const etag = typeof blob.properties.etag === 'string' ? blob.properties.etag : undefined;
      const summary = fromBlobMetadata(id, blob.metadata, etag);

      // Metadata missing or unreadable — fall back to opening the document
      // rather than dropping the task out of the user's list entirely.
      const resolved = summary ?? (await this.summaryFromDocument(id));
      if (resolved === null) continue;

      if (filter.listId !== undefined && resolved.listId !== filter.listId) continue;
      if (filter.isComplete !== undefined && resolved.isComplete !== filter.isComplete) continue;
      if (
        filter.q !== undefined &&
        filter.q.length > 0 &&
        !resolved.title.toLowerCase().includes(filter.q.toLowerCase())
      ) {
        continue;
      }

      summaries.push(resolved);
    }

    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<ETagged<TaskDocument> | null> {
    const blob = this.container.getBlockBlobClient(this.blobName(id));

    try {
      const buffer = await blob.downloadToBuffer();
      const raw: unknown = JSON.parse(buffer.toString('utf8'));
      const document = migrate(raw);
      const properties = await blob.getProperties();
      return { document, etag: properties.etag ?? '' };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async create(document: TaskDocument): Promise<ETagged<TaskDocument>> {
    try {
      // ifNoneMatch '*' makes creation itself conditional: a second create for
      // the same id fails rather than silently replacing the first.
      const result = await this.upload(document, { ifNoneMatch: '*' });
      return { document, etag: result };
    } catch (error) {
      if (isPreconditionFailed(error) || isConflict(error)) {
        throw new DomainError('concurrency_conflict', `Task ${document.id} already exists`, {
          taskId: document.id,
        });
      }
      throw error;
    }
  }

  async replace(document: TaskDocument, ifMatch: string): Promise<ETagged<TaskDocument>> {
    if (ifMatch.length === 0) {
      throw new DomainError(
        'precondition_required',
        'A conditional write requires an If-Match ETag',
        { taskId: document.id },
      );
    }

    try {
      const etag = await this.upload(document, { ifMatch });
      return { document, etag };
    } catch (error) {
      // Azure answers a failed conditional write with 412. The client needs to
      // tell "someone else edited this" apart from every other failure, so it
      // becomes a 409 with a specific problem type (§6, §7).
      if (isPreconditionFailed(error)) {
        throw new DomainError(
          'concurrency_conflict',
          `Task ${document.id} was modified by someone else`,
          { taskId: document.id },
        );
      }
      if (isNotFound(error)) {
        throw new DomainError('not_found', `Task ${document.id} does not exist`, {
          taskId: document.id,
        });
      }
      throw error;
    }
  }

  async purge(id: string): Promise<void> {
    const blob = this.container.getBlockBlobClient(this.blobName(id));
    await blob.deleteIfExists();
  }

  private async upload(
    document: TaskDocument,
    conditions: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<string> {
    const body = JSON.stringify(document);
    const blob = this.container.getBlockBlobClient(this.blobName(document.id));

    const response = await blob.upload(body, Buffer.byteLength(body, 'utf8'), {
      blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
      metadata: toBlobMetadata(document),
      tags: toBlobTags(document),
      conditions,
    });

    return response.etag ?? '';
  }

  private async summaryFromDocument(id: string): Promise<TaskSummary | null> {
    const entry = await this.get(id);
    if (entry === null) return null;
    return toTaskSummary(entry.document, entry.etag);
  }
}

function statusOf(error: unknown): number | null {
  if (error instanceof RestError && typeof error.statusCode === 'number') return error.statusCode;
  return null;
}

function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  return statusOf(error) === 412;
}

function isConflict(error: unknown): boolean {
  return statusOf(error) === 409;
}

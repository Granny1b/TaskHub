import type { ContainerClient } from '@azure/storage-blob';
import { RestError } from '@azure/storage-blob';
import {
  DomainError,
  createTaskListsDocument,
  parseTaskListsDocument,
  type TaskListsDocument,
} from '@taskhub/shared';
import type { ETagged, ITaskListRepository } from './ITaskRepository.js';

/** All user-defined lists live in this one blob. See ADR-0004. */
export const LISTS_BLOB_NAME = 'lists.json';

export class BlobTaskListRepository implements ITaskListRepository {
  constructor(private readonly container: ContainerClient) {}

  async get(): Promise<ETagged<TaskListsDocument>> {
    const blob = this.container.getBlockBlobClient(LISTS_BLOB_NAME);

    try {
      const buffer = await blob.downloadToBuffer();
      const raw: unknown = JSON.parse(buffer.toString('utf8'));
      const document = parseTaskListsDocument(raw);
      const properties = await blob.getProperties();
      return { document, etag: properties.etag ?? '' };
    } catch (error) {
      // No blob yet means no lists yet — an empty document, not an error. The
      // caller saves with ifMatch null to create it.
      if (isNotFound(error)) {
        return { document: createTaskListsDocument(), etag: '' };
      }
      throw error;
    }
  }

  async save(
    document: TaskListsDocument,
    ifMatch: string | null,
  ): Promise<ETagged<TaskListsDocument>> {
    const body = JSON.stringify(document);
    const blob = this.container.getBlockBlobClient(LISTS_BLOB_NAME);
    const isCreate = ifMatch === null || ifMatch.length === 0;

    try {
      const response = await blob.upload(body, Buffer.byteLength(body, 'utf8'), {
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
        conditions: isCreate ? { ifNoneMatch: '*' } : { ifMatch },
      });
      return { document, etag: response.etag ?? '' };
    } catch (error) {
      if (isPreconditionFailed(error) || isConflict(error)) {
        throw new DomainError('concurrency_conflict', 'Task lists were modified by someone else');
      }
      throw error;
    }
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

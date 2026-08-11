import { AttachmentService } from '../domain/attachmentService.js';
import {
  ATTACHMENTS_CONTAINER,
  TASKS_CONTAINER,
  getBlobServiceClient,
  readStorageConfig,
} from '../lib/blobClient.js';
import { BlobAttachmentStorage, credentialFromConnectionString } from './BlobAttachmentStorage.js';
import { BlobTaskListRepository } from './BlobTaskListRepository.js';
import { BlobTaskRepository } from './BlobTaskRepository.js';
import type { IAttachmentStorage } from './IAttachmentStorage.js';
import type { ITaskListRepository, ITaskRepository } from './ITaskRepository.js';

export * from './ITaskRepository.js';
export * from './IAttachmentStorage.js';
export { BlobTaskRepository } from './BlobTaskRepository.js';
export { BlobTaskListRepository, LISTS_BLOB_NAME } from './BlobTaskListRepository.js';
export { BlobAttachmentStorage, credentialFromConnectionString } from './BlobAttachmentStorage.js';
export { InMemoryTaskRepository, InMemoryTaskListRepository } from './InMemoryTaskRepository.js';

/**
 * Dependency wiring — the one line that changes when a database arrives.
 *
 * Swapping `BlobTaskRepository` for `SqlTaskRepository` here is the entire
 * migration as far as every handler is concerned. That is the whole point of
 * ITaskRepository, and it only stays true if nothing above this file ever
 * constructs a repository itself.
 */

let taskRepository: ITaskRepository | null = null;
let taskListRepository: ITaskListRepository | null = null;
let attachmentStorage: IAttachmentStorage | null = null;
let attachmentService: AttachmentService | null = null;

export function getTaskRepository(): ITaskRepository {
  if (taskRepository === null) {
    const container = getBlobServiceClient().getContainerClient(TASKS_CONTAINER);
    taskRepository = new BlobTaskRepository(container);
  }
  return taskRepository;
}

export function getTaskListRepository(): ITaskListRepository {
  if (taskListRepository === null) {
    const container = getBlobServiceClient().getContainerClient(TASKS_CONTAINER);
    taskListRepository = new BlobTaskListRepository(container);
  }
  return taskListRepository;
}

export function getAttachmentStorage(): IAttachmentStorage {
  if (attachmentStorage === null) {
    const config = readStorageConfig();
    if (config.connectionString === undefined || config.connectionString.length === 0) {
      // SAS signing needs a shared key or a user delegation key. v1 runs on a
      // connection string (ADR-0010); the managed-identity path would call
      // getUserDelegationKey here instead.
      throw new Error(
        'Attachment SAS signing requires AZURE_STORAGE_CONNECTION_STRING. ' +
          'See docs/VERIFICATION.md §3 and ADR-0010.',
      );
    }

    const container = getBlobServiceClient().getContainerClient(ATTACHMENTS_CONTAINER);
    attachmentStorage = new BlobAttachmentStorage(
      container,
      credentialFromConnectionString(config.connectionString),
    );
  }
  return attachmentStorage;
}

export function getAttachmentService(): AttachmentService {
  if (attachmentService === null) {
    attachmentService = new AttachmentService(getTaskRepository(), getAttachmentStorage());
  }
  return attachmentService;
}

/** Test seam: inject fakes without touching Azure. */
export function setRepositories(repositories: {
  tasks?: ITaskRepository;
  lists?: ITaskListRepository;
  attachments?: IAttachmentStorage;
  attachmentService?: AttachmentService;
}): void {
  if (repositories.tasks !== undefined) taskRepository = repositories.tasks;
  if (repositories.lists !== undefined) taskListRepository = repositories.lists;
  if (repositories.attachments !== undefined) attachmentStorage = repositories.attachments;
  if (repositories.attachmentService !== undefined) {
    attachmentService = repositories.attachmentService;
  }
}

export function resetRepositories(): void {
  taskRepository = null;
  taskListRepository = null;
  attachmentStorage = null;
  attachmentService = null;
}

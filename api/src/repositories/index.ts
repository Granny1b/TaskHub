import { TASKS_CONTAINER, getBlobServiceClient } from '../lib/blobClient.js';
import { BlobTaskListRepository } from './BlobTaskListRepository.js';
import { BlobTaskRepository } from './BlobTaskRepository.js';
import type { ITaskListRepository, ITaskRepository } from './ITaskRepository.js';

export * from './ITaskRepository.js';
export { BlobTaskRepository } from './BlobTaskRepository.js';
export { BlobTaskListRepository, LISTS_BLOB_NAME } from './BlobTaskListRepository.js';
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

/** Test seam: inject fakes without touching Azure. */
export function setRepositories(repositories: {
  tasks?: ITaskRepository;
  lists?: ITaskListRepository;
}): void {
  if (repositories.tasks !== undefined) taskRepository = repositories.tasks;
  if (repositories.lists !== undefined) taskListRepository = repositories.lists;
}

export function resetRepositories(): void {
  taskRepository = null;
  taskListRepository = null;
}

import { app, type HttpRequest } from '@azure/functions';
import { DomainError, toTaskSummary, validatedTaskDocumentSchema } from '@taskhub/shared';
import { TaskService } from '../domain/taskService.js';
import {
  addChildRequestSchema,
  createTaskRequestSchema,
  patchNodeRequestSchema,
  patchTaskRequestSchema,
  reorderRequestSchema,
} from '../domain/requests.js';
import {
  created,
  ok,
  queryBool,
  queryParam,
  readJson,
  requireIfMatch,
  routeParam,
  withAuth,
} from '../lib/http.js';
import { getTaskRepository } from '../repositories/index.js';
import type { ListTasksFilter } from '../repositories/ITaskRepository.js';

/**
 * Task endpoints.
 *
 * Every handler is the same four steps and nothing else: authenticate (done by
 * `withAuth`), validate with Zod, call the service, return. Business rules live
 * in `api/src/domain/`; storage lives behind `ITaskRepository`.
 */

function service(): TaskService {
  return new TaskService(getTaskRepository());
}

function requireParam(request: HttpRequest, name: string): string {
  const value = routeParam(request, name);
  if (value === null) {
    throw new DomainError('validation_failed', `A ${name} is required in the route`);
  }
  return value;
}

const requireId = (request: HttpRequest): string => requireParam(request, 'id');
const requireChildId = (request: HttpRequest): string => requireParam(request, 'childId');

app.http('listTasks', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: withAuth(async ({ request }) => {
    const listId = queryParam(request, 'listId');
    const q = queryParam(request, 'q');
    const isComplete = queryBool(request, 'isComplete');
    const includeDeleted = queryBool(request, 'includeDeleted');

    const filter: ListTasksFilter = {
      // `listId=none` is how a client asks for ungrouped tasks. Absent means
      // "every list", which is a different question from "no list".
      ...(listId !== null ? { listId: listId === 'none' ? null : listId } : {}),
      ...(isComplete !== undefined ? { isComplete } : {}),
      ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      ...(q !== null ? { q } : {}),
    };

    return ok({ tasks: await service().list(filter) });
  }),
});

app.http('createTask', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: withAuth(async ({ request, mutation }) => {
    const input = await readJson(request, createTaskRequestSchema);
    const saved = await service().create(input, mutation);
    return created(saved.document, saved.etag, `/api/tasks/${saved.document.id}`);
  }),
});

app.http('getTask', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'tasks/{id}',
  handler: withAuth(async ({ request }) => {
    const entry = await service().get(requireId(request));
    // The ETag on this response is what the client must send back on every
    // mutation. Without it there is no concurrency control at all.
    return ok(entry.document, entry.etag);
  }),
});

app.http('replaceTask', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'tasks/{id}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const ifMatch = requireIfMatch(request);
    const document = await readJson(request, validatedTaskDocumentSchema);

    if (document.id !== id) {
      throw new DomainError('validation_failed', 'Document id does not match the route id', {
        routeId: id,
        documentId: document.id,
      });
    }

    const saved = await service().replace(document, ifMatch, mutation);
    return ok(saved.document, saved.etag);
  }),
});

app.http('patchTask', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'tasks/{id}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const ifMatch = requireIfMatch(request);
    const patch = await readJson(request, patchTaskRequestSchema);

    const saved = await service().patch(id, patch, ifMatch, mutation);
    return ok(saved.document, saved.etag);
  }),
});

app.http('deleteTask', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'tasks/{id}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const ifMatch = requireIfMatch(request);

    const saved = await service().softDelete(id, ifMatch, mutation);
    // 200 rather than 204: this is a soft delete, and the client needs the new
    // ETag to keep operating on the task (to restore it, for instance).
    return ok(toTaskSummary(saved.document, saved.etag), saved.etag);
  }),
});

/* -------------------------------------------------------------------------- */
/* Children                                                                    */
/* -------------------------------------------------------------------------- */

app.http('addChild', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/children',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const ifMatch = requireIfMatch(request);
    const input = await readJson(request, addChildRequestSchema);

    const { saved, child } = await service().addChild(id, input, ifMatch, mutation);
    return created({ child, task: saved.document }, saved.etag, `/api/tasks/${id}`);
  }),
});

app.http('patchChild', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/children/{childId}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const childId = requireChildId(request);
    const ifMatch = requireIfMatch(request);
    const patch = await readJson(request, patchNodeRequestSchema);

    const saved = await service().patchChild(id, childId, patch, ifMatch, mutation);
    return ok(saved.document, saved.etag);
  }),
});

app.http('removeChild', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/children/{childId}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const childId = requireChildId(request);
    const ifMatch = requireIfMatch(request);

    const saved = await service().removeChild(id, childId, ifMatch, mutation);
    return ok(saved.document, saved.etag);
  }),
});

app.http('reorderChildren', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/reorder',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireId(request);
    const ifMatch = requireIfMatch(request);
    const input = await readJson(request, reorderRequestSchema);

    const saved = await service().reorder(id, input, ifMatch, mutation);
    return ok(saved.document, saved.etag);
  }),
});

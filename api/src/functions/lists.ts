import { app, type HttpRequest } from '@azure/functions';
import { DomainError } from '@taskhub/shared';
import { ListService } from '../domain/listService.js';
import {
  createListRequestSchema,
  patchListRequestSchema,
  reorderListsRequestSchema,
} from '../domain/requests.js';
import { created, ok, readJson, requireIfMatch, routeParam, withAuth } from '../lib/http.js';
import { getTaskListRepository } from '../repositories/index.js';

/**
 * User-definable lists — the left-panel grouping level.
 *
 * All lists share one blob, so the ETag returned by `GET /api/lists` guards
 * every mutation here, not just the one list being changed (ADR-0004).
 */

function service(): ListService {
  return new ListService(getTaskListRepository());
}

function requireListId(request: HttpRequest): string {
  const id = routeParam(request, 'id');
  if (id === null) {
    throw new DomainError('validation_failed', 'A list id is required in the route');
  }
  return id;
}

app.http('getLists', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'lists',
  handler: withAuth(async () => {
    const { lists, etag } = await service().list();
    return ok({ lists }, etag);
  }),
});

app.http('createList', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'lists',
  handler: withAuth(async ({ request, mutation }) => {
    const input = await readJson(request, createListRequestSchema);

    // The first list has no prior ETag, because the blob does not exist yet.
    // Accept an absent If-Match only in that case; the service still rejects a
    // stale one.
    const ifMatch = request.headers.get('if-match');

    const { list, etag } = await service().create(input, ifMatch, mutation);
    return created({ list }, etag, `/api/lists/${list.id}`);
  }),
});

app.http('patchList', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'lists/{id}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireListId(request);
    const ifMatch = requireIfMatch(request);
    const patch = await readJson(request, patchListRequestSchema);

    const { etag } = await service().patch(id, patch, ifMatch, mutation);
    const { lists } = await service().list();
    return ok({ lists }, etag);
  }),
});

app.http('deleteList', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'lists/{id}',
  handler: withAuth(async ({ request, mutation }) => {
    const id = requireListId(request);
    const ifMatch = requireIfMatch(request);

    const { etag } = await service().softDelete(id, ifMatch, mutation);
    const { lists } = await service().list();
    return ok({ lists }, etag);
  }),
});

app.http('reorderLists', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'lists/reorder',
  handler: withAuth(async ({ request, mutation }) => {
    const ifMatch = requireIfMatch(request);
    const input = await readJson(request, reorderListsRequestSchema);

    const { lists, etag } = await service().reorder(
      input.movedId,
      input.toIndex,
      ifMatch,
      mutation,
    );
    return ok({ lists }, etag);
  }),
});

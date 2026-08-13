import { app, type HttpRequest } from '@azure/functions';
import { DomainError } from '@taskhub/shared';
import { type AttachmentService } from '../domain/attachmentService.js';
import { attachmentCommitRequestSchema, attachmentSasRequestSchema } from '../domain/requests.js';
import {
  created,
  ok,
  queryBool,
  readJson,
  requireIfMatch,
  routeParam,
  withAuth,
} from '../lib/http.js';
import { getAttachmentService } from '../repositories/index.js';

/**
 * Attachment endpoints (§6, §11).
 *
 * Bytes never pass through here: the browser uploads straight to Blob Storage
 * with a short-lived, write-only, single-blob SAS.
 */

function service(): AttachmentService {
  return getAttachmentService();
}

function requireParam(request: HttpRequest, name: string): string {
  const value = routeParam(request, name);
  if (value === null) {
    throw new DomainError('validation_failed', `A ${name} is required in the route`);
  }
  return value;
}

app.http('createAttachmentSas', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/attachments/sas',
  handler: withAuth(async ({ request }) => {
    const taskId = requireParam(request, 'id');
    const input = await readJson(request, attachmentSasRequestSchema);

    // No If-Match: issuing a grant does not modify the document, so requiring
    // one would force a needless refetch and make uploads fail after an
    // unrelated edit.
    return ok(await service().createUploadGrant(taskId, input));
  }),
});

app.http('commitAttachment', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/attachments/commit',
  handler: withAuth(async ({ request, mutation }) => {
    const taskId = requireParam(request, 'id');
    const ifMatch = requireIfMatch(request);
    const input = await readJson(request, attachmentCommitRequestSchema);

    const { saved, attachment } = await service().commit(taskId, input, ifMatch, mutation);
    return created({ attachment, task: saved.document }, saved.etag);
  }),
});

app.http('getAttachmentUrl', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'attachments/{taskId}/{attachmentId}/url',
  handler: withAuth(async ({ request }) => {
    const taskId = requireParam(request, 'taskId');
    const attachmentId = requireParam(request, 'attachmentId');
    const thumbnail = queryBool(request, 'thumbnail');

    const grant = await service().createReadGrant(taskId, attachmentId, {
      ...(thumbnail !== undefined ? { thumbnail } : {}),
    });
    return ok(grant);
  }),
});

app.http('deleteAttachment', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/attachments/{attachmentId}',
  handler: withAuth(async ({ request, mutation }) => {
    const taskId = requireParam(request, 'id');
    const attachmentId = requireParam(request, 'attachmentId');
    const ifMatch = requireIfMatch(request);

    const saved = await service().remove(taskId, attachmentId, ifMatch, mutation);
    return ok(saved.document, saved.etag);
  }),
});

/**
 * Every file in storage.
 *
 * Deliberately not scoped to a task: the whole point of the files view is to
 * see what is being paid for across the account, including files whose task has
 * been deleted. One blob listing plus one task listing (ADR-0043).
 */
app.http('listFiles', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'files',
  handler: withAuth(async () => ok({ files: await service().listStoredFiles() })),
});

/** A URL that saves the file rather than opening it in a tab. */
app.http('getAttachmentDownloadUrl', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'attachments/{taskId}/{attachmentId}/download',
  handler: withAuth(async ({ request }) => {
    const taskId = requireParam(request, 'taskId');
    const attachmentId = requireParam(request, 'attachmentId');

    return ok(await service().createDownloadGrant(taskId, attachmentId));
  }),
});

/**
 * Delete bytes that no task references.
 *
 * Separate from `deleteAttachment` because there is no document to write and no
 * ETag to check — only bytes. The service refuses if a task still claims the
 * file, so this cannot be used to bypass the conditional write.
 */
app.http('deleteOrphanFile', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'files/{taskId}/{attachmentId}',
  handler: withAuth(async ({ request }) => {
    const taskId = requireParam(request, 'taskId');
    const attachmentId = requireParam(request, 'attachmentId');

    const deleted = await service().removeOrphan(taskId, attachmentId);
    return ok({ deleted });
  }),
});

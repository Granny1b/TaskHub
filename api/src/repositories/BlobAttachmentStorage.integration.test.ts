import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { createContext, createTaskDocument, type TaskDocument } from '@taskhub/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { AttachmentService } from '../domain/attachmentService.js';
import { BlobAttachmentStorage, credentialFromConnectionString } from './BlobAttachmentStorage.js';
import { BlobTaskRepository } from './BlobTaskRepository.js';
import type { ETagged } from './ITaskRepository.js';

/**
 * Phase 5 acceptance: attachments round-trip through real blob storage.
 *
 * The point of these tests is that they upload bytes the way the *browser*
 * does — a plain HTTP PUT to the SAS URL, with no SDK and no server-side
 * credential — so they prove the grant itself is correct. A test that used the
 * storage SDK with the account key would prove nothing about the SAS.
 *
 * The 20 MB PDF from the acceptance criterion is here. The pasted-screenshot
 * half is covered by an image upload with a thumbnail beside it; the clipboard
 * event itself is browser behaviour and is not something Node can exercise.
 */

const ctx = () => createContext('anna', new Date('2026-08-11T09:30:00Z'));

let tasksContainer: ContainerClient;
let attachmentsContainer: ContainerClient;
let repository: BlobTaskRepository;
let storage: BlobAttachmentStorage;
let service: AttachmentService;

beforeAll(() => {
  const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];
  if (connectionString === undefined) throw new Error('Azurite global setup did not run');

  const client = BlobServiceClient.fromConnectionString(connectionString);
  tasksContainer = client.getContainerClient('tasks');
  attachmentsContainer = client.getContainerClient('attachments');

  repository = new BlobTaskRepository(tasksContainer);
  storage = new BlobAttachmentStorage(
    attachmentsContainer,
    credentialFromConnectionString(connectionString),
  );
  service = new AttachmentService(repository, storage);
});

async function seedTask(title = 'Med bilaga'): Promise<ETagged<TaskDocument>> {
  return repository.create(createTaskDocument({ title }, ctx()));
}

/** Upload exactly as the browser does: PUT to the SAS URL, no credential. */
async function putToSas(uploadUrl: string, body: Buffer, contentType: string): Promise<Response> {
  return fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body),
  });
}

describe('the attachment round-trip', () => {
  it('round-trips a 20 MB PDF: grant, upload, commit, read back', async () => {
    const task = await seedTask('Stor ritning');

    // A real-sized engineering drawing, with a valid PDF header so nothing can
    // pass by treating it as opaque bytes.
    const bytes = Buffer.alloc(20 * 1024 * 1024, 0x41);
    Buffer.from('%PDF-1.7\n').copy(bytes, 0);

    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'ritning-4b.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });

    const uploaded = await putToSas(grant.uploadUrl, bytes, 'application/pdf');
    expect(uploaded.status).toBe(201);

    const committed = await service.commit(
      task.document.id,
      {
        attachmentId: grant.attachmentId,
        fileName: 'ritning-4b.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        blobPath: grant.blobPath,
      },
      task.etag,
      ctx(),
    );

    expect(committed.attachment.sizeBytes).toBe(20 * 1024 * 1024);
    expect(committed.saved.document.root.attachments).toHaveLength(1);

    // Read it back through a short-lived read SAS, again with no credential.
    const read = await service.createReadGrant(task.document.id, grant.attachmentId);
    const response = await fetch(read.url);
    expect(response.status).toBe(200);

    const returned = Buffer.from(await response.arrayBuffer());
    expect(returned.length).toBe(bytes.length);
    expect(returned.subarray(0, 9).toString()).toBe('%PDF-1.7\n');
  });

  it('round-trips an image together with its thumbnail', async () => {
    const task = await seedTask('Med foto');
    const photo = Buffer.alloc(64 * 1024, 0x8a);
    const thumbnail = Buffer.alloc(4 * 1024, 0x2b);

    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'spindel.jpg',
      contentType: 'image/jpeg',
      sizeBytes: photo.length,
    });

    // Images get a second grant for the client-generated thumbnail.
    expect(grant.thumbnailUploadUrl).not.toBeNull();
    expect(grant.thumbnailPath).toBe(`${task.document.id}/${grant.attachmentId}/thumb.jpg`);

    expect((await putToSas(grant.uploadUrl, photo, 'image/jpeg')).status).toBe(201);
    expect(
      (await putToSas(grant.thumbnailUploadUrl as string, thumbnail, 'image/jpeg')).status,
    ).toBe(201);

    const committed = await service.commit(
      task.document.id,
      {
        attachmentId: grant.attachmentId,
        fileName: 'spindel.jpg',
        contentType: 'image/jpeg',
        sizeBytes: photo.length,
        blobPath: grant.blobPath,
        thumbnailPath: grant.thumbnailPath,
      },
      task.etag,
      ctx(),
    );

    expect(committed.attachment.thumbnailPath).not.toBeNull();

    const thumbRead = await service.createReadGrant(task.document.id, grant.attachmentId, {
      thumbnail: true,
    });
    const response = await fetch(thumbRead.url);
    expect(Buffer.from(await response.arrayBuffer()).length).toBe(thumbnail.length);
  });

  it('does not issue a thumbnail grant for a non-image', async () => {
    const task = await seedTask();
    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'notering.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(grant.thumbnailUploadUrl).toBeNull();
    expect(grant.thumbnailPath).toBeNull();
  });
});

describe('the grant is a real boundary, not a formality', () => {
  it('gives a write-only grant that cannot read the blob back', async () => {
    const task = await seedTask();
    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'hemlig.pdf',
      contentType: 'application/pdf',
      sizeBytes: 16,
    });

    await putToSas(grant.uploadUrl, Buffer.alloc(16, 1), 'application/pdf');

    // The upload URL carries create+write permission only. Reading with it must
    // fail, or a leaked grant would be a data leak rather than a nuisance.
    const attempt = await fetch(grant.uploadUrl, { method: 'GET' });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
  });

  it('scopes the grant to one blob', async () => {
    const task = await seedTask();
    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'ett.pdf',
      contentType: 'application/pdf',
      sizeBytes: 16,
    });

    // Point the same signature at a different blob name. The signature covers
    // the path, so this must be rejected.
    const elsewhere = grant.uploadUrl.replace('/ett.pdf?', '/annat.pdf?');
    const response = await putToSas(elsewhere, Buffer.alloc(16, 2), 'application/pdf');
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a commit whose declared size does not match the uploaded blob', async () => {
    const task = await seedTask();
    const bytes = Buffer.alloc(2048, 7);

    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'liten.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });
    await putToSas(grant.uploadUrl, bytes, 'application/pdf');

    // The client lied about the size to get past the SAS gate. The commit
    // checks the real blob, which is the check that cannot be lied to.
    await expect(
      service.commit(
        task.document.id,
        {
          attachmentId: grant.attachmentId,
          fileName: 'liten.pdf',
          contentType: 'application/pdf',
          sizeBytes: 999,
          blobPath: grant.blobPath,
        },
        task.etag,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_operation' });
  });

  it('rejects a commit for a blob that was never uploaded', async () => {
    const task = await seedTask();
    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'saknas.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });

    await expect(
      service.commit(
        task.document.id,
        {
          attachmentId: grant.attachmentId,
          fileName: 'saknas.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          blobPath: grant.blobPath,
        },
        task.etag,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_operation' });
  });

  it('refuses a commit that points outside its own task prefix', async () => {
    const victim = await seedTask('Offer');
    const attacker = await seedTask('Angripare');

    // Attachments are keyed by task id precisely so this is checkable.
    await expect(
      service.commit(
        attacker.document.id,
        {
          attachmentId: '01JGZ0000000000000000ZZZ1',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
          blobPath: `${victim.document.id}/stolen/x.pdf`,
        },
        attacker.etag,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_operation' });
  });

  it('refuses an upload grant for a disallowed file type', async () => {
    const task = await seedTask();
    await expect(
      service.createUploadGrant(task.document.id, {
        fileName: 'malware.exe',
        contentType: 'application/octet-stream',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'invalid_operation' });
  });

  it('refuses an upload grant above the size cap', async () => {
    const task = await seedTask();
    await expect(
      service.createUploadGrant(task.document.id, {
        fileName: 'enorm.pdf',
        contentType: 'application/pdf',
        sizeBytes: 26 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'payload_too_large' });
  });
});

describe('removing an attachment', () => {
  it('detaches it from the document and deletes the bytes', async () => {
    const task = await seedTask();
    const bytes = Buffer.alloc(512, 3);

    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'kvitto.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });
    await putToSas(grant.uploadUrl, bytes, 'application/pdf');

    const committed = await service.commit(
      task.document.id,
      {
        attachmentId: grant.attachmentId,
        fileName: 'kvitto.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        blobPath: grant.blobPath,
      },
      task.etag,
      ctx(),
    );

    const removed = await service.remove(
      task.document.id,
      grant.attachmentId,
      committed.saved.etag,
      ctx(),
    );

    expect(removed.document.root.attachments).toHaveLength(0);

    /*
      The bytes go too (ADR-0043).

      This deliberately reverses the earlier soft-delete stance. The files view
      exists so someone can reclaim storage, and an unlink that leaves the blob
      behind reclaims nothing while appearing to. This assertion is the whole
      feature: without it, "delete" is a label rather than a behaviour.
    */
    const stillThere = await storage.statBlob(grant.blobPath);
    expect(stillThere.exists).toBe(false);
  });

  it('deletes the thumbnail alongside the file it belongs to', async () => {
    // Both live under `{taskId}/{attachmentId}/`, so one prefix delete covers
    // the pair. A thumbnail left behind is storage nothing can ever reach.
    const task = await seedTask('Med miniatyr');
    const bytes = Buffer.alloc(256, 7);

    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'foto.jpg',
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
    });
    await putToSas(grant.uploadUrl, bytes, 'image/jpeg');

    expect(grant.thumbnailUploadUrl).not.toBeNull();
    await putToSas(grant.thumbnailUploadUrl as string, Buffer.alloc(64, 9), 'image/jpeg');

    const committed = await service.commit(
      task.document.id,
      {
        attachmentId: grant.attachmentId,
        fileName: 'foto.jpg',
        contentType: 'image/jpeg',
        sizeBytes: bytes.length,
        blobPath: grant.blobPath,
        thumbnailPath: grant.thumbnailPath,
      },
      task.etag,
      ctx(),
    );

    await service.remove(task.document.id, grant.attachmentId, committed.saved.etag, ctx());

    expect((await storage.statBlob(grant.blobPath)).exists).toBe(false);
    expect((await storage.statBlob(grant.thumbnailPath as string)).exists).toBe(false);
  });

  it('lists stored files without listing thumbnails as their own row', async () => {
    // A thumbnail is a cost, not a file anyone uploaded; showing it as a row
    // would double every photo in the view.
    const task = await seedTask('För fillistan');
    const bytes = Buffer.alloc(128, 5);

    const grant = await service.createUploadGrant(task.document.id, {
      fileName: 'bild.jpg',
      contentType: 'image/jpeg',
      sizeBytes: bytes.length,
    });
    await putToSas(grant.uploadUrl, bytes, 'image/jpeg');
    await putToSas(grant.thumbnailUploadUrl as string, Buffer.alloc(32, 1), 'image/jpeg');

    await service.commit(
      task.document.id,
      {
        attachmentId: grant.attachmentId,
        fileName: 'bild.jpg',
        contentType: 'image/jpeg',
        sizeBytes: bytes.length,
        blobPath: grant.blobPath,
        thumbnailPath: grant.thumbnailPath,
      },
      task.etag,
      ctx(),
    );

    const files = await service.listStoredFiles();
    const mine = files.filter((file) => file.attachmentId === grant.attachmentId);

    expect(mine).toHaveLength(1);
    expect(mine[0]?.fileName).toBe('bild.jpg');
    expect(mine[0]?.taskTitle).toBe('För fillistan');
    expect(mine[0]?.sizeBytes).toBe(bytes.length);
  });
});

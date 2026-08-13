import {
  DomainError,
  EventBus,
  addAttachment,
  assertUploadAllowed,
  attachmentBlobPath,
  findNode,
  isImageContentType,
  newAttachmentId,
  parseAttachmentPath,
  removeAttachment,
  thumbnailBlobPath,
  updateNode,
  type Attachment,
  type DomainEvent,
  type MutationContext,
  type StoredFile,
  type TaskDocument,
} from '@taskhub/shared';
import type { ETagged, ITaskRepository } from '../repositories/ITaskRepository.js';
import type { IAttachmentStorage } from '../repositories/IAttachmentStorage.js';
import type { AttachmentCommitRequest, AttachmentSasRequest } from './requests.js';

/**
 * The attachment pipeline's server half (§11).
 *
 * The Function issues a grant and later records the result. The bytes never
 * pass through it.
 */
export class AttachmentService {
  constructor(
    private readonly tasks: ITaskRepository,
    private readonly storage: IAttachmentStorage,
    private readonly events: EventBus = new EventBus(),
  ) {}

  private publish(event: DomainEvent): void {
    this.events.publish(event);
  }

  private async requireTask(taskId: string): Promise<ETagged<TaskDocument>> {
    const entry = await this.tasks.get(taskId);
    if (entry === null || entry.document.deletedAt !== null) {
      throw new DomainError('not_found', `Task ${taskId} does not exist`, { taskId });
    }
    return entry;
  }

  /**
   * Step 1–2 of the pipeline: validate the declared file, then grant a
   * write-only SAS for exactly one blob.
   *
   * The validation here gates *issuing the grant*; it cannot be the last word,
   * because everything it checks was supplied by the client. `commit` re-checks
   * the real blob.
   */
  async createUploadGrant(
    taskId: string,
    input: AttachmentSasRequest,
  ): Promise<{
    attachmentId: string;
    uploadUrl: string;
    blobPath: string;
    thumbnailPath: string | null;
    thumbnailUploadUrl: string | null;
    expiresOn: string;
  }> {
    const task = await this.requireTask(taskId);

    const nodeId = input.nodeId ?? task.document.root.id;
    if (findNode(task.document.root, nodeId) === null) {
      throw new DomainError('not_found', `No node ${nodeId} in task ${taskId}`, { taskId, nodeId });
    }

    assertUploadAllowed(input);

    const attachmentId = newAttachmentId();
    const blobPath = attachmentBlobPath(taskId, attachmentId, input.fileName);

    // ORPHAN: a grant issued here may never be committed — the user cancels, or
    // the browser dies mid-upload — leaving a blob no document references.
    // Cleaning those up is a documented Phase-2 job (see docs/ARCHITECTURE.md);
    // it needs a timer trigger, which SWA-managed Functions cannot host, so it
    // belongs in a separate Functions app or a scheduled GitHub Action.
    const grant = await this.storage.createUploadGrant({
      blobPath,
      contentType: input.contentType,
    });

    // Thumbnails are generated client-side on a canvas: server-side image
    // processing would cost money and Function time we do not want to spend.
    const isImage = isImageContentType(input.contentType);
    const thumbPath = isImage ? thumbnailBlobPath(taskId, attachmentId) : null;
    const thumbGrant =
      thumbPath === null
        ? null
        : await this.storage.createUploadGrant({
            blobPath: thumbPath,
            contentType: 'image/jpeg',
          });

    return {
      attachmentId,
      uploadUrl: grant.uploadUrl,
      blobPath: grant.blobPath,
      thumbnailPath: thumbPath,
      thumbnailUploadUrl: thumbGrant?.uploadUrl ?? null,
      expiresOn: grant.expiresOn,
    };
  }

  /**
   * Step 5: record the uploaded file on the document.
   *
   * Verifies the blob actually exists and that its real size matches the
   * declaration before anything is written. A client that lied to get past the
   * size gate fails here, where the storage account is the source of truth.
   */
  async commit(
    taskId: string,
    input: AttachmentCommitRequest,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<{ saved: ETagged<TaskDocument>; attachment: Attachment }> {
    const task = await this.requireTask(taskId);
    const nodeId = input.nodeId ?? task.document.root.id;

    const expectedPrefix = `${taskId}/`;
    if (!input.blobPath.startsWith(expectedPrefix)) {
      throw new DomainError(
        'invalid_operation',
        'Attachment blobPath must live under its own task prefix',
        { taskId, blobPath: input.blobPath },
      );
    }

    assertUploadAllowed(input);

    const facts = await this.storage.statBlob(input.blobPath);
    if (!facts.exists) {
      throw new DomainError(
        'invalid_operation',
        'No uploaded blob found at that path. Upload the file before committing it.',
        { blobPath: input.blobPath },
      );
    }
    if (facts.sizeBytes !== input.sizeBytes) {
      throw new DomainError(
        'invalid_operation',
        `Uploaded blob is ${facts.sizeBytes} bytes but ${input.sizeBytes} was declared`,
        { blobPath: input.blobPath, actual: facts.sizeBytes, declared: input.sizeBytes },
      );
    }

    const attachment: Attachment = {
      id: input.attachmentId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: facts.sizeBytes,
      blobPath: input.blobPath,
      thumbnailPath: input.thumbnailPath ?? null,
      uploadedAt: ctx.now,
      uploadedBy: ctx.actor,
    };

    const root = updateNode(
      task.document.root,
      nodeId,
      (node) => addAttachment(node, attachment, ctx),
      ctx,
    );

    const saved = await this.tasks.replace({ ...task.document, root }, ifMatch);
    this.publish({
      type: 'AttachmentAdded',
      at: ctx.now,
      actor: ctx.actor,
      taskId,
      attachmentId: attachment.id,
    });
    return { saved, attachment };
  }

  /** A short-lived read URL, resolved from the document rather than trusted. */
  async createReadGrant(
    taskId: string,
    attachmentId: string,
    options: { thumbnail?: boolean } = {},
  ): Promise<{ url: string; expiresOn: string; fileName: string }> {
    const task = await this.requireTask(taskId);

    const attachment = findAttachment(task.document, attachmentId);
    if (attachment === null) {
      throw new DomainError('not_found', `No attachment ${attachmentId} on task ${taskId}`, {
        taskId,
        attachmentId,
      });
    }

    // The path comes from the stored document, never from the request, so a
    // caller cannot craft a URL to read some other task's blob.
    const path =
      options.thumbnail === true && attachment.thumbnailPath !== null
        ? attachment.thumbnailPath
        : attachment.blobPath;

    const grant = await this.storage.createReadGrant(path);
    return { url: grant.url, expiresOn: grant.expiresOn, fileName: attachment.fileName };
  }

  /** A read URL that saves the file under its own name rather than opening it. */
  async createDownloadGrant(
    taskId: string,
    attachmentId: string,
  ): Promise<{ url: string; expiresOn: string; fileName: string }> {
    const task = await this.requireTask(taskId);

    const attachment = findAttachment(task.document, attachmentId);
    if (attachment === null) {
      throw new DomainError('not_found', `No attachment ${attachmentId} on task ${taskId}`, {
        taskId,
        attachmentId,
      });
    }

    const grant = await this.storage.createDownloadGrant(attachment.blobPath, attachment.fileName);
    return { url: grant.url, expiresOn: grant.expiresOn, fileName: attachment.fileName };
  }

  /**
   * Every file in storage, with the task it belongs to.
   *
   * Built from one blob listing joined against one task listing, rather than by
   * opening every task document. Both are already the cheapest calls in the
   * API; the alternative is a read per task, which at 500 tasks is 500 reads to
   * answer one question (ADR-0043).
   *
   * Storage is the authority on what exists and what it costs — size, type and
   * date come from the blob itself, not from a record that could disagree with
   * it. The task title is a join, and a file whose task has been deleted still
   * appears, with no title. That is deliberate: a storage view that hid the
   * files nobody can reach would hide exactly the ones worth deleting.
   */
  async listStoredFiles(): Promise<StoredFile[]> {
    const [blobs, tasks] = await Promise.all([this.storage.listAll(), this.tasks.list({})]);
    const titleById = new Map(tasks.map((task) => [task.id, task.title]));

    const files: StoredFile[] = [];
    for (const blob of blobs) {
      const parsed = parseAttachmentPath(blob.blobPath);
      // Thumbnails are storage we pay for but not files anyone uploaded. They
      // are counted in the totals and never listed as their own row.
      if (parsed === null || parsed.isThumbnail) continue;

      files.push({
        taskId: parsed.taskId,
        attachmentId: parsed.attachmentId,
        taskTitle: titleById.get(parsed.taskId) ?? null,
        fileName: parsed.fileName,
        contentType: blob.contentType,
        sizeBytes: blob.sizeBytes,
        uploadedAt: blob.lastModified,
        blobPath: blob.blobPath,
      });
    }

    return files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  /**
   * Remove an attachment from its task *and* delete the bytes.
   *
   * This reverses the §5 stance that nothing a user does destroys bytes, and it
   * does so deliberately: the files view exists so someone can reclaim storage,
   * and an unlink that leaves the blob behind reclaims nothing while looking
   * like it did (ADR-0043). The UI confirms before calling this.
   *
   * The document is written first. If the blob delete then fails the file is
   * unreferenced but still stored — it shows up in the files view as an orphan
   * and can be deleted again, which is a far better failure than a document
   * pointing at bytes that are already gone.
   */
  async remove(
    taskId: string,
    attachmentId: string,
    ifMatch: string,
    ctx: MutationContext,
  ): Promise<ETagged<TaskDocument>> {
    const task = await this.requireTask(taskId);

    const owner = findAttachmentOwner(task.document, attachmentId);
    if (owner === null) {
      throw new DomainError('not_found', `No attachment ${attachmentId} on task ${taskId}`, {
        taskId,
        attachmentId,
      });
    }

    const root = updateNode(
      task.document.root,
      owner,
      (node) => removeAttachment(node, attachmentId, ctx),
      ctx,
    );

    const saved = await this.tasks.replace({ ...task.document, root }, ifMatch);

    /*
      Then the bytes, file and thumbnail together.

      `deletePrefix` on `{taskId}/{attachmentId}/` is exactly the pair — the
      blob path convention (§5) puts nothing else under that prefix. Best
      effort: the document write is the one that must succeed, and an orphaned
      blob is visible in the files view rather than lost.
    */
    try {
      await this.storage.deletePrefix(`${taskId}/${attachmentId}/`);
    } catch {
      // Left for the next attempt; the attachment is already unreferenced.
    }

    this.publish({
      type: 'AttachmentRemoved',
      at: ctx.now,
      actor: ctx.actor,
      taskId,
      attachmentId,
    });
    return saved;
  }

  /**
   * Delete a file that no task references any more.
   *
   * The files view can surface blobs whose task is gone, or whose attachment
   * record was removed before deletion became real. Nothing owns them, so there
   * is no document to write and no ETag to check — only bytes to remove.
   */
  async removeOrphan(taskId: string, attachmentId: string): Promise<number> {
    // Refuse if a task still references it: that route has to go through
    // `remove`, which writes the document under an If-Match first.
    const task = await this.tasks.get(taskId);
    if (task !== null && findAttachment(task.document, attachmentId) !== null) {
      throw new DomainError(
        'invalid_operation',
        'That file is still attached to a task; delete it from the task instead',
        { taskId, attachmentId },
      );
    }

    return this.storage.deletePrefix(`${taskId}/${attachmentId}/`);
  }
}

function findAttachment(document: TaskDocument, attachmentId: string): Attachment | null {
  const search = (node: TaskDocument['root']): Attachment | null => {
    const found = node.attachments.find((item) => item.id === attachmentId);
    if (found !== undefined) return found;
    for (const child of node.children) {
      const inChild = search(child);
      if (inChild !== null) return inChild;
    }
    return null;
  };
  return search(document.root);
}

/** The id of the node holding this attachment. */
function findAttachmentOwner(document: TaskDocument, attachmentId: string): string | null {
  const search = (node: TaskDocument['root']): string | null => {
    if (node.attachments.some((item) => item.id === attachmentId)) return node.id;
    for (const child of node.children) {
      const inChild = search(child);
      if (inChild !== null) return inChild;
    }
    return null;
  };
  return search(document.root);
}

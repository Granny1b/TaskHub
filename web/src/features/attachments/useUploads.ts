import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ATTACHMENT_MAX_BYTES,
  assertUploadAllowed,
  isImageContentType,
  DomainError,
} from '@taskhub/shared';
import { api } from '../../lib/apiClient.js';
import { queryKeys } from '../../lib/queries.js';
import { generateThumbnail } from '../../lib/thumbnails.js';
import { UploadCancelled, uploadToSas } from '../../lib/uploadClient.js';

/**
 * The upload pipeline, client side (§11).
 *
 *   1. validate locally      — instant feedback, no round trip for an obvious
 *                              rejection like a .exe or a 40 MB file
 *   2. request a SAS         — the server validates again; it does not trust us
 *   3. PUT straight to blob  — with progress, cancellable
 *   4. thumbnail for images  — generated on a canvas, uploaded the same way
 *   5. commit                — the server checks the *actual* blob size
 *
 * Uploads are tracked as a list of independent items so several can run at once
 * and one failure never takes the others down: dropping eight photos and having
 * the seventh fail should leave the other seven uploaded.
 */

export type UploadStatus =
  'validating' | 'uploading' | 'committing' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly status: UploadStatus;
  readonly percent: number;
  readonly error?: string;
}

let uploadCounter = 0;
const nextUploadId = (): string => {
  uploadCounter += 1;
  return `upload-${uploadCounter}`;
};

export function useUploads(taskId: string) {
  const client = useQueryClient();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  /**
   * Serialises the commit step across concurrent uploads.
   *
   * A promise chain rather than a lock: each commit waits for the previous one
   * to settle — success or failure — so one rejected commit does not stall the
   * queue behind it.
   */
  const commitQueue = useRef<Promise<unknown>>(Promise.resolve());

  const serialiseCommit = useCallback(<T>(work: () => Promise<T>): Promise<T> => {
    const result = commitQueue.current.then(work, work);
    commitQueue.current = result.catch(() => undefined);
    return result;
  }, []);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  const dismiss = useCallback((id: string) => {
    setUploads((current) => current.filter((item) => item.id !== id));
  }, []);

  /**
   * Upload one file end to end.
   *
   * The ETag is read from the cache at commit time rather than passed in,
   * because uploading a large file takes long enough that the version we
   * started from may be stale — and the commit is a conditional write.
   */
  const uploadOne = useCallback(
    async (file: File, nodeId?: string): Promise<void> => {
      const id = nextUploadId();
      const controller = new AbortController();
      controllers.current.set(id, controller);

      setUploads((current) => [
        ...current,
        {
          id,
          fileName: file.name,
          sizeBytes: file.size,
          status: 'validating',
          percent: 0,
        },
      ]);

      try {
        // Local validation first: rejecting a 40 MB video should not require a
        // round trip, and the error is more immediate this way.
        assertUploadAllowed({
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });

        const grant = await api.requestUploadGrant(taskId, {
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          ...(nodeId !== undefined ? { nodeId } : {}),
        });

        update(id, { status: 'uploading' });

        await uploadToSas(grant.uploadUrl, file, file.type, {
          signal: controller.signal,
          onProgress: ({ percent }) => update(id, { percent }),
        });

        // Thumbnails are best-effort. A browser that cannot decode the format
        // (HEIC is the usual culprit) still gets a working attachment.
        let thumbnailPath: string | null = null;
        if (
          isImageContentType(file.type) &&
          grant.thumbnailUploadUrl !== null &&
          grant.thumbnailPath !== null
        ) {
          const thumbnail = await generateThumbnail(file);
          if (thumbnail !== null) {
            try {
              await uploadToSas(grant.thumbnailUploadUrl, thumbnail, 'image/jpeg', {
                signal: controller.signal,
              });
              thumbnailPath = grant.thumbnailPath;
            } catch {
              thumbnailPath = null;
            }
          }
        }

        update(id, { status: 'committing', percent: 100 });

        /*
          Commits are serialised, uploads are not.

          Each commit is a conditional write against the task's ETag, so two
          uploads finishing together would both commit against the version they
          started from and the second would lose with a 409 — which is exactly
          what dropping several files at once does. Uploading in parallel is
          where the time goes and stays parallel; only the write is queued.
        */
        const saved = await serialiseCommit(async () => {
          const cached = client.getQueryData<{ data: unknown; etag: string }>(
            queryKeys.task(taskId),
          );
          const etag = cached?.etag ?? (await api.getTask(taskId)).etag;

          return api.commitAttachment(
            taskId,
            {
              attachmentId: grant.attachmentId,
              fileName: file.name,
              contentType: file.type,
              sizeBytes: file.size,
              blobPath: grant.blobPath,
              thumbnailPath,
              ...(nodeId !== undefined ? { nodeId } : {}),
            },
            etag,
          );
        });

        client.setQueryData(queryKeys.task(taskId), {
          data: saved.data.task,
          etag: saved.etag,
        });
        void client.invalidateQueries({ queryKey: ['tasks'] });

        update(id, { status: 'done', percent: 100 });

        // Successful uploads clear themselves; the attachment grid is the
        // record from here on, and a growing list of green ticks is clutter.
        window.setTimeout(() => dismiss(id), 2000);
      } catch (error) {
        if (error instanceof UploadCancelled) {
          update(id, { status: 'cancelled' });
        } else {
          update(id, {
            status: 'error',
            error:
              error instanceof DomainError || error instanceof Error
                ? error.message
                : 'Upload failed',
          });
        }
      } finally {
        controllers.current.delete(id);
      }
    },
    [taskId, client, update, dismiss, serialiseCommit],
  );

  /** Upload several files concurrently; one failure does not stop the rest. */
  const upload = useCallback(
    (files: readonly File[], nodeId?: string): void => {
      for (const file of files) void uploadOne(file, nodeId);
    },
    [uploadOne],
  );

  return { uploads, upload, cancel, dismiss, maxBytes: ATTACHMENT_MAX_BYTES };
}

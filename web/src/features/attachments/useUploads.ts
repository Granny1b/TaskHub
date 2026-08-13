import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ATTACHMENT_MAX_BYTES,
  assertUploadAllowed,
  isImageContentType,
  DomainError,
} from '@taskhub/shared';
import { api } from '../../lib/apiClient.js';
import { compressImage } from '../../lib/imageCompression.js';
import { normaliseIncomingFile } from '../../lib/incomingFile.js';
import { readPreferences } from '../../lib/preferences.js';
import { queryKeys } from '../../lib/queries.js';
import { generateThumbnail } from '../../lib/thumbnails.js';
import { UploadCancelled, uploadToSas } from '../../lib/uploadClient.js';

/**
 * The upload pipeline, client side (§11).
 *
 *   1. shrink photographs    — before anything else, because everything after
 *                              this is signed for one filename and one size
 *   2. validate locally      — instant feedback, no round trip for an obvious
 *                              rejection like a .exe or a 40 MB file
 *   3. request a SAS         — the server validates again; it does not trust us
 *   4. PUT straight to blob  — with progress, cancellable
 *   5. thumbnail for images  — generated on a canvas, uploaded the same way
 *   6. commit                — the server checks the *actual* blob size
 *
 * Uploads are tracked as a list of independent items so several can run at once
 * and one failure never takes the others down: dropping eight photos and having
 * the seventh fail should leave the other seven uploaded.
 */

export type UploadStatus =
  'preparing' | 'validating' | 'uploading' | 'committing' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly status: UploadStatus;
  readonly percent: number;
  readonly error?: string;
  /**
   * What the file weighed before compression, when compression happened.
   *
   * Shown next to the new size: a setting that quietly rewrites people's
   * photographs should say so while it is doing it, not only in a dialog
   * nobody opens.
   */
  readonly originalBytes?: number;
}

let uploadCounter = 0;
const nextUploadId = (): string => {
  uploadCounter += 1;
  return `upload-${uploadCounter}`;
};

/**
 * Runs work one item at a time.
 *
 * A promise chain rather than a lock: each turn waits for the previous one to
 * settle — success or failure — so one rejection does not stall the queue
 * behind it.
 */
function useSerialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  const tail = useRef<Promise<unknown>>(Promise.resolve());

  return useCallback(<T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.current.then(work, work);
    tail.current = result.catch(() => undefined);
    return result;
  }, []);
}

export function useUploads(taskId: string) {
  const client = useQueryClient();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  /*
    Two things are serialised, for two different reasons.

    Commits, because each one is a conditional write against the task's ETag:
    two finishing together would both write against the version they started
    from and the second would lose with a 409.

    Compression, because decoding a 12MP photo costs about 48 MB of bitmap.
    Dropping eight at once and decoding them in parallel is most of a phone's
    memory budget, and the tab dies rather than the upload failing politely.
  */
  const serialiseCommit = useSerialQueue();
  const serialiseCompress = useSerialQueue();

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
    async (incoming: File, nodeId?: string): Promise<void> => {
      const id = nextUploadId();
      const controller = new AbortController();
      controllers.current.set(id, controller);

      setUploads((current) => [
        ...current,
        {
          id,
          fileName: incoming.name,
          sizeBytes: incoming.size,
          status: 'preparing',
          percent: 0,
        },
      ]);

      try {
        /*
          Before anything else, make the file fit to upload.

          A photo straight from a camera can arrive with no extension or an
          empty MIME type, and both break this pipeline further down — the
          allowlist checks the extension, and the SAS is signed with the content
          type Azure then compares against the PUT. See incomingFile.ts.
        */
        const original = await normaliseIncomingFile(incoming);

        /*
          Compression comes next, before validation and before the grant.

          The SAS is signed for one blob path, derived from the filename, and
          the commit checks the real uploaded size against what was declared —
          so a file that changes name or size after the grant is issued fails
          at the last step. Everything downstream must see the file that will
          actually be uploaded.
        */
        const compressed =
          readPreferences().imageQuality === 'balanced'
            ? await serialiseCompress(() => compressImage(original))
            : null;

        const file = compressed ?? original;
        update(id, {
          status: 'validating',
          fileName: file.name,
          sizeBytes: file.size,
          ...(compressed !== null ? { originalBytes: original.size } : {}),
        });

        // Local validation next: rejecting a 40 MB video should not require a
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

        // Commits are serialised, uploads are not: the PUT is where the time
        // goes and it stays parallel, only the conditional write is queued.
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
    [taskId, client, update, dismiss, serialiseCommit, serialiseCompress],
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

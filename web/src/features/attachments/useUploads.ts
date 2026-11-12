import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  assertUploadAllowed,
  isImageContentType,
  type TaskDocument,
  type TaskSummary,
} from '@taskhub/shared';
import { ApiError, api, type WithETag } from '../../lib/apiClient.js';
import { compressImage } from '../../lib/imageCompression.js';
import { normaliseIncomingFile } from '../../lib/incomingFile.js';
import { readPreferences } from '../../lib/preferences.js';
import { queryKeys } from '../../lib/queries.js';
import { generateThumbnail } from '../../lib/thumbnails.js';
import { UploadCancelled, UploadError, uploadToSas } from '../../lib/uploadClient.js';

/**
 * The upload pipeline, client side (§11).
 *
 *   1. shrink photographs    — before anything else, because everything after
 *                              this is signed for one filename and one size
 *   2. validate locally      — instant feedback, no round trip for an obvious
 *                              rejection like a .exe or a 40 MB file
 *   3. request a SAS         — the server validates again; it does not trust us
 *   4. PUT straight to blob  — with progress, cancellable
 *   5. thumbnail for images  — generated on a canvas and uploaded *alongside*
 *                              the file rather than after it
 *   6. commit                — the server checks the *actual* blob size
 *
 * Uploads are tracked as a list of independent items so several can run at once
 * and one failure never takes the others down: dropping eight photos and having
 * the seventh fail should leave the other seven uploaded.
 *
 * The list lives in this module, not in a component. It used to be state inside
 * the attachments panel, which meant an upload's progress — and its error, if
 * it failed — vanished the moment the panel unmounted: close the pane, or click
 * another task, and a failed upload left no trace anywhere. It also meant
 * nothing outside the panel could start one. Now an upload belongs to a task
 * rather than to whatever happens to be on screen, so a screenshot can be
 * pasted onto a task whose pane is not open yet, and the progress is there
 * when it opens.
 */

export type UploadStatus =
  'preparing' | 'validating' | 'uploading' | 'committing' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  readonly id: string;
  readonly taskId: string;
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

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

let items: readonly UploadItem[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();

function setItems(next: readonly UploadItem[]): void {
  items = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getItems = (): readonly UploadItem[] => items;

function update(id: string, patch: Partial<UploadItem>): void {
  setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

export function cancelUpload(id: string): void {
  controllers.get(id)?.abort();
}

export function dismissUpload(id: string): void {
  setItems(items.filter((item) => item.id !== id));
}

/* -------------------------------------------------------------------------- */
/* Queues                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Runs work one item at a time.
 *
 * A promise chain rather than a lock: each turn waits for the previous one to
 * settle — success or failure — so one rejection does not stall the queue
 * behind it.
 */
function serialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };
}

/*
  Two things are serialised, for two different reasons.

  Compression, because decoding a 12MP photo costs about 48 MB of bitmap.
  Dropping eight at once and decoding them in parallel is most of a phone's
  memory budget, and the tab dies rather than the upload failing politely. One
  queue for the whole page: memory is not per task.

  Commits, because each one is a conditional write against the task's ETag:
  two finishing together would both write against the version they started
  from and the second would lose with a 409. One queue per task: commits to
  different tasks cannot collide and should not wait on each other.
*/
const serialiseCompress = serialQueue();
const commitQueues = new Map<string, ReturnType<typeof serialQueue>>();

function commitQueueFor(taskId: string): ReturnType<typeof serialQueue> {
  let queue = commitQueues.get(taskId);
  if (queue === undefined) {
    queue = serialQueue();
    commitQueues.set(taskId, queue);
  }
  return queue;
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                                */
/* -------------------------------------------------------------------------- */

const RETRY_DELAY_MS = 800;

/**
 * PUT the file, trying once more if the connection dropped.
 *
 * Workshop wifi drops for a second at a time. Without this, a blip in the
 * middle of a 15 MB drawing meant the user re-selecting the file and starting
 * over; a single quiet retry covers the common case. Exactly one, and only for
 * failures that can be transient — a 403 from an expired or mismatched SAS will
 * fail the same way every time and should say so immediately.
 */
async function putWithRetry(
  url: string,
  body: Blob,
  contentType: string,
  options: Parameters<typeof uploadToSas>[3],
): Promise<void> {
  // A function, not a value: the signal can fire during the wait below.
  const cancelled = (): boolean => options?.signal?.aborted === true;

  try {
    await uploadToSas(url, body, contentType, options);
  } catch (error) {
    const transient = error instanceof UploadError && (error.status === 0 || error.status >= 500);
    if (!transient || cancelled()) throw error;

    await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
    if (cancelled()) throw new UploadCancelled();
    await uploadToSas(url, body, contentType, options);
  }
}

/**
 * Render and upload the thumbnail. Never throws.
 *
 * Thumbnails are best-effort: a browser that cannot decode the format (HEIC is
 * the usual culprit) still gets a working attachment, and so does an upload
 * whose thumbnail PUT failed.
 */
async function uploadThumbnail(
  file: File,
  uploadUrl: string | null,
  path: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  if (!isImageContentType(file.type) || uploadUrl === null || path === null) return null;

  try {
    const thumbnail = await generateThumbnail(file);
    if (thumbnail === null) return null;
    await uploadToSas(uploadUrl, thumbnail, 'image/jpeg', { signal });
    return path;
  } catch {
    return null;
  }
}

/** Put the saved document in the cache, and tell every view that shows it. */
function publishSaved(client: QueryClient, taskId: string, saved: WithETag<TaskDocument>): void {
  client.setQueryData(queryKeys.task(taskId), saved);

  // The paperclip count in the list comes from the listing. Bump it now rather
  // than waiting for the refetch, so the row answers the paste straight away.
  client.setQueriesData<TaskSummary[]>({ queryKey: ['tasks'] }, (summaries) =>
    summaries?.map((summary) =>
      summary.id === taskId
        ? {
            ...summary,
            attachmentCount: summary.attachmentCount + 1,
            etag: saved.etag,
          }
        : summary,
    ),
  );

  void client.invalidateQueries({ queryKey: ['tasks'] });
  void client.invalidateQueries({ queryKey: queryKeys.files });
}

/**
 * Upload one file end to end.
 *
 * The ETag is read from the cache at commit time rather than passed in,
 * because uploading a large file takes long enough that the version we
 * started from may be stale — and the commit is a conditional write.
 */
async function uploadOne(
  client: QueryClient,
  taskId: string,
  incoming: File,
  nodeId?: string,
): Promise<void> {
  const id = nextUploadId();
  const controller = new AbortController();
  controllers.set(id, controller);

  setItems([
    ...items,
    {
      id,
      taskId,
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
      Anything that will not be compressed is validated straight away.

      This used to run after the compression step for every file, so a .exe or
      a 40 MB video waited in the compression queue behind every photograph
      ahead of it before being told no. Photographs are the exception: one that
      is too large as shot may well fit once shrunk, so its size is judged
      below, on what will really be sent.
    */
    const plannedCompression =
      readPreferences().imageQuality === 'balanced' && isImageContentType(original.type);
    if (!plannedCompression) {
      assertUploadAllowed({
        fileName: original.name,
        contentType: original.type,
        sizeBytes: original.size,
      });
    }

    /*
      Compression comes before the grant.

      The SAS is signed for one blob path, derived from the filename, and
      the commit checks the real uploaded size against what was declared —
      so a file that changes name or size after the grant is issued fails
      at the last step. Everything downstream must see the file that will
      actually be uploaded.
    */
    const compressed = plannedCompression
      ? await serialiseCompress(() => compressImage(original))
      : null;
    if (controller.signal.aborted) throw new UploadCancelled();

    const file = compressed ?? original;
    update(id, {
      status: 'validating',
      fileName: file.name,
      sizeBytes: file.size,
      ...(compressed !== null ? { originalBytes: original.size } : {}),
    });

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
    if (controller.signal.aborted) throw new UploadCancelled();

    update(id, { status: 'uploading' });

    /*
      The thumbnail is made and sent while the file itself is uploading.

      It used to wait for the main PUT to finish, so every picture paid for
      a decode, an encode and a second round trip *after* the bar had reached
      100% — the "stuck at the end" pause. The two share nothing, so they
      overlap; the commit waits for both.
    */
    const [, thumbnailPath] = await Promise.all([
      putWithRetry(grant.uploadUrl, file, file.type, {
        signal: controller.signal,
        onProgress: ({ percent }) => update(id, { percent }),
      }),
      uploadThumbnail(file, grant.thumbnailUploadUrl, grant.thumbnailPath, controller.signal),
    ]);

    update(id, { status: 'committing', percent: 100 });

    // Commits are serialised, uploads are not: the PUT is where the time
    // goes and it stays parallel, only the conditional write is queued.
    const saved = await commitQueueFor(taskId)(async () => {
      const commit = (etag: string) =>
        api.commitAttachment(
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

      const cached = client.getQueryData<WithETag<TaskDocument>>(queryKeys.task(taskId));

      try {
        return await commit(cached?.etag ?? (await api.getTask(taskId)).etag);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.isConflict) throw error;

        /*
          The task changed while the file was uploading — someone ticked a
          subtask, or this user edited the title in the meantime. Adding an
          attachment cannot collide with any of that, so there is nothing to
          ask anyone: fetch the current version and record the file on it.

          Without this the upload failed at the very last step, after every
          byte had arrived, with a conflict message about a file.
        */
        const latest = await api.getTask(taskId);
        client.setQueryData(queryKeys.task(taskId), latest);
        return commit(latest.etag);
      }
    });

    publishSaved(client, taskId, { data: saved.data.task, etag: saved.etag });

    update(id, { status: 'done', percent: 100 });

    // Successful uploads clear themselves; the attachment grid is the
    // record from here on, and a growing list of green ticks is clutter.
    window.setTimeout(() => dismissUpload(id), 1500);
  } catch (error) {
    if (error instanceof UploadCancelled || controller.signal.aborted) {
      update(id, { status: 'cancelled' });
    } else {
      update(id, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  } finally {
    controllers.delete(id);
  }
}

/**
 * Start uploading files to a task, from anywhere.
 *
 * Several run concurrently; one failure does not stop the rest.
 */
export function startUploads(
  client: QueryClient,
  taskId: string,
  files: readonly File[],
  nodeId?: string,
): void {
  for (const file of files) void uploadOne(client, taskId, file, nodeId);
}

/** The uploads belonging to one task, and the controls for them. */
export function useUploads(taskId: string) {
  const client = useQueryClient();
  const all = useSyncExternalStore(subscribe, getItems, getItems);
  const uploads = useMemo(() => all.filter((item) => item.taskId === taskId), [all, taskId]);

  const upload = useCallback(
    (files: readonly File[], nodeId?: string): void => startUploads(client, taskId, files, nodeId),
    [client, taskId],
  );

  return { uploads, upload, cancel: cancelUpload, dismiss: dismissUpload };
}

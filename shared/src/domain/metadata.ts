import { countChildren, getPercent, isTaskComplete } from './completion.js';
import { isValidIsoDate } from './dates.js';
import { totalAttachmentCount } from './tree.js';
import type { TaskDocument, TaskSummary } from './schemas.js';

/**
 * Blob metadata projection (§3 decision 2, §5).
 *
 * The list view is built from a blob *listing*, not from opening every blob:
 * Azure returns metadata inline on a list call, so one request populates the
 * whole left panel. That is why these fields are denormalised here.
 *
 * Two rules govern this module:
 *
 *  1. Metadata is a **cache**. Truth lives in the JSON document. Anything that
 *     cannot be rebuilt from the document must not live here.
 *  2. Values must be header-safe ASCII. Swedish titles are not — `Färdig` in a
 *     raw metadata header is a protocol violation, not a display bug — so text
 *     is base64-encoded rather than stripped. Stripping would lose data the
 *     list view actually renders.
 *
 * // SCALE: this listing-driven approach is fine to roughly 1,000 tasks. Past
 * // that, add a projection blob rebuilt by a queue-triggered function and swap
 * // the repository's list implementation. Nothing outside the repository needs
 * // to change — see docs/ARCHITECTURE.md.
 */

/** Metadata names must be valid C# identifiers; Azure lowercases them on read. */
export const TASK_METADATA_KEYS = {
  titleB64: 'titleb64',
  date: 'taskdate',
  isComplete: 'iscomplete',
  percent: 'percent',
  completedDate: 'completeddate',
  childCount: 'childcount',
  childDoneCount: 'childdonecount',
  attachmentCount: 'attachmentcount',
  updatedAt: 'updatedat',
  listId: 'listid',
  schemaVersion: 'schemaversion',
} as const;

/** Index tags allow server-side filtering without opening blobs. Max 10 per blob. */
export const TASK_TAG_KEYS = {
  isComplete: 'isComplete',
  date: 'date',
  listId: 'listId',
  deleted: 'deleted',
} as const;

/* -------------------------------------------------------------------------- */
/* Base64 for non-ASCII text                                                   */
/* -------------------------------------------------------------------------- */

/**
 * UTF-8 safe base64 that works identically in the browser and in Node 20.
 * `btoa` alone throws on characters above U+00FF, so the string is encoded to
 * bytes first.
 */
export function encodeMetadataText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeMetadataText(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

export function toBlobMetadata(document: TaskDocument): Record<string, string> {
  const { root } = document;
  const { total, done } = countChildren(root);
  const percent = getPercent(root) ?? (isTaskComplete(root) ? 100 : 0);

  const metadata: Record<string, string> = {
    [TASK_METADATA_KEYS.titleB64]: encodeMetadataText(root.title),
    [TASK_METADATA_KEYS.date]: root.date,
    [TASK_METADATA_KEYS.isComplete]: String(isTaskComplete(root)),
    [TASK_METADATA_KEYS.percent]: String(percent),
    [TASK_METADATA_KEYS.childCount]: String(total),
    [TASK_METADATA_KEYS.childDoneCount]: String(done),
    [TASK_METADATA_KEYS.attachmentCount]: String(totalAttachmentCount(root)),
    [TASK_METADATA_KEYS.updatedAt]: root.updatedAt,
    [TASK_METADATA_KEYS.schemaVersion]: String(document.schemaVersion),
  };

  // Azure drops empty metadata values inconsistently across SDK versions, so
  // absent values are omitted rather than written as ''.
  if (root.completedDate !== null) {
    metadata[TASK_METADATA_KEYS.completedDate] = root.completedDate;
  }
  if (document.listId !== null) {
    metadata[TASK_METADATA_KEYS.listId] = document.listId;
  }

  return metadata;
}

/**
 * Index tags for server-side filtering.
 *
 * Tag values accept alphanumerics plus a small punctuation set; ULIDs and ISO
 * dates are both already within it, so nothing needs escaping.
 */
export function toBlobTags(document: TaskDocument): Record<string, string> {
  const tags: Record<string, string> = {
    [TASK_TAG_KEYS.isComplete]: String(isTaskComplete(document.root)),
    [TASK_TAG_KEYS.date]: document.root.date,
    [TASK_TAG_KEYS.deleted]: String(document.deletedAt !== null),
  };
  if (document.listId !== null) {
    tags[TASK_TAG_KEYS.listId] = document.listId;
  }
  return tags;
}

function readInt(source: Record<string, string>, key: string, fallback: number): number {
  const raw = source[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Rebuild a summary from a listing result.
 *
 * Returns null when metadata is missing or unusable rather than throwing: a
 * blob written by an older build, or one whose metadata was cleared, should
 * degrade to "open it to find out" instead of breaking the entire list view.
 * The caller can fall back to reading the document.
 */
export function fromBlobMetadata(
  id: string,
  metadata: Record<string, string> | undefined,
  etag?: string,
): TaskSummary | null {
  if (metadata === undefined) return null;

  const encodedTitle = metadata[TASK_METADATA_KEYS.titleB64];
  const date = metadata[TASK_METADATA_KEYS.date];
  const updatedAt = metadata[TASK_METADATA_KEYS.updatedAt];
  if (encodedTitle === undefined || date === undefined || updatedAt === undefined) return null;
  if (!isValidIsoDate(date)) return null;

  let title: string;
  try {
    title = decodeMetadataText(encodedTitle);
  } catch {
    return null;
  }

  const completedDate = metadata[TASK_METADATA_KEYS.completedDate];
  const listId = metadata[TASK_METADATA_KEYS.listId];

  return {
    id,
    listId: listId ?? null,
    title,
    date,
    isComplete: metadata[TASK_METADATA_KEYS.isComplete] === 'true',
    percent: readInt(metadata, TASK_METADATA_KEYS.percent, 0),
    completedDate:
      completedDate !== undefined && isValidIsoDate(completedDate) ? completedDate : null,
    childCount: readInt(metadata, TASK_METADATA_KEYS.childCount, 0),
    childDoneCount: readInt(metadata, TASK_METADATA_KEYS.childDoneCount, 0),
    attachmentCount: readInt(metadata, TASK_METADATA_KEYS.attachmentCount, 0),
    updatedAt,
    ...(etag !== undefined ? { etag } : {}),
  };
}

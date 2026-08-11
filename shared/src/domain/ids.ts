import { monotonicFactory } from 'ulid';

/**
 * Identifier generation.
 *
 * ULIDs rather than UUIDv4 because they sort lexicographically by creation time.
 * That property is doing real work here: blob listing returns names in
 * lexicographic order, so `{taskId}.json` blobs come back oldest-first for free,
 * with no index and no sort key.
 *
 * **Monotonic** on purpose. The plain `ulid()` export draws fresh randomness on
 * every call, so two ids minted in the same millisecond sort in random order
 * relative to each other — which silently breaks the ordering guarantee above
 * exactly when it matters most: a burst of tasks created together. The
 * monotonic factory increments the random component instead, guaranteeing
 * strictly increasing ids within a millisecond.
 *
 * Wrapped in this module so the generator is swappable — nothing else in the
 * codebase imports `ulid` directly.
 */

const nextUlid = monotonicFactory();

/** Opaque-ish aliases. They document intent at call sites; they do not enforce. */
export type TaskId = string;
export type AttachmentId = string;
export type TaskListId = string;

export function newTaskId(): TaskId {
  return nextUlid();
}

export function newAttachmentId(): AttachmentId {
  return nextUlid();
}

export function newTaskListId(): TaskListId {
  return nextUlid();
}

/** ULIDs are 26 characters of Crockford base32. */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

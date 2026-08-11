/**
 * Domain-wide limits.
 *
 * Depth is 0-indexed: depth 0 is a main task, depth 1 is a subtask.
 * `MAX_TASK_DEPTH` counts *levels*, so the deepest addressable depth index is
 * `MAX_TASK_DEPTH - 1`.
 *
 * The spec's inline comment said "children empty at depth === MAX_TASK_DEPTH",
 * which contradicts a cap of 2 with a completion policy keyed {0, 1}. We read
 * the cap as a level count, because that is the reading consistent with the
 * policy table. See docs/DECISIONS.md ADR-0006.
 *
 * Raising this to 3 must be a config change, not a refactor: nothing below
 * hardcodes "main task" or "subtask", and completionPolicy decides behaviour
 * per depth.
 */
export const MAX_TASK_DEPTH = 2;

/** Deepest depth index a node may occupy. Nodes here can never have children. */
export const DEEPEST_TASK_DEPTH = MAX_TASK_DEPTH - 1;

/** `Uppgift` — 1..200 characters, matching the source workbook's practical limit. */
export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 200;

/** `Kommentarer` is free multi-line text. Capped only to keep a blob sane. */
export const COMMENTS_MAX_LENGTH = 10_000;

/**
 * How much of Kommentarer is denormalised into blob metadata for the list view.
 *
 * The spec is emphatic that Kommentarer must be visible in the list row, and
 * the list is built from a blob listing without opening documents (ADR-0002).
 * So a preview has to travel in metadata. 200 characters is far more than a
 * truncated single-line cell can show, and metadata has an 8 KB budget that
 * this uses about 5% of.
 */
export const COMMENTS_PREVIEW_LENGTH = 200;

/** User-definable list names (the left-panel grouping level). */
export const LIST_NAME_MIN_LENGTH = 1;
export const LIST_NAME_MAX_LENGTH = 60;

/** Attachment upload ceiling, enforced both client-side and in the SAS handler. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Percent is an integer 0..100. Percent is progress, never authority on "done". */
export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;

/**
 * The timezone the business operates in. `completedDate` and the `date` default
 * are calendar dates, so they must be resolved in a real timezone rather than
 * UTC — otherwise a task completed at 01:00 in Sweden is stamped with yesterday.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Stockholm';

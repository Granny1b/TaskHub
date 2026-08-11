import { z } from 'zod';
import {
  ATTACHMENT_MAX_BYTES,
  COMMENTS_MAX_LENGTH,
  LIST_NAME_MAX_LENGTH,
  LIST_NAME_MIN_LENGTH,
  PERCENT_MAX,
  PERCENT_MIN,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from './constants.js';
import { isValidIsoDate, isValidIsoDateTime } from './dates.js';

/**
 * Zod schemas are the single source of truth for the domain. TypeScript types
 * are inferred from them (`z.infer`) and never written twice. The same schema
 * validates in the browser (form feedback) and in the Function (trust boundary).
 *
 * One deliberate constraint: **no `.default()` inside persisted schemas.**
 * A default makes a schema's input type diverge from its output type, which
 * turns every downstream annotation into a two-parameter generic and makes the
 * recursive `TaskNode` link below impossible to express cleanly. Defaults live
 * in the `create*` factories instead, where they are easier to read anyway.
 */

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD`. Used by `date` (Datum) and `completedDate` (Färdig datum). */
export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: 'Expected a real ISO calendar date (YYYY-MM-DD)' });

/** Full ISO 8601 instant. Used by audit stamps. */
export const isoDateTimeSchema = z
  .string()
  .refine(isValidIsoDateTime, { message: 'Expected an ISO 8601 date-time' });

/**
 * Who did something. This is the Entra ID object id from `x-ms-client-principal`,
 * never a display name and never anything the client supplied.
 */
export const actorSchema = z.string().min(1).max(200);

export const ulidSchema = z.string().length(26);

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Completion differs by depth, so it is a discriminated union rather than one
 * node type carrying optional fields. A subtask cannot hold a meaningless
 * percent, because the shape that has `percent` is not the shape it is given.
 *
 * Which kind a node gets is decided by `completionPolicy`, not by hardcoding.
 */
export const completionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('checkbox'),
    isComplete: z.boolean(),
  }),
  z.object({
    kind: z.literal('percent'),
    /** Progress reporting only. Never the authority on "done". */
    percent: z.number().int().min(PERCENT_MIN).max(PERCENT_MAX),
    /** The override. Wins outright over percent. */
    isComplete: z.boolean(),
    percentSource: z.enum(['manual', 'derived']),
  }),
]);

export type Completion = z.infer<typeof completionSchema>;
export type CompletionKind = Completion['kind'];
export type PercentCompletion = Extract<Completion, { kind: 'percent' }>;
export type CheckboxCompletion = Extract<Completion, { kind: 'checkbox' }>;

/* -------------------------------------------------------------------------- */
/* Attachments                                                                 */
/* -------------------------------------------------------------------------- */

export const attachmentSchema = z.object({
  id: ulidSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().max(ATTACHMENT_MAX_BYTES),
  blobPath: z.string().min(1).max(1024),
  /** Client-generated, images only. Null for every other type. */
  thumbnailPath: z.string().min(1).max(1024).nullable(),
  uploadedAt: isoDateTimeSchema,
  uploadedBy: actorSchema,
});

export type Attachment = z.infer<typeof attachmentSchema>;

/* -------------------------------------------------------------------------- */
/* TaskNode                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every field of a node except the recursive link. Exported so other schemas can
 * `.extend()` / `.pick()` it — the recursive schema below cannot, because
 * annotating it as `z.ZodType` erases the builder methods.
 */
export const taskNodeBaseSchema = z.object({
  id: ulidSchema,
  /** Uppgift */
  title: z.string().min(TITLE_MIN_LENGTH).max(TITLE_MAX_LENGTH),
  /** Datum — the date the task was raised (see ADR-0005). */
  date: isoDateSchema,
  /** Kommentarer — free multi-line text, shown in the list row, not hidden away. */
  comments: z.string().max(COMMENTS_MAX_LENGTH),
  completion: completionSchema,
  /** Färdig datum. Auto-stamped on completion, but always manually editable. */
  completedDate: isoDateSchema.nullable(),
  /** Sparse float. See ordering.ts — never computed at a call site. */
  order: z.number().finite(),
  attachments: z.array(attachmentSchema),
  createdAt: isoDateTimeSchema,
  createdBy: actorSchema,
  updatedAt: isoDateTimeSchema,
  updatedBy: actorSchema,
  /**
   * Extension point (§9.2). New per-task fields land here without a schema
   * migration; `fieldRegistry` drives how they render. Never remove this.
   */
  custom: z.record(z.string(), z.unknown()),
});

/**
 * The recursive link is the one place a type is hand-written, because
 * TypeScript cannot infer a self-referencing const. Every *field* is still
 * declared exactly once, in `taskNodeBaseSchema` above.
 */
export interface TaskNode extends z.infer<typeof taskNodeBaseSchema> {
  children: TaskNode[];
}

export const taskNodeSchema: z.ZodType<TaskNode> = taskNodeBaseSchema.extend({
  get children() {
    return z.array(taskNodeSchema);
  },
});

/* -------------------------------------------------------------------------- */
/* TaskDocument — what actually lives in a blob                                */
/* -------------------------------------------------------------------------- */

/** Bumped whenever the persisted shape changes. Every read runs `migrate()`. */
export const CURRENT_SCHEMA_VERSION = 1;

export const taskDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  /** Always equal to `root.id`; enforced by the refinement below. */
  id: ulidSchema,
  /**
   * The user-definable list this task belongs to, or null for ungrouped.
   * Lives on the document rather than the node because it is a property of the
   * whole aggregate — subtasks are never in a different list from their parent.
   */
  listId: ulidSchema.nullable(),
  root: taskNodeSchema,
  /** Soft delete (§5). v1 never hard-deletes on a user action. */
  deletedAt: isoDateTimeSchema.nullable(),
});

export type TaskDocumentInput = z.infer<typeof taskDocumentSchema>;

export const validatedTaskDocumentSchema = taskDocumentSchema.refine(
  (doc) => doc.id === doc.root.id,
  { message: 'TaskDocument.id must equal root.id', path: ['id'] },
);

export type TaskDocument = TaskDocumentInput;

/* -------------------------------------------------------------------------- */
/* TaskList — the user-definable grouping level                                */
/* -------------------------------------------------------------------------- */

/**
 * A named list the user creates and calls whatever they like ("Maskin 7",
 * "Kundprojekt Volvo", "Att göra"). This is the level above a main task and it
 * drives the left panel.
 *
 * Unlike tasks, all lists live in a single blob — they are read together,
 * reordered together and written rarely. See ADR-0004.
 */
export const taskListSchema = z.object({
  id: ulidSchema,
  name: z.string().min(LIST_NAME_MIN_LENGTH).max(LIST_NAME_MAX_LENGTH),
  /** Sparse float, same scheme as tasks. */
  order: z.number().finite(),
  /** Optional accent for the left panel. A token name, never a raw hex. */
  colorToken: z.string().max(40).nullable(),
  createdAt: isoDateTimeSchema,
  createdBy: actorSchema,
  updatedAt: isoDateTimeSchema,
  updatedBy: actorSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type TaskList = z.infer<typeof taskListSchema>;

export const taskListsDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  lists: z.array(taskListSchema),
});

export type TaskListsDocument = z.infer<typeof taskListsDocumentSchema>;

/* -------------------------------------------------------------------------- */
/* List-view projection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the list view needs, and nothing more. Built from blob metadata so one
 * listing call populates the whole left panel without opening any blob.
 *
 * This is a *cache*. Truth is always inside the JSON document.
 */
export const taskSummarySchema = z.object({
  id: ulidSchema,
  listId: ulidSchema.nullable(),
  title: z.string(),
  /** First COMMENTS_PREVIEW_LENGTH characters of Kommentarer, for the list row. */
  commentsPreview: z.string(),
  date: isoDateSchema,
  isComplete: z.boolean(),
  percent: z.number().int().min(PERCENT_MIN).max(PERCENT_MAX),
  completedDate: isoDateSchema.nullable(),
  childCount: z.number().int().nonnegative(),
  childDoneCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
  /**
   * The manual sort position, mirrored from `root.order`.
   *
   * Main tasks live in separate blobs, so unlike subtasks their order cannot be
   * read from a parent. It rides in the blob metadata cache instead, which is
   * what lets the list view sort without opening anything (ADR-0034).
   */
  order: z.number().finite(),
  etag: z.string().optional(),
});

export type TaskSummary = z.infer<typeof taskSummarySchema>;

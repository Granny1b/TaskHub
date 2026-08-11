import {
  COMMENTS_MAX_LENGTH,
  LIST_NAME_MAX_LENGTH,
  LIST_NAME_MIN_LENGTH,
  PERCENT_MAX,
  PERCENT_MIN,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  isoDateSchema,
  ulidSchema,
} from '@taskhub/shared';
import { z } from 'zod';

/**
 * Request payload schemas — the trust boundary.
 *
 * These are deliberately *not* the persisted schemas. A client may send a
 * title and comments; it may not send `createdBy`, `updatedAt`, `order` or an
 * `id`, because those are the server's to decide. Reusing the document schema
 * here would quietly accept all of them and let a client forge an audit trail.
 */

export const createTaskRequestSchema = z.object({
  title: z.string().min(TITLE_MIN_LENGTH).max(TITLE_MAX_LENGTH),
  date: isoDateSchema.optional(),
  comments: z.string().max(COMMENTS_MAX_LENGTH).optional(),
  listId: ulidSchema.nullable().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/**
 * A partial update of a single node.
 *
 * `percent` and `isComplete` are separate fields on purpose. They are separate
 * acts: setting progress to 100 is not the same as declaring the task done, and
 * collapsing them into one field would make that distinction unexpressible.
 */
export const patchNodeRequestSchema = z
  .object({
    title: z.string().min(TITLE_MIN_LENGTH).max(TITLE_MAX_LENGTH).optional(),
    date: isoDateSchema.optional(),
    comments: z.string().max(COMMENTS_MAX_LENGTH).optional(),
    isComplete: z.boolean().optional(),
    percent: z.number().int().min(PERCENT_MIN).max(PERCENT_MAX).optional(),
    /** Send `'derived'` to use the "back to auto" affordance. */
    percentSource: z.enum(['manual', 'derived']).optional(),
    completedDate: isoDateSchema.nullable().optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'A patch must change at least one field',
  });
export type PatchNodeRequest = z.infer<typeof patchNodeRequestSchema>;

export const patchTaskRequestSchema = z.object({
  node: patchNodeRequestSchema.optional(),
  /** Move the task to a different user-defined list, or to none. */
  listId: ulidSchema.nullable().optional(),
});
export type PatchTaskRequest = z.infer<typeof patchTaskRequestSchema>;

export const addChildRequestSchema = z.object({
  title: z.string().min(TITLE_MIN_LENGTH).max(TITLE_MAX_LENGTH),
  date: isoDateSchema.optional(),
  comments: z.string().max(COMMENTS_MAX_LENGTH).optional(),
  /** Defaults to the root when absent, which is the only option at depth 2. */
  parentId: ulidSchema.optional(),
});
export type AddChildRequest = z.infer<typeof addChildRequestSchema>;

export const reorderRequestSchema = z.object({
  movedId: ulidSchema,
  toIndex: z.number().int().nonnegative(),
  parentId: ulidSchema.optional(),
});
export type ReorderRequest = z.infer<typeof reorderRequestSchema>;

/**
 * Reordering main tasks is anchored to a neighbour, not to an index.
 *
 * Deliberately unlike the sibling reorder above, which takes `toIndex`. Children
 * are all present in one document, so the client's index and the server's agree.
 * Main tasks are separate blobs and the client is usually looking at a filtered
 * or searched subset, where row 3 on screen is not task 3 in the true order.
 * `afterId: null` means the head of the list.
 */
export const reorderTasksRequestSchema = z.object({
  movedId: ulidSchema,
  afterId: ulidSchema.nullable(),
});
export type ReorderTasksRequest = z.infer<typeof reorderTasksRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Lists                                                                       */
/* -------------------------------------------------------------------------- */

export const createListRequestSchema = z.object({
  name: z.string().trim().min(LIST_NAME_MIN_LENGTH).max(LIST_NAME_MAX_LENGTH),
  colorToken: z.string().max(40).nullable().optional(),
});
export type CreateListRequest = z.infer<typeof createListRequestSchema>;

export const patchListRequestSchema = z
  .object({
    name: z.string().trim().min(LIST_NAME_MIN_LENGTH).max(LIST_NAME_MAX_LENGTH).optional(),
    colorToken: z.string().max(40).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'A patch must change at least one field',
  });
export type PatchListRequest = z.infer<typeof patchListRequestSchema>;

export const reorderListsRequestSchema = z.object({
  movedId: ulidSchema,
  toIndex: z.number().int().nonnegative(),
});
export type ReorderListsRequest = z.infer<typeof reorderListsRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Attachments                                                                 */
/* -------------------------------------------------------------------------- */

export const attachmentSasRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  /** Which node the attachment belongs to. Defaults to the root. */
  nodeId: ulidSchema.optional(),
});
export type AttachmentSasRequest = z.infer<typeof attachmentSasRequestSchema>;

export const attachmentCommitRequestSchema = z.object({
  attachmentId: ulidSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  blobPath: z.string().min(1).max(1024),
  thumbnailPath: z.string().min(1).max(1024).nullable().optional(),
  nodeId: ulidSchema.optional(),
});
export type AttachmentCommitRequest = z.infer<typeof attachmentCommitRequestSchema>;

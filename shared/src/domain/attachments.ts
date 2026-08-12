import { ATTACHMENT_MAX_BYTES } from './constants.js';
import type { MutationContext } from './context.js';
import { DomainError, invalidOperation } from './errors.js';
import type { Attachment, TaskNode } from './schemas.js';

/**
 * Attachment rules that belong to the domain rather than to the upload pipeline.
 *
 * The pipeline itself (SAS grant, direct browser upload, commit) is Phase 5.
 * What lives here is everything that must hold regardless of how bytes arrive:
 * the blob path convention, filename sanitisation, and the size and type gates.
 * The Function enforces these at the trust boundary; the client uses the same
 * functions for instant feedback.
 */

/**
 * Extension allowlist. Deliberately a list of what is permitted rather than a
 * list of what is blocked — a blocklist is one new file format away from being
 * wrong, and this is a shop-floor tool where the useful set is small and known.
 */
export const ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'dxf',
  'dwg',
  'step',
  'stp',
  'igs',
  'iges',
  'zip',
] as const;

/**
 * Both HEIC spellings are here because iPhones produce both: `image/heic` for a
 * single photo and `image/heif` for the sequence container. A phone is the main
 * camera this app has, so a photo it refuses to accept is a bug in the list.
 */
export const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

export function isAllowedExtension(fileName: string): boolean {
  const extension = extensionOf(fileName);
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extension);
}

export function isImageContentType(contentType: string): boolean {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/**
 * Make a filename safe for a blob path while keeping it recognisable.
 *
 * Blob names are far more permissive than this, but a name that survives being
 * put in a URL, a Content-Disposition header and a Windows file dialog without
 * argument is worth more than fidelity to the original bytes. Swedish letters
 * are transliterated rather than stripped so `Ritning-Färdig.pdf` stays legible.
 */
export function sanitizeFileName(fileName: string): string {
  const transliterated = fileName
    .replace(/[åÅ]/g, 'a')
    .replace(/[äÄ]/g, 'a')
    .replace(/[öÖ]/g, 'o')
    .replace(/[éÉèÈêÊ]/g, 'e')
    .replace(/[üÜ]/g, 'u');

  const cleaned = transliterated
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');

  const safe = cleaned.length === 0 ? 'file' : cleaned;
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

/** `{taskId}/{attachmentId}/{sanitizedFileName}` (§5). */
export function attachmentBlobPath(taskId: string, attachmentId: string, fileName: string): string {
  return `${taskId}/${attachmentId}/${sanitizeFileName(fileName)}`;
}

/** `{taskId}/{attachmentId}/thumb.jpg` (§5). */
export function thumbnailBlobPath(taskId: string, attachmentId: string): string {
  return `${taskId}/${attachmentId}/thumb.jpg`;
}

/**
 * Validate an upload request before a SAS is issued.
 *
 * Note what this cannot do: the declared content type and size come from the
 * client and a client can lie. The commit step re-checks the *actual* blob size
 * against the declaration, which is the check that matters.
 */
export function assertUploadAllowed(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): void {
  if (input.fileName.trim().length === 0) {
    throw invalidOperation('An attachment must have a filename');
  }
  if (!isAllowedExtension(input.fileName)) {
    throw invalidOperation(`File type not allowed: ${extensionOf(input.fileName) || '(none)'}`, {
      fileName: input.fileName,
      allowed: ALLOWED_EXTENSIONS,
    });
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw invalidOperation('Attachment size must be a positive number of bytes');
  }
  if (input.sizeBytes > ATTACHMENT_MAX_BYTES) {
    throw new DomainError(
      'payload_too_large',
      `Attachment exceeds the ${Math.floor(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB limit`,
      { sizeBytes: input.sizeBytes, maxBytes: ATTACHMENT_MAX_BYTES },
    );
  }
}

export function addAttachment(
  node: TaskNode,
  attachment: Attachment,
  ctx: MutationContext,
): TaskNode {
  return {
    ...node,
    attachments: [...node.attachments, attachment],
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  };
}

export function removeAttachment(
  node: TaskNode,
  attachmentId: string,
  ctx: MutationContext,
): TaskNode {
  return {
    ...node,
    attachments: node.attachments.filter((attachment) => attachment.id !== attachmentId),
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
  };
}

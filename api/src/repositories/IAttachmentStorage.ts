/**
 * Attachment blob operations, behind an interface for the same reason
 * `ITaskRepository` exists: handlers and domain code must not know that Azure
 * Blob Storage is what is underneath (ADR-0003).
 *
 * Uploads go **browser → Blob Storage directly** via a short-lived SAS and
 * never pass through a Function (§11). That dodges request-size limits and
 * keeps Function execution time near zero, which matters on the Free tier.
 */
export interface UploadGrant {
  /** A write-only, single-blob, short-lived URL the browser PUTs to. */
  readonly uploadUrl: string;
  readonly blobPath: string;
  readonly expiresOn: string;
}

export interface ReadGrant {
  readonly url: string;
  readonly expiresOn: string;
}

export interface BlobFacts {
  readonly exists: boolean;
  readonly sizeBytes: number;
}

export interface IAttachmentStorage {
  /**
   * Grant permission to upload exactly one blob, for a few minutes.
   *
   * Scoped to a single blob path and write-only on purpose: a leaked grant can
   * overwrite the one blob it names and nothing else, and cannot read anything.
   */
  createUploadGrant(input: { blobPath: string; contentType: string }): Promise<UploadGrant>;

  /** A short-lived read URL, fetched on demand. Containers are never public. */
  createReadGrant(blobPath: string): Promise<ReadGrant>;

  /**
   * Does the blob exist, and how big is it really?
   *
   * The commit step uses this to check the *actual* size against what the
   * client declared. The declared size gated the SAS; this is the check that
   * cannot be lied to.
   */
  statBlob(blobPath: string): Promise<BlobFacts>;

  /** Delete every blob under a prefix. Used to clean up a task's attachments. */
  deletePrefix(prefix: string): Promise<number>;
}

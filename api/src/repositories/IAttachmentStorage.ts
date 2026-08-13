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

/**
 * One stored blob, as storage itself describes it.
 *
 * Note what this is *not*: it is not an `Attachment`. An Attachment is a record
 * inside a task document — it has an uploader and a display filename and it can
 * be removed from the task. This is the byte-level truth underneath, which is
 * what a storage view has to be built on if it is going to answer "what am I
 * actually paying to keep".
 */
export interface StoredBlob {
  readonly blobPath: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  /** ISO 8601. Storage's own timestamp, not one the client supplied. */
  readonly lastModified: string;
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
   * A read URL that saves rather than opens.
   *
   * The difference is one SAS field: `contentDisposition`, which the service
   * echoes back as a response header. A browser given `attachment; filename=…`
   * downloads under that name instead of rendering a JPEG in a tab. Doing it
   * here rather than proxying the bytes through a Function keeps a 20 MB
   * download off the Free tier's execution budget entirely.
   */
  createDownloadGrant(blobPath: string, fileName: string): Promise<ReadGrant>;

  /**
   * Every blob in the container.
   *
   * One listing rather than opening every task document: this is what makes a
   * storage view affordable. `ListBlobs` is billed at the write rate (~€0.05
   * per 10,000) and returns a page of results per call, against 500+ reads to
   * assemble the same answer from the task blobs — see docs/COSTS.md §3.
   */
  listAll(): Promise<StoredBlob[]>;

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

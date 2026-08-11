/**
 * Direct browser-to-blob upload.
 *
 * The spec suggests the `@azure/storage-blob` browser SDK. This uses a plain
 * `XMLHttpRequest` PUT instead, for two reasons:
 *
 * 1. **Bundle cost.** The SDK exists to manage credentials, retries, chunking
 *    and a large surface of blob operations. We do exactly one thing — PUT a
 *    single block blob to a URL that already carries its own authentication —
 *    and paying the SDK's weight in every page load to do it is a poor trade in
 *    an app whose whole design is shaped by cost.
 * 2. **Progress and cancel come free.** `XMLHttpRequest.upload.onprogress` is
 *    still the only way to observe upload progress in a browser: `fetch` has no
 *    equivalent, which is precisely the feature the spec asks for.
 *
 * See docs/DECISIONS.md ADR-0027.
 */

export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly percent: number;
}

export interface UploadOptions {
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly signal?: AbortSignal;
}

export class UploadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelled';
  }
}

/**
 * PUT one blob to a SAS URL.
 *
 * `x-ms-blob-type: BlockBlob` is mandatory — without it Azure rejects the
 * request, and the storage CORS rule must list the header or the browser
 * preflight fails before the upload even starts. Both are easy to get wrong and
 * fail in ways that look like a permissions problem.
 */
export function uploadToSas(
  uploadUrl: string,
  body: Blob,
  contentType: string,
  options: UploadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl, true);
    request.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    request.setRequestHeader('Content-Type', contentType);

    const onAbort = (): void => request.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => options.signal?.removeEventListener('abort', onAbort);

    request.upload.onprogress = (event): void => {
      if (!event.lengthComputable) return;
      options.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: event.total === 0 ? 0 : Math.round((event.loaded / event.total) * 100),
      });
    };

    request.onload = (): void => {
      cleanup();
      if (request.status >= 200 && request.status < 300) {
        // Report 100% explicitly: the final progress event does not always fire.
        options.onProgress?.({ loaded: body.size, total: body.size, percent: 100 });
        resolve();
        return;
      }
      reject(new UploadError(request.status, `Upload failed with ${request.status}`));
    };

    request.onerror = (): void => {
      cleanup();
      // A CORS failure surfaces here indistinguishably from a network drop, so
      // the message names both rather than guessing.
      reject(new UploadError(0, 'Upload failed: network error or storage CORS rejection'));
    };

    request.onabort = (): void => {
      cleanup();
      reject(new UploadCancelled());
    };

    request.send(body);
  });
}

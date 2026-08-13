import { api } from '../../lib/apiClient.js';

/**
 * Short-lived read URLs, resolved once and shared.
 *
 * Every view of an attachment goes through a fresh grant — containers are never
 * public — so without a cache the same photo would cost a request in the task
 * grid, another in the files list and a third in the preview. A module-level
 * Map rather than React state because the sharing has to outlive any one
 * component: scrolling a thumbnail out of view and back must not re-fetch.
 *
 * Grants last 15 minutes and the cache is expiry-aware, so a page left open
 * over lunch renews rather than serving a dead URL.
 */
const urlCache = new Map<string, { url: string; expiresAt: number }>();

/** Refresh a minute early rather than serving a URL that expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/** In-flight requests, so N components asking at once make one call. */
const inFlight = new Map<string, Promise<string>>();

export async function resolveAttachmentUrl(
  taskId: string,
  attachmentId: string,
  thumbnail: boolean,
): Promise<string> {
  const key = `${taskId}/${attachmentId}/${thumbnail ? 'thumb' : 'full'}`;

  const cached = urlCache.get(key);
  if (cached !== undefined && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cached.url;
  }

  /*
    Deduplicate concurrent callers.

    A files list scrolling into view mounts a dozen thumbnails in the same tick,
    all asking for grants. Without this they would each issue their own request
    for a URL the first one is already fetching — a dozen Function invocations
    for one answer.
  */
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;

  const request = api
    .getAttachmentUrl(taskId, attachmentId, { thumbnail })
    .then((grant) => {
      urlCache.set(key, { url: grant.url, expiresAt: Date.parse(grant.expiresOn) });
      return grant.url;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/**
 * Forget everything known about an attachment.
 *
 * Called after a delete: the bytes are gone, so a cached URL for them resolves
 * to a 404 and a thumbnail that would otherwise sit there until it expired.
 */
export function forgetAttachmentUrls(taskId: string, attachmentId: string): void {
  urlCache.delete(`${taskId}/${attachmentId}/thumb`);
  urlCache.delete(`${taskId}/${attachmentId}/full`);
}

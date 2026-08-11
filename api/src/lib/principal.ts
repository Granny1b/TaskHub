import type { HttpRequest } from '@azure/functions';

/**
 * Identity, resolved in exactly one place.
 *
 * Static Web Apps injects `x-ms-client-principal` — base64 JSON describing the
 * signed-in user — after it has validated the session. Nothing else from the
 * client is ever trusted for identity: not a body field, not a query parameter,
 * not another header. If it did not come from this function, it is not identity.
 */

export type Role = 'member' | 'admin';

export interface Principal {
  /** Entra ID object id. Stable, and what we store in `createdBy` / `updatedBy`. */
  readonly userId: string;
  /** Usually the UPN or email. Display and allowlist matching only. */
  readonly userDetails: string;
  readonly identityProvider: string;
  readonly roles: readonly string[];
}

/** The raw shape SWA base64-encodes into the header. */
interface ClientPrincipalPayload {
  userId?: unknown;
  userDetails?: unknown;
  identityProvider?: unknown;
  userRoles?: unknown;
}

export const CLIENT_PRINCIPAL_HEADER = 'x-ms-client-principal';

/**
 * Parse the principal, or null when the request is anonymous or the header is
 * unusable.
 *
 * Deliberately total: a malformed header returns null rather than throwing, so
 * every route treats "no valid identity" identically as a 401. A parse failure
 * here is not a server error — it is an unauthenticated request.
 */
export function getPrincipal(request: HttpRequest): Principal | null {
  const header = request.headers.get(CLIENT_PRINCIPAL_HEADER);
  if (header === null || header.length === 0) return null;

  let payload: ClientPrincipalPayload;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    payload = parsed as ClientPrincipalPayload;
  } catch {
    return null;
  }

  const userId = typeof payload.userId === 'string' ? payload.userId : '';
  if (userId.length === 0) return null;

  const userDetails = typeof payload.userDetails === 'string' ? payload.userDetails : '';
  const identityProvider =
    typeof payload.identityProvider === 'string' ? payload.identityProvider : '';

  const roles = Array.isArray(payload.userRoles)
    ? payload.userRoles.filter((role): role is string => typeof role === 'string')
    : [];

  return { userId, userDetails, identityProvider, roles };
}

/** Build the header value. Used by tests and by the local dev harness. */
export function encodeClientPrincipal(principal: {
  userId: string;
  userDetails?: string;
  identityProvider?: string;
  userRoles?: string[];
}): string {
  return Buffer.from(
    JSON.stringify({
      userId: principal.userId,
      userDetails: principal.userDetails ?? principal.userId,
      identityProvider: principal.identityProvider ?? 'aad',
      userRoles: principal.userRoles ?? ['authenticated'],
    }),
    'utf8',
  ).toString('base64');
}

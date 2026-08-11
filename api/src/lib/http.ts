import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { DomainError, createContext, type MutationContext } from '@taskhub/shared';
import type { z } from 'zod';
import { readAccessPolicy, isAuthorisedUser, type AccessPolicy } from './authorization.js';
import { getPrincipal, type Principal } from './principal.js';
import { forbidden, toProblemResponse, unauthorised } from './problemDetails.js';

/**
 * The shape every handler follows: **authenticate → validate → call the domain
 * → map errors to HTTP** (§6). No business logic lives in a handler.
 *
 * `withAuth` implements the first and last steps once, so no route can forget
 * the allowlist check that substitutes for tenant restriction on the Free tier.
 */

export interface AuthenticatedRequest {
  readonly request: HttpRequest;
  readonly context: InvocationContext;
  readonly principal: Principal;
  readonly policy: AccessPolicy;
  /** Pre-built with the acting principal, so handlers never read the clock. */
  readonly mutation: MutationContext;
}

export type AuthenticatedHandler = (input: AuthenticatedRequest) => Promise<HttpResponseInit>;

/**
 * Wrap a handler with authentication, the allowlist gate, and error mapping.
 *
 * The 403 branch is the one doing real work: on the SWA Free tier any Microsoft
 * account can authenticate, so a valid principal proves only that someone
 * signed in somewhere — not that they belong here.
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const principal = getPrincipal(request);
    if (principal === null) return unauthorised();

    const policy = readAccessPolicy();
    if (!isAuthorisedUser(principal, policy)) {
      // Logged because, on the Free tier, this is the signal that someone
      // outside the organisation found the app.
      context.warn(
        `Rejected non-allowlisted principal ${principal.userId} (${principal.userDetails})`,
      );
      return forbidden();
    }

    try {
      return await handler({
        request,
        context,
        principal,
        policy,
        mutation: createContext(principal.userId),
      });
    } catch (error) {
      return toProblemResponse(error, (message, thrown) => {
        context.error(message, thrown);
      });
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

export function ok<T>(body: T, etag?: string): HttpResponseInit {
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Task state is per-user-session and cheap to fetch; caching it would
      // only create stale-ETag conflicts.
      'Cache-Control': 'no-store',
      ...(etag !== undefined && etag.length > 0 ? { ETag: etag } : {}),
    },
    jsonBody: body,
  };
}

export function created<T>(body: T, etag?: string, location?: string): HttpResponseInit {
  return {
    status: 201,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(etag !== undefined && etag.length > 0 ? { ETag: etag } : {}),
      ...(location !== undefined ? { Location: location } : {}),
    },
    jsonBody: body,
  };
}

export function noContent(): HttpResponseInit {
  return { status: 204 };
}

/* -------------------------------------------------------------------------- */
/* Request reading                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Read `If-Match`, or fail with 428.
 *
 * A mutation without a precondition is never accepted. Silently allowing
 * last-write-wins is the exact bug the ETag layer exists to prevent, and it
 * fails invisibly — the user whose edit vanished never learns it happened.
 *
 * `If-Match: *` is rejected too: it means "if it exists at all", which is
 * last-write-wins wearing a precondition's clothes.
 */
export function requireIfMatch(request: HttpRequest): string {
  const value = request.headers.get('if-match');
  if (value === null || value.trim().length === 0 || value.trim() === '*') {
    throw new DomainError(
      'precondition_required',
      'Mutations require an If-Match header carrying the ETag from a prior GET. ' +
        'Writing without one risks silently discarding another user’s changes.',
    );
  }
  return value.trim();
}

/** Parse and validate a JSON body, throwing a ZodError the mapper understands. */
export async function readJson<T extends z.ZodType>(
  request: HttpRequest,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  return schema.parse(raw) as z.infer<T>;
}

export function routeParam(request: HttpRequest, name: string): string | null {
  const value = request.params[name];
  return value === undefined || value.length === 0 ? null : value;
}

export function queryParam(request: HttpRequest, name: string): string | null {
  return request.query.get(name);
}

export function queryBool(request: HttpRequest, name: string): boolean | undefined {
  const value = request.query.get(name);
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

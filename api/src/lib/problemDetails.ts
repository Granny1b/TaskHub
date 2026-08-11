import type { HttpResponseInit } from '@azure/functions';
import { DomainError, type DomainErrorCode } from '@taskhub/shared';
import { ZodError } from 'zod';

/**
 * RFC 7807 problem+json (§6).
 *
 * The client needs to distinguish "someone else edited this" from every other
 * failure so it can show the non-destructive conflict banner rather than a
 * generic error. That distinction rides on a stable machine-readable `type`,
 * never on parsing a message — messages are for humans and will be translated.
 */

export interface ProblemDetails {
  /** Stable identifier. The client branches on this. */
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  /** Field-level validation issues, when the failure was a bad payload. */
  readonly errors?: readonly { path: string; message: string }[];
}

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  validation_failed: 400,
  invalid_operation: 400,
  depth_exceeded: 422,
  not_found: 404,
  concurrency_conflict: 409,
  precondition_required: 428,
  forbidden: 403,
  payload_too_large: 413,
};

const TITLE_BY_CODE: Record<DomainErrorCode, string> = {
  validation_failed: 'Validation failed',
  invalid_operation: 'Invalid operation',
  depth_exceeded: 'Maximum nesting depth exceeded',
  not_found: 'Not found',
  concurrency_conflict: 'This item was modified by someone else',
  precondition_required: 'If-Match header required',
  forbidden: 'Forbidden',
  payload_too_large: 'Payload too large',
};

export function problemResponse(problem: ProblemDetails): HttpResponseInit {
  return {
    status: problem.status,
    headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
    jsonBody: problem,
  };
}

export function problem(
  type: string,
  status: number,
  title: string,
  detail?: string,
): HttpResponseInit {
  return problemResponse({
    type,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
  });
}

export const unauthorised = (): HttpResponseInit =>
  problem('unauthenticated', 401, 'Authentication required', 'No valid client principal.');

export const forbidden = (detail?: string): HttpResponseInit =>
  problem('forbidden', 403, 'Forbidden', detail ?? 'This account is not permitted to use TaskHub.');

export const notFound = (detail?: string): HttpResponseInit =>
  problem('not_found', 404, 'Not found', detail);

export const preconditionRequired = (detail?: string): HttpResponseInit =>
  problem(
    'precondition_required',
    428,
    'If-Match header required',
    detail ??
      'Mutations require an If-Match header carrying the ETag from a prior GET. ' +
        'Writing without one risks silently discarding another user’s changes.',
  );

export function validationProblem(error: ZodError): HttpResponseInit {
  return problemResponse({
    type: 'validation_failed',
    title: 'Validation failed',
    status: 400,
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/**
 * Map any thrown value to a response.
 *
 * `DomainError` carries its own code, so it maps precisely. Anything else is a
 * bug: it becomes a 500 with a deliberately vague body — internal messages can
 * leak storage paths, account names and stack shapes — while the full error is
 * logged for whoever has to debug it.
 */
export function toProblemResponse(
  error: unknown,
  log: (message: string, error: unknown) => void,
): HttpResponseInit {
  if (error instanceof DomainError) {
    return problemResponse({
      type: error.code,
      title: TITLE_BY_CODE[error.code],
      status: STATUS_BY_CODE[error.code],
      detail: error.message,
    });
  }

  if (error instanceof ZodError) {
    return validationProblem(error);
  }

  log('Unhandled error in HTTP handler', error);
  return problemResponse({
    type: 'internal_error',
    title: 'Internal server error',
    status: 500,
    detail: 'An unexpected error occurred. The failure has been logged.',
  });
}

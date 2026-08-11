/**
 * Domain errors carry a stable machine-readable code so the HTTP layer can map
 * them to RFC 7807 problem+json without string-matching messages (§6).
 */
export type DomainErrorCode =
  | 'validation_failed'
  | 'invalid_operation'
  | 'depth_exceeded'
  | 'not_found'
  | 'concurrency_conflict'
  | 'precondition_required'
  | 'forbidden'
  | 'payload_too_large';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function invalidOperation(message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError('invalid_operation', message, details);
}

export function notFound(message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError('not_found', message, details);
}

export function depthExceeded(message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError('depth_exceeded', message, details);
}

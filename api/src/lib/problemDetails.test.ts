import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@taskhub/shared';
import { z } from 'zod';
import {
  forbidden,
  notFound,
  preconditionRequired,
  toProblemResponse,
  unauthorised,
  validationProblem,
} from './problemDetails.js';

const noopLog = () => {
  /* silence */
};

describe('DomainError mapping', () => {
  it('maps a concurrency conflict to 409 with a type the client can branch on', () => {
    const response = toProblemResponse(
      new DomainError('concurrency_conflict', 'Someone else edited this'),
      noopLog,
    );

    expect(response.status).toBe(409);
    // The client shows a non-destructive "review" banner on exactly this type.
    // It must never have to parse the message, which will be translated.
    expect(response.jsonBody).toMatchObject({ type: 'concurrency_conflict', status: 409 });
  });

  it('maps each domain code to its HTTP status', () => {
    const cases = [
      ['validation_failed', 400],
      ['invalid_operation', 400],
      ['depth_exceeded', 422],
      ['not_found', 404],
      ['concurrency_conflict', 409],
      ['precondition_required', 428],
      ['forbidden', 403],
      ['payload_too_large', 413],
    ] as const;

    for (const [code, status] of cases) {
      const response = toProblemResponse(new DomainError(code, 'message'), noopLog);
      expect(response.status, `${code} should map to ${status}`).toBe(status);
      expect(response.jsonBody).toMatchObject({ type: code });
    }
  });

  it('serves problem+json', () => {
    const response = toProblemResponse(new DomainError('not_found', 'x'), noopLog);
    expect(response.headers).toMatchObject({
      'Content-Type': 'application/problem+json; charset=utf-8',
    });
  });
});

describe('unexpected errors', () => {
  it('becomes a 500 with a deliberately vague body', () => {
    const response = toProblemResponse(
      new Error('Connection string DefaultEndpointsProtocol=https;AccountKey=SECRET'),
      noopLog,
    );

    expect(response.status).toBe(500);
    // Internal messages leak storage paths, account names and key material.
    expect(JSON.stringify(response.jsonBody)).not.toContain('AccountKey');
    expect(JSON.stringify(response.jsonBody)).not.toContain('SECRET');
  });

  it('logs the real error for whoever has to debug it', () => {
    const log = vi.fn();
    const thrown = new Error('boom');
    toProblemResponse(thrown, log);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Unhandled error'), thrown);
  });

  it('handles a non-Error throw without falling over', () => {
    expect(toProblemResponse('a bare string', noopLog).status).toBe(500);
  });
});

describe('validation errors', () => {
  const schema = z.object({ title: z.string().min(1), percent: z.number().int() });

  it('reports the offending field paths', () => {
    const result = schema.safeParse({ title: '', percent: 1.5 });
    if (result.success) throw new Error('fixture should fail');

    const response = validationProblem(result.error);
    expect(response.status).toBe(400);

    const body = response.jsonBody as { errors: { path: string }[] };
    expect(body.errors.map((issue) => issue.path).sort()).toEqual(['percent', 'title']);
  });

  it('is produced automatically when a ZodError escapes a handler', () => {
    const result = schema.safeParse({});
    if (result.success) throw new Error('fixture should fail');
    expect(toProblemResponse(result.error, noopLog).status).toBe(400);
  });
});

describe('canned responses', () => {
  it('401 for an anonymous request', () => {
    expect(unauthorised()).toMatchObject({ status: 401 });
  });

  it('403 for an authenticated but non-allowlisted account', () => {
    const response = forbidden();
    expect(response.status).toBe(403);
    expect(response.jsonBody).toMatchObject({ type: 'forbidden' });
  });

  it('404', () => {
    expect(notFound('gone').status).toBe(404);
  });

  it('428 explains why a bare write is refused', () => {
    const response = preconditionRequired();
    expect(response.status).toBe(428);
    expect(JSON.stringify(response.jsonBody)).toContain('If-Match');
  });
});

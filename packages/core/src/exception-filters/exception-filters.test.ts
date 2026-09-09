import {
  describe,
  expect,
  it,
} from 'bun:test';

import type { OneBunRequest } from '../types';

import { NotFoundError, HttpStatusCode } from '@onebun/requests';

import { HttpExecutionContextImpl } from '../http-guards/http-guards';

import {
  createDefaultExceptionFilter,
  createExceptionFilter,
  defaultExceptionFilter,
  UNHANDLED_ERROR_MESSAGE,
} from './exception-filters';
import { HttpException } from './http-exception';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(): HttpExecutionContextImpl {
  const req = new Request('http://localhost/test') as unknown as OneBunRequest;

  return new HttpExecutionContextImpl(req, 'testHandler', 'TestController');
}

// ============================================================================
// HttpException
// ============================================================================

describe('HttpException', () => {
  it('stores statusCode and message', () => {
    const ex = new HttpException(400, 'Bad request');
    expect(ex).toBeInstanceOf(Error);
    expect(ex.statusCode).toBe(400);
    expect(ex.message).toBe('Bad request');
    expect(ex.name).toBe('HttpException');
  });

  it('works with instanceof check', () => {
    const ex = new HttpException(404, 'Not found');
    expect(ex instanceof HttpException).toBe(true);
    expect(ex instanceof Error).toBe(true);
  });
});

// ============================================================================
// createExceptionFilter
// ============================================================================

describe('createExceptionFilter', () => {
  it('creates a filter that calls the provided function', async () => {
    let caught: unknown;
    const filter = createExceptionFilter((error, _ctx) => {
      caught = error;

      return new Response('handled', { status: 200 });
    });

    const err = new Error('boom');
    const ctx = makeContext();
    const response = await filter.catch(err, ctx);

    expect(caught).toBe(err);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('handled');
  });

  it('receives the execution context', async () => {
    let capturedHandler = '';
    let capturedController = '';

    const filter = createExceptionFilter((_error, ctx) => {
      capturedHandler = ctx.getHandler();
      capturedController = ctx.getController();

      return new Response('ok');
    });

    const ctx = makeContext();
    await filter.catch(new Error('test'), ctx);

    expect(capturedHandler).toBe('testHandler');
    expect(capturedController).toBe('TestController');
  });

  it('supports async filter functions', async () => {
    const filter = createExceptionFilter(async () => {
      await Promise.resolve();

      return new Response('async', { status: 418 });
    });

    const response = await filter.catch(new Error('test'), makeContext());

    expect(response.status).toBe(418);
  });
});

// ============================================================================
// defaultExceptionFilter (proper HTTP status codes)
// ============================================================================

describe('defaultExceptionFilter', () => {
  it('returns proper HTTP status for OneBunBaseError', async () => {
    const error = new NotFoundError('Not found');
    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
    const body = await response.json() as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('returns HTTP 500 for plain Error, without the error message', async () => {
    const error = new Error('Something went wrong');
    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    // The message of an unhandled error is written by whatever threw it, not by the author.
    expect(body.error).toBe(UNHANDLED_ERROR_MESSAGE);
  });

  it('returns HTTP 500 for non-Error values, without stringifying them into the body', async () => {
    const response = await defaultExceptionFilter.catch('string error', makeContext());

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    // `throw someObject` is no safer than `throw new Error(...)`: `String(value)` of a thrown
    // config object is exactly the kind of thing that carries a connection string.
    expect(body.error).toBe(UNHANDLED_ERROR_MESSAGE);
  });

  it('sets Content-Type to application/json', async () => {
    const response = await defaultExceptionFilter.catch(new Error('test'), makeContext());

    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('returns actual HTTP status for HttpException', async () => {
    const error = new HttpException(400, 'Validation failed');
    const response = await defaultExceptionFilter.catch(error, makeContext());
    expect(response.status).toBe(400);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 for HttpException with 404 status', async () => {
    const error = new HttpException(404, 'Not found');
    const response = await defaultExceptionFilter.catch(error, makeContext());
    expect(response.status).toBe(404);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Not found');
  });

  it('does not put a stack trace in the body of an unhandled error', async () => {
    // The response used to carry `error.stack` verbatim on this branch — the DEFAULT path for
    // every unhandled throw. That discloses absolute filesystem paths, dependency versions and
    // internal module layout to any caller who can provoke a 500.
    const response = await defaultExceptionFilter.catch(new Error('boom'), makeContext());
    const body = await response.json() as Record<string, unknown>;

    // `createErrorResponse` always emits the key; what must be gone is its CONTENT.
    expect(body.details).toEqual({});

    // Asserted on the serialised body, not on the parsed object: a stack could arrive nested
    // under a key this test does not name, and the point is that it is not shipped AT ALL.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('stack');
    expect(raw).not.toContain(import.meta.dir);
  });

  it('withholds the internal error class name and non-HTTP code as well', async () => {
    // Same class of disclosure, same undocumented `details` field: `ECONNREFUSED` names the
    // infrastructure and `PostgresConnectionError` names the internals.
    const error = new Error('connect failed');
    error.name = 'PostgresConnectionError';
    (error as Error & { code: string }).code = 'ECONNREFUSED';

    const response = await defaultExceptionFilter.catch(error, makeContext());
    const raw = JSON.stringify(await response.json());

    expect(raw).not.toContain('PostgresConnectionError');
    expect(raw).not.toContain('ECONNREFUSED');
    // And the message with it: `connect failed` is the benign half of a family whose other
    // members name hosts, ports and credentials, and nothing here can tell them apart.
    expect(raw).not.toContain('connect failed');
  });

  it('discloses no path, host:port or connection string from an unhandled error', async () => {
    // The three shapes a runtime error routinely carries, on the raw response text rather than
    // on a parsed field: the point is that none of it is shipped AT ALL, under any key.
    const leaks = [
      "ENOENT: no such file or directory, open '/srv/app/config/private.pem'",
      'connect ECONNREFUSED 10.0.3.17:5432',
      'getaddrinfo ENOTFOUND internal-billing.svc.cluster.local',
      'Invalid URL: postgres://app:hunter2@db.internal:5432/app',
    ];

    for (const leak of leaks) {
      const response = await defaultExceptionFilter.catch(new Error(leak), makeContext());
      const raw = await response.text();

      expect(raw).not.toContain('/srv/app/config');
      expect(raw).not.toContain('10.0.3.17');
      expect(raw).not.toContain('internal-billing.svc.cluster.local');
      expect(raw).not.toContain('hunter2');
      expect(raw).toContain(UNHANDLED_ERROR_MESSAGE);
    }
  });

  it('leaves an author-written HttpException message alone', async () => {
    // The leak is confined to the branch where the text came from a library or the kernel.
    // A message the author chose is client-facing on purpose and still goes out verbatim.
    const response = await defaultExceptionFilter.catch(
      new HttpException(422, 'orderId must be a positive integer'),
      makeContext(),
    );

    expect(await response.text()).toContain('orderId must be a positive integer');
  });

  it('leaves an author-written OneBunBaseError message alone', async () => {
    const response = await defaultExceptionFilter.catch(
      new NotFoundError('No order with that id'),
      makeContext(),
    );

    expect(await response.text()).toContain('No order with that id');
  });

  it('still answers 500 when a non-HTTP code cannot become a status', async () => {
    // `toHttpStatus` maps `ECONNREFUSED` to 500 rather than letting `new Response` throw.
    // Withholding `details` must not disturb that — the status is computed from the same
    // value either way.
    const error = new Error('socket died');
    (error as Error & { code: string }).code = 'ECONNREFUSED';

    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
  });
});

describe('createDefaultExceptionFilter({ exposeErrorDetails })', () => {
  it('is off by default, so an unhandled error carries no details', async () => {
    const filter = createDefaultExceptionFilter();
    const response = await filter.catch(new Error('boom'), makeContext());
    const body = await response.json() as Record<string, unknown>;

    expect(body.details).toEqual({});
  });

  it('returns the real message when explicitly enabled', async () => {
    // One knob, not two: a message naming an internal host is not meaningfully safer than the
    // stack naming the file, so the same flag governs both.
    const filter = createDefaultExceptionFilter({ exposeErrorDetails: true });
    const response = await filter.catch(
      new Error("ENOENT: no such file or directory, open '/srv/app/config/private.pem'"),
      makeContext(),
    );

    expect(await response.text()).toContain('/srv/app/config/private.pem');
  });

  it('adds the stack and the original error identity when explicitly enabled', async () => {
    // The escape hatch exists so a developer can get the old behaviour back deliberately. It
    // is not tied to NODE_ENV: an unset or mistyped NODE_ENV would then leak stacks silently,
    // which is the failure being guarded against.
    const filter = createDefaultExceptionFilter({ exposeErrorDetails: true });
    const error = new Error('boom');
    error.name = 'PostgresConnectionError';

    const response = await filter.catch(error, makeContext());
    const body = await response.json() as { details?: Record<string, unknown> };

    expect(body.details).toBeDefined();
    expect(body.details!.originalErrorName).toBe('PostgresConnectionError');
    expect(typeof body.details!.stack).toBe('string');
  });

  it('leaves the HttpException branch alone in both modes', async () => {
    // Only the unhandled branch ever built `details`; the flag must not start adding one to a
    // deliberate HttpException, whose body is a documented contract.
    for (const exposeErrorDetails of [false, true]) {
      const filter = createDefaultExceptionFilter({ exposeErrorDetails });
      const response = await filter.catch(new HttpException(400, 'Bad input'), makeContext());
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      // Empty on this branch before the change and after it — the flag must not start
      // populating a body that was never carrying details in the first place.
      expect(body.details).toEqual({});
    }
  });
});

// ============================================================================
// httpEnvelope mode (always HTTP 200)
// ============================================================================

describe('createDefaultExceptionFilter with httpEnvelope: true', () => {
  const envelopeFilter = createDefaultExceptionFilter({ httpEnvelope: true });

  it('returns HTTP 200 for OneBunBaseError', async () => {
    const error = new NotFoundError('Not found');
    const response = await envelopeFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; code: number };
    expect(body.success).toBe(false);
    expect(body.code).toBe(HttpStatusCode.NOT_FOUND);
  });

  it('returns HTTP 200 for HttpException', async () => {
    const error = new HttpException(400, 'Validation failed');
    const response = await envelopeFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation failed');
  });

  it('returns HTTP 200 for plain Error', async () => {
    const error = new Error('Something went wrong');
    const response = await envelopeFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    // The envelope changes the STATUS, not what may be disclosed in the body.
    expect(body.error).toBe(UNHANDLED_ERROR_MESSAGE);
  });

  it('returns HTTP 200 for non-Error values', async () => {
    const response = await envelopeFilter.catch('string error', makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe(UNHANDLED_ERROR_MESSAGE);
  });
});

// ============================================================================
// Validation error via HttpException (bug reproduction)
// ============================================================================

describe('Validation error via HttpException (bug reproduction)', () => {
  it('returns 400 with JSON body for validation HttpException', async () => {
    const error = new HttpException(400, 'Parameter body validation failed: name must be a string (was missing)');
    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(400);
    const body = await response.json() as { success: boolean; error: string; statusCode: number };
    expect(body.success).toBe(false);
    expect(body.error).toContain('validation failed');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

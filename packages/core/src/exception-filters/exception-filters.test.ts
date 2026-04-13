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

  it('returns HTTP 500 for plain Error', async () => {
    const error = new Error('Something went wrong');
    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Something went wrong');
  });

  it('returns HTTP 500 for non-Error values', async () => {
    const response = await defaultExceptionFilter.catch('string error', makeContext());

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
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
    expect(body.error).toBe('Something went wrong');
  });

  it('returns HTTP 200 for non-Error values', async () => {
    const response = await envelopeFilter.catch('string error', makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
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

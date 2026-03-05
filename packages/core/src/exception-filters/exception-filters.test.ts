import {
  describe,
  expect,
  it,
} from 'bun:test';

import type { OneBunRequest } from '../types';

import { NotFoundError, HttpStatusCode } from '@onebun/requests';

import { HttpExecutionContextImpl } from '../http-guards/http-guards';

import { createExceptionFilter, defaultExceptionFilter } from './exception-filters';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(): HttpExecutionContextImpl {
  const req = new Request('http://localhost/test') as unknown as OneBunRequest;

  return new HttpExecutionContextImpl(req, 'testHandler', 'TestController');
}

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
// defaultExceptionFilter
// ============================================================================

describe('defaultExceptionFilter', () => {
  it('returns HTTP 200 with serialised OneBunBaseError', async () => {
    const error = new NotFoundError('Not found');
    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('returns HTTP 200 with generic error details for plain Error', async () => {
    const error = new Error('Something went wrong');
    const response = await defaultExceptionFilter.catch(error, makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Something went wrong');
  });

  it('returns HTTP 200 for non-Error values', async () => {
    const response = await defaultExceptionFilter.catch('string error', makeContext());

    expect(response.status).toBe(HttpStatusCode.OK);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
  });

  it('sets Content-Type to application/json', async () => {
    const response = await defaultExceptionFilter.catch(new Error('test'), makeContext());

    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

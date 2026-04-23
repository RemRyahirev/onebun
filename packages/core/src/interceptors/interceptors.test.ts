import {
  describe,
  expect,
  it,
  mock,
} from 'bun:test';

import type {
  ExecutionContext,
  Interceptor,
  OneBunRequest,
  OneBunResponse,
  ResolvedInterceptor,
} from '../types';

import { HttpStatusCode } from '@onebun/requests';

import { HttpException } from '../exception-filters/http-exception';
import { HttpExecutionContextImpl } from '../http-guards/http-guards';

import {
  BaseInterceptor,
  composeInterceptors,
  createInterceptor,
  isHttpContext,
  LoggingInterceptor,
  TimeoutInterceptor,
} from './interceptors';

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(url = 'http://localhost/test', method = 'GET'): OneBunRequest {
  return new Request(url, { method }) as unknown as OneBunRequest;
}

function makeHttpContext(
  url = 'http://localhost/test',
  handler = 'testHandler',
  controller = 'TestController',
): ExecutionContext {
  return new HttpExecutionContextImpl(makeRequest(url), handler, controller);
}

function makeResponse(body = '{"ok":true}', status = 200): OneBunResponse {
  return new Response(body, {
    status,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMockLogger() {
  const logger: Record<string, ReturnType<typeof mock>> = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    info: mock(() => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    warn: mock(() => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    error: mock(() => {}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    debug: mock(() => {}),
    child: mock(() => logger),
  };

  return logger;
}

function makeMockConfig() {
  return {
    get: mock(() => undefined),
  };
}

// ============================================================================
// composeInterceptors
// ============================================================================

describe('composeInterceptors', () => {
  it('calls handler directly when interceptor list is empty', async () => {
    const handler = mock(async () => makeResponse());
    const ctx = makeHttpContext();
    const composed = composeInterceptors([], ctx, handler);

    const response = await composed();

    expect(handler).toHaveBeenCalledTimes(1);
    expect((response as Response).status).toBe(200);
  });

  it('wraps handler with a single interceptor', async () => {
    const order: string[] = [];
    const interceptor: ResolvedInterceptor = async (_ctx, next) => {
      order.push('before');
      const res = await next();
      order.push('after');

      return res;
    };
    const handler = async () => {
      order.push('handler');

      return makeResponse();
    };

    const composed = composeInterceptors([interceptor], makeHttpContext(), handler);
    await composed();

    expect(order).toEqual(['before', 'handler', 'after']);
  });

  it('wraps in onion order (first interceptor outermost)', async () => {
    const order: string[] = [];
    const makeInterceptor = (name: string): ResolvedInterceptor => async (_ctx, next) => {
      order.push(`${name}:before`);
      const res = await next();
      order.push(`${name}:after`);

      return res;
    };

    const handler = async () => {
      order.push('handler');

      return makeResponse();
    };

    const composed = composeInterceptors(
      [makeInterceptor('A'), makeInterceptor('B'), makeInterceptor('C')],
      makeHttpContext(),
      handler,
    );
    await composed();

    expect(order).toEqual([
      'A:before', 'B:before', 'C:before',
      'handler',
      'C:after', 'B:after', 'A:after',
    ]);
  });

  it('allows interceptor to short-circuit without calling next', async () => {
    const handler = mock(async () => makeResponse());
    const shortCircuit: ResolvedInterceptor = async () => makeResponse('cached', 200);

    const composed = composeInterceptors([shortCircuit], makeHttpContext(), handler);
    const response = await composed();

    expect(handler).not.toHaveBeenCalled();
    expect(await (response as Response).text()).toBe('cached');
  });

  it('allows interceptor to transform the response', async () => {
    const interceptor: ResolvedInterceptor = async (_ctx, next) => {
      const response = await next() as Response;
      const body = await response.text();
      const modified = JSON.stringify({ ...JSON.parse(body), extra: true });

      return new Response(modified, {
        status: response.status,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const handler = async () => makeResponse('{"data":"original"}');

    const composed = composeInterceptors([interceptor], makeHttpContext(), handler);
    const response = await composed() as Response;
    const body = await response.json() as { data: string; extra: boolean };

    expect(body.data).toBe('original');
    expect(body.extra).toBe(true);
  });

  it('propagates handler errors through interceptors', async () => {
    const handler = async (): Promise<unknown> => {
      throw new Error('handler failed');
    };
    const interceptor: ResolvedInterceptor = async (_ctx, next) => await next();

    const composed = composeInterceptors([interceptor], makeHttpContext(), handler);

    await expect(composed()).rejects.toThrow('handler failed');
  });

  it('passes correct context to interceptors', async () => {
    let receivedCtx: ExecutionContext | undefined;
    const interceptor: ResolvedInterceptor = async (ctx, next) => {
      receivedCtx = ctx;

      return await next();
    };

    const ctx = makeHttpContext('http://localhost/users', 'getUsers', 'UserController');
    const composed = composeInterceptors([interceptor], ctx, async () => makeResponse());
    await composed();

    expect(receivedCtx).toBeDefined();
    expect(receivedCtx!.type).toBe('http');
    if (isHttpContext(receivedCtx!)) {
      expect(receivedCtx.getHandler()).toBe('getUsers');
      expect(receivedCtx.getController()).toBe('UserController');
    }
  });
});

// ============================================================================
// createInterceptor
// ============================================================================

describe('createInterceptor', () => {
  it('returns a class constructor', () => {
    const interceptorClass = createInterceptor(async (_ctx, next) => await next());

    expect(typeof interceptorClass).toBe('function');
    expect(new interceptorClass()).toBeDefined();
  });

  it('creates instances that implement Interceptor', async () => {
    const fn = mock(async (_ctx: ExecutionContext, next: () => Promise<unknown>) => await next());
    const interceptorClass = createInterceptor(fn);
    const instance: Interceptor = new interceptorClass();

    const ctx = makeHttpContext();
    const handler = async () => makeResponse();
    await instance.intercept(ctx, handler);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes context and next to the factory function', async () => {
    let receivedCtx: ExecutionContext | undefined;
    let nextCalled = false;

    const interceptorClass = createInterceptor(async (ctx, next) => {
      receivedCtx = ctx;
      nextCalled = true;

      return await next();
    });

    const instance = new interceptorClass();
    const ctx = makeHttpContext('http://localhost/test', 'myHandler', 'MyCtrl');
    await instance.intercept(ctx, async () => makeResponse());

    expect(isHttpContext(receivedCtx!)).toBe(true);
    expect(nextCalled).toBe(true);
  });
});

// ============================================================================
// BaseInterceptor
// ============================================================================

describe('BaseInterceptor', () => {
  it('picks up logger and config from ambient init context', () => {
    const logger = makeMockLogger();
    const config = makeMockConfig();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BaseInterceptor.setInitContext(logger as any, config as any);
    try {
      class TestInterceptor extends BaseInterceptor {
        async intercept(_ctx: ExecutionContext, next: () => Promise<unknown>) {
          return await next();
        }

        getLogger() {
          return this.logger;
        }

        getConfig() {
          return this.config;
        }
      }

      const instance = new TestInterceptor();
      expect(instance.getLogger()).toBeDefined();
      expect(instance.getConfig()).toBeDefined();
      expect(logger.child).toHaveBeenCalled();
    } finally {
      BaseInterceptor.clearInitContext();
    }
  });

  it('initializeInterceptor provides fallback initialization', () => {
    class TestInterceptor extends BaseInterceptor {
      async intercept(_ctx: ExecutionContext, next: () => Promise<unknown>) {
        return await next();
      }

      getLogger() {
        return this.logger;
      }
    }

    const instance = new TestInterceptor();
    expect(instance.getLogger()).toBeUndefined();

    const logger = makeMockLogger();
    const config = makeMockConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instance.initializeInterceptor(logger as any, config as any);

    expect(instance.getLogger()).toBeDefined();
  });

  it('initializeInterceptor is a no-op when already initialized', () => {
    const logger1 = makeMockLogger();
    const config1 = makeMockConfig();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BaseInterceptor.setInitContext(logger1 as any, config1 as any);
    try {
      class TestInterceptor extends BaseInterceptor {
        async intercept(_ctx: ExecutionContext, next: () => Promise<unknown>) {
          return await next();
        }

        getLogger() {
          return this.logger;
        }
      }

      const instance = new TestInterceptor();
      const originalLogger = instance.getLogger();

      const logger2 = makeMockLogger();
      const config2 = makeMockConfig();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instance.initializeInterceptor(logger2 as any, config2 as any);

      // Should still have the original logger
      expect(instance.getLogger()).toBe(originalLogger);
    } finally {
      BaseInterceptor.clearInitContext();
    }
  });
});

// ============================================================================
// LoggingInterceptor
// ============================================================================

describe('LoggingInterceptor', () => {
  it('calls next and returns the response', async () => {
    const logger = makeMockLogger();
    const config = makeMockConfig();
    const interceptor = new LoggingInterceptor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interceptor.initializeInterceptor(logger as any, config as any);

    const expectedResponse = makeResponse('{"result":"ok"}');
    const ctx = makeHttpContext('http://localhost/api/users', 'getUsers', 'UserController');
    const response = await interceptor.intercept(ctx, async () => expectedResponse);

    expect(response).toBe(expectedResponse);
  });

  it('logs request and response info for HTTP context', async () => {
    const logger = makeMockLogger();
    const config = makeMockConfig();
    const interceptor = new LoggingInterceptor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interceptor.initializeInterceptor(logger as any, config as any);

    const ctx = makeHttpContext('http://localhost/api/users', 'getUsers', 'UserController');
    await interceptor.intercept(ctx, async () => makeResponse());

    expect(logger.info).toHaveBeenCalledTimes(2);
    const firstCall = logger.info.mock.calls[0][0] as string;
    const secondCall = logger.info.mock.calls[1][0] as string;
    expect(firstCall).toContain('GET');
    expect(firstCall).toContain('/api/users');
    expect(secondCall).toContain('200');
  });

  it('logs error and re-throws on handler failure', async () => {
    const logger = makeMockLogger();
    const config = makeMockConfig();
    const interceptor = new LoggingInterceptor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interceptor.initializeInterceptor(logger as any, config as any);

    const ctx = makeHttpContext('http://localhost/api/fail', 'fail', 'FailController');

    await expect(
      interceptor.intercept(ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(logger.error).toHaveBeenCalledTimes(1);
    const errorCall = logger.error.mock.calls[0][0] as string;
    expect(errorCall).toContain('GET');
    expect(errorCall).toContain('/api/fail');
  });
});

// ============================================================================
// TimeoutInterceptor
// ============================================================================

describe('TimeoutInterceptor', () => {
  it('returns response when handler completes within timeout', async () => {
    const interceptor = new TimeoutInterceptor(1000);
    const logger = makeMockLogger();
    const config = makeMockConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interceptor.initializeInterceptor(logger as any, config as any);

    const ctx = makeHttpContext();
    const response = await interceptor.intercept(ctx, async () => makeResponse('fast')) as Response;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('fast');
  });

  it('throws HttpException(408) when HTTP handler exceeds timeout', async () => {
    const interceptor = new TimeoutInterceptor(10);
    const logger = makeMockLogger();
    const config = makeMockConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interceptor.initializeInterceptor(logger as any, config as any);

    const ctx = makeHttpContext();

    try {
      await interceptor.intercept(ctx, () => new Promise((resolve) => {
        setTimeout(() => resolve(makeResponse('slow')), 200);
      }));
      expect(true).toBe(false); // should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).statusCode).toBe(HttpStatusCode.REQUEST_TIMEOUT);
      expect((error as HttpException).message).toContain('10ms');
    }
  });
});

// ============================================================================
// ExecutionContext type discriminant
// ============================================================================

describe('ExecutionContext type discriminant', () => {
  it('HttpExecutionContextImpl has type "http"', () => {
    const ctx = makeHttpContext();
    expect(ctx.type).toBe('http');
    expect(isHttpContext(ctx)).toBe(true);
  });

  it('isHttpContext returns false for non-HTTP context', () => {
    // Minimal WS-like context for type guard testing
    const wsCtx = { type: 'ws' as const } as ExecutionContext;
    expect(isHttpContext(wsCtx)).toBe(false);
  });

  it('type guards correctly narrow all transport types', () => {
    const httpCtx = makeHttpContext();
    const wsCtx = { type: 'ws' as const } as ExecutionContext;
    const queueCtx = { type: 'queue' as const } as ExecutionContext;

    expect(isHttpContext(httpCtx)).toBe(true);
    expect(isHttpContext(wsCtx)).toBe(false);
    expect(isHttpContext(queueCtx)).toBe(false);

    // Import the other type guards
    const { isWsContext, isQueueContext } = require('../types');
    expect(isWsContext(wsCtx)).toBe(true);
    expect(isWsContext(httpCtx)).toBe(false);
    expect(isQueueContext(queueCtx)).toBe(true);
    expect(isQueueContext(httpCtx)).toBe(false);
  });
});

// ============================================================================
// composeInterceptors with non-HTTP context
// ============================================================================

describe('composeInterceptors with non-HTTP contexts', () => {
  it('works with queue context', async () => {
    const order: string[] = [];
    const interceptor: ResolvedInterceptor = async (_ctx, next) => {
      order.push('before');
      const res = await next();
      order.push('after');

      return res;
    };
    const handler = async () => {
      order.push('handler');

      return undefined;
    };

    const queueCtx = { type: 'queue' as const } as ExecutionContext;
    const composed = composeInterceptors([interceptor], queueCtx, handler);
    await composed();

    expect(order).toEqual(['before', 'handler', 'after']);
  });

  it('works with ws context', async () => {
    const interceptorCalled = { value: false };
    const interceptor: ResolvedInterceptor = async (_ctx, next) => {
      interceptorCalled.value = true;

      return await next();
    };

    const wsCtx = { type: 'ws' as const } as ExecutionContext;
    const composed = composeInterceptors([interceptor], wsCtx, async () => ({ event: 'pong' }));
    await composed();

    expect(interceptorCalled.value).toBe(true);
  });
});

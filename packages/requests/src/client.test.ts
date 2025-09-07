/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import type { RequestConfig, RequestsOptions } from './types.js';

import { executeRequest, HttpClient } from './client.js';
import {
  createErrorResponse,
  DEFAULT_REQUESTS_OPTIONS,
  HttpMethod,
} from './types.js';

// Simple helper to create a Response with JSON body
function jsonResponse(obj: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(obj), {
    headers: new Headers([['content-type', 'application/json']]),
    status: 200,
    ...init,
  });
}

function textResponse(text: string, init?: ResponseInit): Response {
  return new Response(text, {
    headers: new Headers([['content-type', 'text/plain']]),
    status: 200,
    ...init,
  });
}

const originalFetch = globalThis.fetch;
const originalMetrics = (globalThis as any).__onebunMetricsService;
const originalTrace = (globalThis as any).__onebunCurrentTraceContext;

describe('client.executeRequest', () => {
  beforeEach(() => {
    (globalThis as any).__onebunMetricsService = undefined;
    (globalThis as any).__onebunCurrentTraceContext = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).__onebunMetricsService = originalMetrics;
    (globalThis as any).__onebunCurrentTraceContext = originalTrace;
  });

  it('returns SuccessResponse on 200 with JSON body', async () => {
    const payload = { hello: 'world' };
    globalThis.fetch = (() => Promise.resolve(jsonResponse(payload))) as any;

    const res = await Effect.runPromise(
      executeRequest<{ hello: string }>({ method: HttpMethod.GET, url: '/t' }),
    );

    expect(res.success).toBe(true);
    expect(res.result).toEqual(payload);
  });

  it('fails with standardized error when body contains OneBun error object', async () => {
    // API returns 200 but body is our standardized error -> parseResponseData will convert to ErrorResponse and fail
    const errorObj = createErrorResponse('E', 400, 'bad');
    globalThis.fetch = (() => Promise.resolve(jsonResponse(errorObj, { status: 400 }))) as any;

    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/err' })),
    ).rejects.toThrow(/"success":false/);
  });

  it('retries on 503 and then succeeds', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let n = 0;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (n++ === 0) {
        return Promise.resolve(textResponse('oops', { status: 503, statusText: 'Service Unavailable' }));
      }

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const options: RequestsOptions = {
      retries: {
        ...DEFAULT_REQUESTS_OPTIONS.retries, max: 1, delay: 1, backoff: 'fixed',
      },
    };
    const res = await Effect.runPromise(
      executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/retry' }, options),
    );
    expect(res.success).toBe(true);
    expect(res.result.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('propagates trace id header and records metrics', async () => {
    const calls: RequestInit[] = [];
    let recorded: any | undefined;
    (globalThis as any).__onebunCurrentTraceContext = { traceId: 'trace-xyz' };
    (globalThis as any).__onebunMetricsService = {
      recordHttpRequest(input: any) {
        recorded = input;
      },
    };

    globalThis.fetch = ((_: string, init: RequestInit) => {
      calls.push(init);

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    await Effect.runPromise(
      executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/m' }),
    );

    // headers is Headers or object; in Bun, RequestInit.headers can be a Headers or plain object
    const h = calls[0]!.headers as Record<string, string>;
    // Either directly or via Headers; we normalize
    const hasTrace = ((): boolean => {
      if (h && typeof h === 'object' && 'get' in h && typeof (h as any).get === 'function') {
        return Boolean((h as any).get('X-Trace-Id'));
      }

      return Boolean((h as any)['X-Trace-Id']);
    })();
    expect(hasTrace).toBe(true);

    expect(recorded).toBeDefined();
    expect(recorded.method).toBe('GET');
  });

  it('fails with AUTH_ERROR when auth interceptor throws', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ ok: true }))) as any;

    const cfg: RequestConfig = {
      method: HttpMethod.GET,
      url: '/auth',
      auth: {
        type: 'custom',
        interceptor() {
          throw new Error('nope');
        },
      },
    };

    await expect(
      Effect.runPromise(executeRequest(cfg)),
    ).rejects.toThrow(/AUTH_ERROR/);
  });
});

describe('HttpClient wrappers', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('HttpClient.request returns ApiResponse via runPromise', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ pong: true }))) as any;
    const client = new HttpClient();
    const res = await client.request<{ pong: boolean }>({ method: HttpMethod.GET, url: '/pong' });
    if (!res.success) {
      throw new Error('Unexpected error response');
    }
    expect(res.success).toBe(true);
    expect(res.result.pong).toBe(true);
  });
});

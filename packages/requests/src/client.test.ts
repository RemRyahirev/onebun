/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
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

describe('client helpers via executeRequest', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).__onebunCurrentTraceContext = originalTrace;
  });

  it('handles non-JSON content by returning text', async () => {
    globalThis.fetch = (() => Promise.resolve(textResponse('plain')) ) as any;
    const res = await Effect.runPromise(
      executeRequest<string>({ method: HttpMethod.GET, url: '/text' }),
    );
    expect(res.success).toBe(true);
    expect(res.result).toBe('plain');
  });

  it('fails with RESPONSE_PARSE_ERROR on empty JSON body', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('', { headers: new Headers([['content-type','application/json']]), status: 200 }))) as any;
    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/empty-json' })),
    ).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('fails with RESPONSE_PARSE_ERROR on invalid JSON body', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('not-json', { headers: new Headers([['content-type','application/json']]), status: 200 }))) as any;
    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/bad-json' })),
    ).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('fails with FETCH_ERROR when fetch rejects', async () => {
    globalThis.fetch = ((_: string) => Promise.reject(new Error('net'))) as any;
    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/net', retries: { max: 1, delay: 1 } })),
    ).rejects.toThrow(/FETCH_ERROR/);
  });

  it('builds URL from baseUrl and merges query with existing query string', async () => {
    const seen: { url?: string } = {};
    globalThis.fetch = ((url: string) => {
      seen.url = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    await Effect.runPromise(
      executeRequest<{ ok: boolean }>(
        { method: HttpMethod.GET, url: '/path?x=1', query: { a: 2 } },
        { baseUrl: 'https://api.example.com/' },
      ),
    );

    expect(seen.url).toBe('https://api.example.com/path?x=1&a=2');
  });

  it('does not add X-Trace-Id header when tracing disabled in request config', async () => {
    (globalThis as any).__onebunCurrentTraceContext = { traceId: 'trace-abc' };
    let headersSeen: Headers | Record<string, string> | undefined;
    globalThis.fetch = ((_: string, init: RequestInit) => {
      headersSeen = init.headers as any;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    await Effect.runPromise(
      executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/no-trace', tracing: false }),
    );

    const hasTrace = (() => {
      const h = headersSeen as any;
      if (!h) {
        return false;
      }
      if (typeof h.get === 'function') {
        return Boolean(h.get('X-Trace-Id'));
      }

      return Boolean(h['X-Trace-Id']);
    })();

    expect(hasTrace).toBe(false);
  });

  it('stops retrying and returns RETRY_CALLBACK_ERROR when onRetry throws', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount += 1;

      return Promise.resolve(textResponse('oops', { status: 503 }));
    }) as any;

    const options = {
      retries: {
        ...DEFAULT_REQUESTS_OPTIONS.retries,
        max: 2,
        delay: 1,
        backoff: 'fixed' as const,
        onRetry() {
          throw new Error('cb');
        },
      },
    } as const;

    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/retry-cb' }, options)),
    ).rejects.toThrow(/RETRY_CALLBACK_ERROR/);

    // Should have attempted only once because callback failed
    expect(callCount).toBe(1);
  });
});

describe('HttpClient more wrappers', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('HttpClient.post/put/patch/delete/head/options return ApiResponse', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ ok: true }))) as any;
    const client = new HttpClient();

    const post = await client.post<{ ok: boolean }, { x: number }>('/p', { x: 1 });
    const put = await client.put<{ ok: boolean }, { x: number }>('/u', { x: 1 });
    const patch = await client.patch<{ ok: boolean }, { x: number }>('/pa', { x: 1 });
    const del = await client.delete<{ ok: boolean }>('/d');
    const head = await client.head('/h');
    const opt = await client.options<{ ok: boolean }>('/o');

    for (const r of [post, put, patch, del, opt]) {
      if (!r.success) {
        throw new Error('Unexpected');
      }
      expect((r as any).result.ok).toBe(true);
    }
    // head returns ApiResponse<void>
    expect(head.success).toBe(true);
  });
});

describe('client.executeRequest edge cases', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('builds URL correctly with baseUrl slash combinations and query values filtering', async () => {
    // We assert by intercepting the url passed to fetch
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(textResponse('ok'));
    }) as any;

    await Effect.runPromise(
      executeRequest({ method: HttpMethod.GET, url: '/path', query: { a: 1, b: undefined, c: null as any } }, { baseUrl: 'https://api.example.com/' }),
    );
    expect(calledUrl).toBe('https://api.example.com/path?a=1');

    await Effect.runPromise(
      executeRequest({ method: HttpMethod.GET, url: 'sub/route' }, { baseUrl: 'https://api.example.com' }),
    );
    expect(calledUrl).toBe('https://api.example.com/sub/route');
  });

  it('calculate retry: not in retryOn -> may retry due to default config merge; ensure only retryOn governs when overridden', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;

      return Promise.resolve(textResponse('bad', { status: 404, statusText: 'NF' }));
    }) as any;

    const options: RequestsOptions = {
      retries: {
        ...DEFAULT_REQUESTS_OPTIONS.retries, max: 3, delay: 1, backoff: 'fixed', retryOn: [500],
      },
    };

    await expect(Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/nf' }, options))).rejects.toThrow();
    // Because executeWithRetry merges defaults first, 404 is not included and should not retry beyond 1
    expect(calls).toBe(1);
  });

  it('retry on retryOn and fail after reaching max', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;

      return Promise.resolve(textResponse('bad', { status: 503, statusText: 'Service Unavailable' }));
    }) as any;

    const options: RequestsOptions = {
      retries: {
        ...DEFAULT_REQUESTS_OPTIONS.retries, max: 2, delay: 1, backoff: 'fixed', retryOn: [503],
      },
    };

    await expect(Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/svc' }, options))).rejects.toThrow();
    // 1 initial + 2 retries = 3
    expect(calls).toBe(3);
  });

  it('onRetry throwing leads to RETRY_CALLBACK_ERROR (no further retries)', async () => {
    const seq = [503, 200];
    const seen: number[] = [];
    globalThis.fetch = (() => {
      const code = seq[seen.length] ?? 200;
      seen.push(code);
      if (code === 503) {
        return Promise.resolve(textResponse('bad', { status: 503 }));
      }

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const options: RequestsOptions = {
      retries: {
        ...DEFAULT_REQUESTS_OPTIONS.retries,
        max: 1,
        delay: 1,
        backoff: 'fixed',
        retryOn: [503],
        onRetry() {
          throw new Error('boom');
        },
      },
    };

    await expect(Effect.runPromise(executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/x' }, options))).rejects.toThrow(/RETRY_CALLBACK_ERROR/);
    // Should attempt only once (initial), because onRetry throws and we short-circuit
    expect(seen).toEqual([503]);
  });

  it('parseResponseData: empty JSON text results in RESPONSE_PARSE_ERROR', async () => {
    globalThis.fetch = (() => {
      // 200 with application/json but empty body
      return Promise.resolve(new Response('', { headers: new Headers([['content-type', 'application/json']]) }));
    }) as any;

    await expect(Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/empty' }))).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('parseResponseData: invalid JSON results in RESPONSE_PARSE_ERROR', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response('{not-json', { headers: new Headers([['content-type', 'application/json']]) }));
    }) as any;

    await expect(Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/badjson' }))).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('text/plain path returns text body directly', async () => {
    globalThis.fetch = (() => Promise.resolve(textResponse('hello', { status: 200 }))) as any;
    const res = await Effect.runPromise(executeRequest<string>({ method: HttpMethod.GET, url: '/txt' }));
    expect(res.success).toBe(true);
    expect(res.result).toBe('hello');
  });

  it('should handle response.text() failure in JSON parsing', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve({
        status: 200,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.reject(new Error('Text read error')),
      });
    }) as any;

    await expect(Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/error' }))).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('should handle response.text() failure in non-JSON parsing', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve({
        status: 200,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: new Headers({ 'Content-Type': 'text/plain' }),
        text: () => Promise.reject(new Error('Text read error')),
      });
    }) as any;

    await expect(Effect.runPromise(executeRequest<string>({ method: HttpMethod.GET, url: '/error' }))).rejects.toThrow(/RESPONSE_READ_ERROR/);
  });
});

describe('HttpClient additional methods', () => {
  const mockFetch = mock();
  
  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    mockFetch.mockClear();
  });

  it('should have all Effect-based methods', () => {
    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
    });

    expect(typeof client.getEffect).toBe('function');
    expect(typeof client.postEffect).toBe('function');
    expect(typeof client.putEffect).toBe('function');
    expect(typeof client.patchEffect).toBe('function');
    expect(typeof client.deleteEffect).toBe('function');
    expect(typeof client.headEffect).toBe('function');
    expect(typeof client.optionsEffect).toBe('function');
  });

  it('should handle generic req method success', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: 'test' }), {
        status: 200,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
    });

    const result = await client.req('GET', '/test');
    expect(result).toEqual({ success: true, data: 'test' });
  });

  it('should handle req method with error', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ 
        success: false, 
        error: { code: 'TEST_ERROR', message: 'Test error' }, 
      }), {
        status: 400,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
    });

    await expect(client.req('GET', '/test')).rejects.toThrow();
  });

  it('should handle req method with query data', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: 'response' }), {
        status: 200,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
    });

    const result = await client.req('GET', '/test', { param: 'value' });
    expect(result).toEqual({ success: true, data: 'response' });
  });

  it('should handle req method with config object', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: 'response' }), {
        status: 200,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
    });

    const result = await client.req('GET', '/test', undefined, { });
    expect(result).toEqual({ success: true, data: 'response' });
  });
});

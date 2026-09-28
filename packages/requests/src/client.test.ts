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

import {
  calculateRetryDelay,
  executeRequest,
  HttpClient,
} from './client.js';
import { setTraceContextProvider } from './trace-context.js';
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

  it('propagates the caller trace on the wire and records metrics', async () => {
    const calls: RequestInit[] = [];
    let recorded: any | undefined;
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';

    // Through the registered provider, not `globalThis.__onebunCurrentTraceContext`. This test
    // used to set that global itself and assert the header appeared — which proved only that the
    // client could read a global the framework never wrote. The header was absent in every real
    // application, and the suite was green.
    setTraceContextProvider(() => ({ traceId, spanId, traceFlags: 1 }));
    // Through the sink the caller supplies, not a process-wide slot. The client has no
    // application to ask, so reading a slot recorded an outgoing call into whichever
    // application happened to start last — and into its SERVER-side request metric.
    const metricsSink = (input: any): void => {
      recorded = input;
    };

    globalThis.fetch = ((_: string, init: RequestInit) => {
      calls.push(init);

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    try {
      await Effect.runPromise(
        executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/m' }, { metricsSink }),
      );

      const headers = calls[0]!.headers as Record<string, string>;

      expect(headers.traceparent).toBe(`00-${traceId}-${spanId}-01`);
      expect(headers['X-Trace-Id']).toBe(traceId);
      // With the pair, never the trace id alone — on its own the receiver ignores it.
      expect(headers['X-Span-Id']).toBe(spanId);

      expect(recorded).toBeDefined();
      expect(recorded.method).toBe('GET');
    } finally {
      setTraceContextProvider(null);
    }
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

  it('sends no trace headers when tracing is disabled on the request', async () => {
    // Through the provider, so the absence means "suppressed" and not "there was never a trace
    // to send" — the previous version set a global the client no longer reads, which made the
    // assertion hold for the wrong reason.
    setTraceContextProvider(() => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    }));

    let headersSeen: Record<string, string> | undefined;
    globalThis.fetch = ((_: string, init: RequestInit) => {
      headersSeen = init.headers as Record<string, string>;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    try {
      await Effect.runPromise(
        executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/no-trace', tracing: false }),
      );

      expect(headersSeen!['X-Trace-Id']).toBeUndefined();
      expect(headersSeen!['X-Span-Id']).toBeUndefined();
      expect(headersSeen!.traceparent).toBeUndefined();
      // Asserted against a request that WAS made, with the client's own header present, so the
      // three absences cannot be satisfied by a call that never happened.
      expect(headersSeen!['User-Agent']).toBe('OneBun-Requests/1.0');
    } finally {
      setTraceContextProvider(null);
    }
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
    // head returns ApiResponse<void>. The stub attaches a JSON body to HEAD, which no real server
    // does — that is how this test stayed green while head() failed against every JSON endpoint.
    // The body of a HEAD answer is never read now, so the stubbed one is ignored.
    expect(head.success).toBe(true);
    expect(head.success && head.result).toBeUndefined();
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

    const result = await client.req('GET', '/test', undefined, {});
    expect(result).toEqual({ success: true, data: 'response' });
  });
});

describe('HttpClient.getEffect parameter overloads', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getEffect with no extra args sends plain GET', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await Effect.runPromise(client.getEffect('/items'));

    expect(res.success).toBe(true);
    expect(calledUrl).toBe('https://api.example.com/items');
  });

  it('getEffect with query object appends query string', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await Effect.runPromise(client.getEffect('/items', { page: 2, limit: 5 }));

    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('limit=5');
  });

  it('getEffect with config object (has "timeout" field) treats second arg as config', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await Effect.runPromise(client.getEffect('/items', { timeout: 3000 }));

    expect(calledUrl).toBe('https://api.example.com/items');
  });

  it('getEffect with config object (has "headers" field) treats second arg as config', async () => {
    const seenHeaders: Record<string, string>[] = [];
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      seenHeaders.push(init.headers as Record<string, string>);

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    // eslint-disable-next-line @typescript-eslint/naming-convention
    await Effect.runPromise(client.getEffect('/items', { headers: { 'x-custom': 'yes' } }));

    expect(seenHeaders.length).toBe(1);
  });

  it('getEffect with both query and config spreads both correctly', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await Effect.runPromise(client.getEffect('/items', { sort: 'asc' }, { timeout: 3000 }));

    expect(calledUrl).toContain('sort=asc');
  });
});

describe('HttpClient.req with custom errors config', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('req throws InternalServerError with custom error when response is error and errors config present', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        jsonResponse(
          { success: false, error: 'NOT_FOUND', code: 404 },
          { status: 404 },
        ),
      )) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const customErrors = {
      default: { error: 'ITEM_NOT_FOUND', message: 'Item was not found', details: { extra: true } },
    };

    // req uses errorConfig.error as the Error message (via InternalServerError constructor)
    await expect(
      client.req('GET', '/missing', undefined, { errors: customErrors }),
    ).rejects.toThrow('ITEM_NOT_FOUND');
  });

  it('req throws InternalServerError with custom error on fetch failure with errors config', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('Network down'))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const customErrors = {
      default: { error: 'NETWORK_ERROR', message: 'Network failed', details: {} },
    };

    await expect(
      client.req(
        'GET',
        '/fail',
        undefined,
        { errors: customErrors, retries: { max: 0, delay: 1, backoff: 'fixed' } },
      ),
    ).rejects.toThrow('NETWORK_ERROR');
  });

  it('req uses POST method with data (not query) for non-GET verbs', async () => {
    let body: string | undefined;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      body = init.body as string;

      return Promise.resolve(jsonResponse({ id: 42 }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const result = await client.req<{ id: number }>('POST', '/items', { name: 'New item' });

    expect(result).toEqual({ id: 42 });
    expect(body).toContain('New item');
  });

  it('req uses DELETE method with query (not body)', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ deleted: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const result = await client.req<{ deleted: boolean }>('DELETE', '/items', { id: '5' });

    expect(result).toEqual({ deleted: true });
    expect(calledUrl).toContain('id=5');
  });
});

describe('HttpClient.reqEffect', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reqEffect returns SuccessResponse Effect on success', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ value: 42 }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const effect = client.reqEffect<{ value: number }>('GET', '/data');

    expect(effect).toBeDefined();
    const res = await Effect.runPromise(effect);
    expect(res.success).toBe(true);
    expect(res.result.value).toBe(42);
  });

  it('reqEffect fails with ErrorResponse on error status', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(textResponse('Server Error', { status: 503 }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const effect = client.reqEffect('GET', '/fail', undefined, {
      retries: { max: 0, delay: 1, backoff: 'fixed' },
    });

    await expect(Effect.runPromise(effect)).rejects.toBeDefined();
  });

  it('reqEffect routes GET query as query param', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await Effect.runPromise(client.reqEffect('GET', '/search', { q: 'hello' }));

    expect(calledUrl).toContain('q=hello');
  });

  it('reqEffect routes POST data as body', async () => {
    let bodyStr: string | undefined;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      bodyStr = init.body as string;

      return Promise.resolve(jsonResponse({ created: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await Effect.runPromise(client.reqEffect('POST', '/items', { name: 'foo' }));

    expect(bodyStr).toContain('foo');
  });

  it('reqEffect with HttpMethod enum value', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ ok: true }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await Effect.runPromise(client.reqEffect(HttpMethod.PATCH, '/items/1', { x: 1 }));

    expect(res.success).toBe(true);
  });
});

describe('HttpClient.get Promise wrapper and reqRaw', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('get() calls getEffect and returns ApiResponse', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ items: [1, 2, 3] }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await client.get<{ items: number[] }>('/list');

    expect(res.success).toBe(true);
    if (!res.success) {
      throw new Error('Expected success response');
    }
    expect(res.result.items).toEqual([1, 2, 3]);
  });

  it('get() with query params', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await client.get('/items', { page: 3 });

    expect(calledUrl).toContain('page=3');
  });

  it('get() with config as second param', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ ok: true }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await client.get('/items', { timeout: 3000 });

    expect(res.success).toBe(true);
  });

  it('get() with both query and config', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await client.get('/items', { sort: 'desc' }, { timeout: 5000 });

    expect(calledUrl).toContain('sort=desc');
  });

  it('reqRaw returns full ApiResponse on success', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ value: 7 }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await client.reqRaw<{ value: number }>('GET', '/data');

    expect(res.success).toBe(true);
    if (!res.success) {
      throw new Error('Expected success');
    }
    expect(res.result.value).toBe(7);
  });

  it('reqRaw uses query for GET', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = ((url: string) => {
      calledUrl = url;

      return Promise.resolve(jsonResponse({ ok: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await client.reqRaw('GET', '/items', { q: 'test' });

    expect(calledUrl).toContain('q=test');
  });

  it('reqRaw uses body for POST', async () => {
    let bodyStr: string | undefined;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      bodyStr = init.body as string;

      return Promise.resolve(jsonResponse({ created: true }));
    }) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    await client.reqRaw('POST', '/items', { name: 'new item' });

    expect(bodyStr).toContain('new item');
  });

  it('reqRaw with HttpMethod enum and config', async () => {
    globalThis.fetch = (() => Promise.resolve(jsonResponse({ ok: true }))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const res = await client.reqRaw(HttpMethod.PUT, '/items/1', { x: 1 }, { timeout: 3000 });

    expect(res.success).toBe(true);
  });
});

describe('HttpClient.req unexpected error wrapping', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('req wraps unexpected non-OneBun errors as InternalServerError REQUEST_FAILED', async () => {
    // Fetch throws a non-OneBunBaseError that is not caught by retry logic
    // We set max retries to 0 so it fails immediately without retrying
    globalThis.fetch = (() => Promise.reject(new TypeError('Unexpected network issue'))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });

    let caughtError: unknown;
    try {
      await client.req('GET', '/fail', undefined, {
        retries: { max: 0, delay: 1, backoff: 'fixed' },
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toBeInstanceOf(Error);
  });

  it('req with custom errors config wraps unexpected errors as custom InternalServerError', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('Network failure'))) as any;

    const client = new HttpClient({ baseUrl: 'https://api.example.com' });
    const customErrors = {
      default: { error: 'CUSTOM_NETWORK_ERROR', message: 'Custom network error' },
    };

    let caughtError: unknown;
    try {
      await client.req('GET', '/fail', undefined, {
        errors: customErrors,
        retries: { max: 0, delay: 1, backoff: 'fixed' },
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('CUSTOM_NETWORK_ERROR');
  });
});

describe('calculateRetryDelay', () => {
  it('exponential: delay * factor^(attempt-1)', () => {
    const config = {
      max: 3, delay: 5, backoff: 'exponential' as const, factor: 2, retryOn: [503], 
    };
    expect(calculateRetryDelay(1, config)).toBe(5);   // 5 * 2^0
    expect(calculateRetryDelay(2, config)).toBe(10);  // 5 * 2^1
    expect(calculateRetryDelay(3, config)).toBe(20);  // 5 * 2^2
  });

  it('exponential with custom factor', () => {
    const config = {
      max: 3, delay: 10, backoff: 'exponential' as const, factor: 3, retryOn: [503], 
    };
    expect(calculateRetryDelay(1, config)).toBe(10);  // 10 * 3^0
    expect(calculateRetryDelay(2, config)).toBe(30);  // 10 * 3^1
    expect(calculateRetryDelay(3, config)).toBe(90);  // 10 * 3^2
  });

  it('linear: delay * attempt', () => {
    const config = {
      max: 3, delay: 5, backoff: 'linear' as const, retryOn: [503], 
    };
    expect(calculateRetryDelay(1, config)).toBe(5);   // 5 * 1
    expect(calculateRetryDelay(2, config)).toBe(10);  // 5 * 2
    expect(calculateRetryDelay(3, config)).toBe(15);  // 5 * 3
  });

  it('fixed: always returns delay', () => {
    const config = {
      max: 3, delay: 5, backoff: 'fixed' as const, retryOn: [503], 
    };
    expect(calculateRetryDelay(1, config)).toBe(5);
    expect(calculateRetryDelay(2, config)).toBe(5);
    expect(calculateRetryDelay(3, config)).toBe(5);
  });

  it('defaults to fixed when backoff is undefined', () => {
    const config = { max: 3, delay: 7, retryOn: [503] } as any;
    expect(calculateRetryDelay(1, config)).toBe(7);
    expect(calculateRetryDelay(2, config)).toBe(7);
  });
});

describe('retry backoff strategies', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('exponential backoff retries the correct number of times', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;

      return Promise.resolve(textResponse('fail', { status: 503 }));
    }) as any;

    await expect(
      Effect.runPromise(
        executeRequest({ method: HttpMethod.GET, url: '/backoff' }, {
          retries: {
            max: 2, delay: 1, backoff: 'exponential', factor: 2, retryOn: [503],
          },
        }),
      ),
    ).rejects.toBeDefined();

    expect(callCount).toBe(3);
  });

  it('linear backoff retries the correct number of times', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;

      return Promise.resolve(textResponse('fail', { status: 503 }));
    }) as any;

    await expect(
      Effect.runPromise(
        executeRequest({ method: HttpMethod.GET, url: '/linear' }, {
          retries: {
            max: 2, delay: 1, backoff: 'linear', retryOn: [503],
          },
        }),
      ),
    ).rejects.toBeDefined();

    expect(callCount).toBe(3);
  });

  it('fixed backoff retries the correct number of times', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;

      return Promise.resolve(textResponse('fail', { status: 503 }));
    }) as any;

    await expect(
      Effect.runPromise(
        executeRequest({ method: HttpMethod.GET, url: '/fixed' }, {
          retries: {
            max: 2, delay: 1, backoff: 'fixed', retryOn: [503],
          },
        }),
      ),
    ).rejects.toBeDefined();

    expect(callCount).toBe(3);
  });

  it('stops exactly after max retries (max=3 means 4 total calls)', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;

      return Promise.resolve(textResponse('fail', { status: 503 }));
    }) as any;

    const maxRetries = 3;
    await expect(
      Effect.runPromise(
        executeRequest({ method: HttpMethod.GET, url: '/maxretries' }, {
          retries: {
            max: maxRetries, delay: 1, backoff: 'fixed', retryOn: [503],
          },
        }),
      ),
    ).rejects.toBeDefined();

    expect(callCount).toBe(maxRetries + 1);
  });
});

/**
 * The outgoing-request metric used to label every success `status_code="200"`:
 * `statusCode: result.success ? HttpStatusCode.OK : result.code`. Every 2xx that is not 200 —
 * 201 Created, 202 Accepted, 204 No Content — was misreported, so a dashboard could not tell them
 * apart and an alert on non-200 responses never fired.
 */
describe('outgoing request metrics', () => {
  const HTTP_CREATED = 201;
  const HTTP_ACCEPTED = 202;
  const HTTP_NO_CONTENT = 204;
  const HTTP_NOT_FOUND = 404;

  // `globalThis.fetch` is process-wide and bun runs every test file in one process: leaving a
  // canned response installed makes every later file's HTTP test answer from this mock instead of
  // its own server. Restored per test, not per suite.
  const fetchBeforeSuite = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = fetchBeforeSuite;
    delete (globalThis as any).__onebunMetricsService;
  });

  async function statusRecordedFor(upstreamStatus: number): Promise<number | undefined> {
    let recorded: { statusCode: number } | undefined;
    const metricsSink = (input: { statusCode: number }): void => {
      recorded = input;
    };

    globalThis.fetch = (() => Promise.resolve(
      upstreamStatus === HTTP_NO_CONTENT
        ? new Response(null, { status: upstreamStatus })
        : jsonResponse({ ok: true }, { status: upstreamStatus }),
    )) as any;

    try {
      await Effect.runPromise(
        executeRequest({ method: HttpMethod.GET, url: '/thing' }, { retries: { max: 0 }, metricsSink }),
      ).catch(() => undefined);
    } finally {
      globalThis.fetch = fetchBeforeSuite;
    }

    return recorded?.statusCode;
  }

  it('records the status the upstream actually returned', async () => {
    expect(await statusRecordedFor(HTTP_CREATED)).toBe(HTTP_CREATED);
    expect(await statusRecordedFor(HTTP_ACCEPTED)).toBe(HTTP_ACCEPTED);
    expect(await statusRecordedFor(HTTP_NO_CONTENT)).toBe(HTTP_NO_CONTENT);
  });

  it('still records the status of a failure', async () => {
    expect(await statusRecordedFor(HTTP_NOT_FOUND)).toBe(HTTP_NOT_FOUND);
  });

  it('exposes the upstream status on the success response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(jsonResponse({ ok: true }, { status: HTTP_CREATED }))) as any;

    const response = await Effect.runPromise(
      executeRequest<{ ok: boolean }>({ method: HttpMethod.GET, url: '/thing' }),
    );

    // 201, 202 and 204 each mean something a caller may need to branch on, and the metric label
    // is derived from this rather than assumed.
    expect(response.statusCode).toBe(HTTP_CREATED);
  });
});

/**
 * onebun-FB-31: `get`, `delete`, `head` and `options` share one overload resolver, and an answer
 * that has no content (HEAD, 204, 304) is not parsed.
 *
 * Driven against a real `Bun.serve` so the assertions are on what reached the wire, not on what the
 * client handed a stubbed fetch.
 */
/* eslint-disable @typescript-eslint/naming-convention -- HTTP header names as object keys */
describe('HttpClient query/config overload and bodyless answers', () => {
  interface Arrival {
    method: string;
    path: string;
    headers: Headers;
  }

  let server: ReturnType<typeof Bun.serve>;
  let arrivals: Arrival[];
  let client: HttpClient;

  beforeEach(() => {
    arrivals = [];
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        arrivals.push({ method: req.method, path: url.pathname + url.search, headers: req.headers });

        switch (url.pathname) {
          case '/204json':
            return new Response(null, { status: 204, headers: { 'content-type': 'application/json' } });
          case '/304':
            return new Response(null, { status: 304, headers: { etag: '"v1"', 'content-type': 'application/json' } });
          case '/missing':
            return Response.json({ reason: 'gone' }, { status: 404 });
          case '/text':
            return new Response('plain', { headers: { 'content-type': 'text/plain' } });
          default:
            return Response.json({ a: 1 });
        }
      },
    });
    client = new HttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, retries: { max: 0 } });
  });

  afterEach(() => {
    server.stop(true);
    setTraceContextProvider(null);
  });

  const paths = (): string[] => arrivals.map((arrival) => `${arrival.method} ${arrival.path}`);

  it('reads tracing and metrics as config on delete, head and options, not as query data', async () => {
    // 0.8.1 sent `?tracing=false` / `?metrics=false`: these three kept an inline copy of an older
    // four-name marker list after `get` had been moved to the shared one.
    await client.delete('/d', { tracing: false });
    await client.delete('/d', { metrics: false });
    await client.head('/h', { metrics: false });
    await client.head('/h', { tracing: false });
    await client.options('/o', { tracing: false });
    await client.options('/o', { metrics: false });

    expect(paths()).toEqual([
      'DELETE /d',
      'DELETE /d',
      'HEAD /h',
      'HEAD /h',
      'OPTIONS /o',
      'OPTIONS /o',
    ]);
  });

  it('applies the config it recognised: tracing: false on delete sends no trace headers', async () => {
    setTraceContextProvider(() => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    }));

    await client.delete('/traced');
    await client.delete('/untraced', { tracing: false });

    expect(arrivals[0]?.headers.get('traceparent')).not.toBeNull();
    expect(arrivals[1]?.path).toBe('/untraced');
    expect(arrivals[1]?.headers.get('traceparent')).toBeNull();
    expect(arrivals[1]?.headers.get('x-trace-id')).toBeNull();
  });

  it('honours (url, undefined, config) on all four methods, Promise and Effect forms alike', async () => {
    const config = { headers: { 'x-a': '1' } };

    await client.get('/g', undefined, config);
    await client.delete('/d', undefined, config);
    await client.head('/h', undefined, config);
    await client.options('/o', undefined, config);
    await Effect.runPromise(client.getEffect('/ge', undefined, config));
    await Effect.runPromise(client.deleteEffect('/de', undefined, config));
    await Effect.runPromise(client.headEffect('/he', undefined, config));
    await Effect.runPromise(client.optionsEffect('/oe', undefined, config));

    expect(arrivals.map((arrival) => `${arrival.path} ${arrival.headers.get('x-a')}`)).toEqual([
      '/g 1',
      '/d 1',
      '/h 1',
      '/o 1',
      '/ge 1',
      '/de 1',
      '/he 1',
      '/oe 1',
    ]);
  });

  it('keeps every non-marker key on the query side', async () => {
    // `redirect`, `retries` and `query` are deliberately not markers: each is a plausible query
    // parameter, and flipping one would silently turn working query data into config.
    await client.get('/login', { redirect: '/home' });
    await client.delete('/d', { retries: 3 });
    await client.options('/o', { page: 2 });

    expect(paths()).toEqual([
      'GET /login?redirect=%2Fhome',
      'DELETE /d?retries=3',
      'OPTIONS /o?page=2',
    ]);
  });

  it('reads the second argument as query data whenever a third is given, even if it looks like config', async () => {
    await client.get('/q', { timeout: 5 }, {});
    await client.head('/q', { page: 1 }, { headers: { 'x-a': '2' } });

    expect(paths()).toEqual(['GET /q?timeout=5', 'HEAD /q?page=1']);
    expect(arrivals[1]?.headers.get('x-a')).toBe('2');
  });

  it('resolves HEAD against a JSON endpoint without reading a body', async () => {
    // 0.8.1: RESPONSE_PARSE_ERROR code 200 "Response text is empty" — Bun keeps the JSON
    // content type on the HEAD answer and the client sent the empty text to JSON.parse.
    const head = await client.head('/x');

    expect(head).toMatchObject({ success: true, statusCode: 200 });
    expect(head.success && head.result).toBeUndefined();
    expect(await client.head('/text')).toMatchObject({ success: true, statusCode: 200 });
    // The method is compared case-insensitively, as fetch does when it puts it on the wire
    expect(await client.reqRaw('head', '/x')).toMatchObject({ success: true, statusCode: 200 });
    expect(arrivals.map((arrival) => arrival.method)).toEqual(['HEAD', 'HEAD', 'HEAD']);
  });

  it('resolves a 204 that carries a JSON content type', async () => {
    const removed = await client.delete<{ ignored: true }>('/204json');

    expect(removed).toMatchObject({ success: true, statusCode: 204 });
    expect(removed.success && removed.result).toBeUndefined();
  });

  it('resolves a 304 as a success and records it as one', async () => {
    let recorded: { statusCode: number; success: boolean } | undefined;
    const observed = new HttpClient({
      baseUrl: `http://127.0.0.1:${server.port}`,
      retries: { max: 0 },
      metricsSink(data) {
        recorded = { statusCode: data.statusCode, success: data.success };
      },
    });

    const cached = await observed.get('/304', undefined, { headers: { 'If-None-Match': '"v1"' } });

    expect(cached).toMatchObject({ success: true, statusCode: 304 });
    expect(cached.success && cached.result).toBeUndefined();
    expect(arrivals[0]?.headers.get('if-none-match')).toBe('"v1"');
    expect(recorded).toEqual({ statusCode: 304, success: true });
  });

  it('fails a HEAD 404 as HTTP_ERROR 404, not as a parse error', async () => {
    const outcome = await Effect.runPromise(Effect.either(client.headEffect('/missing')));

    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      expect(outcome.left.error).toBe('HTTP_ERROR');
      expect(outcome.left.code).toBe(404);
    }
  });

  it('sends GET when the method is explicitly undefined, and settles both outcomes as responses', async () => {
    // `{ method: undefined }` spreads over the GET default and type-checks while
    // `exactOptionalPropertyTypes` is off. fetch sends it as GET; the client then called
    // `toUpperCase()` on the undefined method and died with a TypeError defect — on the success
    // path too once HEAD detection ran on every answer — with no ErrorResponse and no metrics.
    const methods: string[] = [];
    const observed = new HttpClient({
      baseUrl: `http://127.0.0.1:${server.port}`,
      retries: { max: 0 },
      metricsSink(data) {
        methods.push(data.method);
      },
    });

    const ok = await observed.request({ url: '/ok', method: undefined });
    const viaOverload = await observed.get('/ok', { method: undefined });
    const failed = await Effect.runPromise(Effect.either(observed.requestEffect({ url: '/missing', method: undefined })));

    expect(ok).toEqual({
      success: true,
      result: { a: 1 },
      statusCode: 200,
      retryCount: 0,
    });
    expect(viaOverload).toMatchObject({ success: true, result: { a: 1 }, statusCode: 200 });
    expect(failed._tag).toBe('Left');
    if (failed._tag === 'Left') {
      expect(failed.left).toMatchObject({ error: 'HTTP_ERROR', code: 404 });
    }
    expect(paths()).toEqual(['GET /ok', 'GET /ok', 'GET /missing']);
    expect(methods).toEqual(['GET', 'GET', 'GET']);
  });

  it('still reads the body of a GET error answer into the error details', async () => {
    const missing = await Effect.runPromise(Effect.either(client.getEffect('/missing')));

    expect(missing._tag).toBe('Left');
    if (missing._tag === 'Left') {
      expect(missing.left.error).toBe('HTTP_ERROR');
      expect(missing.left.details).toMatchObject({ details: { reason: 'gone' } });
    }
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

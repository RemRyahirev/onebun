/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from 'bun:test';
import { Effect } from 'effect';

import { executeRequest, HttpClient } from './client.js';
import { DEFAULT_REQUESTS_OPTIONS, HttpMethod } from './types.js';

function jsonResponse(obj: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(obj), {
    headers: new Headers([["content-type", "application/json"]]),
    status: 200,
    ...init,
  });
}

function textResponse(text: string, init?: ResponseInit): Response {
  return new Response(text, {
    headers: new Headers([["content-type", "text/plain"]]),
    status: 200,
    ...init,
  });
}

const originalFetch = globalThis.fetch;
const originalTrace = (globalThis as any).__onebunCurrentTraceContext;

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
    globalThis.fetch = (() => Promise.resolve(new Response('', { headers: { 'content-type': 'application/json' } as any, status: 200 }))) as any;
    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/empty-json' })),
    ).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('fails with RESPONSE_PARSE_ERROR on invalid JSON body', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('not-json', { headers: { 'content-type': 'application/json' } as any, status: 200 }))) as any;
    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/bad-json' })),
    ).rejects.toThrow(/RESPONSE_PARSE_ERROR/);
  });

  it('fails with FETCH_ERROR when fetch rejects', async () => {
    globalThis.fetch = ((_) => Promise.reject(new Error('net'))) as any;
    await expect(
      Effect.runPromise(executeRequest({ method: HttpMethod.GET, url: '/net' })),
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
      if (!h) return false;
      if (typeof h.get === 'function') return Boolean(h.get('X-Trace-Id'));
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
      retries: { ...DEFAULT_REQUESTS_OPTIONS.retries, max: 2, delay: 1, backoff: 'fixed', onRetry() { throw new Error('cb'); } },
    };

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
    const head = await client.head<{ ok: boolean }>('/h');
    const opt = await client.options<{ ok: boolean }>('/o');

    for (const r of [post, put, patch, del, head, opt]) {
      if (!r.success) throw new Error('Unexpected');
      expect(r.result.ok).toBe(true);
    }
  });
});

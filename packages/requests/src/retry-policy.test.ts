/**
 * Retry policy: which methods are replayed, and how a transport failure is classified.
 *
 * Every case here counts the requests the server actually received — the whole point of the
 * defect is that a caller cannot see the amplification from the call site.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import type { RequestsOptions } from './types.js';

import { createHttpClient } from './client.js';
import {
  DEFAULT_RETRY_CONFIG,
  DEFAULT_RETRY_DELAY,
  DEFAULT_RETRY_METHODS,
  getTransportFailureKind,
  isErrorResponse,
  isRetryableMethod,
  resolveRetryConfig,
  TRANSPORT_FAILURE_CODE,
} from './types.js';

interface SeenRequest {
  method: string;
  path: string;
}

interface TestServer {
  baseUrl: string;
  seen: SeenRequest[];
  stop(): void;
}

type Responder = (attempt: number) => Response | Promise<Response>;

function startServer(respond: Responder): TestServer {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      seen.push({ method: req.method, path: new URL(req.url).pathname });

      return respond(seen.length);
    },
  });

  return {
    baseUrl: server.url.origin,
    seen,
    stop: () => server.stop(true),
  };
}

const jsonHeaders = (): Headers => new Headers([['content-type', 'application/json']]);

const status = (code: number): Response =>
  new Response(JSON.stringify({ error: 'upstream' }), {
    status: code,
    headers: jsonHeaders(),
  });

const ok = (): Response =>
  new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders() });

/** Run an effect and get the response back as a value, whether it succeeded or failed. */
async function settle<T>(effect: Effect.Effect<T, unknown>): Promise<unknown> {
  return await Effect.runPromise(Effect.merge(effect));
}

interface CapturedLog {
  message: string;
  context: Record<string, unknown>;
}

const captured: CapturedLog[] = [];
// eslint-disable-next-line @typescript-eslint/naming-convention
const g = globalThis as unknown as { __onebunLoggerService?: unknown };
let originalLogger: unknown;
const servers: TestServer[] = [];

function serve(respond: Responder): TestServer {
  const server = startServer(respond);
  servers.push(server);

  return server;
}

beforeEach(() => {
  captured.length = 0;
  originalLogger = g.__onebunLoggerService;
  // Also keeps the Effect fallback logger from writing to the test output
  g.__onebunLoggerService = {
    warn(message: string, context: Record<string, unknown>) {
      captured.push({ message, context });
    },
  };
});

afterEach(() => {
  g.__onebunLoggerService = originalLogger;
  while (servers.length > 0) {
    servers.pop()!.stop();
  }
});

describe('retry method allowlist', () => {
  it('sends an unconfigured POST exactly once when the server answers 503', async () => {
    const server = serve(() => status(503));
    const client = createHttpClient({ baseUrl: server.baseUrl });

    const result = await settle(client.postEffect('/orders', { total: 100 }));

    expect(server.seen.length).toBe(1);
    expect(server.seen[0]).toEqual({ method: 'POST', path: '/orders' });
    expect(isErrorResponse(result)).toBe(true);
    expect((result as { code: number }).code).toBe(503);
    expect((result as { retryCount?: number }).retryCount).toBe(0);
  });

  it('sends an unconfigured PATCH exactly once when the server answers 503', async () => {
    const server = serve(() => status(503));
    const client = createHttpClient({ baseUrl: server.baseUrl });

    await settle(client.patchEffect('/orders/1', { total: 100 }));

    expect(server.seen.length).toBe(1);
    expect(server.seen[0]!.method).toBe('PATCH');
  });

  it('still retries an unconfigured GET four times on 503, at the documented delays', async () => {
    const server = serve(() => status(503));
    const client = createHttpClient({ baseUrl: server.baseUrl });

    const started = Date.now();
    const result = await settle(client.getEffect('/orders'));
    const elapsed = Date.now() - started;

    // 1 initial attempt + DEFAULT_RETRY_CONFIG.max retries
    expect(server.seen.length).toBe(4);
    expect(server.seen.every((r) => r.method === 'GET')).toBe(true);
    expect((result as { retryCount?: number }).retryCount).toBe(3);
    // 300 + 600 + 1200 = 2100ms of exponential backoff
    expect(elapsed).toBeGreaterThanOrEqual(1900);
  });

  it('keeps PUT and DELETE in the idempotent default set', async () => {
    const server = serve(() => status(503));
    const client = createHttpClient({
      baseUrl: server.baseUrl,
      // Only the pacing is overridden; `methods` keeps its default
      retries: { max: 1, delay: 1 },
    });

    await settle(client.putEffect('/orders/1', { total: 1 }));
    await settle(client.deleteEffect('/orders/1'));

    expect(server.seen).toEqual([
      { method: 'PUT', path: '/orders/1' },
      { method: 'PUT', path: '/orders/1' },
      { method: 'DELETE', path: '/orders/1' },
      { method: 'DELETE', path: '/orders/1' },
    ]);
  });

  it('retries a POST when the caller opts it in, and not otherwise', async () => {
    const server = serve(() => status(429));
    const retries: RequestsOptions['retries'] = { max: 2, delay: 1 };

    const optedIn = createHttpClient({
      baseUrl: server.baseUrl,
      retries: { ...retries, methods: ['GET', 'POST'] },
    });
    await settle(optedIn.postEffect('/charges', { amount: 500 }));

    expect(server.seen.length).toBe(3);

    server.seen.length = 0;

    const control = createHttpClient({ baseUrl: server.baseUrl, retries });
    await settle(control.postEffect('/charges', { amount: 500 }));

    expect(server.seen.length).toBe(1);
  });
});

describe('transport failure classification', () => {
  it('does not replay a POST that hit the client-side timeout', async () => {
    const server = serve(async () => {
      await Bun.sleep(300);

      return ok();
    });
    const client = createHttpClient({ baseUrl: server.baseUrl });

    const result = await settle(
      client.postEffect('/charges', { amount: 500 }, { timeout: 80 }),
    );

    expect(server.seen.length).toBe(1);
    expect((result as { error: string }).error).toBe('TIMEOUT_ERROR');
    expect((result as { code: number }).code).toBe(TRANSPORT_FAILURE_CODE);
    expect(getTransportFailureKind(result)).toBe('timeout');
  });

  it('does not retry a timed-out GET either, since the server may have processed it', async () => {
    const server = serve(async () => {
      await Bun.sleep(300);

      return ok();
    });
    const client = createHttpClient({ baseUrl: server.baseUrl });

    const result = await settle(client.getEffect('/reports', { timeout: 80 }));

    expect(server.seen.length).toBe(1);
    expect(getTransportFailureKind(result)).toBe('timeout');
  });

  it('retries a timed-out GET when the caller sets retryOnTimeout', async () => {
    const server = serve(async () => {
      await Bun.sleep(300);

      return ok();
    });
    const client = createHttpClient({
      baseUrl: server.baseUrl,
      retries: { max: 2, delay: 1, retryOnTimeout: true },
    });

    const result = await settle(client.getEffect('/reports', { timeout: 80 }));

    expect(server.seen.length).toBe(3);
    expect((result as { error: string }).error).toBe('TIMEOUT_ERROR');
    expect((result as { code: number }).code).toBe(TRANSPORT_FAILURE_CODE);
  });

  it('classifies a refused connection as a network failure and retries a GET', async () => {
    const dead = startServer(() => ok());
    const { baseUrl } = dead;
    dead.stop();

    const client = createHttpClient({
      baseUrl,
      retries: { max: 2, delay: 5 },
    });

    const result = await settle(client.getEffect('/reports'));

    expect((result as { error: string }).error).toBe('FETCH_ERROR');
    expect((result as { code: number }).code).toBe(TRANSPORT_FAILURE_CODE);
    expect(getTransportFailureKind(result)).toBe('network');
    expect((result as { retryCount?: number }).retryCount).toBe(2);
  });

  it('does not replay a POST on a network failure', async () => {
    const dead = startServer(() => ok());
    const { baseUrl } = dead;
    dead.stop();

    const client = createHttpClient({ baseUrl, retries: { max: 2, delay: 5 } });

    const result = await settle(client.postEffect('/charges', { amount: 500 }));

    expect(getTransportFailureKind(result)).toBe('network');
    expect((result as { retryCount?: number }).retryCount).toBe(0);
  });

  it('honours retryOnNetworkError: false for an idempotent method', async () => {
    const dead = startServer(() => ok());
    const { baseUrl } = dead;
    dead.stop();

    const client = createHttpClient({
      baseUrl,
      retries: { max: 2, delay: 5, retryOnNetworkError: false },
    });

    const result = await settle(client.getEffect('/reports'));

    expect(getTransportFailureKind(result)).toBe('network');
    expect((result as { retryCount?: number }).retryCount).toBe(0);
  });
});

describe('retry config merge', () => {
  it('keeps the documented defaults when only max is overridden', async () => {
    const server = serve((attempt) => (attempt === 1 ? status(429) : ok()));
    const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 5 } });

    const started = Date.now();
    const result = await settle(client.getEffect('/reports'));
    const elapsed = Date.now() - started;

    // 429 stays in retryOn, so the request is retried once and then succeeds
    expect(server.seen.length).toBe(2);
    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { retryCount?: number }).retryCount).toBe(1);
    // The 300ms base delay survives; the dead literal in the client used 1000ms
    expect(elapsed).toBeGreaterThanOrEqual(DEFAULT_RETRY_DELAY - 50);
    expect(elapsed).toBeLessThan(900);
  });

  it('merges a partial config field-wise onto the defaults', () => {
    expect(resolveRetryConfig({ max: 5 })).toEqual({ ...DEFAULT_RETRY_CONFIG, max: 5 });
    expect(resolveRetryConfig(undefined)).toEqual(DEFAULT_RETRY_CONFIG);
    expect(resolveRetryConfig({ max: 5 }, { delay: 7 })).toEqual({
      ...DEFAULT_RETRY_CONFIG,
      max: 5,
      delay: 7,
    });
  });

  it('exposes the idempotent set as the default method allowlist', () => {
    expect(DEFAULT_RETRY_METHODS).toEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
    expect(isRetryableMethod('get', DEFAULT_RETRY_CONFIG)).toBe(true);
    expect(isRetryableMethod('POST', DEFAULT_RETRY_CONFIG)).toBe(false);
    expect(isRetryableMethod('PATCH', DEFAULT_RETRY_CONFIG)).toBe(false);
    expect(isRetryableMethod('POST', resolveRetryConfig({ methods: ['POST'] }))).toBe(true);
  });
});

describe('retry diagnostics', () => {
  it('logs every retry with method, url, attempt and the code that triggered it', async () => {
    const server = serve(() => status(503));
    const client = createHttpClient({
      baseUrl: server.baseUrl,
      retries: { max: 2, delay: 1 },
    });

    await settle(client.getEffect('/reports'));

    expect(captured.length).toBe(2);
    expect(captured[0]!.context).toMatchObject({
      method: 'GET',
      attempt: 1,
      code: 503,
      error: 'HTTP_ERROR',
    });
    expect(String(captured[0]!.context.url)).toContain('/reports');
    expect(captured[1]!.context).toMatchObject({ attempt: 2, code: 503 });
  });

  it('logs a transport failure with its kind rather than as a 500', async () => {
    const dead = startServer(() => ok());
    const { baseUrl } = dead;
    dead.stop();

    const client = createHttpClient({ baseUrl, retries: { max: 1, delay: 1 } });

    await settle(client.getEffect('/reports'));

    expect(captured.length).toBe(1);
    expect(captured[0]!.context).toMatchObject({
      transport: 'network',
      code: TRANSPORT_FAILURE_CODE,
      error: 'FETCH_ERROR',
    });
  });

  it('reports retryCount on a successful response that needed a retry', async () => {
    const server = serve((attempt) => (attempt === 1 ? status(429) : ok()));
    const client = createHttpClient({
      baseUrl: server.baseUrl,
      retries: { max: 3, delay: 1 },
    });

    const result = await settle(client.getEffect('/reports'));

    expect(server.seen.length).toBe(2);
    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { retryCount?: number }).retryCount).toBe(1);
  });
});

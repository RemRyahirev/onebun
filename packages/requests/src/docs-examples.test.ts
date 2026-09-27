/**
 * Documentation Examples Tests for @onebun/requests
 *
 * @source docs:api/requests.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import {
  Cause,
  Effect,
  Runtime,
} from 'effect';

import {
  calculateRetryDelay,
  createHttpClient,
  getTransportFailureKind,
  isErrorResponse,
  resolveRetryConfig,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_RETRY_DELAY,
  HttpStatusCode,
  type RequestMetricsData,
  setTraceContextProvider,
  TRANSPORT_FAILURE_CODE,
} from './';

/** Counts the requests a client really sent, so retry claims can be checked end to end. */
function startCountingServer(
  respond: (attempt: number) => Response | Promise<Response>,
): { baseUrl: string; methods: string[]; stop(): void } {
  const methods: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      methods.push(req.method);

      return respond(methods.length);
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    methods,
    stop: () => server.stop(true),
  };
}

const jsonStatus = (code: number, body: unknown = { ok: code < 400 }): Response =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: new Headers([['content-type', 'application/json']]),
  });

/**
 * Answers every request with `status` and one chunk of body, then stalls; records the paths it
 * was asked for and the ones whose body stream the client cancelled.
 */
function startStallingServer(
  status = 200,
): { baseUrl: string; paths: string[]; cancelled: string[]; stop(): void } {
  const paths: string[] = [];
  const cancelled: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      paths.push(path);

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"rows":['));
          },
          cancel() {
            cancelled.push(path);
          },
        }),
        { status, headers: new Headers([['content-type', 'application/json']]) },
      );
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    paths,
    cancelled,
    stop: () => server.stop(true),
  };
}

/** Wait until `condition` holds or `withinMs` passes; the caller asserts on what it observed. */
async function waitFor(condition: () => boolean, withinMs: number): Promise<void> {
  const deadline = performance.now() + withinMs;
  while (!condition() && performance.now() < deadline) {
    await Bun.sleep(5);
  }
}

interface EchoedCall {
  method: string;
  path: string;
  body: string;
  headers: Headers;
}

/** Records what the client really put on the wire, so call-shape claims can be checked. */
function startEchoServer(): { baseUrl: string; calls: EchoedCall[]; stop(): void } {
  const calls: EchoedCall[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const hasBody = req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'HEAD';

      calls.push({
        method: req.method,
        path: url.pathname + url.search,
        body: hasBody ? await req.text() : '',
        headers: req.headers,
      });

      return url.pathname === '/missing' ? jsonStatus(404) : jsonStatus(200);
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    calls,
    stop: () => server.stop(true),
  };
}

describe('Requests README Examples', () => {
  describe('Basic Usage with Promise API (README)', () => {
    it('should create a client with basic options', () => {
      // From README: Create a client
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        timeout: 5000,
      });

      expect(client).toBeDefined();
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.patch).toBe('function');
      expect(typeof client.delete).toBe('function');
    });
  });

  describe('Client Configuration (README)', () => {
    it('should create client with full configuration', () => {
      // From README: Client Configuration
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        timeout: 10000,
        /* eslint-disable @typescript-eslint/naming-convention */
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        /* eslint-enable @typescript-eslint/naming-convention */
        auth: {
          type: 'bearer',
          token: 'your-bearer-token',
        },
        retries: {
          max: 3,
          delay: 1000,
          backoff: 'exponential',
          retryOn: [408, 429, 500, 502, 503, 504],
        },
      });

      expect(client).toBeDefined();
    });
  });

  describe('Authentication Types (README)', () => {
    it('should create client with Bearer Token auth', () => {
      // From README: Bearer Token
      const bearerClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'bearer',
          token: 'your-token',
        },
      });

      expect(bearerClient).toBeDefined();
    });

    it('should create client with API Key auth', () => {
      // From README: API Key
      const apiKeyClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'apikey',
          key: 'X-API-Key',
          value: 'your-api-key',
        },
      });

      expect(apiKeyClient).toBeDefined();
    });

    it('should create client with Basic Auth', () => {
      // From README: Basic Auth
      const basicClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'basic',
          username: 'user',
          password: 'pass',
        },
      });

      expect(basicClient).toBeDefined();
    });
  });

  describe('Dual API Support (README)', () => {
    it('should have both Promise and Effect APIs', () => {
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // Promise API
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.patch).toBe('function');
      expect(typeof client.delete).toBe('function');

      // Effect API
      expect(typeof client.getEffect).toBe('function');
      expect(typeof client.postEffect).toBe('function');
      expect(typeof client.putEffect).toBe('function');
      expect(typeof client.patchEffect).toBe('function');
      expect(typeof client.deleteEffect).toBe('function');
    });
  });
});

describe('Requests API Documentation Examples', () => {
  describe('Basic Requests (docs/api/requests.md)', () => {
    /**
     * @source docs:api/requests.md#get
     */
    it('should send the query record given as the second argument', async () => {
      // From docs: "the second argument *is* the query record"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.get('/users', { page: 1, limit: 10 });

        expect(server.calls[0]?.path).toBe('/users?page=1&limit=10');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#get
     */
    it('should read an object carrying headers as config, not as query', async () => {
      // From docs: "an object carrying `method`, `headers`, `timeout`, `auth`, `tracing` or `metrics`
      // is read as per-request config"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        /* eslint-disable @typescript-eslint/naming-convention */
        await client.get('/users', { headers: { 'X-Custom-Header': 'value' } });
        /* eslint-enable @typescript-eslint/naming-convention */

        expect(server.calls[0]?.path).toBe('/users');
        expect(server.calls[0]?.headers.get('x-custom-header')).toBe('value');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#get
     */
    it('should take the query second and the config third', async () => {
      // From docs: "Both at once: query second, config third"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.get('/users', { page: 1, limit: 10 }, { timeout: 5000 });

        expect(server.calls[0]?.path).toBe('/users?page=1&limit=10');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#get
     */
    it('should honour a config given third when the query is undefined', async () => {
      // From docs: "a third argument makes the second one the query, even `undefined`"
      const server = startCountingServer(() => jsonStatus(503));

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 2, delay: 1 } });

        await expect(client.get('/users', undefined, { retries: { max: 0 } })).rejects.toThrow(/"code":503/);

        // One arrival: the per-request `retries: { max: 0 }` reached the request. Dropped, the
        // client's own `max: 2` would have sent three.
        expect(server.methods).toEqual(['GET']);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#get
     */
    it('should resolve delete, head and options by the same rule as get', async () => {
      // From docs: "`delete`, `head` and `options` take the same three arguments and resolve
      // them by the same rule"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.delete('/d', { tracing: false });
        await client.head('/h', { metrics: false });
        await client.options('/o', { tracing: false });
        await client.delete('/d', { reason: 'expired' });

        expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
          'DELETE /d',
          'HEAD /h',
          'OPTIONS /o',
          'DELETE /d?reason=expired',
        ]);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#get
     */
    it('should send a key outside the six config names as query data', async () => {
      // From docs: "`client.get('/login', { redirect: '/home' })` sends `GET /login?redirect=%2Fhome`"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.get('/login', { redirect: '/home' });

        expect(server.calls[0]?.path).toBe('/login?redirect=%2Fhome');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#get
     */
    it('should stringify a wrapped query object instead of expanding it', async () => {
      // From docs (warning): "Do not wrap the query in a key"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.get('/users', { params: { page: 1 } });
        await client.get('/users', { query: { page: 1 } });

        expect(server.calls[0]?.path).toBe('/users?params=%5Bobject+Object%5D');
        expect(server.calls[1]?.path).toBe('/users?query=%5Bobject+Object%5D');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#post
     */
    it('should send the payload given as the second argument', async () => {
      // From docs: "the second argument *is* the payload"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.post('/users', { name: 'John', email: 'john@example.com' });

        expect(server.calls[0]?.body).toBe('{"name":"John","email":"john@example.com"}');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#post
     */
    it('should apply per-request config given as the third argument', async () => {
      // From docs: "per-request config is the third argument"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        /* eslint-disable @typescript-eslint/naming-convention */
        await client.post('/users', { name: 'John' }, {
          headers: { 'X-Request-ID': 'rid-123' },
          timeout: 30000,
        });
        /* eslint-enable @typescript-eslint/naming-convention */

        expect(server.calls[0]?.body).toBe('{"name":"John"}');
        expect(server.calls[0]?.headers.get('x-request-id')).toBe('rid-123');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#post
     */
    it('should send a wrapped payload verbatim, timeout and all', async () => {
      // From docs: wrapping the payload "sends {"body":{...},"timeout":30000} as the request body"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.post('/users', { body: { name: 'John' }, timeout: 30000 });

        expect(server.calls[0]?.body).toBe('{"body":{"name":"John"},"timeout":30000}');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#put-patch-delete
     */
    it('should send PUT and PATCH payloads positionally', async () => {
      // From docs: PUT, PATCH, DELETE
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        await client.put('/users/123', { name: 'Updated Name' });
        await client.patch('/users/123', { name: 'Partial Update' });
        await client.delete('/users/123');

        expect(server.calls[0]?.body).toBe('{"name":"Updated Name"}');
        expect(server.calls[1]?.body).toBe('{"name":"Partial Update"}');
        expect(server.calls[2]?.method).toBe('DELETE');
      } finally {
        server.stop();
      }
    });
  });

  describe('Error Handling (docs/api/requests.md)', () => {
    /**
     * @source docs:api/requests.md#a-failed-request-rejects
     */
    it('should reject the promise instead of resolving with an ErrorResponse', async () => {
      // From docs: "await on a failed request throws; it never resolves with an ErrorResponse"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });
        let resolved: unknown;
        let rejected = false;

        try {
          resolved = await client.get('/missing');
        } catch {
          rejected = true;
        }

        expect(rejected).toBe(true);
        expect(resolved).toBeUndefined();

        // The narrowing branch the docs keep is a type-level formality: on success it is false
        const ok = await client.get('/users');

        expect(isErrorResponse(ok)).toBe(false);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#reading-the-errorresponse
     */
    it('should put the ErrorResponse in the Effect error channel', async () => {
      // From docs: Reading the ErrorResponse
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        const outcome = await Effect.runPromise(Effect.either(client.getEffect('/missing')));

        expect(outcome._tag).toBe('Left');

        if (outcome._tag === 'Left') {
          expect(outcome.left.code).toBe(HttpStatusCode.NOT_FOUND);
          expect(outcome.left.error).toBe('HTTP_ERROR');
          expect(outcome.left.retryCount).toBe(0);
        }
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#reading-the-errorresponse
     */
    it('should carry the ErrorResponse inside the rejected FiberFailure', async () => {
      // From docs: unwrapping the rejection with Runtime.isFiberFailure + Cause.squash
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });
        let code: number | undefined;
        let name: string | undefined;

        try {
          await client.get('/missing');
        } catch (error) {
          expect(Runtime.isFiberFailure(error)).toBe(true);

          if (Runtime.isFiberFailure(error)) {
            const failure = Cause.squash(error[Runtime.FiberFailureCauseId]);

            expect(isErrorResponse(failure)).toBe(true);

            if (isErrorResponse(failure)) {
              code = failure.code;
              name = failure.error;
            }
          }
        }

        expect(code).toBe(HttpStatusCode.NOT_FOUND);
        expect(name).toBe('HTTP_ERROR');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#error-response
     */
    it('should name the failure in `error`, never in `message`', async () => {
      // From docs: "There is no `message` field"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        const outcome = await Effect.runPromise(Effect.either(client.getEffect('/missing')));

        expect(outcome._tag).toBe('Left');

        if (outcome._tag === 'Left') {
          expect(Object.keys(outcome.left)).not.toContain('message');
          expect(typeof outcome.left.error).toBe('string');
          expect(typeof outcome.left.details).toBe('object');
        }
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#success-response
     */
    it('should carry retryCount on a successful response', async () => {
      // From docs: Success Response
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        const response = await client.get('/users');

        expect(response.success).toBe(true);
        expect(response.retryCount).toBe(0);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#success-response
     */
    it('should carry the upstream headers on a success, out of reach of serialization', async () => {
      // From docs: "`headers` holds the upstream's response headers on every success the client
      // produced ... `headers` is **not enumerable**. `JSON.stringify`, `Object.keys`, a spread
      // (`{ ...response }`) and `structuredClone` skip it."
      const report = JSON.stringify({ pages: 3 });
      /* eslint-disable @typescript-eslint/naming-convention */
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          if (req.method === 'POST') {
            return Response.json({ id: 42 }, { status: 201, headers: { Location: '/files/42' } });
          }

          // Answers HEAD as well: Bun drops the body and keeps the etag and the content-length
          return new Response(report, {
            headers: { 'content-type': 'application/json', ETag: '"v7"', 'Set-Cookie': 'session=upstream' },
          });
        },
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      try {
        const client = createHttpClient({ baseUrl: `http://localhost:${server.port}`, retries: { max: 0 } });

        const head = await client.head('/files/report.pdf');

        expect(head.success).toBe(true);
        if (head.success) {
          expect(head.headers?.etag).toBe('"v7"');
          expect(head.headers?.['content-length']).toBe(String(report.length));
          // Present, and invisible to every serialization
          expect('headers' in head).toBe(true);
          expect(Object.keys(head)).not.toContain('headers');
          expect(JSON.stringify(head)).not.toContain('session=upstream');
          expect({ ...head }).not.toHaveProperty('headers');
          expect(structuredClone(head)).not.toHaveProperty('headers');
        }

        const created = await client.post('/files', { name: 'report.pdf' });

        expect(created).toMatchObject({ success: true, statusCode: 201 });
        if (created.success) {
          const location = created.headers?.location;
          expect(location).toBe('/files/42');
        }
      } finally {
        server.stop(true);
      }
    });

    /**
     * @source docs:api/requests.md#responses-without-a-body
     */
    it('should resolve HEAD, 204 and 304 answers without reading a body', async () => {
      // From docs: "An answer to `HEAD`, and every `204 No Content` and `304 Not Modified`, has no
      // content by definition ... A `304` resolves as a success"
      const etag = '"v1"';
      /* eslint-disable @typescript-eslint/naming-convention */
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          if (req.method === 'DELETE') {
            // A 204 that keeps its JSON content type — it used to reach the JSON parser
            return new Response(null, { status: 204, headers: { 'content-type': 'application/json' } });
          }
          if (req.headers.get('if-none-match') === etag) {
            return new Response(null, { status: 304, headers: { etag, 'content-type': 'application/json' } });
          }

          // Answers HEAD as well: Bun drops the body and keeps `content-type: application/json`
          return Response.json({ id: '123' }, { headers: { etag } });
        },
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      try {
        const client = createHttpClient({ baseUrl: `http://localhost:${server.port}`, retries: { max: 0 } });

        const head = await client.head('/users/123');
        expect(head).toMatchObject({ success: true, statusCode: 200 });
        expect(head.success && head.result).toBeUndefined();

        const removed = await client.delete('/users/123');
        expect(removed).toMatchObject({ success: true, statusCode: 204 });
        expect(removed.success && removed.result).toBeUndefined();

        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await client.get<{ id: string }>('/users/123', undefined, { headers: { 'If-None-Match': etag } });
        expect(response).toMatchObject({ success: true, statusCode: 304 });
        expect(response.success && response.result).toBeUndefined();

        // A request without the condition still gets, and parses, the body
        const fresh = await client.get<{ id: string }>('/users/123');
        expect(fresh.success && fresh.result).toEqual({ id: '123' });
      } finally {
        server.stop(true);
      }
    });

    /**
     * @source docs:api/requests.md#timeouts-and-interruption
     */
    it('should report a body that outlives the timeout as TIMEOUT_ERROR with the status that arrived', async () => {
      // From docs: "Whichever part it catches, the call fails with TIMEOUT_ERROR and code: 0. When
      // the headers had already arrived, details.phase is 'body' and details.statusCode is the
      // status they carried" — and "The upstream sees the connection close when the timeout fires"
      const server = startStallingServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl });

        const outcome = await Effect.runPromise(
          Effect.either(client.getEffect('/reports/export', { timeout: 100 })),
        );

        expect(outcome._tag).toBe('Left');

        if (outcome._tag === 'Left') {
          expect(getTransportFailureKind(outcome.left)).toBe('timeout');
          expect(outcome.left.error).toBe('TIMEOUT_ERROR');
          expect(outcome.left.code).toBe(0);
          expect(outcome.left.details?.phase).toBe('body');
          expect(outcome.left.details?.statusCode).toBe(200);
        }

        await waitFor(() => server.cancelled.length > 0, 500);
        expect(server.cancelled).toEqual(['/reports/export']);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#timeouts-and-interruption
     */
    it('should leave a stalled 500 to retryOnTimeout, not to retryOn', async () => {
      // From docs: "A 500 whose body stalls is therefore a timeout, not a 500: ... retryOnTimeout —
      // off by default — decides whether it is replayed"
      const server = startStallingServer(500);

      try {
        const byDefault = createHttpClient({ baseUrl: server.baseUrl, timeout: 100 });
        const outcome = await Effect.runPromise(Effect.either(byDefault.getEffect('/reports')));

        expect(server.paths).toEqual(['/reports']);
        expect(outcome._tag === 'Left' && outcome.left.details?.statusCode).toBe(500);

        server.paths.length = 0;
        const optedIn = createHttpClient({
          baseUrl: server.baseUrl,
          timeout: 100,
          retries: { max: 1, delay: 1, retryOnTimeout: true },
        });
        await Effect.runPromise(Effect.either(optedIn.getEffect('/reports')));

        expect(server.paths).toEqual(['/reports', '/reports']);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#timeouts-and-interruption
     */
    it('should abort the fetch when the Effect is interrupted', async () => {
      // From docs: "Aborted after 2 s, although the client's own timeout is 10 s" — scaled down
      const aborted: number[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          req.signal.addEventListener('abort', () => aborted.push(performance.now()));

          return new Promise<Response>(() => undefined);
        },
      });

      try {
        const client = createHttpClient({ baseUrl: `http://localhost:${server.port}`, timeout: 10000 });
        const startedAt = performance.now();

        const outcome = await Effect.runPromise(
          Effect.either(Effect.timeout(client.getEffect('/reports'), '100 millis')),
        );
        await waitFor(() => aborted.length > 0, 500);

        // The interruption, not an ErrorResponse
        expect(outcome._tag === 'Left' && Cause.isTimeoutException(outcome.left)).toBe(true);
        expect(aborted.length).toBe(1);
        expect(aborted[0]! - startedAt).toBeLessThan(1000);
      } finally {
        server.stop(true);
      }
    });
  });

  describe('Redirects (docs/api/requests.md)', () => {
    interface Arrival {
      method: string;
      path: string;
      body: string;
      headers: Headers;
    }

    /**
     * `/go/<status>?to=<url>` answers `<status>` with that `Location` (none without `to`), `/loop`
     * redirects to itself,
     * `/chain/<n>` redirects `n` times and then answers 201; anything else answers 200.
     */
    function startRedirectServer(): { origin: string; port: number; arrivals: Arrival[]; stop(): void } {
      const arrivals: Arrival[] = [];
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          arrivals.push({
            method: req.method, path: url.pathname, body: await req.text(), headers: req.headers, 
          });
          const [, route, arg] = url.pathname.split('/');

          if (route === 'go') {
            const to = url.searchParams.get('to');

            return new Response(null, { status: Number(arg), headers: to === null ? {} : { location: to } });
          }
          if (route === 'loop') {
            return new Response(null, { status: 302, headers: { location: '/loop' } });
          }
          if (route === 'chain' && Number(arg) > 0) {
            return new Response(null, { status: 302, headers: { location: `/chain/${Number(arg) - 1}` } });
          }

          return Response.json({ at: url.pathname }, { status: route === 'chain' ? 201 : 200 });
        },
      });

      return {
        origin: `http://127.0.0.1:${server.port}`,
        port: server.port!,
        arrivals,
        stop: () => server.stop(true),
      };
    }

    /**
     * @source docs:api/requests.md#redirects
     */
    it('should follow a redirect and change the method the way fetch does', async () => {
      // From docs: "301 or 302 to a POST → GET, without the body and without Content-Type ...
      // 307 or 308 → the same method with the same body bytes"
      const server = startRedirectServer();

      try {
        const client = createHttpClient({ baseUrl: server.origin });

        const moved = await client.post('/go/302?to=%2Ftarget', { n: 1 });
        const kept = await client.post('/go/307?to=%2Ftarget', { n: 1 });
        // "Any other method answered 301 or 302 keeps its method and body"
        await client.put('/go/301?to=%2Ftarget', { n: 1 });

        expect(moved.success && moved.statusCode).toBe(200);
        expect(kept.success && kept.statusCode).toBe(200);
        const targets = server.arrivals.filter((arrival) => arrival.path === '/target');
        expect(targets.map((arrival) => [arrival.method, arrival.body])).toEqual([
          ['GET', ''],
          ['POST', '{"n":1}'],
          ['PUT', '{"n":1}'],
        ]);
        expect(targets[0].headers.get('content-type')).toBeNull();
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#redirects
     */
    it('should record the chain once, with the original URL and the final status', async () => {
      // From docs: "The metrics sink gets one record for the chain, not one per hop, with the
      // original URL and the final status"
      const server = startRedirectServer();
      const records: RequestMetricsData[] = [];

      try {
        const client = createHttpClient({ baseUrl: server.origin, metricsSink: (data) => records.push(data) });

        await client.get('/chain/2');

        expect(server.arrivals).toHaveLength(3);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ url: `${server.origin}/chain/2`, statusCode: 201 });
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#redirect-headers
     */
    it('should take no credential to another origin, and only the safelisted headers', async () => {
      // From docs: "/v1/files/42 answers 302 to https://cdn.example.net/files/42. The CDN request
      // carries User-Agent, Accept and the trace headers, never X-Api-Key." — `localhost` is
      // another origin than `127.0.0.1`, on the same socket.
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const spanId = '00f067aa0ba902b7';
      setTraceContextProvider(() => ({ traceId, spanId }));
      const server = startRedirectServer();

      try {
        const api = createHttpClient({
          baseUrl: server.origin,
          auth: { type: 'apikey', key: 'X-Api-Key', value: 'secret' },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'X-Request-Id': 'req-1', 'Accept-Language': 'en' },
        });

        await api.get('/go/302', { to: `http://localhost:${server.port}/files/42` });

        const [original, cdn] = server.arrivals;
        expect(original.headers.get('x-api-key')).toBe('secret');
        expect(cdn.path).toBe('/files/42');
        expect(cdn.headers.get('x-api-key')).toBeNull();
        // "credential or not, such as Accept-Language or X-Request-Id"
        expect(cdn.headers.get('x-request-id')).toBeNull();
        expect(cdn.headers.get('accept-language')).toBeNull();
        expect(cdn.headers.get('user-agent')).toBe('OneBun-Requests/1.0');
        expect(cdn.headers.get('accept')).toBe('application/json');
        expect(cdn.headers.get('traceparent')).toBe(`00-${traceId}-${spanId}-01`);
        expect(cdn.headers.get('x-trace-id')).toBe(traceId);
        expect(cdn.headers.get('x-span-id')).toBe(spanId);
      } finally {
        setTraceContextProvider(null);
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#redirect-headers
     */
    it('should carry every header to the same origin, the signature unchanged', async () => {
      // From docs: "A hop to the same origin — same scheme, host and port — carries every header of
      // the original request" and "A same-origin hop carries the signature as it was"
      const server = startRedirectServer();

      try {
        const client = createHttpClient({
          baseUrl: server.origin,
          auth: {
            type: 'onebun', serviceId: 'orders-service', secretKey: 's'.repeat(40), audience: 'billing', 
          },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'X-Request-Id': 'req-1' },
        });

        await client.get('/go/307', { to: `${server.origin}/moved` });

        const [original, moved] = server.arrivals;
        expect(moved.path).toBe('/moved');
        expect(Object.fromEntries(moved.headers)).toEqual(Object.fromEntries(original.headers));
        expect(moved.headers.get('x-onebun-signature')).toStartWith('v=1;svc=orders-service;');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#redirect-error
     */
    it('should fail a redirect it cannot follow with REDIRECT_ERROR, sent once', async () => {
      // From docs: "code is the 3xx that could not be followed. It is never retried, whatever
      // retryOn lists"
      const server = startRedirectServer();

      try {
        const client = createHttpClient({ baseUrl: server.origin, retries: { retryOn: [302] } });

        const outcome = await Effect.runPromise(Effect.either(client.getEffect('/loop')));

        expect(outcome._tag).toBe('Left');
        if (outcome._tag === 'Left' && outcome.left.error === 'REDIRECT_ERROR') {
          expect(outcome.left.code).toBe(302);
          expect(outcome.left.details?.reason).toBe('too-many-redirects');
          expect(outcome.left.details?.location).toBe('/loop');
          expect(outcome.left.details?.redirects).toBe(20);
        }
        expect(outcome._tag === 'Left' && outcome.left.error).toBe('REDIRECT_ERROR');
        // "the answer that would have been the 21st redirect": 21 requests, no retry
        expect(server.arrivals).toHaveLength(21);

        server.arrivals.length = 0;
        const missing = await Effect.runPromise(Effect.either(client.getEffect('/go/303')));
        const invalid = await Effect.runPromise(
          Effect.either(client.getEffect('/go/308', { to: 'ftp://127.0.0.1/file' })),
        );

        expect(missing._tag === 'Left' && [missing.left.code, missing.left.details?.reason])
          .toEqual([303, 'missing-location']);
        expect(invalid._tag === 'Left' && [invalid.left.code, invalid.left.details?.reason])
          .toEqual([308, 'invalid-location']);
        expect(server.arrivals).toHaveLength(2);
      } finally {
        server.stop();
      }
    });
  });

  describe('Limiting the response size (docs/api/requests.md)', () => {
    const EXPORT_TEXT = 'row,value\n'.repeat(10_000);

    /**
     * `/status` answers a small JSON body; `/exports/latest` answers `EXPORT_TEXT` (100 KB) gzip-
     * compressed, `/exports/plain` the same text uncompressed with its `Content-Length`;
     * `/legacy/feed` answers in a coding nobody decodes, `/broken` a corrupt gzip body,
     * `/failing` a 500 with a JSON body, and `/failing-gzip` a 500 with a gzip-compressed JSON body.
     * Records each request's path and `Accept-Encoding`.
     */
    function startSizedServer(): {
      baseUrl: string;
      arrivals: { path: string; acceptEncoding: string | null }[];
      stop(): void;
    } {
      const arrivals: { path: string; acceptEncoding: string | null }[] = [];
      const exportGzip = Bun.gzipSync(new TextEncoder().encode(EXPORT_TEXT));
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          arrivals.push({ path, acceptEncoding: req.headers.get('accept-encoding') });
          const encoded = (body: string | Uint8Array, encoding: string) => new Response(body, {
            headers: new Headers([['content-type', 'text/csv'], ['content-encoding', encoding]]),
          });

          switch (path) {
            case '/status':
              return jsonStatus(200, { status: 'ok' });
            case '/exports/latest':
              return encoded(exportGzip, 'gzip');
            case '/exports/plain':
              return new Response(EXPORT_TEXT, { headers: new Headers([['content-type', 'text/csv']]) });
            case '/legacy/feed':
              return encoded('abc', 'x-foo');
            case '/broken':
              return encoded(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8]), 'gzip');
            case '/failing':
              return jsonStatus(500, { error: 'db down', trace: 'x'.repeat(8192) });
            case '/failing-gzip':
              return new Response(Bun.gzipSync(new TextEncoder().encode(JSON.stringify({ error: 'db down' }))), {
                status: 500,
                headers: new Headers([['content-type', 'application/json'], ['content-encoding', 'gzip']]),
              });
            default:
              return jsonStatus(404);
          }
        },
      });

      return {
        baseUrl: server.url.origin,
        arrivals,
        stop: () => server.stop(true),
      };
    }

    /**
     * @source docs:api/requests.md#max-response-bytes
     */
    it('should cap the decoded body per client, tighten or lift it per call, and decode it itself', async () => {
      // From docs: "A request's own maxResponseBytes wins over the client's. Infinity means no
      // limit: that request is read exactly as one without the option, and fetch decompresses it."
      // and "A limited request sends Accept-Encoding: gzip, deflate, br, zstd"
      const server = startSizedServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, maxResponseBytes: 1024 * 1024 });

        const archive = await client.get('/exports/latest');
        const status = await client.get('/status', undefined, { maxResponseBytes: 4096 });
        const tooBig = await Effect.runPromise(
          Effect.either(client.getEffect('/exports/latest', undefined, { maxResponseBytes: 4096 })),
        );
        const twoArgument = await Effect.runPromise(
          Effect.either(client.getEffect('/exports/latest', { maxResponseBytes: 4096 })),
        );
        const unlimited = await createHttpClient({ baseUrl: server.baseUrl, maxResponseBytes: 16 })
          .get('/exports/latest', undefined, { maxResponseBytes: Number.POSITIVE_INFINITY });

        expect(archive.success && archive.result).toBe(EXPORT_TEXT);
        // "those describe the compressed bytes, not result"
        expect(archive.success && archive.headers?.['content-encoding']).toBeUndefined();
        expect(archive.success && archive.headers?.['content-length']).toBeUndefined();
        expect(server.arrivals[0].acceptEncoding).toBe('gzip, deflate, br, zstd');
        expect(status.success && status.result).toEqual({ status: 'ok' });
        expect(tooBig._tag === 'Left' && tooBig.left.error).toBe('RESPONSE_TOO_LARGE');
        expect(twoArgument._tag === 'Left' && twoArgument.left.error).toBe('RESPONSE_TOO_LARGE');
        expect(unlimited.success && unlimited.result).toBe(EXPORT_TEXT);
        // fetch decompressed it, and fetch keeps the wire headers
        expect(unlimited.success && unlimited.headers?.['content-encoding']).toBe('gzip');
        // "A request's own Accept-Encoding header is sent instead"
        // eslint-disable-next-line @typescript-eslint/naming-convention
        await client.get('/status', undefined, { headers: { 'Accept-Encoding': 'identity' } });
        expect(server.arrivals.at(-1)?.acceptEncoding).toBe('identity');
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#max-response-bytes
     */
    it('should read an error status that fits into details.details, and drop the compressed-size headers it decoded', async () => {
      const server = startSizedServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, maxResponseBytes: 1024 * 1024 });

        const outcome = await Effect.runPromise(
          Effect.either(client.getEffect('/failing', undefined, { retries: { max: 0 } })),
        );
        const compressed = await Effect.runPromise(
          Effect.either(client.getEffect('/failing-gzip', undefined, { retries: { max: 0 } })),
        );

        expect(outcome._tag === 'Left' && outcome.left.error).toBe('HTTP_ERROR');
        expect(outcome._tag === 'Left' && outcome.left.details?.details)
          .toEqual({ error: 'db down', trace: 'x'.repeat(8192) });
        expect(compressed._tag).toBe('Left');
        if (compressed._tag === 'Left') {
          expect(compressed.left.details?.details).toEqual({ error: 'db down' });
          // "When the client decoded the body, neither a success's headers nor an HTTP_ERROR's
          // details.headers has content-encoding or content-length"
          expect(compressed.left.details?.headers).toHaveProperty('content-type', 'application/json');
          expect(compressed.left.details?.headers).not.toHaveProperty('content-encoding');
          expect(compressed.left.details?.headers).not.toHaveProperty('content-length');
        }
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#response-too-large
     */
    it('should fail a body over the limit with RESPONSE_TOO_LARGE, never retried', async () => {
      // From docs: "Its code is the status that arrived" and "It is never retried, whatever
      // retryOn lists"
      const server = startSizedServer();

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          maxResponseBytes: 4096,
          retries: { max: 3, retryOn: [500], delay: 1 },
        });

        const decoded = await Effect.runPromise(Effect.either(client.getEffect('/exports/latest')));
        const declared = await Effect.runPromise(Effect.either(client.getEffect('/exports/plain')));
        const failing = await Effect.runPromise(Effect.either(client.getEffect('/failing')));

        expect(decoded._tag).toBe('Left');
        if (decoded._tag === 'Left') {
          expect(decoded.left.error).toBe('RESPONSE_TOO_LARGE');
          expect(decoded.left.code).toBe(200);
          expect(decoded.left.details?.limit).toBe(4096);
          expect(decoded.left.details?.received).toBeGreaterThan(4096);
          expect(decoded.left.details?.statusCode).toBe(200);
          expect(decoded.left.details?.contentLength).toBeUndefined();
        }
        // "the declared size, when refused before reading"
        expect(declared._tag === 'Left' && declared.left.details).toEqual({
          limit: 4096,
          received: 0,
          statusCode: 200,
          contentLength: EXPORT_TEXT.length,
        });
        expect(failing._tag === 'Left' && [failing.left.error, failing.left.code])
          .toEqual(['RESPONSE_TOO_LARGE', 500]);
        // "The error carries no part of the body"
        expect(JSON.stringify(failing)).not.toContain('db down');
        expect(server.arrivals.filter((arrival) => arrival.path === '/failing')).toHaveLength(1);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#response-decode-error
     */
    it('should fail a body it cannot decode with RESPONSE_DECODE_ERROR, never retried', async () => {
      const server = startSizedServer();

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          maxResponseBytes: 1024 * 1024,
          retries: { max: 3, retryOn: [200], delay: 1 },
        });

        const unknown = await Effect.runPromise(Effect.either(client.getEffect('/legacy/feed')));
        const corrupt = await Effect.runPromise(Effect.either(client.getEffect('/broken')));
        const uncapped = await createHttpClient({ baseUrl: server.baseUrl }).get('/legacy/feed');

        expect(unknown._tag === 'Left' && unknown.left.error).toBe('RESPONSE_DECODE_ERROR');
        expect(unknown._tag === 'Left' && unknown.left.code).toBe(200);
        expect(unknown._tag === 'Left' && unknown.left.details?.reason).toBe('unsupported-encoding');
        expect(unknown._tag === 'Left' && unknown.left.details?.encoding).toBe('x-foo');
        expect(corrupt._tag === 'Left' && corrupt.left.details?.reason).toBe('corrupt-body');
        expect(corrupt._tag === 'Left' && corrupt.left.details?.encoding).toBe('gzip');
        // "A request without a limit is decoded by fetch, which hands a body in an unknown coding
        // over as it is"
        expect(uncapped.success && uncapped.result).toBe('abc');
        expect(server.arrivals.filter((arrival) => arrival.path === '/legacy/feed')).toHaveLength(2);
        expect(server.arrivals.filter((arrival) => arrival.path === '/broken')).toHaveLength(1);
      } finally {
        server.stop();
      }
    });
  });

  describe('Request Configuration (docs/api/requests.md)', () => {
    /**
     * @source docs:api/requests.md#request-configuration
     */
    it('should apply a config given third whatever the second argument is', async () => {
      // From docs: "`client.get('/x', undefined, { headers: { … } })` sends the headers. That holds
      // for all seven methods". It used to be a warning: get, delete, head and options dropped the
      // third argument when the second was `undefined`, and this test pinned the drop.
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const config = { headers: { 'x-a': '1' } };

        await client.get('/g', undefined, config);
        await client.delete('/d', undefined, config);
        await client.head('/h', undefined, config);
        await client.options('/o', undefined, config);
        await client.post('/p', undefined, config);
        await client.put('/u', undefined, config);
        await client.patch('/pa', undefined, config);

        expect(server.calls.map((call) => `${call.method} ${call.path} ${call.headers.get('x-a')}`)).toEqual([
          'GET /g 1',
          'DELETE /d 1',
          'HEAD /h 1',
          'OPTIONS /o 1',
          'POST /p 1',
          'PUT /u 1',
          'PATCH /pa 1',
        ]);
      } finally {
        server.stop();
      }
    });
  });

  describe('HTTP Status Codes (docs/api/requests.md)', () => {
    it('should export HttpStatusCode enum', () => {
      // From docs: HTTP Status Codes
      expect(HttpStatusCode.OK).toBe(200);
      expect(HttpStatusCode.CREATED).toBe(201);
      expect(HttpStatusCode.NO_CONTENT).toBe(204);
      expect(HttpStatusCode.BAD_REQUEST).toBe(400);
      expect(HttpStatusCode.UNAUTHORIZED).toBe(401);
      expect(HttpStatusCode.FORBIDDEN).toBe(403);
      expect(HttpStatusCode.NOT_FOUND).toBe(404);
      expect(HttpStatusCode.CONFLICT).toBe(409);
      expect(HttpStatusCode.UNPROCESSABLE_ENTITY).toBe(422);
      expect(HttpStatusCode.INTERNAL_SERVER_ERROR).toBe(500);
      expect(HttpStatusCode.BAD_GATEWAY).toBe(502);
      expect(HttpStatusCode.SERVICE_UNAVAILABLE).toBe(503);
    });
  });

  describe('isErrorResponse helper (docs/api/requests.md)', () => {
    it('should detect error response', () => {
      // From docs: Response Types
      // isErrorResponse checks: success === false, 'error' exists, 'code' exists and is number
      const errorResponse = {
        success: false as const,
        error: 'NOT_FOUND',
        code: 404,
        details: { message: 'Not found' },
      };

      const successResponse = {
        success: true as const,
        result: { id: '123', name: 'Test' },
      };

      expect(isErrorResponse(errorResponse)).toBe(true);
      expect(isErrorResponse(successResponse)).toBe(false);
    });

    it('should not detect incomplete error response', () => {
      // Missing 'error' field - not a valid ErrorResponse
      const incompleteError = {
        success: false as const,
        code: 404,
        message: 'Not found',
      };

      expect(isErrorResponse(incompleteError)).toBe(false);
    });
  });

  describe('Enhanced Typed Generics (README)', () => {
    it('should support typed query parameters interface', () => {
      // From README: Enhanced Typed Generics - GET Requests
      interface UserQuery {
        name?: string;
        email?: string;
        active?: boolean;
      }

      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // Method 1: Typed query parameters (recommended)
      // This just verifies the API exists
      /* eslint-disable jest/unbound-method */
      expect(typeof client.get<unknown, UserQuery>).toBe('function');
      /* eslint-enable jest/unbound-method */
    });

    it('should support typed request data interface', () => {
      // From README: POST/PUT/PATCH Requests with Typed Data
      interface CreatePostData {
        title: string;
        body: string;
        userId: number;
      }

      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // This just verifies the API exists
      /* eslint-disable jest/unbound-method */
      expect(typeof client.post<unknown, CreatePostData>).toBe('function');
      expect(typeof client.put<unknown, CreatePostData>).toBe('function');
      expect(typeof client.patch<unknown, CreatePostData>).toBe('function');
      /* eslint-enable jest/unbound-method */
    });
  });

  describe('Retry Configuration (docs/api/requests.md)', () => {
    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should apply max, retryOn and onRetry from the documented config shape', async () => {
      // From docs: "max — retries after the first attempt", "retryOn — status codes a server
      // returned", "onRetry — callback on retry" receiving (error, attempt)
      const server = startCountingServer(() => jsonStatus(503));
      const observed: { attempt: number; code: number; error: string }[] = [];

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: {
            max: 2,
            backoff: 'fixed',
            delay: 1,
            retryOn: [503],
            onRetry(error, attempt) {
              observed.push({ attempt, code: error.code, error: error.error });
            },
          },
        });

        await client.get('/reports').catch(() => undefined);

        // max: 2 means two retries *after* the first attempt — three requests in total
        expect(server.methods).toEqual(['GET', 'GET', 'GET']);
        expect(observed).toEqual([
          { attempt: 1, code: 503, error: 'HTTP_ERROR' },
          { attempt: 2, code: 503, error: 'HTTP_ERROR' },
        ]);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should not replay a status that is absent from retryOn', async () => {
      // From docs: retryOn is the list of status codes that are retried — 404 is not on it
      const server = startCountingServer(() => jsonStatus(404));

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: { max: 3, delay: 1 },
        });

        const outcome = await Effect.runPromise(Effect.either(client.getEffect('/missing')));

        expect(server.methods).toEqual(['GET']);
        expect(outcome._tag).toBe('Left');

        if (outcome._tag === 'Left') {
          expect(outcome.left.code).toBe(HttpStatusCode.NOT_FOUND);
          expect(outcome.left.retryCount).toBe(0);
        }
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should not replay a client-side timeout, nor report it as a server 500', async () => {
      // From docs: "A client-side timeout is not retried either, for any method" and
      // "A transport failure carries code: 0 with the error name TIMEOUT_ERROR"
      const server = startCountingServer(async () => {
        await Bun.sleep(300);

        return jsonStatus(200);
      });

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 3, delay: 1 } });

        const outcome = await Effect.runPromise(
          Effect.either(client.getEffect('/reports', { timeout: 60 })),
        );

        expect(server.methods).toEqual(['GET']);
        expect(outcome._tag).toBe('Left');

        if (outcome._tag === 'Left') {
          expect(outcome.left.code).toBe(TRANSPORT_FAILURE_CODE);
          expect(outcome.left.error).toBe('TIMEOUT_ERROR');
          expect(getTransportFailureKind(outcome.left)).toBe('timeout');
        }
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should retry a request that never reached the server, keeping code 0', async () => {
      // From docs: "retryOnNetworkError: true — Refused / DNS / TLS / reset" is a default,
      // and the failure "is never reported as a server 500"
      const dead = startCountingServer(() => jsonStatus(200));
      const { baseUrl } = dead;
      dead.stop();

      const client = createHttpClient({ baseUrl, retries: { max: 2, delay: 1 } });

      const outcome = await Effect.runPromise(Effect.either(client.getEffect('/reports')));

      expect(outcome._tag).toBe('Left');

      if (outcome._tag === 'Left') {
        expect(outcome.left.retryCount).toBe(2);
        expect(outcome.left.code).toBe(TRANSPORT_FAILURE_CODE);
        expect(outcome.left.error).toBe('FETCH_ERROR');
        expect(getTransportFailureKind(outcome.left)).toBe('network');
      }
    });

    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should report a reset after the request was sent as the same network failure', async () => {
      // From docs: "a connection reset after the request was sent is reported the same way
      // (FETCH_ERROR), and that request may have been processed. retryOnNetworkError replays both"
      let received = 0;
      const listener = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: {
          data(socket, chunk) {
            // The request arrived whole; the connection closes without an answer
            if (chunk.toString().startsWith('GET /reports')) {
              received++;
              socket.end();
            }
          },
        },
      });

      try {
        const client = createHttpClient({
          baseUrl: `http://127.0.0.1:${listener.port}`,
          retries: { max: 1, delay: 1 },
        });

        const outcome = await Effect.runPromise(Effect.either(client.getEffect('/reports')));

        expect(outcome._tag).toBe('Left');

        if (outcome._tag === 'Left') {
          expect(outcome.left.error).toBe('FETCH_ERROR');
          expect(getTransportFailureKind(outcome.left)).toBe('network');
          expect(outcome.left.retryCount).toBe(1);
        }
        // Both attempts reached the server
        expect(received).toBe(2);
      } finally {
        listener.stop(true);
      }
    });

    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should use the documented defaults when no retry config is given', () => {
      // From docs: Retry Configuration - Defaults table
      expect(DEFAULT_RETRY_CONFIG.max).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.delay).toBe(300);
      expect(DEFAULT_RETRY_CONFIG.backoff).toBe('exponential');
      expect(DEFAULT_RETRY_CONFIG.factor).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.retryOn).toEqual([408, 429, 500, 502, 503, 504]);
      expect(DEFAULT_RETRY_CONFIG.methods).toEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
      expect(DEFAULT_RETRY_CONFIG.retryOnNetworkError).toBe(true);
      expect(DEFAULT_RETRY_CONFIG.retryOnTimeout).toBe(false);
    });

    /**
     * @source docs:api/requests.md#retry-configuration
     */
    it('should not replay POST or PATCH without an opt-in', async () => {
      // From docs: "POST and PATCH are not retried unless you ask for it"
      const server = startCountingServer(() => jsonStatus(503));

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl });

        await client.post('/charges', { amount: 100 }).catch(() => undefined);
        await client.patch('/charges/1', { amount: 100 }).catch(() => undefined);

        expect(server.methods).toEqual(['POST', 'PATCH']);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#overriding
     */
    it('should merge a partial retry config field-wise onto the defaults', async () => {
      // From docs: "max becomes 5; delay stays 300, retryOn still includes 429"
      const server = startCountingServer((attempt) =>
        attempt === 1 ? jsonStatus(429) : jsonStatus(200));

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: { max: 5 },
        });

        const started = Date.now();
        const response = await client.get('/reports');
        const elapsed = Date.now() - started;

        expect(server.methods).toEqual(['GET', 'GET']);
        expect(isErrorResponse(response)).toBe(false);
        expect(elapsed).toBeGreaterThanOrEqual(DEFAULT_RETRY_DELAY - 50);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retrying-a-non-idempotent-method
     */
    it('should retry POST when the caller lists it in retries.methods', async () => {
      // From docs: Retrying a non-idempotent method
      const server = startCountingServer(() => jsonStatus(429));

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl });

        await client
          .post('/charges', { amount: 100 }, {
            /* eslint-disable @typescript-eslint/naming-convention */
            headers: { 'Idempotency-Key': 'charge-1' },
            /* eslint-enable @typescript-eslint/naming-convention */
            retries: {
              max: 2,
              delay: 1,
              methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'POST'],
            },
          })
          .catch(() => undefined);

        expect(server.methods).toEqual(['POST', 'POST', 'POST']);

        // The same POST without the opt-in is sent once
        server.methods.length = 0;
        await client.post('/charges', { amount: 100 }).catch(() => undefined);

        expect(server.methods).toEqual(['POST']);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#observing-retries
     */
    it('should report retryCount on the response', async () => {
      // From docs: Observing retries
      const server = startCountingServer((attempt) =>
        attempt === 1 ? jsonStatus(429) : jsonStatus(200));

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: { max: 3, delay: 1 },
        });

        const response = await client.get('/reports');

        expect(response.retryCount).toBe(1);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retry-strategies
     */
    it('should keep the delay constant under the fixed strategy', async () => {
      // From docs: `{ max: 3, backoff: 'fixed', delay: 1000 }` retries after 1000ms, 1000ms, 1000ms
      const schedule = resolveRetryConfig({ max: 3, backoff: 'fixed', delay: 1000 });

      expect([1, 2, 3].map((attempt) => calculateRetryDelay(attempt, schedule)))
        .toEqual([1000, 1000, 1000]);

      // ...and the client really sleeps that schedule: 20 + 20 + 20 = 60ms of waiting
      const server = startCountingServer(() => jsonStatus(503));

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: { max: 3, backoff: 'fixed', delay: 20 },
        });
        const started = Date.now();

        await client.get('/reports').catch(() => undefined);
        const elapsed = Date.now() - started;

        expect(server.methods).toEqual(['GET', 'GET', 'GET', 'GET']);
        // Bounded on both sides: the lower bound proves it slept, the upper bound proves it slept
        // the CONFIGURED schedule. Falling back to the 300ms default would take >=900ms and is the
        // failure a lower bound alone cannot see. Which strategy was used is settled exactly by the
        // calculateRetryDelay assertion above, not by wall-clock, which is too noisy to discriminate.
        expect(elapsed).toBeGreaterThanOrEqual(55);
        expect(elapsed).toBeLessThan(600);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retry-strategies
     */
    it('should grow the delay by one base step under the linear strategy', async () => {
      // From docs: `{ max: 3, backoff: 'linear', delay: 1000 }` retries after 1000ms, 2000ms, 3000ms
      const schedule = resolveRetryConfig({ max: 3, backoff: 'linear', delay: 1000 });

      expect([1, 2, 3].map((attempt) => calculateRetryDelay(attempt, schedule)))
        .toEqual([1000, 2000, 3000]);

      // ...and the client really sleeps that schedule: 20 + 40 + 60 = 120ms of waiting
      const server = startCountingServer(() => jsonStatus(503));

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: { max: 3, backoff: 'linear', delay: 20 },
        });
        const started = Date.now();

        await client.get('/reports').catch(() => undefined);
        const elapsed = Date.now() - started;

        expect(server.methods).toEqual(['GET', 'GET', 'GET', 'GET']);
        // See the fixed-strategy test: bounded both ways, and the strategy itself is pinned by the
        // calculateRetryDelay assertion rather than by elapsed time.
        expect(elapsed).toBeGreaterThanOrEqual(115);
        expect(elapsed).toBeLessThan(600);
      } finally {
        server.stop();
      }
    });

    /**
     * @source docs:api/requests.md#retry-strategies
     */
    it('should multiply the delay by the factor under the exponential strategy', async () => {
      // From docs: `{ max: 3, backoff: 'exponential', delay: 1000, factor: 2 }` retries after
      // 1000ms, 2000ms, 4000ms, 8000ms...
      const schedule = resolveRetryConfig({
        max: 3,
        backoff: 'exponential',
        delay: 1000,
        factor: 2,
      });

      expect([1, 2, 3, 4].map((attempt) => calculateRetryDelay(attempt, schedule)))
        .toEqual([1000, 2000, 4000, 8000]);

      // ...and the client really sleeps that schedule: 20 + 40 + 80 = 140ms of waiting
      const server = startCountingServer(() => jsonStatus(503));

      try {
        const client = createHttpClient({
          baseUrl: server.baseUrl,
          retries: {
            max: 3,
            backoff: 'exponential',
            delay: 20,
            factor: 2,
          },
        });
        const started = Date.now();

        await client.get('/reports').catch(() => undefined);
        const elapsed = Date.now() - started;

        expect(server.methods).toEqual(['GET', 'GET', 'GET', 'GET']);
        // 130, not 135: the tighter bound sat ~3ms above the linear schedule's measured wall-clock
        // (126-132ms), so it flaked under load while pretending to discriminate linear from
        // exponential. That discrimination belongs to the calculateRetryDelay assertion above.
        expect(elapsed).toBeGreaterThanOrEqual(130);
        expect(elapsed).toBeLessThan(600);
      } finally {
        server.stop();
      }
    });
  });
});

describe('Request Client API Methods', () => {
  const client = createHttpClient({
    baseUrl: 'https://api.example.com',
    timeout: 5000,
  });

  describe('GET Requests', () => {
    it('should have get method', () => {
      expect(typeof client.get).toBe('function');
    });

    it('should have getEffect method', () => {
      expect(typeof client.getEffect).toBe('function');
    });
  });

  describe('POST Requests', () => {
    it('should have post method', () => {
      expect(typeof client.post).toBe('function');
    });

    it('should have postEffect method', () => {
      expect(typeof client.postEffect).toBe('function');
    });
  });

  describe('PUT Requests', () => {
    it('should have put method', () => {
      expect(typeof client.put).toBe('function');
    });

    it('should have putEffect method', () => {
      expect(typeof client.putEffect).toBe('function');
    });
  });

  describe('PATCH Requests', () => {
    it('should have patch method', () => {
      expect(typeof client.patch).toBe('function');
    });

    it('should have patchEffect method', () => {
      expect(typeof client.patchEffect).toBe('function');
    });
  });

  describe('DELETE Requests', () => {
    it('should have delete method', () => {
      expect(typeof client.delete).toBe('function');
    });

    it('should have deleteEffect method', () => {
      expect(typeof client.deleteEffect).toBe('function');
    });
  });
});

/**
 * docs/api/trace.md, "Context Propagation": three headers go out, the parent id is the innermost
 * open span, `tracing: false` suppresses them, and nothing is sent when there is no trace to join.
 *
 * Driven through a registered provider rather than a whole application — that is the seam the
 * page documents for anyone using `createHttpClient()` outside OneBun, and it keeps the assertion
 * on what reaches the wire.
 */
describe('Outgoing trace context (docs/api/trace.md)', () => {
  const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
  const SPAN_ID = '00f067aa0ba902b7';
  const NOT_SAMPLED = 0;

  let received: Headers[];
  let upstream: ReturnType<typeof Bun.serve>;
  let upstreamUrl: string;

  beforeEach(() => {
    received = [];
    upstream = Bun.serve({
      port: 0,
      fetch(request) {
        received.push(request.headers);

        return Response.json({ ok: true });
      },
    });
    upstreamUrl = `http://localhost:${upstream.port}/echo`;
  });

  afterEach(() => {
    setTraceContextProvider(null);
    upstream.stop(true);
  });

  /**
   * @source docs:api/trace.md#context-propagation
   */
  it('should send traceparent plus the X-Trace-Id / X-Span-Id pair', async () => {
    setTraceContextProvider(() => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }));

    await createHttpClient().get(upstreamUrl);

    const [headers] = received;
    expect(headers.get('traceparent')).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    expect(headers.get('x-trace-id')).toBe(TRACE_ID);
    // Sent WITH the trace id, never without: the receiver needs both, so a lone id joins nothing.
    expect(headers.get('x-span-id')).toBe(SPAN_ID);
  });

  /**
   * @source docs:api/trace.md#context-propagation
   */
  it('should carry the sampling decision rather than claiming everything is sampled', async () => {
    setTraceContextProvider(() => ({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: NOT_SAMPLED,
    }));

    await createHttpClient().get(upstreamUrl);

    expect(received[0].get('traceparent')).toBe(`00-${TRACE_ID}-${SPAN_ID}-00`);
  });

  /**
   * @source docs:api/trace.md#context-propagation
   */
  it('should send nothing when tracing is off, per client and per call', async () => {
    setTraceContextProvider(() => ({ traceId: TRACE_ID, spanId: SPAN_ID }));

    await createHttpClient({ tracing: false }).get(upstreamUrl);
    await createHttpClient().get(upstreamUrl, { tracing: false });

    expect(received.map((headers) => headers.get('traceparent'))).toEqual([null, null]);
  });

  /**
   * @source docs:api/trace.md#context-propagation
   */
  it('should send nothing when there is no trace to join, or when the ids are unusable', async () => {
    await createHttpClient().get(upstreamUrl);

    // The all-zero ids are OpenTelemetry's "invalid" sentinels, handed out for non-recording
    // spans — so they arrive routinely, and a peer honouring them would join a trace that does
    // not exist. A malformed `traceparent` can also get the request rejected outright.
    setTraceContextProvider(() => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16) }));
    await createHttpClient().get(upstreamUrl);

    setTraceContextProvider(() => ({ traceId: 'not-hex', spanId: SPAN_ID }));
    await createHttpClient().get(upstreamUrl);

    setTraceContextProvider(() => {
      throw new Error('provider exploded');
    });
    await createHttpClient().get(upstreamUrl);

    expect(received.map((headers) => headers.get('traceparent'))).toEqual([null, null, null, null]);
  });
});

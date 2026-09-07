/**
 * Documentation Examples Tests for @onebun/requests
 *
 * @source docs:api/requests.md
 */

import {
  describe,
  it,
  expect,
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
      // From docs: "an object carrying `headers`, `timeout`, `auth` or `method` is read as config"
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
  });

  describe('Request Configuration (docs/api/requests.md)', () => {
    /**
     * @source docs:api/requests.md#request-configuration
     */
    it('should drop the third argument of get when the second is undefined', async () => {
      // From docs (warning): "get, delete, head and options drop the third argument
      // when the second is undefined"
      const server = startEchoServer();

      try {
        const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

        /* eslint-disable @typescript-eslint/naming-convention */
        await client.get('/users', undefined, { headers: { 'X-Request-ID': 'rid-1' } });
        await client.post('/users', undefined, { headers: { 'X-Request-ID': 'rid-2' } });
        /* eslint-enable @typescript-eslint/naming-convention */

        expect(server.calls[0]?.headers.get('x-request-id')).toBeNull();
        expect(server.calls[1]?.headers.get('x-request-id')).toBe('rid-2');
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
      // From docs: "retryOnNetworkError: true — connection refused / DNS / TLS" is a default,
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

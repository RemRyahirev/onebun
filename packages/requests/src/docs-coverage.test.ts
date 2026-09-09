/**
 * Coverage tests for sections of docs/api/requests.md that `docs-examples.test.ts` leaves
 * unpinned. Each test carries an `@source` anchor naming the section whose promise it checks.
 *
 * Symbols are imported through `@onebun/requests`, the package this page documents. The doc
 * snippets import them from `@onebun/core`, which only re-exports them — pulling core in here
 * would invert the dependency (core depends on requests, not the other way round).
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';
import { Effect } from 'effect';

import {
  type AuthConfig,
  createHttpClient,
  DEFAULT_RETRY_DELAY,
  type ErrorResponse,
  type HttpClient,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  NotFoundError,
  OneBunBaseError,
  TRANSPORT_FAILURE_CODE,
  makeSingleReplicaNonceStore,
  verifyOneBunRequest,
} from '@onebun/requests';

interface RecordedCall {
  method: string;
  path: string;
  /** The absolute URL as it arrived, which is what a signature is verified against. */
  url: string;
  headers: Headers;
  body: string;
}

interface StubServer {
  baseUrl: string;
  calls: RecordedCall[];
  stop(): void;
}

/**
 * Records what the client really put on the wire and answers with whatever the test dictates,
 * so every documented promise is checked against an observable request/response pair.
 */
function startStubServer(
  respond: (call: RecordedCall) => Response | Promise<Response>,
): StubServer {
  const calls: RecordedCall[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE';
      const call: RecordedCall = {
        method: req.method,
        path: url.pathname + url.search,
        url: req.url,
        headers: req.headers,
        body: hasBody ? await req.text() : '',
      };

      calls.push(call);

      return await respond(call);
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    calls,
    stop: () => server.stop(true),
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: new Headers([['content-type', 'application/json']]),
  });

/** Reads the ErrorResponse out of an error thrown by the documented mapping recipes. */
function asErrorResponse(error: unknown): ErrorResponse | undefined {
  return error instanceof OneBunBaseError ? error.toErrorResponse() : undefined;
}

/**
 * Verify a recorded call the way a callee would: from the request itself.
 *
 * The header set is taken verbatim from what the client sent — nothing is added. An earlier
 * version of this helper synthesised `x-onebun-method` and `x-onebun-url`, headers the client
 * never emitted, which is how a protocol nobody could speak stayed green.
 */
async function verifyRecordedCall(
  call: RecordedCall,
  secret: string,
): Promise<{ serviceId?: string; valid: boolean }> {
  const headers: Record<string, string> = {};
  call.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  const result = await Effect.runPromise(verifyOneBunRequest(
    {
      method: call.method,
      url: call.url,
      headers,
      body: call.body === undefined || call.body === '' ? undefined : call.body,
    },
    { secret, audience: false, nonceStore: makeSingleReplicaNonceStore() },
  ));

  return { serviceId: result.serviceId, valid: result.valid };
}

interface RecordedLog {
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

/** Stands in for `BaseService.logger`, which the framework installs before the constructor. */
class CollectingLogger {
  readonly entries: RecordedLog[] = [];

  debug(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'debug', message, context });
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'info', message, context });
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, context });
  }
}

describe('Creating HTTP Client (docs/api/requests.md)', () => {
  /**
   * @source docs:api/requests.md#creating-http-client
   */
  it('should prefix baseUrl and put the configured headers on every request', async () => {
    // From docs: createHttpClient({ baseUrl, timeout, headers }) — the client options travel
    // with every request the client makes
    const server = startStubServer(() => json({ ok: true }));

    try {
      /* eslint-disable @typescript-eslint/naming-convention */
      const client = createHttpClient({
        baseUrl: server.baseUrl,
        timeout: 10000,
        headers: {
          // Both of the snippet's values are also the framework's own defaults (`buildHeaders`
          // seeds Accept and Content-Type with 'application/json'), so a configured header is
          // only observable through a value the default cannot supply: Accept carries one, and
          // an ignored `headers` option — or one merged before the defaults instead of after —
          // turns the assertion below red. Content-Type is sent as documented but pins nothing.
          'Content-Type': 'application/json',
          Accept: 'application/vnd.example+json',
        },
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      await client.get('/users');
      await client.post('/users', { name: 'John' });

      expect(server.calls.map((call) => `${call.method} ${call.path}`))
        .toEqual(['GET /users', 'POST /users']);
      expect(server.calls.map((call) => call.headers.get('accept')))
        .toEqual(['application/vnd.example+json', 'application/vnd.example+json']);
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#creating-http-client
   */
  it('should abort a request that outlives the client-level timeout', async () => {
    // From docs: `timeout: 10000,  // 10 seconds` — the client option is the deadline
    const server = startStubServer(async () => {
      await Bun.sleep(300);

      return json({ ok: true });
    });

    try {
      const client = createHttpClient({
        baseUrl: server.baseUrl,
        timeout: 50,
        retries: { max: 0 },
      });

      const outcome = await Effect.runPromise(Effect.either(client.getEffect('/slow')));

      expect(outcome._tag).toBe('Left');

      if (outcome._tag === 'Left') {
        expect(outcome.left.error).toBe('TIMEOUT_ERROR');
        expect(outcome.left.code).toBe(TRANSPORT_FAILURE_CODE);
      }
    } finally {
      server.stop();
    }
  });
});

describe('Authentication (docs/api/requests.md)', () => {
  /**
   * @source docs:api/requests.md#bearer-token
   */
  it('should send the bearer token in the Authorization header', async () => {
    // From docs: auth: { type: 'bearer', token: 'your-jwt-token' }
    const server = startStubServer(() => json({ ok: true }));

    try {
      const client = createHttpClient({
        baseUrl: server.baseUrl,
        auth: { type: 'bearer', token: 'your-jwt-token' },
      });

      await client.get('/users');
      await client.post('/users', { name: 'John' });

      expect(server.calls.map((call) => call.headers.get('authorization')))
        .toEqual(['Bearer your-jwt-token', 'Bearer your-jwt-token']);
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#api-key
   */
  it('should send the api key in the header named by the auth config', async () => {
    // From docs: an API key is carried in a named header, 'X-API-Key' or 'Authorization'.
    // The union member is `{ type: 'apikey', key: <header name>, value: <the key> }` — the
    // page spells it `{ type: 'apiKey', key: <the key>, header: <header name> }`, which is
    // neither assignable nor honoured; both halves are pinned so the drift is not silent.
    const server = startStubServer(() => json({ ok: true }));

    try {
      const client = createHttpClient({
        baseUrl: server.baseUrl,
        auth: { type: 'apikey', key: 'X-API-Key', value: 'your-api-key' },
      });

      await client.get('/users');

      expect(server.calls[0].headers.get('x-api-key')).toBe('your-api-key');

      // The page's spelling falls through `applyAuth`'s default branch: the request goes out
      // unauthenticated. Fix the page (or teach applyAuth the alias) and this goes red.
      const asDocumented = createHttpClient({
        baseUrl: server.baseUrl,
        auth: { type: 'apiKey', key: 'your-api-key', header: 'X-API-Key' } as unknown as AuthConfig,
      });

      await asDocumented.get('/users');

      expect(server.calls[1].headers.get('x-api-key')).toBeNull();
      expect(server.calls[1].headers.get('authorization')).toBeNull();
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#basic-auth
   */
  it('should send username and password base64-encoded in the Authorization header', async () => {
    // From docs: auth: { type: 'basic', username: 'user', password: 'pass' }
    const server = startStubServer(() => json({ ok: true }));

    try {
      const client = createHttpClient({
        baseUrl: server.baseUrl,
        auth: { type: 'basic', username: 'user', password: 'pass' },
      });

      await client.get('/users');

      const header = server.calls[0].headers.get('authorization') ?? '';

      expect(header).toBe(`Basic ${btoa('user:pass')}`);
      expect(atob(header.slice('Basic '.length))).toBe('user:pass');
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#onebun-hmac-inter-service
   */
  it('should sign the request with the shared secret so the callee can verify it', async () => {
    // From docs: auth: { type: 'onebun', serviceId, secretKey } — inter-service HMAC
    const server = startStubServer(() => json({ ok: true }));

    try {
      const client = createHttpClient({
        baseUrl: server.baseUrl,
        auth: { type: 'onebun', serviceId: 'my-service', secretKey: 'shared-secret' },
      });

      await client.get('/internal');
      await client.get('/internal');

      const [first, second] = server.calls;

      // One self-describing header carries the whole claim.
      expect(first.headers.get('x-onebun-signature')).toContain('v=1;svc=my-service;');
      expect(first.headers.get('x-onebun-signature')).toContain('alg=hmac-sha256;');

      // The callee accepts the signature when it holds the same secret...
      expect(await verifyRecordedCall(first, 'shared-secret'))
        .toEqual({ serviceId: 'my-service', valid: true });

      // ...and rejects it when it does not.
      expect(await verifyRecordedCall(first, 'other-secret'))
        .toEqual({ serviceId: 'my-service', valid: false });

      // Each request is signed afresh: the nonce, and therefore the signature, is not reused.
      expect(first.headers.get('x-onebun-signature'))
        .not.toBe(second.headers.get('x-onebun-signature'));
    } finally {
      server.stop();
    }
  });
});

describe('Mapping upstream failures to framework errors (docs/api/requests.md)', () => {
  interface User {
    id: string;
    name: string;
  }

  /**
   * The documented recipe verbatim, minus `@Service()`/`BaseService`, which only supply
   * `this.logger` and `this.config` — the mapping itself is what this section promises.
   */
  class UserService {
    constructor(private readonly client: HttpClient) {}

    async findById(id: string): Promise<User> {
      const outcome = await Effect.runPromise(
        Effect.either(this.client.getEffect<User>(`/users/${id}`)),
      );

      if (outcome._tag === 'Left') {
        if (outcome.left.code === 404) {
          throw new NotFoundError('User', { id });
        }

        throw new InternalServerError(outcome.left.error, outcome.left.details);
      }

      if (isErrorResponse(outcome.right)) {
        throw new InternalServerError(outcome.right.error);
      }

      return outcome.right.result;
    }
  }

  /**
   * @source docs:api/requests.md#mapping-upstream-failures-to-framework-errors
   */
  it('should turn an upstream 404 into NotFoundError and anything else into a 500', async () => {
    const server = startStubServer((call) =>
      (call.path === '/users/1'
        ? json({ id: '1', name: 'John' })
        : call.path === '/users/404'
          ? json({ error: 'no such user' }, HttpStatusCode.NOT_FOUND)
          : json({ error: 'nope' }, HttpStatusCode.NOT_IMPLEMENTED)));

    try {
      // The section is about mapping, not retrying: one attempt per call keeps it deterministic
      const service = new UserService(
        createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } }),
      );

      expect(await service.findById('1')).toEqual({ id: '1', name: 'John' });

      let notFound: ErrorResponse | undefined;

      try {
        await service.findById('404');
      } catch (error) {
        notFound = asErrorResponse(error);
      }

      expect(notFound).toMatchObject({
        success: false,
        error: 'User',
        code: HttpStatusCode.NOT_FOUND,
        details: { id: '404' },
      });

      let serverError: ErrorResponse | undefined;

      try {
        await service.findById('boom');
      } catch (error) {
        serverError = asErrorResponse(error);
      }

      expect(serverError?.code).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
      expect(serverError?.error).toBe('HTTP_ERROR');
      // `outcome.left.details` is carried across into the framework error
      expect(serverError?.details?.method).toBe('GET');
      expect(String(serverError?.details?.url)).toBe(`${server.baseUrl}/users/boom`);
    } finally {
      server.stop();
    }
  });
});

describe('HTTP Status Codes (docs/api/requests.md)', () => {
  /**
   * @source docs:api/requests.md#http-status-codes
   */
  it('should expose the documented status-code constants and report them on responses', async () => {
    // From docs: the HttpStatusCode table
    expect({
      ok: HttpStatusCode.OK,
      created: HttpStatusCode.CREATED,
      noContent: HttpStatusCode.NO_CONTENT,
      badRequest: HttpStatusCode.BAD_REQUEST,
      unauthorized: HttpStatusCode.UNAUTHORIZED,
      forbidden: HttpStatusCode.FORBIDDEN,
      notFound: HttpStatusCode.NOT_FOUND,
      conflict: HttpStatusCode.CONFLICT,
      unprocessableEntity: HttpStatusCode.UNPROCESSABLE_ENTITY,
      internalServerError: HttpStatusCode.INTERNAL_SERVER_ERROR,
      badGateway: HttpStatusCode.BAD_GATEWAY,
      serviceUnavailable: HttpStatusCode.SERVICE_UNAVAILABLE,
    }).toEqual({
      ok: 200,
      created: 201,
      noContent: 204,
      badRequest: 400,
      unauthorized: 401,
      forbidden: 403,
      notFound: 404,
      conflict: 409,
      unprocessableEntity: 422,
      internalServerError: 500,
      badGateway: 502,
      serviceUnavailable: 503,
    });

    // ...and the constant is the same number a real response reports
    const server = startStubServer(() => json({ error: 'bad' }, 422));

    try {
      const client = createHttpClient({ baseUrl: server.baseUrl, retries: { max: 0 } });

      const outcome = await Effect.runPromise(Effect.either(client.getEffect('/thing')));

      expect(outcome._tag).toBe('Left');

      if (outcome._tag === 'Left') {
        expect(outcome.left.code).toBe(HttpStatusCode.UNPROCESSABLE_ENTITY);
      }
    } finally {
      server.stop();
    }
  });
});

describe('Using in Services (docs/api/requests.md)', () => {
  interface ExternalData {
    id: string;
    value: number;
  }

  interface Resource {
    id: string;
    name: string;
  }

  /**
   * The documented service, minus `@Service()`/`BaseService`: `this.config` and `this.logger`
   * are handed in, so what the test observes is the HTTP client the constructor builds.
   */
  class ExternalApiService {
    private readonly client: HttpClient;

    constructor(
      config: { get(key: string): string },
      private readonly logger: CollectingLogger,
    ) {
      this.client = createHttpClient({
        baseUrl: config.get('external.apiUrl'),
        auth: {
          type: 'bearer',
          token: config.get('external.apiToken'),
        },
        retries: {
          max: 3,
          backoff: 'exponential',
          // The page says 1000; shrunk here so three backoffs cost 35ms instead of 7 seconds
          delay: 5,
        },
      });
    }

    async fetchData(id: string): Promise<ExternalData> {
      this.logger.debug('Fetching external data', { id });

      const outcome = await Effect.runPromise(
        Effect.either(this.client.getEffect<ExternalData>(`/data/${id}`)),
      );

      if (outcome._tag === 'Left') {
        this.logger.error('External API error', {
          id,
          code: outcome.left.code,
          error: outcome.left.error,
        });

        throw new Error(`External API error: ${outcome.left.error}`);
      }

      if (isErrorResponse(outcome.right)) {
        throw new Error(outcome.right.error);
      }

      return outcome.right.result;
    }

    async createResource(data: { name: string }): Promise<Resource> {
      const response = await this.client.post<Resource>('/resources', data);

      if (isErrorResponse(response)) {
        throw new Error(response.error);
      }

      return response.result;
    }
  }

  const makeService = (baseUrl: string): { service: ExternalApiService; logger: CollectingLogger } => {
    const logger = new CollectingLogger();
    const config = {
      get: (key: string): string => (key === 'external.apiUrl' ? baseUrl : 'token-from-config'),
    };

    return { service: new ExternalApiService(config, logger), logger };
  };

  /**
   * @source docs:api/requests.md#using-in-services
   */
  it('should authenticate from config and unwrap the result', async () => {
    // From docs: the constructor reads baseUrl and the bearer token off this.config.
    // The snippet's `this.logger.debug(...)` is not asserted: the logger here is the test's
    // own double and the service its own copy of the snippet, so a recorded debug entry
    // observes neither the client nor the framework. The error entry of the sibling test is
    // different — its `code`/`error` come out of the framework's ErrorResponse.
    const server = startStubServer(() => json({ id: 'ok', value: 42 }));

    try {
      const { service } = makeService(server.baseUrl);

      expect(await service.fetchData('ok')).toEqual({ id: 'ok', value: 42 });
      expect(server.calls[0].path).toBe('/data/ok');
      expect(server.calls[0].headers.get('authorization')).toBe('Bearer token-from-config');
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#using-in-services
   */
  it('should replay the retryable failure, then log and rethrow it', async () => {
    // From docs: retries { max: 3 } on the client, then the Left branch logs code/error and
    // throws `External API error: <error>`
    const arrivals: number[] = [];
    const server = startStubServer(() => {
      arrivals.push(Date.now());

      return json({ error: 'busy' }, HttpStatusCode.SERVICE_UNAVAILABLE);
    });

    try {
      const { service, logger } = makeService(server.baseUrl);

      await expect(service.fetchData('down')).rejects.toThrow('External API error: HTTP_ERROR');

      // max: 3 means three retries after the first attempt
      expect(server.calls.map((call) => call.path)).toEqual([
        '/data/down',
        '/data/down',
        '/data/down',
        '/data/down',
      ]);

      // ...but `max: 3` and `backoff: 'exponential'` are DEFAULT_RETRY_CONFIG's own values, so
      // the call count alone cannot tell the constructor's `retries` from the defaults. The
      // waits between the attempts can: the configured 5ms exponential spaces them 5/10/20ms
      // apart, whereas an ignored client-level config falls back to 300/600/1200ms.
      const gaps = arrivals.slice(1).map((arrival, index) => arrival - arrivals[index]);

      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5);
      expect(Math.max(...gaps)).toBeLessThan(DEFAULT_RETRY_DELAY);
      expect(logger.entries[1]).toEqual({
        level: 'error',
        message: 'External API error',
        context: { id: 'down', code: HttpStatusCode.SERVICE_UNAVAILABLE, error: 'HTTP_ERROR' },
      });
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#using-in-services
   */
  it('should post the payload and return the created resource', async () => {
    // From docs: createResource — `await this.client.post(...)` then `response.result`
    const server = startStubServer((call) =>
      json({ id: 'r-1', name: (JSON.parse(call.body) as { name: string }).name }, 201));

    try {
      const { service } = makeService(server.baseUrl);

      expect(await service.createResource({ name: 'widget' })).toEqual({ id: 'r-1', name: 'widget' });
      expect(server.calls[0].method).toBe('POST');
      expect(server.calls[0].path).toBe('/resources');
      expect(server.calls[0].body).toBe('{"name":"widget"}');
    } finally {
      server.stop();
    }
  });
});

describe('Complete Example (docs/api/requests.md)', () => {
  interface User {
    id: string;
    name: string;
    email: string;
  }

  interface CreateUserDto {
    name: string;
    email: string;
  }

  /**
   * The page's `UserApiService`, minus `@Service()`/`BaseService` and `@Span()` — the tracing
   * decorator is api/trace.md's promise, not this page's.
   */
  class UserApiService {
    private readonly client: HttpClient;

    constructor(config: { get(key: string): string }) {
      this.client = createHttpClient({
        baseUrl: config.get('services.usersUrl'),
        timeout: 10000,
        /* eslint-disable @typescript-eslint/naming-convention */
        headers: {
          'Content-Type': 'application/json',
        },
        /* eslint-enable @typescript-eslint/naming-convention */
        auth: {
          type: 'onebun',
          serviceId: 'my-service',
          secretKey: config.get('services.secretKey'),
        },
        retries: {
          max: 3,
          backoff: 'exponential',
          // The page says 1000; shrunk so a retried call costs 35ms instead of 7 seconds
          delay: 5,
          factor: 2,
          retryOn: [408, 429, 500, 502, 503, 504],
        },
      });
    }

    async findAll(page = 1, limit = 10): Promise<User[]> {
      const response = await this.client.get<User[]>('/users', { page, limit });

      if (isErrorResponse(response)) {
        throw new Error(response.error);
      }

      return response.result;
    }

    async findById(id: string): Promise<User> {
      const outcome = await Effect.runPromise(
        Effect.either(this.client.getEffect<User>(`/users/${id}`)),
      );

      if (outcome._tag === 'Left') {
        if (outcome.left.code === 404) {
          throw new NotFoundError('User', { id });
        }

        throw new Error(outcome.left.error);
      }

      if (isErrorResponse(outcome.right)) {
        throw new Error(outcome.right.error);
      }

      return outcome.right.result;
    }

    async create(data: CreateUserDto): Promise<User> {
      const response = await this.client.post<User>('/users', data);

      if (isErrorResponse(response)) {
        throw new Error(response.error);
      }

      return response.result;
    }

    async update(id: string, data: Partial<CreateUserDto>): Promise<User> {
      const outcome = await Effect.runPromise(
        Effect.either(this.client.patchEffect<User>(`/users/${id}`, data)),
      );

      if (outcome._tag === 'Left') {
        if (outcome.left.code === 404) {
          throw new NotFoundError('User', { id });
        }

        throw new Error(outcome.left.error);
      }

      if (isErrorResponse(outcome.right)) {
        throw new Error(outcome.right.error);
      }

      return outcome.right.result;
    }

    async delete(id: string): Promise<void> {
      const outcome = await Effect.runPromise(
        Effect.either(this.client.deleteEffect(`/users/${id}`)),
      );

      if (outcome._tag === 'Left') {
        if (outcome.left.code === 404) {
          throw new NotFoundError('User', { id });
        }

        throw new Error(outcome.left.error);
      }
    }
  }

  const john: User = { id: '1', name: 'John', email: 'john@example.com' };

  /** Routes the five documented calls; anything unexpected is answered 501 so it cannot pass. */
  const startUsersServer = (): StubServer =>
    startStubServer((call) => {
      if (call.method === 'GET' && call.path.startsWith('/users?')) {
        return json([john]);
      }

      if (call.path === '/users/404') {
        return json({ error: 'no such user' }, HttpStatusCode.NOT_FOUND);
      }

      if (call.method === 'GET' && call.path === '/users/1') {
        return json(john);
      }

      if (call.method === 'POST' && call.path === '/users') {
        return json({ id: '2', ...(JSON.parse(call.body) as CreateUserDto) }, 201);
      }

      if (call.method === 'PATCH' && call.path === '/users/1') {
        return json({ ...john, ...(JSON.parse(call.body) as Partial<CreateUserDto>) });
      }

      if (call.method === 'DELETE' && call.path === '/users/1') {
        return new Response(null, { status: HttpStatusCode.NO_CONTENT });
      }

      return json({ error: 'unexpected call' }, HttpStatusCode.NOT_IMPLEMENTED);
    });

  const makeService = (baseUrl: string): UserApiService =>
    new UserApiService({
      get: (key: string): string => (key === 'services.usersUrl' ? baseUrl : 'shared-secret'),
    });

  /**
   * @source docs:api/requests.md#complete-example
   */
  it('should read, create and update users through the documented calls', async () => {
    const server = startUsersServer();

    try {
      const service = makeService(server.baseUrl);

      expect(await service.findAll(2, 5)).toEqual([john]);
      expect(await service.create({ name: 'Jane', email: 'jane@example.com' }))
        .toEqual({ id: '2', name: 'Jane', email: 'jane@example.com' });
      expect(await service.update('1', { name: 'Johnny' }))
        .toEqual({ ...john, name: 'Johnny' });

      expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        // findAll passes the page/limit record positionally, so it becomes the query string
        'GET /users?page=2&limit=5',
        'POST /users',
        'PATCH /users/1',
      ]);
      expect(server.calls[1].body).toBe('{"name":"Jane","email":"jane@example.com"}');
      expect(server.calls[2].body).toBe('{"name":"Johnny"}');

      // Every call is signed with the identity and the secret the constructor read off config,
      // and verified the way a callee would: from the request that actually arrived. The
      // signature now covers the method, the full path, the query string and the body, so it
      // holds only if all four match what was sent.
      const verified = await Promise.all(
        server.calls.map(async (call) => await verifyRecordedCall(call, 'shared-secret')),
      );

      expect(verified).toEqual([
        { serviceId: 'my-service', valid: true },
        { serviceId: 'my-service', valid: true },
        { serviceId: 'my-service', valid: true },
      ]);
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#complete-example
   */
  it('should raise NotFoundError with the id when the upstream answers 404', async () => {
    const server = startUsersServer();

    try {
      const service = makeService(server.baseUrl);
      const failures: (ErrorResponse | undefined)[] = [];

      for (const call of [
        (): Promise<unknown> => service.findById('404'),
        (): Promise<unknown> => service.update('404', { name: 'Nobody' }),
        (): Promise<unknown> => service.delete('404'),
      ]) {
        try {
          await call();
          failures.push(undefined);
        } catch (error) {
          failures.push(asErrorResponse(error));
        }
      }

      expect(failures.map((failure) => failure?.code)).toEqual([404, 404, 404]);
      expect(failures.map((failure) => failure?.error)).toEqual(['User', 'User', 'User']);
      expect(failures.map((failure) => failure?.details)).toEqual([
        { id: '404' },
        { id: '404' },
        { id: '404' },
      ]);
      // 404 is absent from retryOn, so none of the three was replayed
      expect(server.calls.map((call) => call.method)).toEqual(['GET', 'PATCH', 'DELETE']);
    } finally {
      server.stop();
    }
  });

  /**
   * @source docs:api/requests.md#complete-example
   */
  it('should resolve delete when the upstream answers 204 with no body', async () => {
    const server = startUsersServer();

    try {
      const service = makeService(server.baseUrl);
      const outcome: string[] = [];

      try {
        await service.delete('1');
        outcome.push('resolved');
      } catch (error) {
        outcome.push(`threw ${String(error)}`);
      }

      // An empty 204 body is a success, not a RESPONSE_PARSE_ERROR
      expect(outcome).toEqual(['resolved']);
      expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['DELETE /users/1']);
    } finally {
      server.stop();
    }
  });
});

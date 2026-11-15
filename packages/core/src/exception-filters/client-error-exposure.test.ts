/**
 * What an uncaught HTTP-client error sends to the application's OWN caller.
 *
 * A controller that lets a client error escape hands it to the default exception filter, which
 * serializes a `OneBunBaseError` into the response body. The client's error record carries the
 * upstream's response headers (its `set-cookie` included), the URL the request went to, and the
 * upstream's body: none of that was written for this application's caller. Each client path is
 * driven through a real application against a real upstream, because the leak lives in how the
 * pieces meet, not in any one of them.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  Effect,
  Either,
  Layer,
} from 'effect';

import type { ApplicationOptions } from '../types';

import {
  getTransportFailureKind,
  HttpClient,
  InternalServerError,
  isHttpClientFailure,
  makeRequestsService,
  NotFoundError,
  OneBunBaseError,
  RequestsService,
  TransportError,
} from '@onebun/requests';


import { OneBunApplication } from '../application/application';
import {
  Controller,
  Get,
  Module,
  Param,
} from '../decorators/decorators';
import { createServiceClient } from '../service-client/service-client';
import { createServiceDefinition } from '../service-client/service-definition';
import { makeMockLoggerLayer, makeRecordingLoggerLayer } from '../testing/test-utils';

import { createExceptionFilter } from './exception-filters';

const COOKIE_ONE = 'session=COOKIE-SECRET-ONE; Path=/; HttpOnly';
const COOKIE_TWO = 'refresh=COOKIE-SECRET-TWO; Path=/; HttpOnly';
const HEADER_SECRET = 'HEADER-SECRET';
const BODY_SECRET = 'UPSTREAM-BODY-SECRET';
const URL_SECRET = 'URL-SECRET';
const UPSTREAM_PATH = '/internal/billing';

/** Every marker that must stay out of what the caller reads, and where it came from. */
const leakMarkers = (upstreamHost: string): Record<string, string> => ({
  upstreamSetCookie: 'COOKIE-SECRET',
  upstreamHeader: HEADER_SECRET,
  upstreamBody: BODY_SECRET,
  requestQuery: URL_SECRET,
  requestHost: upstreamHost,
  requestPath: UPSTREAM_PATH,
});

let upstream: ReturnType<typeof Bun.serve>;
let upstreamHost: string;
let httpClient: HttpClient;
let requestsService: RequestsService;
let serviceClient: ReturnType<typeof createServiceClient>;

@Controller('/items')
class ItemsController {
  @Get('/:id')
  detail(@Param('id') _id: string) {
    return {};
  }
}

@Module({ controllers: [ItemsController] })
class ItemsModule {}

@Controller('/leak')
class LeakController {
  @Get('/req')
  async viaReq() {
    return await httpClient.req('GET', UPSTREAM_PATH, { token: URL_SECRET });
  }

  @Get('/req-errors')
  async viaReqWithErrorConfig() {
    return await httpClient.req('GET', UPSTREAM_PATH, { token: URL_SECRET }, {
      errors: { billing: { error: 'BILLING_UNAVAILABLE', message: 'Billing is unavailable', details: { area: 'billing' } } },
    });
  }

  @Get('/promise')
  async viaPromiseApi() {
    return await httpClient.get(UPSTREAM_PATH, { token: URL_SECRET });
  }

  @Get('/service')
  async viaRequestsService() {
    return await requestsService.get(UPSTREAM_PATH, { token: URL_SECRET });
  }

  @Get('/service-client')
  async viaServiceClient() {
    return await serviceClient.ItemsController.detail('item-1');
  }

  /** The RequestsService Effect API fails with a OneBunBaseError holding the client's details. */
  @Get('/service-effect')
  async viaRequestsServiceEffect() {
    const outcome = await Effect.runPromise(Effect.either(requestsService.getEffect(UPSTREAM_PATH, { token: URL_SECRET })));
    if (Either.isLeft(outcome)) {
      throw outcome.left;
    }

    return outcome.right;
  }

  /** The error a client `ErrorResponse` becomes, as the promise API is to reject with it. */
  @Get('/from-error-response')
  async viaFromErrorResponse() {
    const outcome = await Effect.runPromise(Effect.either(httpClient.getEffect(UPSTREAM_PATH, { token: URL_SECRET })));
    if (Either.isLeft(outcome)) {
      throw OneBunBaseError.fromErrorResponse(outcome.left);
    }

    return outcome.right;
  }

  /** The client's failure returned as data rather than thrown: no filter sees it. */
  @Get('/returned')
  async viaReturnedFailure() {
    const outcome = await Effect.runPromise(Effect.either(httpClient.getEffect(UPSTREAM_PATH, { token: URL_SECRET })));

    return Either.isLeft(outcome) ? outcome.left : outcome.right;
  }
}

@Module({ controllers: [LeakController] })
class LeakModule {}

/** Start an application on a free port, run `body` against it, and stop it. */
async function withApp(
  options: Partial<ApplicationOptions>,
  body: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = new OneBunApplication(LeakModule, {
    ...options,
    port: 0,
    loggerLayer: makeMockLoggerLayer(),
  });
  await app.start();

  try {
    await body(`http://127.0.0.1:${app.getPort()}`);
  } finally {
    await app.stop();
  }
}

/** The markers found in `text`, by where they came from. */
const markersIn = (text: string): string[] =>
  Object.entries(leakMarkers(upstreamHost))
    .filter(([, marker]) => text.includes(marker))
    .map(([source]) => source);

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    fetch() {
      const headers = new Headers({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'X-Upstream-Internal': HEADER_SECRET,
      });
      headers.append('Set-Cookie', COOKIE_ONE);
      headers.append('Set-Cookie', COOKIE_TWO);

      return new Response(JSON.stringify({ message: BODY_SECRET }), { status: 404, headers });
    },
  });
  upstreamHost = `127.0.0.1:${upstream.port}`;
  const baseUrl = `http://${upstreamHost}`;

  httpClient = new HttpClient({ baseUrl, retries: { max: 0 } });
  requestsService = Effect.runSync(
    Effect.provide(RequestsService, makeRequestsService({ baseUrl, retries: { max: 0 } }) as Layer.Layer<RequestsService>),
  );
  serviceClient = createServiceClient(createServiceDefinition(ItemsModule), {
    url: baseUrl,
    retries: { max: 0 },
  });
});

afterAll(() => {
  upstream.stop(true);
});

/**
 * Each client path, with the status and `error` name its escaped error is answered with: the
 * upstream's own 404 wherever the client rejects or fails with the error the failure maps to, which
 * since 0.9 is every path. Up to 0.8 the Promise API rejected with a FiberFailure, answered as an
 * unhandled 500, and req() with a 500 REQUEST_FAILED wrapping one. Only the transport details leave
 * the body.
 */
const CLIENT_PATHS: { path: string; status: number; error: string }[] = [
  { path: 'req', status: 404, error: 'HTTP_ERROR' },
  { path: 'req-errors', status: 500, error: 'BILLING_UNAVAILABLE' },
  { path: 'promise', status: 404, error: 'HTTP_ERROR' },
  { path: 'service', status: 404, error: 'HTTP_ERROR' },
  { path: 'service-client', status: 404, error: 'HTTP_ERROR' },
  { path: 'service-effect', status: 404, error: 'HTTP_ERROR' },
  { path: 'from-error-response', status: 404, error: 'HTTP_ERROR' },
];

describe('an uncaught HTTP-client error answered by the default exception filter', () => {
  test.each(CLIENT_PATHS)('/$path carries no upstream header, body or request URL', async ({ path, status, error }) => {
    await withApp({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/leak/${path}`);
      const text = await response.text();

      expect({ path, leaked: markersIn(text) }).toEqual({ path, leaked: [] });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect({ status: response.status, error: JSON.parse(text).error }).toEqual({ status, error });
    });
  });

  test.each(['req', 'promise', 'service', 'service-client'])(
    'keeps everything else of the error /%s rejects with',
    async (path) => {
      await withApp({}, async (baseUrl) => {
        const body = await (await fetch(`${baseUrl}/leak/${path}`)).json();

        expect(body).toEqual({
          success: false,
          error: 'HTTP_ERROR',
          code: 404,
          details: { duration: expect.any(Number), method: 'GET' },
        });
      });
    },
  );

  test('keeps everything else of the error req() with an errors map throws', async () => {
    await withApp({}, async (baseUrl) => {
      const body = await (await fetch(`${baseUrl}/leak/req-errors`)).json();

      expect(body).toEqual({
        success: false,
        error: 'BILLING_UNAVAILABLE',
        code: 500,
        details: {
          area: 'billing',
          originalError: {
            name: 'NotFoundError',
            error: 'HTTP_ERROR',
            code: 404,
            details: { duration: expect.any(Number), method: 'GET' },
          },
        },
      });
    });
  });

  test('answers a refused connection with 500 and code 0, without the URL the raw error names', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response('') });
    const refusedOrigin = `127.0.0.1:${closed.port}`;
    closed.stop(true);
    const refusing = new HttpClient({ baseUrl: `http://${refusedOrigin}`, retries: { max: 0 } });

    @Controller('/refused')
    class RefusedController {
      @Get('/')
      async viaPromiseApi() {
        return await refusing.get(UPSTREAM_PATH, { token: URL_SECRET });
      }
    }

    @Module({ controllers: [RefusedController] })
    class RefusedModule {}

    const app = new OneBunApplication(RefusedModule, { port: 0, loggerLayer: makeMockLoggerLayer() });
    await app.start();

    try {
      const response = await fetch(`http://127.0.0.1:${app.getPort()}/refused`);
      const text = await response.text();

      // A TransportError: code 0 in the body, and HTTP 500, since 0 is no status
      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({
        success: false,
        error: 'FETCH_ERROR',
        code: 0,
        details: { transport: 'network' },
      });
      expect(text).not.toContain(refusedOrigin);
      expect(text).not.toContain(URL_SECRET);
    } finally {
      await app.stop();
    }
  });

  test('keeps everything else of an error built from a client failure', async () => {
    await withApp({}, async (baseUrl) => {
      const body = await (await fetch(`${baseUrl}/leak/service-effect`)).json();

      expect(body).toEqual({
        success: false,
        error: 'HTTP_ERROR',
        code: 404,
        details: { duration: expect.any(Number), method: 'GET' },
      });
    });
  });
});

describe('the same errors with exposeErrorDetails on', () => {
  test.each(['req', 'service-effect', 'from-error-response'])(
    '/%s sends the transport details, as before',
    async (path) => {
      await withApp({ exposeErrorDetails: true }, async (baseUrl) => {
        const text = await (await fetch(`${baseUrl}/leak/${path}`)).text();

        expect(markersIn(text).sort()).toEqual([
          'requestHost',
          'requestPath',
          'requestQuery',
          'upstreamBody',
          'upstreamHeader',
          'upstreamSetCookie',
        ]);
      });
    },
  );

  test.each(['promise', 'service', 'service-client'])(
    'a rejection of /%s is sent whole, as any client error is',
    async (path) => {
      await withApp({ exposeErrorDetails: true }, async (baseUrl) => {
        const text = await (await fetch(`${baseUrl}/leak/${path}`)).text();

        expect(markersIn(text)).toContain('requestHost');
        expect(markersIn(text)).toContain('upstreamSetCookie');
      });
    },
  );
});

/**
 * The boundary docs/api/requests.md#uncaught-client-errors draws: filters see only what a handler
 * throws. A failure it returns is its result, and the result is sent as the handler returned it.
 */
describe('a client failure a handler returns', () => {
  test('is its result, sent whole: no filter sees it', async () => {
    await withApp({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/leak/returned`);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ success: true, result: { success: false, error: 'HTTP_ERROR', code: 404 } });
      expect(markersIn(text)).toContain('upstreamSetCookie');
      expect(markersIn(text)).toContain('requestQuery');
    });
  });
});

/** An application on a free port of 127.0.0.1, and how to stop it. */
async function startApp(
  module: new () => object,
  options: Partial<ApplicationOptions> = {},
): Promise<{ url: string; stop: () => Promise<void> }> {
  const app = new OneBunApplication(module, {
    loggerLayer: makeMockLoggerLayer(),
    ...options,
    port: 0,
    host: '127.0.0.1',
  });
  await app.start();

  return { url: `http://127.0.0.1:${app.getPort()}`, stop: async () => await app.stop() };
}

/** An origin nothing listens on: a server that was started and stopped. */
function closedOrigin(): string {
  const closed = Bun.serve({ port: 0, fetch: () => new Response('') });
  const origin = `http://127.0.0.1:${closed.port}`;
  closed.stop(true);

  return origin;
}

/**
 * Two hops: a caller A with the HTTP client, a OneBun service B whose handler lets its own client
 * failure escape, and B's upstream C. B's default filter answers HTTP 500 and keeps the failure's
 * `code` in the body: `0` for C's timeout or refused connection. A's client used to read that body
 * as A's own transport failure, a `TransportError`, retried under `retryOnNetworkError` and never
 * under `retryOn`, although A's own request to B had arrived whole.
 */
describe('a client failure relayed across two hops', () => {
  const RELAY_TIMEOUT_MS = 30;
  const SLOW_MS = 200;

  let relayed: { url: string; stop: () => Promise<void> };
  let slowUpstream: ReturnType<typeof Bun.serve>;
  const bHits: Record<string, number> = { refused: 0, slow: 0 };

  beforeAll(async () => {
    slowUpstream = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch() {
        await Bun.sleep(SLOW_MS);

        return new Response('late');
      },
    });
    const refusing = new HttpClient({ baseUrl: closedOrigin(), retries: { max: 0 } });
    const slow = new HttpClient({
      baseUrl: `http://127.0.0.1:${slowUpstream.port}`,
      timeout: RELAY_TIMEOUT_MS,
      retries: { max: 0 },
    });

    @Controller('/b')
    class RelayController {
      @Get('/refused')
      async refused() {
        bHits.refused += 1;

        return await refusing.get('/c');
      }

      @Get('/slow')
      async slow() {
        bHits.slow += 1;

        return await slow.get('/c');
      }
    }

    @Module({ controllers: [RelayController] })
    class RelayModule {}

    relayed = await startApp(RelayModule);
  });

  afterAll(async () => {
    await relayed.stop();
    slowUpstream.stop(true);
  });

  test.each(['refused', 'slow'])('A reads B\'s %s upstream as B\'s 500, and retries it under retryOn', async (path) => {
    bHits[path] = 0;
    const retries: number[] = [];
    const a = new HttpClient({
      baseUrl: relayed.url,
      // The transport flags set against the old reading: only retryOn can replay a 500
      retries: {
        max: 2,
        delay: 1,
        retryOnNetworkError: false,
        retryOnTimeout: false,
        onRetry(_error, attempt) {
          retries.push(attempt);
        },
      },
    });

    const error = await a.get(`/b/${path}`).then(() => null, (rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(InternalServerError);
    expect(error).not.toBeInstanceOf(TransportError);
    expect((error as OneBunBaseError).code).toBe(500);
    expect(getTransportFailureKind(error)).toBeUndefined();
    expect(retries).toEqual([1, 2]);
    expect(bHits[path]).toBe(3);
  });
});

/**
 * A OneBun callee's error, relayed by a caller that lets it escape. The callee wrote its `details`
 * for the caller's code — a database host, a failing statement — not for the caller's own callers.
 */
describe('a OneBun callee\'s error a caller lets escape', () => {
  const CALLEE_DETAILS = { host: 'db.internal:5432', sql: 'select * from users where token = ?' };

  @Controller('/c')
  class CalleeController {
    @Get('/fail')
    fail() {
      throw new InternalServerError('DB_FAILED', CALLEE_DETAILS);
    }

    @Get('/missing')
    missing() {
      throw new NotFoundError('NO_SUCH_ITEM', { id: 'a', shard: 'eu-internal-3' });
    }
  }

  @Module({ controllers: [CalleeController] })
  class CalleeModule {}

  let callee: { url: string; stop: () => Promise<void> };
  let calleeClient: ReturnType<typeof createServiceClient>;

  @Controller('/b')
  class CallerController {
    @Get('/fail')
    async fail() {
      return await calleeClient.CalleeController.fail();
    }

    @Get('/missing')
    async missing() {
      return await calleeClient.CalleeController.missing();
    }
  }

  @Module({ controllers: [CallerController] })
  class CallerModule {}

  beforeAll(async () => {
    callee = await startApp(CalleeModule);
    calleeClient = createServiceClient(createServiceDefinition(CalleeModule), { url: callee.url, retries: { max: 0 } });
  });

  afterAll(async () => {
    await callee.stop();
  });

  test('reaches the caller\'s code whole', async () => {
    const error = await calleeClient.CalleeController.fail().then(() => null, (rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as OneBunBaseError).details).toEqual(CALLEE_DETAILS);
  });

  test('answers the caller\'s own caller with its status and name, and details: {}', async () => {
    const caller = await startApp(CallerModule);

    try {
      const failed = await fetch(`${caller.url}/b/fail`);
      const missing = await fetch(`${caller.url}/b/missing`);
      const failedText = await failed.text();

      expect(failed.status).toBe(500);
      expect(JSON.parse(failedText)).toEqual({
        success: false, error: 'DB_FAILED', code: 500, details: {},
      });
      expect(failedText).not.toContain('db.internal');
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        success: false, error: 'NO_SUCH_ITEM', code: 404, details: {},
      });
    } finally {
      await caller.stop();
    }
  });

  test('sends the callee\'s details with exposeErrorDetails on', async () => {
    const caller = await startApp(CallerModule, { exposeErrorDetails: true });

    try {
      const body = await (await fetch(`${caller.url}/b/fail`)).json();

      expect(body).toMatchObject({ error: 'DB_FAILED', code: 500, details: CALLEE_DETAILS });
    } finally {
      await caller.stop();
    }
  });
});

/**
 * When no exception filter of the application answers, the application logs what nobody in it
 * chose, on the way to the default filter: an unhandled throw, and a failure of the HTTP client a
 * handler let escape. A OneBunBaseError the application throws itself is ordinary control flow and
 * is not logged, and neither is an error one of its filters answered.
 */
describe('logging an escaped error', () => {
  const refusing = new HttpClient({ baseUrl: closedOrigin(), retries: { max: 0 } });

  @Controller('/log')
  class LoggedController {
    @Get('/refused')
    async refused() {
      return await refusing.get('/x');
    }

    @Get('/upstream-404')
    async upstream404() {
      return await httpClient.get(UPSTREAM_PATH);
    }

    @Get('/own')
    own() {
      throw new NotFoundError('NO_SUCH_ORDER', { id: 1 });
    }

    @Get('/plain')
    plain() {
      throw new Error('boom');
    }
  }

  @Module({ controllers: [LoggedController] })
  class LoggedModule {}

  test.each([
    { path: 'refused', status: 500, context: { code: 0, details: { transport: 'network' } } },
    {
      path: 'upstream-404',
      status: 404,
      context: { code: 404, details: { method: 'GET', duration: expect.any(Number) } },
    },
  ])('logs a client failure that escaped /$path at error level, with its code and details', async ({ path, status, context }) => {
    const recorder = makeRecordingLoggerLayer();
    const app = await startApp(LoggedModule, { loggerLayer: recorder.layer });

    try {
      const response = await fetch(`${app.url}/log/${path}`);
      await response.text();

      expect(response.status).toBe(status);
      const logged = recorder.records.filter((record) => record.level === 'error');
      expect(logged).toHaveLength(1);
      expect(logged[0].message).toContain('Unhandled error in LoggedController.');
      expect(logged[0].args[0]).toBeInstanceOf(OneBunBaseError);
      // The logger writes an error's message (its name) and stack. Beside the error go its code and
      // the details the caller's body keeps: which transport failed, or the method and duration
      expect(logged[0].args[1]).toEqual(context);
      // ...and not its transport details: the upstream's URL, headers and body
      const besideTheError = JSON.stringify(logged[0].args.slice(1));
      expect(besideTheError).not.toContain('127.0.0.1');
      expect(markersIn(besideTheError)).toEqual([]);
    } finally {
      await app.stop();
    }
  });

  test('does not log a OneBunBaseError the application threw, and still logs an unhandled throw', async () => {
    const recorder = makeRecordingLoggerLayer();
    const app = await startApp(LoggedModule, { loggerLayer: recorder.layer });

    try {
      await (await fetch(`${app.url}/log/own`)).text();
      expect(recorder.messages('error')).toEqual([]);

      await (await fetch(`${app.url}/log/plain`)).text();
      expect(recorder.messages('error')).toEqual(['Unhandled error in LoggedController.plain:']);
    } finally {
      await app.stop();
    }
  });

  test('does not log a client failure an exception filter of the application answered', async () => {
    const recorder = makeRecordingLoggerLayer();
    const upstreamDown = createExceptionFilter((error) => (
      isHttpClientFailure(error)
        ? Response.json({ success: false, error: 'UPSTREAM_UNAVAILABLE', code: 503 }, { status: 503 })
        : undefined
    ));
    const app = await startApp(LoggedModule, { loggerLayer: recorder.layer, filters: [upstreamDown] });

    try {
      const answered = await fetch(`${app.url}/log/refused`);
      expect(answered.status).toBe(503);
      expect(await answered.json()).toEqual({ success: false, error: 'UPSTREAM_UNAVAILABLE', code: 503 });
      expect(recorder.messages('error')).toEqual([]);

      // The filter declines everything else: an unhandled throw still reaches the log
      await (await fetch(`${app.url}/log/plain`)).text();
      expect(recorder.messages('error')).toEqual(['Unhandled error in LoggedController.plain:']);
    } finally {
      await app.stop();
    }
  });

  test('logs a filter that throws on a client failure, then the client failure with its code and details', async () => {
    const recorder = makeRecordingLoggerLayer();
    const broken = createExceptionFilter(() => {
      throw new Error('filter bug');
    });
    const app = await startApp(LoggedModule, { loggerLayer: recorder.layer, filters: [broken] });

    try {
      const response = await fetch(`${app.url}/log/refused`);
      await response.text();

      // The default filter answers in the broken filter's place: a code outside 400-599 is a 500
      expect(response.status).toBe(500);
      const logged = recorder.records.filter((record) => record.level === 'error');
      expect(logged.map((record) => record.message)).toEqual([
        expect.stringMatching(/^Exception filter .+ threw; falling back to the default filter$/),
        'Unhandled error in LoggedController.refused:',
      ]);
      expect(logged[1].args[0]).toBeInstanceOf(TransportError);
      expect(logged[1].args[1]).toEqual({ code: 0, details: { transport: 'network' } });
      expect(markersIn(JSON.stringify(logged[1].args.slice(1)))).toEqual([]);
    } finally {
      await app.stop();
    }
  });
});

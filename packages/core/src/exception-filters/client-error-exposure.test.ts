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
  HttpClient,
  makeRequestsService,
  OneBunBaseError,
  RequestsService,
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
import { makeMockLoggerLayer } from '../testing/test-utils';

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
 * Each client path, with the status and `error` name its escaped error is answered with. They are
 * what the application answered before transport details were left out, and must stay so: only the
 * transport details leave the body.
 */
const CLIENT_PATHS: { path: string; status: number; error: string }[] = [
  { path: 'req', status: 500, error: 'REQUEST_FAILED' },
  { path: 'req-errors', status: 500, error: 'BILLING_UNAVAILABLE' },
  { path: 'promise', status: 500, error: 'Internal Server Error' },
  { path: 'service', status: 500, error: 'Internal Server Error' },
  { path: 'service-client', status: 500, error: 'Internal Server Error' },
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

  test('keeps everything else of the error req() throws', async () => {
    await withApp({}, async (baseUrl) => {
      const body = await (await fetch(`${baseUrl}/leak/req-errors`)).json();

      expect(body).toEqual({
        success: false,
        error: 'BILLING_UNAVAILABLE',
        code: 500,
        details: {
          area: 'billing',
          originalError: {
            _id: 'FiberFailure',
            cause: {
              _id: 'Cause',
              _tag: 'Fail',
              failure: {
                success: false,
                error: 'HTTP_ERROR',
                code: 404,
                traceId: expect.any(String),
                details: { duration: expect.any(Number), method: 'GET' },
                retryCount: 0,
              },
            },
          },
        },
      });
    });
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

  test('a rejection of the promise API is disclosed as any unhandled error is: its message is the failure', async () => {
    await withApp({ exposeErrorDetails: true }, async (baseUrl) => {
      const text = await (await fetch(`${baseUrl}/leak/promise`)).text();

      expect(markersIn(text)).toContain('requestQuery');
    });
  });
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

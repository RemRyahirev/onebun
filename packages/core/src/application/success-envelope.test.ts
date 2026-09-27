/**
 * One success-envelope rule for both dispatch arms (onebun-FB-32).
 *
 * A route with no decorated parameter and no `@ApiResponse` takes the fast arm; any other route
 * goes through `executeHandler`, including one whose `@ApiResponse` has a description and no
 * schema. The fast arm always wrapped the handler's value into `{ success: true, result }`, while
 * `executeHandler` sent any object with a `success` key as it was. So one `@Query()` changed the
 * bytes on the wire, and a 200 domain object shaped
 * `{ success: false, error, code }` reached every client that reads the envelope as a failed
 * request — the service client rejected it as an InternalServerError with code 500.
 *
 * Now every value that is not a `Response` is wrapped, on every arm, and a `Response` is the only
 * thing sent as it is.
 */

import { type as arktype } from 'arktype';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  ApiResponse,
  Controller,
  Get,
  Module,
  Query,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { createServiceClient } from '../service-client/service-client';
import { createServiceDefinition } from '../service-client/service-definition';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

/** A 200 domain value that happens to look like an error envelope. */
const DOMAIN_FAILURE = { success: false, error: 'X', code: 7 };

/** What every route below returns; each test sets it before it calls. */
let returned: unknown;

/**
 * How many arguments the last probing route was called with. The fast arm calls the handler with
 * the request; the full arm passes only decorated positions, so a handler without any gets none.
 */
let receivedArgs = -1;

@Controller('/envelope')
class EnvelopeController extends BaseController {
  /** No decorated parameter, no response schema: the fast arm. */
  @Get('/fast')
  fast(): unknown {
    return returned;
  }

  /** One decorated parameter: the full arm. */
  @Get('/full')
  full(@Query('x') _x?: string): unknown {
    return returned;
  }

  /** A declared response schema and no parameter: also the full arm, through validation. */
  @Get('/schema')
  @ApiResponse(200, { schema: arktype('object'), description: 'any object' })
  withSchema(): unknown {
    return returned;
  }

  /** No parameter, no schema: probes which arm a route with nothing on it takes. */
  @Get('/fast-probe')
  fastProbe(...received: unknown[]): unknown {
    receivedArgs = received.length;

    return returned;
  }

  /** An @ApiResponse with a description and no schema is enough to put a route on the full arm. */
  @Get('/described')
  @ApiResponse(200, { description: 'no schema' })
  described(...received: unknown[]): unknown {
    receivedArgs = received.length;

    return returned;
  }

  /** A Response is the one value sent as the handler built it. */
  @Get('/fast-response')
  fastResponse(): Response {
    return Response.json(DOMAIN_FAILURE);
  }

  @Get('/full-response')
  fullResponse(@Query('x') _x?: string): Response {
    return Response.json(DOMAIN_FAILURE);
  }

  /** `json()` is an alias of `success()`: it wraps its argument like a plain return does. */
  @Get('/helper-json')
  helperJson(@Query('x') _x?: string): Response {
    return this.json(DOMAIN_FAILURE);
  }

  /** `error()` builds the error envelope, with the status the caller picks. */
  @Get('/helper-error')
  helperError(): Response {
    return this.error('X', DOMAIN_FAILURE.code, 200);
  }
}

@Module({ controllers: [EnvelopeController] })
class EnvelopeModule {}

describe('the success envelope', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(EnvelopeModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app.stop();
  });

  const get = async (path: string): Promise<{ status: number; type: string | null; body: string }> => {
    const response = await fetch(`${base}/envelope${path}`);

    return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
  };

  test.each([
    ['a domain object', { id: 'a' }],
    ['a 200 domain object shaped like an error envelope', DOMAIN_FAILURE],
    ['an object shaped like a success envelope', { success: true, result: 'inner', extra: 1 }],
    ['an array of envelope-shaped objects', [DOMAIN_FAILURE]],
    ['a string', 'text'],
    ['zero', 0],
    ['null', null],
  ])('sends %s as the same bytes with and without a decorated parameter', async (_label, value) => {
    returned = value;

    const fast = await get('/fast');
    const full = await get('/full?x=1');

    expect(fast).toEqual({ status: 200, type: 'application/json', body: JSON.stringify({ success: true, result: value }) });
    expect(full).toEqual(fast);
  });

  test('sends undefined as an envelope without a result on both arms', async () => {
    returned = undefined;

    const fast = await get('/fast');
    const full = await get('/full');

    expect(fast.body).toBe('{"success":true}');
    expect(full).toEqual(fast);
  });

  test('wraps a value that passed a declared response schema, like the other arms', async () => {
    returned = DOMAIN_FAILURE;

    const withSchema = await get('/schema');

    expect(withSchema.status).toBe(200);
    expect(JSON.parse(withSchema.body)).toEqual({ success: true, result: DOMAIN_FAILURE });
    expect(withSchema.body).toBe((await get('/fast')).body);
  });

  test('wraps on a route whose @ApiResponse has only a description, which takes the full arm', async () => {
    returned = DOMAIN_FAILURE;

    // The probe tells the arms apart: the fast arm hands the handler the request
    receivedArgs = -1;
    const fast = await get('/fast-probe');
    expect(receivedArgs).toBe(1);

    // No schema, yet the full arm, which through 0.8.x sent DOMAIN_FAILURE raw
    receivedArgs = -1;
    const described = await get('/described');
    expect(receivedArgs).toBe(0);

    expect(described).toEqual({ status: 200, type: 'application/json', body: JSON.stringify({ success: true, result: DOMAIN_FAILURE }) });
    expect(described).toEqual(fast);
  });

  test('sends a returned Response as it is, on both arms', async () => {
    const fast = await get('/fast-response');
    const full = await get('/full-response?x=1');

    expect(fast.status).toBe(200);
    expect(fast.body).toBe(JSON.stringify(DOMAIN_FAILURE));
    expect(full).toEqual(fast);
  });

  test('wraps the argument of this.json(), which is a Response that already holds the envelope', async () => {
    const helper = await get('/helper-json');

    expect(helper.body).toBe(JSON.stringify({ success: true, result: DOMAIN_FAILURE }));
  });

  test('sends the error envelope from this.error() as it is', async () => {
    const helper = await get('/helper-error');

    expect(helper.status).toBe(200);
    expect(JSON.parse(helper.body)).toEqual({ ...DOMAIN_FAILURE, details: {} });
  });

  test('lets the service client resolve a 200 domain object shaped like an error on both arms', async () => {
    returned = DOMAIN_FAILURE;
    const client = createServiceClient(createServiceDefinition(EnvelopeModule), {
      url: base,
      retries: { max: 0, delay: 0 },
    });

    // The full arm used to send DOMAIN_FAILURE raw, and the client rejected it as a 500. It is
    // the handler's value, so the call resolves with it, on either arm.
    for (const method of ['fast', 'full'] as const) {
      expect(await client.EnvelopeController[method]()).toEqual(DOMAIN_FAILURE);
    }
  });
});

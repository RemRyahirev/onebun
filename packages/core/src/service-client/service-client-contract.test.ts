/**
 * What a service-client call resolves and rejects with, against a real OneBun service
 * (onebun-FB-32, WI-400).
 *
 * Up to 0.8 a call resolved the HTTP client's envelope around the server's own,
 * `{ success, result: { success, result }, statusCode, retryCount }`, and a failure rejected with
 * Effect's FiberFailure, whose ErrorResponse only `Runtime`/`Cause` from `effect` could reach. A
 * status without a class of its own (a 418) came out as a 500. This file imports nothing from
 * `effect`: an application needs nothing from it to read a failure.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import type { ControllerClient } from '@onebun/core';
import {
  BaseController,
  Body,
  ConflictError,
  Controller,
  createHttpClient,
  createServiceClient,
  createServiceDefinition,
  Delete,
  Get,
  getTransportFailureKind,
  HttpStatusError,
  InternalServerError,
  Module,
  NotFoundError,
  OneBunApplication,
  OneBunBaseError,
  Param,
  Post,
  TRANSPORT_FAILURE_CODE,
  TransportError,
  UnauthorizedError,
} from '@onebun/core';

import { makeMockLoggerLayer } from '../testing/test-utils';

/** How long the client waits before it gives up on a handler that is still running. */
const CLIENT_TIMEOUT_MS = 100;

/** A value a handler returns that looks like an error envelope: data, not a failure. */
const DOMAIN_FAILURE = { success: false, error: 'X', code: 7 };

let slowHits = 0;
let releaseSlow: () => void = () => undefined;
let slowGate: Promise<void> = Promise.resolve();

/** Hold every slow handler until the test lets it go. */
function closeSlowGate(): void {
  slowHits = 0;
  slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
}

@Controller('/items')
class ItemsController extends BaseController {
  @Get('/:id')
  detail(@Param('id') id: string) {
    return { id, revision: 1 };
  }

  @Post('/:id/revise')
  revise(@Param('id') _id: string, @Body() body: { revision: number }) {
    throw new ConflictError('REVISION_CONFLICT', { expected: body.revision, actual: 2 });
  }

  @Get('/:id/secret')
  secret(@Param('id') _id: string) {
    throw new UnauthorizedError('TOKEN_EXPIRED', { realm: 'items' });
  }

  @Get('/:id/missing')
  missing(@Param('id') id: string) {
    throw new NotFoundError('NO_SUCH_ITEM', { id });
  }

  @Get('/:id/teapot')
  teapot(@Param('id') _id: string) {
    throw new HttpStatusError(418, 'I_AM_A_TEAPOT', { brew: 'tea' });
  }

  @Get('/:id/raw-teapot')
  rawTeapot(@Param('id') _id: string) {
    return new Response('short and stout', { status: 418 });
  }

  @Get('/:id/domain-failure')
  domainFailure(@Param('id') _id: string) {
    return DOMAIN_FAILURE;
  }

  @Post('/:id/created')
  created(@Param('id') id: string) {
    return this.success({ id, created: true }, 201);
  }

  @Get('/:id/custom')
  custom(@Param('id') id: string) {
    return Response.json({ id, shape: 'mine' });
  }

  @Delete('/:id')
  remove(@Param('id') _id: string): void {
    // Nothing to return: the server sends `{ "success": true }`
  }

  @Post('/:id/slow')
  async slowPost(@Param('id') id: string) {
    slowHits += 1;
    await slowGate;

    return { id };
  }

  @Get('/:id/slow')
  async slowGet(@Param('id') id: string) {
    slowHits += 1;
    await slowGate;

    return { id };
  }
}

@Module({ controllers: [ItemsController] })
class ItemsModule {}

const definition = createServiceDefinition(ItemsModule);

let app: OneBunApplication;
let url: string;

beforeAll(async () => {
  app = new OneBunApplication(ItemsModule, {
    port: 0,
    host: '127.0.0.1',
    loggerLayer: makeMockLoggerLayer(),
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
  });
  await app.start();
  url = `http://127.0.0.1:${app.getPort()}`;
});

afterAll(async () => {
  releaseSlow();
  await app.stop();
});

/** The rejection of `call`, or a failed expectation when it resolves. */
async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  const outcome = await call.then(
    (value: unknown) => ({ resolved: value }),
    (error: unknown) => ({ rejected: error }),
  );

  expect(outcome).toHaveProperty('rejected');

  return 'rejected' in outcome ? outcome.rejected : undefined;
}

describe('what a call resolves with', () => {
  test('the value the handler returned, not an envelope around it', async () => {
    const client = createServiceClient(definition, { url });

    expect(await client.ItemsController.detail('a')).toEqual({ id: 'a', revision: 1 });
  });

  test('a returned value shaped like an error is data, and resolves', async () => {
    const client = createServiceClient(definition, { url });

    expect(await client.ItemsController.domainFailure('a')).toEqual(DOMAIN_FAILURE);
  });

  test('the result of this.success(value, 201), and a Response body of the handler\'s own as it is', async () => {
    const client = createServiceClient(definition, { url });

    expect(await client.ItemsController.created('a')).toEqual({ id: 'a', created: true });
    expect(await client.ItemsController.custom('a')).toEqual({ id: 'a', shape: 'mine' });
  });

  test('undefined for a handler that returns nothing', async () => {
    const client = createServiceClient(definition, { url });

    expect(await client.ItemsController.remove('a')).toBeUndefined();
  });

  test('is typed unknown, not any', () => {
    // Checked by `bun run typecheck`, which compiles this file: with `any`, the `IsAny` line
    // would need `true`, and a stale `.result.result` read would compile.
    type IsAny<T> = 0 extends 1 & T ? true : false;
    type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;
    type Result = Awaited<ReturnType<ControllerClient[string]>>;
    type Generated = Awaited<ReturnType<ReturnType<typeof createServiceClient>[string][string]>>;

    const resultIsAny: IsAny<Result> = false;
    const resultIsUnknown: IsUnknown<Result> = true;
    const generatedIsUnknown: IsUnknown<Generated> = true;

    expect([resultIsAny, resultIsUnknown, generatedIsUnknown]).toEqual([false, true, true]);
  });
});

describe('what a call rejects with', () => {
  test('a ConflictError the handler threw arrives as a ConflictError, with its code, error and details', async () => {
    const client = createServiceClient(definition, { url, retries: { max: 0 } });

    const error = await rejectionOf(client.ItemsController.revise('a', { revision: 1 }));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toBeInstanceOf(OneBunBaseError);
    if (error instanceof ConflictError) {
      expect(error.code).toBe(409);
      expect(error.error).toBe('REVISION_CONFLICT');
      expect(error.details).toEqual({ expected: 1, actual: 2 });
    }
  });

  test('an UnauthorizedError arrives as an UnauthorizedError with 401', async () => {
    const client = createServiceClient(definition, { url, retries: { max: 0 } });

    const error = await rejectionOf(client.ItemsController.secret('a'));

    expect(error).toBeInstanceOf(UnauthorizedError);
    if (error instanceof UnauthorizedError) {
      expect(error.code).toBe(401);
      expect(error.error).toBe('TOKEN_EXPIRED');
      expect(error.details).toEqual({ realm: 'items' });
    }
  });

  test('a NotFoundError arrives as a NotFoundError with 404', async () => {
    const client = createServiceClient(definition, { url, retries: { max: 0 } });

    const error = await rejectionOf(client.ItemsController.missing('a'));

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ code: 404, error: 'NO_SUCH_ITEM', details: { id: 'a' } });
  });

  test('a 418 keeps its code through the service client and through createHttpClient().get()', async () => {
    const client = createServiceClient(definition, { url, retries: { max: 0 } });
    const http = createHttpClient({ baseUrl: url, retries: { max: 0 } });

    const viaServiceClient = await rejectionOf(client.ItemsController.teapot('a'));
    const viaGet = await rejectionOf(http.get('/items/a/teapot'));
    const rawViaServiceClient = await rejectionOf(client.ItemsController.rawTeapot('a'));
    const rawViaGet = await rejectionOf(http.get('/items/a/raw-teapot'));

    for (const error of [viaServiceClient, viaGet, rawViaServiceClient, rawViaGet]) {
      expect(error).toBeInstanceOf(HttpStatusError);
      expect(error).not.toBeInstanceOf(InternalServerError);
      expect((error as HttpStatusError).code).toBe(418);
    }
    expect(viaServiceClient).toMatchObject({ error: 'I_AM_A_TEAPOT', details: { brew: 'tea' } });
    expect(viaGet).toMatchObject({ error: 'I_AM_A_TEAPOT', details: { brew: 'tea' } });
    // Not a OneBun error body: the client's own HTTP_ERROR, with the status kept
    expect(rawViaGet).toMatchObject({ error: 'HTTP_ERROR' });
  });

  test('a client-side timeout rejects with the transport class, not a status class', async () => {
    closeSlowGate();
    const client = createServiceClient(definition, { url, timeout: CLIENT_TIMEOUT_MS, retries: { max: 0 } });

    try {
      const error = await rejectionOf(client.ItemsController.slowGet('a'));

      expect(error).toBeInstanceOf(TransportError);
      expect(error).not.toBeInstanceOf(HttpStatusError);
      expect(error).not.toBeInstanceOf(InternalServerError);
      expect(error).toMatchObject({ error: 'TIMEOUT_ERROR', code: TRANSPORT_FAILURE_CODE });
      expect(getTransportFailureKind(error)).toBe('timeout');
    } finally {
      releaseSlow();
    }
  });
});

describe('a POST whose handler outlives the client timeout', () => {
  test.each([
    ['retries { max: 0 }', { retries: { max: 0 } }],
    ['no retry configuration', {}],
  ])('reaches the server exactly once with %s', async (_label, options) => {
    closeSlowGate();
    const client = createServiceClient(definition, { url, timeout: CLIENT_TIMEOUT_MS, ...options });

    try {
      // The client retries, when it does, before the call settles: the count at the rejection is
      // every request that was sent
      const error = await rejectionOf(client.ItemsController.slowPost('a'));

      expect(error).toBeInstanceOf(TransportError);
      expect(slowHits).toBe(1);
    } finally {
      releaseSlow();
    }
  });
});

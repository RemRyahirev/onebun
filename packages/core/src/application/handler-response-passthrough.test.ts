/**
 * What the framework does with a `Response` the handler built.
 *
 * A route with no decorated parameters took the fast arm and its Response was sent verbatim. One
 * `@Param`, `@Body`, `@Query` or even `@Req` moved it to the full arm, which cloned the response,
 * read it to text, `JSON.parse`d it and rebuilt it from `JSON.stringify` — so a 64-bit id sent as
 * a JSON number arrived rounded, and a streaming body reached the client only once its producer
 * had finished. One decorated parameter was the whole difference.
 */

import { type as arktype } from 'arktype';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import type { SyncLogger } from '@onebun/logger';


import {
  ApiResponse,
  Controller,
  Get,
  Module,
  Param,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { createMockSyncLogger, makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const FIRST_CHUNK_DEADLINE_MS = 250;
const PRODUCER_TAIL_MS = 400;
const BIG_ID_BODY = '{"big":12345678901234567890}';

@Controller('/passthrough')
class PassthroughController extends BaseController {
  /** One decorated parameter is enough to leave the fast arm. */
  @Get('/precision/:id')
  precision(@Param('id') _id: string): Response {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return new Response(BIG_ID_BODY, { headers: { 'content-type': 'application/json' } });
  }

  @Get('/stream/:id')
  stream(@Param('id') _id: string): Response {
    // The tail is cancelled with the stream. A timer that outlives the request throws
    // "Controller is already closed" into whichever test is running when it fires — the client
    // here reads the first chunk and cancels, which is the whole point of the case.
    let tail: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"first":true}\n'));
        tail = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('{"last":true}\n'));
          controller.close();
        }, PRODUCER_TAIL_MS);
      },
      cancel() {
        clearTimeout(tail);
      },
    });

    // eslint-disable-next-line @typescript-eslint/naming-convention
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  }

  @Get('/schema/:id')
  @ApiResponse(200, { schema: arktype({ declared: 'string' }), description: 'declared shape' })
  schema(@Param('id') _id: string): Response {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return new Response('{"undeclared":"kept"}', { headers: { 'content-type': 'application/json' } });
  }
}

@Module({ controllers: [PassthroughController] })
class PassthroughModule {}

describe('a handler-built Response reaches the client as it was built', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;
  const warnings: string[] = [];

  beforeAll(async () => {
    app = new OneBunApplication(PassthroughModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });

    const capturing: SyncLogger = {
      ...createMockSyncLogger(),
      warn(message: string) {
        warnings.push(message);
      },
      child: () => capturing,
    };
    (app as unknown as { logger: SyncLogger }).logger = capturing;

    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app.stop();
  });

  test('should send the exact bytes, without a JSON round trip', async () => {
    const response = await fetch(`${base}/passthrough/precision/1`);

    // Round-tripped through JSON.parse this read 12345678901234567000: a different id, silently.
    expect(await response.text()).toBe(BIG_ID_BODY);
  });

  test('should let the client read the first chunk before the producer finishes', async () => {
    const started = Date.now();
    const response = await fetch(`${base}/passthrough/stream/1`);
    const reader = response.body!.getReader();
    const first = await reader.read();
    const elapsed = Date.now() - started;

    await reader.cancel();

    expect(new TextDecoder().decode(first.value)).toContain('first');
    // Buffered, this arrived only when the producer closed the stream at ~400 ms.
    expect(elapsed).toBeLessThan(FIRST_CHUNK_DEADLINE_MS);
  });

  test('should say once that a declared response schema does not validate a Response', async () => {
    const before = warnings.filter((line) => line.includes('schema')).length;

    const first = await fetch(`${base}/passthrough/schema/1`);
    await fetch(`${base}/passthrough/schema/2`);

    // The handler's body is sent as written, undeclared field included.
    expect(await first.text()).toBe('{"undeclared":"kept"}');

    const after = warnings.filter((line) => line.includes('@ApiResponse'));

    // Once per route, not once per request.
    expect(after.length).toBe(before + 1);
    expect(after[0]).toContain('PassthroughController.schema');
  });
});

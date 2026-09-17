/**
 * `ApplicationOptions.maxRequestBodySize` against a real server.
 *
 * The property is transport-level and pre-routing, so nothing above the socket can show it:
 * the request that proves the limit never reaches a handler, a middleware, or even the router.
 * These cases speak HTTP over a raw TCP connection because `fetch` will not send a
 * `content-length` that disagrees with the body it has.
 *
 * @source docs:api/core.md#max-request-body-size
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import type { OneBunRequest, OneBunResponse } from '../types';

import {
  Controller,
  Module,
  Post,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseMiddleware } from '../module/middleware';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

/** Records that nothing above the transport ran for a refused request. */
const reached = {
  handler: 0,
  middleware: 0,
};

class CountingMiddleware extends BaseMiddleware {
  async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    reached.middleware += 1;

    return await next();
  }
}

@Controller('/api')
class UploadController extends BaseController {
  @Post('/upload')
  async upload() {
    reached.handler += 1;

    return { ok: true };
  }
}

@Module({ controllers: [UploadController] })
class UploadModule {}

/**
 * Speaks one HTTP request over a raw socket and returns the status line.
 *
 * `fetch` cannot send this: a `content-length` larger than the body it holds is exactly what the
 * server is being asked to refuse, and no compliant client will write it.
 */
async function rawRequest(port: number, contentLength: number, body = ''): Promise<string> {
  const chunks: string[] = [];
  let settle: (value: string) => void;
  const answered = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_socket, data) {
        chunks.push(new TextDecoder().decode(data));
        settle(chunks.join(''));
      },
      open(openedSocket) {
        openedSocket.write(
          'POST /api/upload HTTP/1.1\r\n'
          + `Host: 127.0.0.1:${port}\r\n`
          + 'Content-Type: application/json\r\n'
          + `Content-Length: ${contentLength}\r\n`
          + `Connection: close\r\n\r\n${body}`,
        );
      },
      error() {
        settle(chunks.join(''));
      },
      close() {
        settle(chunks.join(''));
      },
    },
  });

  // A request the server intends to answer only after reading a body it will never receive
  // simply waits — the timeout is the observation, not a flake.
  const answer = await Promise.race([
    answered,
    Bun.sleep(1_500).then(() => 'TIMEOUT'),
  ]);
  socket.end();

  return answer.split('\r\n')[0] ?? '';
}

function createApp(options: Record<string, unknown> = {}): OneBunApplication {
  return new OneBunApplication(UploadModule, {
    port: 0,
    metrics: { enabled: false },
    docs: { enabled: false },
    gracefulShutdown: false,
    middleware: [CountingMiddleware],
    ...options,
    loggerLayer: makeMockLoggerLayer(),
  });
}

describe('ApplicationOptions.maxRequestBodySize', () => {
  let app: OneBunApplication | null = null;

  afterEach(async () => {
    if (app) {
      await app.stop();
      app = null;
    }
    reached.handler = 0;
    reached.middleware = 0;
  });

  it('refuses a body larger than the configured limit, before routing or middleware', async () => {
    app = createApp({ maxRequestBodySize: 1024 });
    await app.start();

    const status = await rawRequest(app.getPort(), 10_000);

    expect(status).toContain('413');
    // The point of a transport-level bound: nothing of ours ran, and no body was read.
    expect(reached.handler).toBe(0);
    expect(reached.middleware).toBe(0);
  });

  it('still serves a request inside the limit', async () => {
    app = createApp({ maxRequestBodySize: 1024 });
    await app.start();

    const response = await fetch(`http://127.0.0.1:${app.getPort()}/api/upload`, {
      method: 'POST',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'small enough' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, result: { ok: true } });
    expect(reached.handler).toBe(1);
  });

  it('leaves Bun\'s 128 MiB default in place when the option is absent', async () => {
    app = createApp();
    await app.start();

    // The same declared length the configured server refused with 413. Unset means Bun's
    // 128 MiB default, so the request is accepted and routed like any other — this handler
    // never reads the body, so it answers without waiting for one.
    const status = await rawRequest(app.getPort(), 10_000);

    expect(status).toContain('200');
    expect(reached.handler).toBe(1);
  });

  it('gives each service in multi-service mode its own limit', async () => {
    // The reporter's case is exactly this split — a public intake and an internal worker —
    // and in multi-service mode they are two listeners in one process.
    const multi = new OneBunApplication({
      services: {
        intake: { module: UploadModule, port: 0, maxRequestBodySize: 1024 },
        worker: { module: UploadModule, port: 0 },
      },
      maxRequestBodySize: 8192,
      metrics: { enabled: false },
    });

    try {
      await multi.start();

      const intakePort = multi.getApplication('intake')!.getPort();
      const workerPort = multi.getApplication('worker')!.getPort();
      // Between the two limits: over the intake's 1024, under the app-level 8192 the worker
      // inherits. One request shape, two answers.
      const onIntake = await rawRequest(intakePort, 2_000);
      const onWorker = await rawRequest(workerPort, 2_000);

      expect(onIntake).toContain('413');
      expect(onWorker).toContain('200');
    } finally {
      await multi.stop();
    }
  });

  it('refuses ahead of routing, so an unknown path is bounded too', async () => {
    app = createApp({ maxRequestBodySize: 1024 });
    await app.start();

    const chunks: string[] = [];
    let settle: (value: string) => void;
    const answered = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const port = app.getPort();
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data(_socket, data) {
          chunks.push(new TextDecoder().decode(data));
          settle(chunks.join(''));
        },
        open(openedSocket) {
          openedSocket.write(
            'POST /nothing-declares-this HTTP/1.1\r\n'
            + `Host: 127.0.0.1:${port}\r\n`
            + 'Content-Length: 10000\r\n'
            + 'Connection: close\r\n\r\n',
          );
        },
        error() {
          settle(chunks.join(''));
        },
        close() {
          settle(chunks.join(''));
        },
      },
    });
    const answer = await Promise.race([answered, Bun.sleep(1_500).then(() => 'TIMEOUT')]);
    socket.end();

    // Not a 404: the limit is enforced before anything looks at the path.
    expect(answer.split('\r\n')[0]).toContain('413');
  });
});

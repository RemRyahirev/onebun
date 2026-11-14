/**
 * A `@UseGuards` list on a base method guards a handler that overrides it — on an HTTP route, every
 * WebSocket gateway handler type and a queue consumer alike.
 *
 * One class carries all three transports on ONE overriding method, so a transport that resolves
 * its method guards differently from the other two shows up as the one that lets the call
 * through. Gateway and route metadata are process-wide maps keyed by class, so every test builds
 * its own classes.
 */

import {
  describe,
  it,
  expect,
  afterEach,
} from 'bun:test';

import type { Guard } from './http-guards';
import type { QueueService } from '../queue/queue.service';
import type { ExecutionContext } from '../types';

import { OneBunApplication } from '../application/application';
import {
  Get,
  Module,
  UseGuards,
} from '../decorators/decorators';
import { clearGlobalServicesRegistry } from '../module/module';
import { Subscribe } from '../queue/decorators';
import { makeMockLoggerLayer } from '../testing/test-utils';
import { BaseWebSocketGateway } from '../websocket/ws-base-gateway';
import {
  OnConnect,
  OnDisconnect,
  OnMessage,
  WebSocketGateway,
} from '../websocket/ws-decorators';

const HOST = '127.0.0.1';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const WAIT_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 5;

/** `<guard>:<transport>` for every `canActivate` call, in the order they ran. */
const guardCalls: string[] = [];
/** One entry per handler invocation that got past the guards. */
const handlerRuns: string[] = [];

function recordingGuard(name: string, verdict: boolean): new () => Guard {
  return class RecordingGuard implements Guard {
    canActivate(ctx: ExecutionContext): boolean {
      guardCalls.push(`${name}:${ctx.type}`);

      return verdict;
    }
  };
}

async function waitUntil<T>(probe: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

interface Outcome {
  httpStatus: number;
  wsFrame: { event: string; data: { code?: string } };
}

const running: OneBunApplication[] = [];

/**
 * Boot the module, then call the one handler once over each transport: `GET /h`, a WebSocket
 * `h` event and a queue message on `h`.
 */
async function callOnEveryTransport(moduleClass: new () => object): Promise<Outcome> {
  const app = new OneBunApplication(moduleClass, {
    port: 0,
    host: HOST,
    loggerLayer: makeMockLoggerLayer(),
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
    websocket: {},
    queue: { enabled: true, adapter: 'memory' },
  });
  running.push(app);
  await app.start();

  const response = await fetch(`http://${HOST}:${app.getPort()}/h`);
  const httpStatus = response.status;
  await response.body?.cancel();

  const frames: Outcome['wsFrame'][] = [];
  const socket = new WebSocket(`ws://${HOST}:${app.getPort()}/ws`);
  socket.addEventListener('message', (message) => {
    frames.push(JSON.parse(String(message.data)) as Outcome['wsFrame']);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('WebSocket upgrade failed')));
  });
  socket.send(JSON.stringify({ event: 'h', data: {}, ack: 1 }));
  const wsFrame = await waitUntil(
    () => frames.find((frame) => (frame as { ack?: number }).ack === 1),
    'the reply to ack 1',
  );
  socket.close();

  const queueCallsBefore = guardCalls.filter((call) => call.endsWith(':queue')).length;
  const queueRunsBefore = handlerRuns.length;
  await (app.getQueueService() as QueueService).publish('h', {});
  // The message is settled once a guard has decided on it or the handler has run.
  await waitUntil(
    () => (guardCalls.filter((call) => call.endsWith(':queue')).length > queueCallsBefore
      || handlerRuns.length > queueRunsBefore
      ? true
      : undefined),
    'the queue delivery',
  );
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

  return { httpStatus, wsFrame };
}

describe('a guard on a base method guards an overriding handler on every transport', () => {
  afterEach(async () => {
    for (const app of running.splice(0)) {
      await app.stop();
    }
    clearGlobalServicesRegistry();
    guardCalls.length = 0;
    handlerRuns.length = 0;
  });

  it('refuses on HTTP, WebSocket and the queue when only the base method carries a denying guard', async () => {
    const denyGuard = recordingGuard('deny', false);

    class BaseHandlers extends BaseWebSocketGateway {
      @UseGuards(denyGuard)
      handle(): unknown {
        handlerRuns.push('base');

        return { event: 'h:ok', data: {} };
      }
    }

    @WebSocketGateway({ path: '/ws' })
    class Exposed extends BaseHandlers {
      @Get('/h')
      @OnMessage('h')
      @Subscribe('h')
      override handle(): unknown {
        handlerRuns.push('override');

        return { event: 'h:ok', data: {} };
      }
    }

    @Module({ controllers: [Exposed] })
    class ExposedModule {}

    const { httpStatus, wsFrame } = await callOnEveryTransport(ExposedModule);

    expect(httpStatus).toBe(HTTP_FORBIDDEN);
    expect(wsFrame.event).toBe('error');
    expect(wsFrame.data.code).toBe('FORBIDDEN');
    expect(guardCalls).toEqual(['deny:http', 'deny:ws', 'deny:queue']);
    expect(handlerRuns).toEqual([]);
  });

  it('runs the base method guard before the override guard, and refuses when the override denies', async () => {
    const allowGuard = recordingGuard('base-allow', true);
    const denyGuard = recordingGuard('own-deny', false);

    class BaseHandlers extends BaseWebSocketGateway {
      @UseGuards(allowGuard)
      handle(): unknown {
        handlerRuns.push('base');

        return { event: 'h:ok', data: {} };
      }
    }

    @WebSocketGateway({ path: '/ws' })
    class Exposed extends BaseHandlers {
      @Get('/h')
      @OnMessage('h')
      @Subscribe('h')
      @UseGuards(denyGuard)
      override handle(): unknown {
        handlerRuns.push('override');

        return { event: 'h:ok', data: {} };
      }
    }

    @Module({ controllers: [Exposed] })
    class ExposedModule {}

    const { httpStatus, wsFrame } = await callOnEveryTransport(ExposedModule);

    expect(httpStatus).toBe(HTTP_FORBIDDEN);
    expect(wsFrame.data.code).toBe('FORBIDDEN');
    expect(guardCalls).toEqual([
      'base-allow:http', 'own-deny:http',
      'base-allow:ws', 'own-deny:ws',
      'base-allow:queue', 'own-deny:queue',
    ]);
    expect(handlerRuns).toEqual([]);
  });

  it('runs a guard named on both the base method and the override once per call', async () => {
    const sameGuard = recordingGuard('same', true);

    class BaseHandlers extends BaseWebSocketGateway {
      @UseGuards(sameGuard)
      handle(): unknown {
        handlerRuns.push('base');

        return { event: 'h:ok', data: {} };
      }
    }

    @WebSocketGateway({ path: '/ws' })
    class Exposed extends BaseHandlers {
      @Get('/h')
      @OnMessage('h')
      @Subscribe('h')
      @UseGuards(sameGuard)
      override handle(): unknown {
        handlerRuns.push('override');

        return { event: 'h:ok', data: {} };
      }
    }

    @Module({ controllers: [Exposed] })
    class ExposedModule {}

    const { httpStatus, wsFrame } = await callOnEveryTransport(ExposedModule);

    expect(httpStatus).toBe(HTTP_OK);
    expect(wsFrame.event).toBe('h:ok');
    expect(guardCalls).toEqual(['same:http', 'same:ws', 'same:queue']);
    expect(handlerRuns).toEqual(['override', 'override', 'override']);
  });

  it('orders class guards, then base method guards, then override guards on every transport', async () => {
    const classGuard = recordingGuard('class', true);
    const baseGuard = recordingGuard('base', true);
    const ownGuard = recordingGuard('own', true);

    class BaseHandlers extends BaseWebSocketGateway {
      @UseGuards(baseGuard)
      handle(): unknown {
        handlerRuns.push('base');

        return { event: 'h:ok', data: {} };
      }
    }

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(classGuard)
    class Exposed extends BaseHandlers {
      @Get('/h')
      @OnMessage('h')
      @Subscribe('h')
      @UseGuards(ownGuard)
      override handle(): unknown {
        handlerRuns.push('override');

        return { event: 'h:ok', data: {} };
      }
    }

    @Module({ controllers: [Exposed] })
    class ExposedModule {}

    const { httpStatus, wsFrame } = await callOnEveryTransport(ExposedModule);

    expect(httpStatus).toBe(HTTP_OK);
    expect(wsFrame.event).toBe('h:ok');
    expect(guardCalls).toEqual([
      'class:http', 'base:http', 'own:http',
      'class:ws', 'base:ws', 'own:ws',
      'class:queue', 'base:queue', 'own:queue',
    ]);
    expect(handlerRuns).toEqual(['override', 'override', 'override']);
  });

  it('skips an overriding @OnConnect and @OnDisconnect without an error frame when the base denies', async () => {
    const connectDeny = recordingGuard('connect-deny', false);
    const disconnectDeny = recordingGuard('disconnect-deny', false);

    class LifecycleBase extends BaseWebSocketGateway {
      @UseGuards(connectDeny)
      greet(): unknown {
        handlerRuns.push('base-greet');

        return { event: 'welcome', data: {} };
      }

      @UseGuards(disconnectDeny)
      cleanup(): void {
        handlerRuns.push('base-cleanup');
      }
    }

    @WebSocketGateway({ path: '/ws' })
    class Lifecycle extends LifecycleBase {
      @OnConnect()
      override greet(): unknown {
        handlerRuns.push('greet');

        return { event: 'welcome', data: {} };
      }

      @OnDisconnect()
      override cleanup(): void {
        handlerRuns.push('cleanup');
      }

      @OnMessage('ping')
      ping(): unknown {
        return { event: 'pong', data: {} };
      }
    }

    @Module({ controllers: [Lifecycle] })
    class LifecycleModule {}

    const app = new OneBunApplication(LifecycleModule, {
      port: 0,
      host: HOST,
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      websocket: {},
    });
    running.push(app);
    await app.start();

    const frames: Array<{ event: string; ack?: number }> = [];
    const socket = new WebSocket(`ws://${HOST}:${app.getPort()}/ws`);
    socket.addEventListener('message', (message) => {
      frames.push(JSON.parse(String(message.data)) as { event: string; ack?: number });
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('WebSocket upgrade failed')));
    });
    await waitUntil(() => (guardCalls.includes('connect-deny:ws') ? true : undefined), 'the connect guard');

    // The denied connect leaves the socket open: an unguarded message still gets its answer.
    socket.send(JSON.stringify({ event: 'ping', data: {}, ack: 1 }));
    await waitUntil(() => frames.find((frame) => frame.ack === 1), 'the reply to ack 1');

    socket.close();
    await waitUntil(() => (guardCalls.includes('disconnect-deny:ws') ? true : undefined), 'the disconnect guard');
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    // No `welcome` and no `error` frame: a lifecycle handler has no message to answer.
    expect(frames).toEqual([{ event: 'pong', data: {}, ack: 1 }]);
    expect(guardCalls).toEqual(['connect-deny:ws', 'disconnect-deny:ws']);
    // Neither the override nor the base body ran, so the cleanup written in @OnDisconnect is skipped.
    expect(handlerRuns).toEqual([]);
  });
});

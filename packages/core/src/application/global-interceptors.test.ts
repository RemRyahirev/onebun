/**
 * `ApplicationOptions.interceptors` across the three transports.
 *
 * The option is named and typed as an application-wide setting, and it was merged only at HTTP
 * route registration: a global logging, metrics or tracing interceptor covered HTTP and silently
 * skipped every WebSocket message and every queue delivery. Nothing warned, and the gap was
 * invisible until a transport went missing from a dashboard.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { ExecutionContext, Interceptor } from '../types';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import {
  isHttpContext,
  isQueueContext,
  isWsContext,
} from '../interceptors/interceptors';
import { Controller as BaseController } from '../module/controller';
import { Subscribe } from '../queue/decorators';
import { makeMockLoggerLayer } from '../testing/test-utils';
import { BaseWebSocketGateway } from '../websocket/ws-base-gateway';
import { OnMessage, WebSocketGateway } from '../websocket/ws-decorators';

import { OneBunApplication } from './application';

const observed: string[] = [];

class GlobalRecordingInterceptor implements Interceptor {
  async intercept(ctx: ExecutionContext, next: () => unknown): Promise<unknown> {
    if (isHttpContext(ctx)) {
      observed.push('http');
    } else if (isWsContext(ctx)) {
      observed.push('ws');
    } else if (isQueueContext(ctx)) {
      observed.push('queue');
    } else {
      observed.push('unknown');
    }

    return await next();
  }
}

@Controller('/global')
class GlobalController extends BaseController {
  @Get('/ping')
  ping(): { ok: boolean } {
    return { ok: true };
  }

  @Subscribe('global.event')
  handleEvent(): void {
    /* the interceptor is the subject, not the handler */
  }
}

@WebSocketGateway({ path: '/global-ws' })
class GlobalGateway extends BaseWebSocketGateway {
  @OnMessage('echo')
  echo(data: unknown): unknown {
    return data;
  }
}

@Module({ controllers: [GlobalController, GlobalGateway] })
class GlobalModule {}

describe('ApplicationOptions.interceptors', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;

  beforeEach(async () => {
    observed.length = 0;
    app = new OneBunApplication(GlobalModule, {
      port: 0,
      host: '127.0.0.1',
      interceptors: [GlobalRecordingInterceptor],
      queue: { enabled: true, adapter: 'memory' },
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });
    await app.start();
  });

  afterEach(async () => {
    await app.stop();
  });

  test('should reach an HTTP route, a queue delivery and a WebSocket message', async () => {
    await fetch(`${app.getHttpUrl()}/global/ping`);

    await app.getQueueService().publish('global.event', { id: 1 });

    const socket = new WebSocket(`${app.getHttpUrl().replace('http', 'ws')}/global-ws`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('the socket never opened')));
    });
    socket.send(JSON.stringify({ event: 'echo', data: { n: 1 } }));

    const deadline = Date.now() + 3000;
    while (observed.length < 3 && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    socket.close();

    // One interceptor, three transports. Before this it was HTTP alone.
    expect(observed.sort()).toEqual(['http', 'queue', 'ws']);
  });
});

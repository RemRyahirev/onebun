/**
 * Which gateway an upgrade lands on, when more than one path could claim it.
 *
 * Resolution was: exact key, then the FIRST gateway in registration order whose path the request
 * merely `startsWith`. Two consequences, both measured:
 *
 *   - `/chat` claimed `/chatterbox`, because the check was a string prefix rather than a path one.
 *   - with `/chat` and `/chat/admin` both declared, `/chat/admin` went to whichever was registered
 *     first — declaration order decided routing.
 *
 * The default path is `/` (`@WebSocketGateway()` with no options), so `/` keeps claiming
 * everything: an application that never declared a path and connects on `/ws` works today, and
 * tightening that would 404 it. What changes is the middle of a segment, which is where the
 * misrouting was.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { WsClientData } from './ws.types';

import { OneBunApplication } from '../application/application';
import { Module } from '../decorators/decorators';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import {
  Client,
  OnConnect,
  WebSocketGateway,
} from './ws-decorators';

const OPEN_TIMEOUT_MS = 2000;
const SETTLE_MS = 120;

/** Which gateway admitted the connection, in order. */
let admitted: string[] = [];

@WebSocketGateway({ path: '/chat' })
class ChatGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() _client: WsClientData): void {
    admitted.push('chat');
  }
}

@WebSocketGateway({ path: '/chat/admin' })
class ChatAdminGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() _client: WsClientData): void {
    admitted.push('chat-admin');
  }
}

@WebSocketGateway()
class RootGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() _client: WsClientData): void {
    admitted.push('root');
  }
}

@Module({ controllers: [ChatGateway] })
class ChatOnlyModule {}

// `/chat` first on purpose: under the old rule registration order decided, so this is the
// arrangement in which the longer, more specific path lost.
@Module({ controllers: [ChatGateway, ChatAdminGateway] })
class NestedPathsModule {}

@Module({ controllers: [ChatGateway, RootGateway] })
class ChatAndRootModule {}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out opening ${url}`)), OPEN_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`refused ${url}`));
    });
  });

  return socket;
}

const settle = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe('upgrade path resolution', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const running: OneBunApplication<any, any>[] = [];
  const sockets: WebSocket[] = [];

  function boot(moduleClass: Function): OneBunApplication {
    const app = new OneBunApplication(moduleClass as new () => object, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });
    running.push(app as never);

    return app;
  }

  const wsUrl = (app: OneBunApplication, path: string): string =>
    `${app.getHttpUrl().replace('http://', 'ws://')}${path}`;

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
    await Promise.all(running.splice(0).map((app) => app.stop().catch(() => undefined)));
    admitted = [];
  });

  test('should refuse a path that only shares a prefix mid-segment', async () => {
    const app = boot(ChatOnlyModule);
    await app.start();

    // `'/chatterbox'.startsWith('/chat')` is true, which is why this used to connect — and be
    // served by a gateway that had nothing to do with it.
    await expect(connect(wsUrl(app, '/chatterbox'))).rejects.toThrow();
    expect(admitted).toEqual([]);
  });

  test('should still serve a path below the gateway\'s own', async () => {
    const app = boot(ChatOnlyModule);
    await app.start();

    const socket = await connect(wsUrl(app, '/chat/room1'));
    sockets.push(socket);
    await settle();

    expect(admitted).toEqual(['chat']);
  });

  test('should pick the most specific gateway, not the first one declared', async () => {
    const app = boot(NestedPathsModule);
    await app.start();

    // Below both gateways, so neither wins on the exact-key lookup and the prefix rule decides.
    const socket = await connect(wsUrl(app, '/chat/admin/audit'));
    sockets.push(socket);
    await settle();

    // Was `['chat']`: `/chat` is registered first and `'/chat/admin/audit'.startsWith('/chat')`,
    // so the loop returned before it ever saw the longer, more specific path.
    expect(admitted).toEqual(['chat-admin']);
  });

  test('should leave the default path as the catch-all it has always been', async () => {
    const app = boot(ChatAndRootModule);
    await app.start();

    const anywhere = await connect(wsUrl(app, '/somewhere/else'));
    const shared = await connect(wsUrl(app, '/chatterbox'));
    sockets.push(anywhere, shared);
    await settle();

    // `@WebSocketGateway()` defaults to `/`, so an application that declares nothing keeps
    // accepting every path — including the one `/chat` used to swallow.
    expect(admitted).toEqual(['root', 'root']);
  });

  test('should still prefer an exact path over the catch-all', async () => {
    const app = boot(ChatAndRootModule);
    await app.start();

    const socket = await connect(wsUrl(app, '/chat'));
    sockets.push(socket);
    await settle();

    expect(admitted).toEqual(['chat']);
  });
});

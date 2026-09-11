/**
 * A Socket.IO client picks its gateway with the namespace it states in the CONNECT packet.
 *
 * Every Socket.IO client arrives on one path, so the URL cannot tell two gateways apart. OneBun
 * added `?namespace=` to the query for that, and the protocol's own discriminator — the `nsp`
 * field of the CONNECT packet — was parsed, echoed back, and never consulted: `io('/admin')` puts
 * nothing in the query, so a client written the normal Socket.IO way was bound to whichever
 * gateway happened to be registered first.
 *
 * It could not be consulted, because `@OnConnect` ran at upgrade and the CONNECT packet arrives
 * after that. So the binding now waits for it: the handshake goes out at upgrade, the gateway is
 * chosen when the client names it, and `@OnConnect` runs on the gateway that was chosen. A client
 * that never sends CONNECT never gets `@OnConnect` — which is the Socket.IO contract, and is why
 * OneBun's own client now sends the packet too.
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
import { createWsClient } from './ws-client';
import {
  Client,
  OnConnect,
  OnMessage,
  WebSocketGateway,
} from './ws-decorators';
import { createWsServiceDefinition } from './ws-service-definition';

const OPEN_TIMEOUT_MS = 2000;
const WAIT_STEP_MS = 10;
const SETTLE_MS = 150;

/** What each gateway saw, in order. */
let seen: string[] = [];

@WebSocketGateway({ path: '/ws', namespace: 'chat' })
class ChatGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() _client: WsClientData): { event: string; data: Record<string, string> } {
    seen.push('chat.connect');

    return { event: 'welcome', data: { from: 'chat' } };
  }

  @OnMessage('who')
  who(): { event: string; data: Record<string, string> } {
    seen.push('chat.who');

    return { event: 'here', data: { from: 'chat' } };
  }
}

@WebSocketGateway({ path: '/ws', namespace: 'admin' })
class AdminGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() _client: WsClientData): { event: string; data: Record<string, string> } {
    seen.push('admin.connect');

    return { event: 'welcome', data: { from: 'admin' } };
  }

  @OnMessage('who')
  who(): { event: string; data: Record<string, string> } {
    seen.push('admin.who');

    return { event: 'here', data: { from: 'admin' } };
  }
}

@WebSocketGateway({
  path: '/ws',
  namespace: 'guarded',
  authenticate: () => false,
})
class GuardedGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(): void {
    seen.push('guarded.connect');
  }
}

@Module({ controllers: [ChatGateway, AdminGateway] })
class TwoNamespaceModule {}

@Module({ controllers: [ChatGateway, GuardedGateway] })
class GuardedModule {}

interface RawSocket {
  socket: WebSocket;
  frames: string[];
  send(frame: string): void;
}

async function openRaw(url: string): Promise<RawSocket> {
  const socket = new WebSocket(url);
  const frames: string[] = [];
  socket.addEventListener('message', (event) => frames.push(String(event.data)));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out opening ${url}`)), OPEN_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`failed to open ${url}`));
    });
  });

  return {
    socket,
    frames,
    send: (frame: string) => socket.send(frame),
  };
}

async function waitFor<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

const settle = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe('socket.io namespace routing', () => {
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
      websocket: { socketio: { enabled: true, path: '/socket.io' } },
    });
    running.push(app as never);

    return app;
  }

  const sioUrl = (app: OneBunApplication, query = ''): string =>
    `${app.getHttpUrl().replace('http://', 'ws://')}/socket.io/?EIO=4&transport=websocket${query}`;

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
    await Promise.all(running.splice(0).map((app) => app.stop().catch(() => undefined)));
    seen = [];
  });

  test('should bind to the namespace the CONNECT packet names', async () => {
    const app = boot(TwoNamespaceModule);
    await app.start();

    const raw = await openRaw(sioUrl(app));
    sockets.push(raw.socket);
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('0')), 'engine.io OPEN');

    // `io('/admin')` states the namespace here and nowhere else — no query, nothing in the URL.
    // This used to bind to ChatGateway, the first one registered, and echo "/admin" back.
    raw.send('40/admin,');
    await settle();

    expect(seen).toEqual(['admin.connect']);
  });

  test('should hold @OnConnect until the client states a namespace', async () => {
    const app = boot(TwoNamespaceModule);
    await app.start();

    const raw = await openRaw(sioUrl(app));
    sockets.push(raw.socket);
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('0')), 'engine.io OPEN');
    await settle();

    // The reply used to be on its way out before the client could say which gateway it wanted,
    // which is exactly why `nsp` could not be the routing signal.
    expect(seen).toEqual([]);
    expect(raw.frames.some((frame) => frame.startsWith('42["welcome"'))).toBe(false);

    raw.send('40/chat,');
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('42["welcome"')), 'welcome');

    expect(seen).toEqual(['chat.connect']);
  });

  test('should route later messages to the gateway the namespace chose', async () => {
    const app = boot(TwoNamespaceModule);
    await app.start();

    const raw = await openRaw(sioUrl(app));
    sockets.push(raw.socket);
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('0')), 'engine.io OPEN');

    raw.send('40/admin,');
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('42["welcome"')), 'welcome');
    raw.send('42["who",{}]');
    await settle();

    expect(seen).toEqual(['admin.connect', 'admin.who']);
  });

  test('should keep the query namespace when the packet names the default one', async () => {
    const app = boot(TwoNamespaceModule);
    await app.start();

    const raw = await openRaw(sioUrl(app, '&namespace=admin'));
    sockets.push(raw.socket);
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('0')), 'engine.io OPEN');

    // A bare `40` is "the default namespace" — it names no gateway, so it does not override
    // the one the query already chose.
    raw.send('40');
    await settle();

    expect(seen).toEqual(['admin.connect']);
  });

  test('should refuse a namespace whose authenticate hook never ran', async () => {
    const app = boot(GuardedModule);
    await app.start();

    const raw = await openRaw(sioUrl(app, '&namespace=chat'));
    sockets.push(raw.socket);
    await waitFor(() => raw.frames.find((frame) => frame.startsWith('0')), 'engine.io OPEN');

    // The upgrade ran ChatGateway's hook (it has none). Switching to a gateway that DOES guard
    // its connections would admit a client its hook never saw, so the switch is refused rather
    // than performed unchecked.
    raw.send('40/guarded,');
    const refusal = await waitFor(
      () => raw.frames.find((frame) => frame.startsWith('44')),
      'socket.io connect_error',
    );

    expect(refusal).toContain('guarded');
    expect(seen).toEqual([]);
  });

  test('should let OneBun\'s own socketio client reach a namespace', async () => {
    const app = boot(TwoNamespaceModule);
    await app.start();

    const client = createWsClient(createWsServiceDefinition(TwoNamespaceModule), {
      url: `${app.getHttpUrl().replace('http://', 'ws://')}/socket.io`,
      protocol: 'socketio',
      namespace: 'admin',
      reconnect: false,
    });

    await client.connect();
    await settle();

    try {
      // The client never sent a CONNECT packet at all, so with the binding moved to that packet
      // it would have hung connected and silent.
      expect(seen).toEqual(['admin.connect']);
    } finally {
      client.disconnect();
    }
  });
});

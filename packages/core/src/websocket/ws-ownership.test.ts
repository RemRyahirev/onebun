/**
 * A connection belongs to the gateway that admitted it.
 *
 * The socket registry was one module-level `Map` shared by every gateway in the process, and
 * `WsHandler` fanned every event out over every registered gateway. Measured: one raw client on
 * `/chat` fired BOTH gateways' `@OnConnect`, could invoke the `/admin` gateway's
 * `@OnMessage('admin:secret')`, and received `AdminGateway.broadcast()` in its own inbox:
 *
 *   handlers fired on connect: ["ChatGateway.onConnect(22bf)","AdminGateway.onConnect(22bf)"]
 *   /chat client inbox: ["{\"event\":\"admin:secret-leak\",\"data\":{\"salary\":999}}", ...]
 *
 * Across applications the leak was write-only — each application has its own `WsHandler`, so
 * dispatch did not cross, but one process-wide socket map meant a broadcast did.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { WsClientData } from './ws.types';
import type { ServerWebSocket } from 'bun';

import { OneBunApplication } from '../application/application';
import { Module } from '../decorators/decorators';
import { createMockSyncLogger, makeMockLoggerLayer } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import {
  Client,
  OnConnect,
  OnDisconnect,
  OnMessage,
  WebSocketGateway,
} from './ws-decorators';
import { WsHandler } from './ws-handler';


const OPEN_TIMEOUT_MS = 2000;
const SETTLE_MS = 120;

/** What each gateway saw, in order, so a leak names the gateway that should not have run. */
let fired: string[] = [];

@WebSocketGateway({ path: '/chat' })
class ChatGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() client: WsClientData): void {
    fired.push(`chat.connect(${client.id.slice(0, 4)})`);
  }

  @OnDisconnect()
  onDisconnect(): void {
    fired.push('chat.disconnect');
  }

  @OnMessage('chat:hello')
  hello(): { event: string; data: Record<string, unknown> } {
    fired.push('chat.hello');
    this.broadcast('chat:greeting', { from: 'chat' });

    return { event: 'chat:ok', data: {} };
  }
}

@WebSocketGateway({ path: '/admin', namespace: 'admin' })
class AdminGateway extends BaseWebSocketGateway {
  @OnConnect()
  onConnect(@Client() client: WsClientData): void {
    fired.push(`admin.connect(${client.id.slice(0, 4)})`);
  }

  @OnDisconnect()
  onDisconnect(): void {
    fired.push('admin.disconnect');
  }

  @OnMessage('admin:secret')
  secret(): { event: string; data: Record<string, unknown> } {
    fired.push('admin.secret');
    this.broadcast('admin:secret-leak', { salary: 999 });

    return { event: 'admin:ok', data: {} };
  }
}

@Module({ controllers: [ChatGateway, AdminGateway] })
class TwoGatewayModule {}

class Outsider extends BaseWebSocketGateway {}

interface Probe {
  socket: WebSocket;
  inbox: string[];
}

/** The gateway surface these tests reach through the handler's registry. */
interface GatewayProbe {
  clients: Map<string, unknown>;
  rooms: Map<string, { name: string; clientIds: string[] }>;
  joinRoom(clientId: string, roomName: string): Promise<void>;
  publishToRoom(roomName: string, event: string, data: unknown): void;
  getRoom(roomName: string): Promise<{ name: string; clientIds: string[] } | undefined>;
  getRoomsByPattern(pattern: string): Promise<Array<{ name: string; clientIds: string[] }>>;
  getClientsByRoom(roomName: string): Promise<unknown[]>;
  getClient(clientId: string): Promise<unknown | undefined>;
}

async function connect(url: string): Promise<Probe> {
  const socket = new WebSocket(url);
  const inbox: string[] = [];
  socket.addEventListener('message', (event) => inbox.push(String(event.data)));

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

  return { socket, inbox };
}

const settle = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe('a connection belongs to one gateway', () => {
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
    fired = [];
  });

  test('should run only the admitting gateway\'s connect and disconnect handlers', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const probe = await connect(wsUrl(app, '/chat'));
    sockets.push(probe.socket);
    await settle();

    // Before: ["chat.connect(22bf)","admin.connect(22bf)"] — one client, both gateways.
    expect(fired.filter((entry) => entry.startsWith('chat.connect'))).toHaveLength(1);
    expect(fired.filter((entry) => entry.startsWith('admin.connect'))).toHaveLength(0);

    probe.socket.close();
    await settle();

    expect(fired).toContain('chat.disconnect');
    expect(fired).not.toContain('admin.disconnect');
  });

  test('should not let a client reach another gateway\'s message handler', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const probe = await connect(wsUrl(app, '/chat'));
    sockets.push(probe.socket);
    probe.socket.send(JSON.stringify({ event: 'admin:secret', data: {} }));
    await settle();

    // Before: the /chat client ran AdminGateway.secret() and its inbox received
    // {"event":"admin:secret-leak","data":{"salary":999}}.
    expect(fired).not.toContain('admin.secret');
    expect(probe.inbox.join('\n')).not.toContain('admin:secret-leak');
  });

  test('should deliver a broadcast only to the broadcasting gateway\'s own clients', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const chat = await connect(wsUrl(app, '/chat'));
    const admin = await connect(wsUrl(app, '/admin'));
    sockets.push(chat.socket, admin.socket);

    chat.socket.send(JSON.stringify({ event: 'chat:hello', data: {} }));
    await settle();

    expect(chat.inbox.join('\n')).toContain('chat:greeting');
    expect(admin.inbox.join('\n')).not.toContain('chat:greeting');
  });

  test('should hide live clients from a gateway nobody registered', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const probe = await connect(wsUrl(app, '/chat'));
    sockets.push(probe.socket);
    await settle();

    // Before: a hand-built gateway — never in a module, never registered with any handler —
    // both saw the live client and could write to it through the module-level map.
    const outsider = new Outsider();

    expect(outsider.clients.size).toBe(0);
  });

  test('should not let one application broadcast into another\'s connections', async () => {
    const first = boot(TwoGatewayModule);
    const second = boot(TwoGatewayModule);
    await first.start();
    await second.start();

    const firstChat = await connect(wsUrl(first, '/chat'));
    const secondChat = await connect(wsUrl(second, '/chat'));
    sockets.push(firstChat.socket, secondChat.socket);

    firstChat.socket.send(JSON.stringify({ event: 'chat:hello', data: {} }));
    await settle();

    // Before: one process-wide socket map, so the first application's broadcast landed in the
    // second application's client inbox. Dispatch never crossed — each app has its own handler
    // — which is what made this the quieter half of the defect.
    expect(firstChat.inbox.join('\n')).toContain('chat:greeting');
    expect(secondChat.inbox.join('\n')).not.toContain('chat:greeting');

    // Reached through the handler because a gateway is registered as a controller, not a
    // provider. Before, this reported 2: the first application's gateway counting the second
    // application's client.
    const registry = (first as unknown as {
      wsHandler: { gateways: Map<string, { instance: { clients: Map<string, unknown> } }> };
    }).wsHandler;

    expect(registry.gateways.get('/chat')!.instance.clients.size).toBe(1);
  });

  test('should route a stated namespace to its gateway, and ignore one that matches nothing', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const namespaced = await connect(`${wsUrl(app, '/admin')}?namespace=admin`);
    sockets.push(namespaced.socket);
    await settle();

    expect(fired.filter((entry) => entry.startsWith('admin.connect'))).toHaveLength(1);

    fired = [];

    // A namespace that matches nothing NARROWS nothing — it must not refuse the connection,
    // because it does not today and because confinement comes from binding, not from turning
    // clients away.
    const unknown = await connect(`${wsUrl(app, '/chat')}?namespace=nope`);
    sockets.push(unknown.socket);
    await settle();

    expect(fired.filter((entry) => entry.startsWith('chat.connect'))).toHaveLength(1);
  });

  test('should not let one gateway read another gateway\'s rooms or clients', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const chat = await connect(wsUrl(app, '/chat'));
    const admin = await connect(wsUrl(app, '/admin'));
    sockets.push(chat.socket, admin.socket);
    await settle();

    const registry = (app as unknown as {
      wsHandler: { gateways: Map<string, { instance: GatewayProbe }> };
    }).wsHandler;
    const chatGateway = registry.gateways.get('/chat')!.instance;
    const adminGateway = registry.gateways.get('/admin:admin')!.instance;

    const adminClientId = [...adminGateway.clients.keys()][0];

    await chatGateway.joinRoom([...chatGateway.clients.keys()][0], 'zone:chat');
    await adminGateway.joinRoom(adminClientId, 'zone:admin');

    // Before: `getRoom('zone:admin')` returned the admin room with its exact membership, and
    // `getClientsByRoom` handed back the FULL record of a foreign client — auth, metadata and
    // the gateway key naming its owner. The socket fence stopped messages crossing; it never
    // stopped reads.
    expect(await chatGateway.getRoom('zone:admin')).toBeUndefined();
    expect(await chatGateway.getClientsByRoom('zone:admin')).toEqual([]);
    expect(await chatGateway.getClient(adminClientId)).toBeUndefined();

    const visible = await chatGateway.getRoomsByPattern('zone:*');

    expect(visible.map((room) => room.name)).toEqual(['zone:chat']);
  });

  test('should not enrol another gateway\'s client into a room', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const chat = await connect(wsUrl(app, '/chat'));
    const admin = await connect(wsUrl(app, '/admin'));
    sockets.push(chat.socket, admin.socket);
    await settle();

    const registry = (app as unknown as {
      wsHandler: { gateways: Map<string, { instance: GatewayProbe }> };
    }).wsHandler;
    const chatGateway = registry.gateways.get('/chat')!.instance;
    const adminGateway = registry.gateways.get('/admin:admin')!.instance;
    const adminClientId = [...adminGateway.clients.keys()][0];

    // The storage half of joinRoom used to run unconditionally while only the socket
    // subscription was fenced — so this wrote a membership neither gateway could then see.
    await chatGateway.joinRoom(adminClientId, 'zone:chat');

    expect(await adminGateway.getRoom('zone:chat')).toBeUndefined();
    expect(await chatGateway.getClientsByRoom('zone:chat')).toEqual([]);
  });

  test('should report this gateway\'s own rooms instead of an empty map', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const chat = await connect(wsUrl(app, '/chat'));
    sockets.push(chat.socket);
    await settle();

    const registry = (app as unknown as {
      wsHandler: { gateways: Map<string, { instance: GatewayProbe }> };
    }).wsHandler;
    const chatGateway = registry.gateways.get('/chat')!.instance;
    const clientId = [...chatGateway.clients.keys()][0];

    await chatGateway.joinRoom(clientId, 'lobby');

    // `rooms` used to return `new Map()` unconditionally, with a comment pointing at a
    // `getRoomsAsync()` that exists nowhere in the framework.
    const rooms = chatGateway.rooms;

    expect([...rooms.keys()]).toEqual(['lobby']);
    expect(rooms.get('lobby')!.clientIds).toEqual([clientId]);
  });

  test('should keep a scoped room publish inside its own gateway', async () => {
    const app = boot(TwoGatewayModule);
    await app.start();

    const chat = await connect(wsUrl(app, '/chat'));
    const admin = await connect(wsUrl(app, '/admin'));
    sockets.push(chat.socket, admin.socket);
    await settle();

    const registry = (app as unknown as {
      wsHandler: { gateways: Map<string, { instance: GatewayProbe }> };
    }).wsHandler;
    const chatGateway = registry.gateways.get('/chat')!.instance;
    const adminGateway = registry.gateways.get('/admin:admin')!.instance;

    // The same room NAME in both gateways. Bun's topics are a process-wide namespace, so a raw
    // publish to 'lobby' reaches every socket subscribed to it, whichever gateway admitted it.
    await chatGateway.joinRoom([...chatGateway.clients.keys()][0], 'lobby');
    await adminGateway.joinRoom([...adminGateway.clients.keys()][0], 'lobby');
    await settle();

    chatGateway.publishToRoom('lobby', 'chat:scoped', { from: 'chat' });
    await settle();

    expect(chat.inbox.join('\n')).toContain('chat:scoped');
    expect(admin.inbox.join('\n')).not.toContain('chat:scoped');
  });

  test('should refuse two different gateway classes on one key', () => {
    const handler = new WsHandler(createMockSyncLogger());

    @WebSocketGateway({ path: '/dup' })
    class First extends BaseWebSocketGateway {}

    @WebSocketGateway({ path: '/dup' })
    class Second extends BaseWebSocketGateway {}

    handler.registerGateway(First, new First());

    // Before: the second silently replaced the first, which became unreachable with nothing said.
    expect(() => handler.registerGateway(Second, new Second())).toThrow(/both\s+resolve to/);
  });

  test('should empty a gateway\'s socket map on cleanup even if no close arrived', async () => {
    const handler = new WsHandler(createMockSyncLogger());
    const gateway = new ChatGateway();
    handler.registerGateway(ChatGateway, gateway);

    const socket = { data: { id: 'orphan' } } as unknown as ServerWebSocket<WsClientData>;
    gateway._registerSocket('orphan', socket);

    expect((gateway as unknown as { ownSockets: Map<string, unknown> }).ownSockets.size).toBe(1);

    await handler.cleanup();

    // `closeAll` normally drains the map through each socket's close callback; one whose
    // callback never arrives used to leave its entry behind with nothing able to reach it.
    expect((gateway as unknown as { ownSockets: Map<string, unknown> }).ownSockets.size).toBe(0);
  });
});

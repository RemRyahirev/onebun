/**
 * Documentation Examples Tests — WebSocket
 *
 * These pin what the WebSocket pages PROMISE, not merely that their snippets compile: what a
 * gateway answers, what reaches `client.auth`, what the Socket.IO handshake announces, and what
 * a room looks like as clients join and leave it.
 *
 * @source docs:api/websocket.md
 * @source docs:examples/websocket-chat.md
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import type {
  WsClientData,
  WsExecutionContext,
  WsGatewayClient,
  WsRoom,
} from '@onebun/core';
import {
  BaseService,
  BaseWebSocketGateway,
  Client,
  Controller,
  createGuard,
  createNativeWsClient,
  createWsClient,
  createWsServiceDefinition,
  Env,
  Get,
  MessageData,
  Module,
  OnConnect,
  OneBunApplication,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  PatternParams,
  registerDependencies,
  RoomName,
  Service,
  UseWsGuards,
  WebSocketGateway,
  WsPermissionGuard,
} from '@onebun/core';
import { makeMockLoggerLayer } from '@onebun/core/testing';
import { TypedEnv } from '@onebun/envs';

// --- Shared helpers -------------------------------------------------------------------------

const HOST = '127.0.0.1';
const CLIENT_TIMEOUT_MS = 2000;
const WAIT_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Heartbeat values for the Socket.IO section. The page shows 25000/20000, which are also the
 * framework defaults — asserting those would pass whether the option was honoured or ignored, so
 * distinct numbers are configured here and the handshake is checked against them.
 */
const SOCKETIO_PING_INTERVAL = 12000;
const SOCKETIO_PING_TIMEOUT = 9000;

const baseOptions = {
  // Port 0: the OS hands out a free port and `getPort()` reports it, so the suite never
  // collides with a developer's running server.
  port: 0,
  host: HOST,
  metrics: { enabled: false },
  tracing: { enabled: false },
  gracefulShutdown: false,
};

/** Poll until `probe` produces a value, so no test depends on a guessed sleep length. */
async function waitUntil<T>(probe: () => T | undefined, label = 'condition'): Promise<T> {
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

/**
 * A bare browser WebSocket that records every frame verbatim.
 *
 * Used for the Socket.IO sections: `socket.io-client` is not a dependency of this repo, so the
 * tests speak the exact Engine.IO/Socket.IO v4 wire format that client puts on the socket rather
 * than reusing the framework's own encoder — which would let both sides agree on a wrong format.
 */
function openRawSocket(url: string): {
  frames: string[];
  opened: Promise<void>;
  send(frame: string): void;
  close(): void;
} {
  const frames: string[] = [];
  const socket = new WebSocket(url);

  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error(`WebSocket upgrade to ${url} failed`));
    socket.onclose = () => reject(new Error(`WebSocket to ${url} closed before it opened`));
  });

  socket.onmessage = (event: MessageEvent) => {
    frames.push(typeof event.data === 'string' ? event.data : String(event.data));
  };

  return {
    frames,
    opened,
    send: (frame: string) => socket.send(frame),
    close: () => socket.close(),
  };
}

/** `client.ChatGateway` through the proxy, without an `any`. */
function gatewayOf(client: unknown, name: string): WsGatewayClient {
  return (client as Record<string, WsGatewayClient>)[name];
}

const wsUrl = (app: OneBunApplication, path: string): string => `ws://${HOST}:${app.getPort()}${path}`;

/** Handler payloads come back as `unknown`; naming a shape lets `toEqual` compare it. */
type JsonRecord = Record<string, unknown>;

// --- The chat example, built exactly as docs/examples/websocket-chat.md describes it ---------

interface ChatMessageRecord {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  timestamp: number;
}

/**
 * A fresh copy of the example's service, guard, gateway and module per test.
 *
 * Fresh classes on purpose: gateway metadata is a process-wide map keyed by class, so sharing one
 * class between applications would let one test's guard resolution leak into the next.
 *
 * One deliberate departure from the page: the gateway declares an `authenticate` hook. The page's
 * gateway has none, and `ChatAuthGuard` requires `client.auth.authenticated`, which nothing but
 * that hook (or an `@OnConnect` handler) ever sets — so the documented `chat:{roomId}:message`
 * flow is unreachable as written. See the `#step-3-auth-guard` test, which pins both halves.
 */
function createChatFixture() {
  @Service()
  class ChatService extends BaseService {
    private messages: Map<string, ChatMessageRecord[]> = new Map();
    private messageIdCounter = 0;

    async saveMessage(data: Omit<ChatMessageRecord, 'id'>): Promise<ChatMessageRecord> {
      const message: ChatMessageRecord = { id: `msg_${++this.messageIdCounter}`, ...data };
      const roomMessages = this.messages.get(data.roomId) || [];
      roomMessages.push(message);
      this.messages.set(data.roomId, roomMessages);

      return message;
    }

    async getMessageHistory(roomId: string, limit = 50): Promise<ChatMessageRecord[]> {
      const roomMessages = this.messages.get(roomId) || [];

      return roomMessages.slice(-limit);
    }

    async clearRoom(roomId: string): Promise<void> {
      this.messages.delete(roomId);
    }
  }

  // src/auth.guard.ts
  // eslint-disable-next-line @typescript-eslint/naming-convention -- a guard class held in a const
  const ChatAuthGuard = createGuard((context: WsExecutionContext) => {
    const client = context.getClient();

    if (!client.auth?.authenticated) {
      return false;
    }

    return true;
  });

  // src/chat.gateway.ts
  @WebSocketGateway({
    path: '/chat',
    authenticate: ({ token }) => (token ? { userId: `user-${token}` } : null),
  })
  class ChatGateway extends BaseWebSocketGateway {
    constructor(private chatService: ChatService) {
      super();
    }

    @OnConnect()
    async handleConnect(@Client() client: WsClientData) {
      return {
        event: 'welcome',
        data: {
          message: 'Welcome to the chat!',
          clientId: client.id,
          timestamp: Date.now(),
        },
      };
    }

    @OnJoinRoom('room:{roomId}')
    async handleJoinRoom(
      @Client() client: WsClientData,
      @RoomName() room: string,
      @PatternParams() params: { roomId: string },
    ) {
      await this.joinRoom(client.id, room);

      // Notify others (exclude the joining user)
      this.emitToRoom(room, 'user:joined', { userId: client.id, room }, [client.id]);

      const history = await this.chatService.getMessageHistory(params.roomId);

      return {
        event: 'room:joined',
        data: {
          room: params.roomId,
          history,
          users: (await this.getClientsByRoom(room)).map((c) => c.id),
        },
      };
    }

    @OnLeaveRoom('room:{roomId}')
    async handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
      await this.leaveRoom(client.id, room);
      this.emitToRoom(room, 'user:left', { userId: client.id, room });
    }

    @UseWsGuards(ChatAuthGuard)
    @OnMessage('chat:{roomId}:message')
    async handleMessage(
      @Client() client: WsClientData,
      @MessageData() data: { text: string },
      @PatternParams() params: { roomId: string },
    ) {
      if (!client.rooms.includes(`room:${params.roomId}`)) {
        return { event: 'error', data: { message: 'Not in room' } };
      }

      const message = await this.chatService.saveMessage({
        roomId: params.roomId,
        userId: client.id,
        text: data.text,
        timestamp: Date.now(),
      });

      this.emitToRoom(`room:${params.roomId}`, 'chat:message', message);

      return { event: 'chat:message:ack', data: { messageId: message.id } };
    }

    @OnMessage('typing:{roomId}')
    handleTyping(@Client() client: WsClientData, @PatternParams() params: { roomId: string }) {
      this.emitToRoom(`room:${params.roomId}`, 'typing', { userId: client.id }, [client.id]);
    }
  }

  registerDependencies(ChatGateway, [ChatService]);

  // src/chat.module.ts — the gateway is a CONTROLLER, the service is a provider
  @Module({
    controllers: [ChatGateway],
    providers: [ChatService],
  })
  class ChatModule {}

  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- classes keep their own names
    ChatAuthGuard, ChatGateway, ChatModule, ChatService,
  };
}

interface WelcomePayload {
  message: string;
  clientId: string;
  timestamp: number;
}

interface RoomJoinedPayload {
  room: string;
  history: ChatMessageRecord[];
  users: string[];
}

interface MembershipPayload {
  userId: string;
  room: string;
}

// --- docs/api/websocket.md ------------------------------------------------------------------

describe('docs/api/websocket.md', () => {
  /**
   * The three Quick Start snippets are one system: the gateway, the module that lists it under
   * `controllers`, and the application options that turn WebSocket on. The note's
   * `controllers: [AppGateway, ChatGateway]` shape is pinned too — a gateway shares that list
   * with ordinary controllers, and the ordinary ones keep their HTTP routes.
   *
   * A plain `GET` to the gateway path is deliberately NOT asserted: a gateway carries no route
   * metadata, so 404 there is also what a completely unregistered gateway answers.
   *
   * @source docs:api/websocket.md#quick-start
   */
  it('serves the quick-start gateway on its path beside an ordinary HTTP controller', async () => {
    // gateway.ts
    @WebSocketGateway({ path: '/ws' })
    class AppGateway extends BaseWebSocketGateway {
      @OnConnect()
      handleConnect(@Client() client: WsClientData) {
        return { event: 'welcome', data: { id: client.id } };
      }

      @OnMessage('ping')
      handlePing() {
        return { event: 'pong', data: {} };
      }
    }

    // A plain HTTP controller sharing the list with the gateway, and listed AFTER it
    @Controller('/status')
    class StatusController {
      @Get()
      status() {
        return { ok: true };
      }
    }

    // app.module.ts — gateways are controllers
    @Module({
      controllers: [AppGateway, StatusController],
      providers: [],
    })
    class AppModule {}

    // index.ts
    const app = new OneBunApplication(AppModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const client = createNativeWsClient({ url: wsUrl(app, '/ws'), timeout: CLIENT_TIMEOUT_MS });
      const welcomes: { id: string }[] = [];
      client.on<{ id: string }>('welcome', (data) => welcomes.push(data));

      await client.connect();

      // @OnConnect pushes its response the moment the socket opens, with the client's own id
      const welcome = await waitUntil(() => welcomes[0], 'welcome');
      expect(welcome.id).toMatch(UUID_PATTERN);

      // @OnMessage('ping') answers with the documented pong payload
      expect(await client.emit<JsonRecord>('ping', {})).toEqual({});

      client.disconnect();

      // "The framework discovers gateways from that list" — and the discovery does not consume
      // the rest of it: the controller listed behind the gateway is still served over HTTP.
      const status = await fetch(`http://${HOST}:${app.getPort()}/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ success: true, result: { ok: true } });
    } finally {
      await app.stop();
    }
  });

  /**
   * `socketio.enabled` opens a SECOND endpoint speaking Engine.IO/Socket.IO v4, on
   * `socketio.path`, announcing the configured heartbeat — and `socket.io-client` talks to it
   * with the frames written literally below.
   *
   * @source docs:api/websocket.md#enabling-socketio
   * @source docs:api/websocket.md#using-socketio-client
   * @source docs:examples/websocket-chat.md#option-c-socketio-client-socketio-protocol
   */
  it('speaks the Socket.IO v4 wire protocol on the configured socketio path', async () => {
    @WebSocketGateway({ path: '/ws' })
    class SioGateway extends BaseWebSocketGateway {
      @OnConnect()
      handleConnect(@Client() client: WsClientData) {
        return { event: 'welcome', data: { id: client.id, protocol: client.protocol } };
      }

      @OnJoinRoom('room:{roomId}')
      async handleJoin(
        @Client() client: WsClientData,
        @RoomName() room: string,
        @PatternParams() params: { roomId: string },
      ) {
        await this.joinRoom(client.id, room);

        return { event: 'room:joined', data: { room: params.roomId } };
      }

      @OnMessage('ping')
      handlePing() {
        return { event: 'pong', data: {} };
      }
    }

    @Module({ controllers: [SioGateway] })
    class SioModule {}

    const app = new OneBunApplication(SioModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {
        socketio: {
          enabled: true,
          path: '/socket.io',
          pingInterval: SOCKETIO_PING_INTERVAL,
          pingTimeout: SOCKETIO_PING_TIMEOUT,
        },
      },
    });

    await app.start();

    try {
      // What `io('http://host', { path: '/socket.io', transports: ['websocket'] })` opens
      const raw = openRawSocket(`${wsUrl(app, '/socket.io')}/?EIO=4&transport=websocket`);
      await raw.opened;

      // Engine.IO OPEN packet: type '0' followed by the handshake JSON
      const open = await waitUntil(() => raw.frames.find((f) => f.startsWith('0')), 'engine.io OPEN');
      const handshake = JSON.parse(open.slice(1)) as {
        sid: string;
        upgrades: string[];
        pingInterval: number;
        pingTimeout: number;
      };
      expect(handshake.sid).toMatch(UUID_PATTERN);
      expect(handshake.upgrades).toEqual(['websocket']);
      expect(handshake.pingInterval).toBe(SOCKETIO_PING_INTERVAL);
      expect(handshake.pingTimeout).toBe(SOCKETIO_PING_TIMEOUT);

      // socket.io-client joins a namespace with `40` before anything else happens on the socket,
      // and that packet is what binds the connection to a gateway — so `@OnConnect` waits for it.
      expect(raw.frames.some((f) => f.startsWith('42["welcome"'))).toBe(false);

      raw.send('40');
      const connected = await waitUntil(() => raw.frames.find((f) => f.startsWith('42["connect"')), 'connect event');
      expect(JSON.parse(connected.slice(2))).toEqual(['connect', { sid: handshake.sid }]);

      // socket.on('welcome', ...) — pushed as MESSAGE(4) + EVENT(2), and the gateway sees the
      // connection as Socket.IO rather than native
      const welcome = await waitUntil(() => raw.frames.find((f) => f.startsWith('42["welcome"')), 'welcome event');
      expect(JSON.parse(welcome.slice(2))).toEqual(['welcome', { id: handshake.sid, protocol: 'socketio' }]);

      // socket.emit('join', 'room:general', cb) — ack id 1, answered as ACK(3) id 1
      raw.send('421["join","room:general"]');
      const joinAck = await waitUntil(() => raw.frames.find((f) => f.startsWith('431')), 'join ack');
      expect(JSON.parse(joinAck.slice(3))).toEqual([{ event: 'room:joined', data: { room: 'general' } }]);

      // socket.emit('ping', {}, cb) — ack id 2
      raw.send('422["ping",{}]');
      const pingAck = await waitUntil(() => raw.frames.find((f) => f.startsWith('432')), 'ping ack');
      expect(JSON.parse(pingAck.slice(3))).toEqual([{ event: 'pong', data: {} }]);

      raw.close();
    } finally {
      await app.stop();
    }
  });

  /**
   * The other half of the same claim: Socket.IO is opt-in. With the flag left off the path is
   * not an endpoint at all, while the gateway's own path keeps serving native JSON.
   *
   * @source docs:api/websocket.md#enabling-socketio
   */
  it('refuses the socketio path when socketio.enabled is left off, and keeps the native path', async () => {
    @WebSocketGateway({ path: '/ws' })
    class NativeOnlyGateway extends BaseWebSocketGateway {
      @OnConnect()
      handleConnect(@Client() client: WsClientData) {
        return { event: 'welcome', data: { protocol: client.protocol } };
      }
    }

    @Module({ controllers: [NativeOnlyGateway] })
    class NativeOnlyModule {}

    const app = new OneBunApplication(NativeOnlyModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const refused = openRawSocket(`${wsUrl(app, '/socket.io')}/?EIO=4&transport=websocket`);
      await expect(refused.opened).rejects.toThrow();

      const native = openRawSocket(wsUrl(app, '/ws'));
      await native.opened;
      const welcome = await waitUntil(() => native.frames[0], 'native welcome');

      // Native messages are plain JSON `{ event, data }`, not Engine.IO packets
      expect(JSON.parse(welcome)).toEqual({ event: 'welcome', data: { protocol: 'native' } });

      native.close();
    } finally {
      await app.stop();
    }
  });

  /**
   * The typed client with `protocol: 'socketio'` reaches the same gateway through the Socket.IO
   * endpoint, and `auth.token` still travels with the upgrade.
   *
   * @source docs:api/websocket.md#typed-client-socketio
   * @source docs:examples/websocket-chat.md#option-d-typed-client-with-socketio
   */
  it('drives the gateway through the typed client over Socket.IO', async () => {
    @WebSocketGateway({ path: '/ws' })
    class TypedSioGateway extends BaseWebSocketGateway {
      @OnConnect()
      handleConnect(@Client() client: WsClientData) {
        return { event: 'welcome', data: { protocol: client.protocol } };
      }

      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'whoami', data: { token: client.auth?.token ?? null, protocol: client.protocol } };
      }
    }

    @Module({ controllers: [TypedSioGateway] })
    class TypedSioModule {}

    const definition = createWsServiceDefinition(TypedSioModule);
    const app = new OneBunApplication(TypedSioModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: { socketio: { enabled: true, path: '/socket.io' } },
    });

    await app.start();

    try {
      const client = createWsClient(definition, {
        url: wsUrl(app, '/socket.io'),
        protocol: 'socketio',
        auth: { token: 'xxx' },
        timeout: CLIENT_TIMEOUT_MS,
      });
      const gateway = gatewayOf(client, 'TypedSioGateway');

      const welcomes: { protocol: string }[] = [];
      gateway.on<{ protocol: string }>('welcome', (data) => welcomes.push(data));

      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Server-pushed events arrive through the gateway proxy, exactly as on the native protocol
      expect(await waitUntil(() => welcomes[0], 'welcome')).toEqual({ protocol: 'socketio' });

      // A Socket.IO acknowledgement carries the whole handler response, not just its `data`
      expect(await gateway.emit<JsonRecord>('whoami', {})).toEqual({
        event: 'whoami',
        data: { token: 'xxx', protocol: 'socketio' },
      });

      client.disconnect();
      expect(client.isConnected()).toBe(false);
    } finally {
      await app.stop();
    }
  });

  /**
   * Every field the WsClientData interface lists, read off the object a handler is handed.
   *
   * @source docs:api/websocket.md#wsclientdata
   */
  it('hands a handler a WsClientData carrying every documented field', async () => {
    @WebSocketGateway({ path: '/ws' })
    class ClientDataGateway extends BaseWebSocketGateway {
      @OnJoinRoom('room:{roomId}')
      async handleJoin(@Client() client: WsClientData, @RoomName() room: string) {
        await this.joinRoom(client.id, room);

        return { event: 'room:joined', data: { room } };
      }

      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'whoami', data: client };
      }
    }

    @Module({ controllers: [ClientDataGateway] })
    class ClientDataModule {}

    const app = new OneBunApplication(ClientDataModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const before = Date.now();
      const client = createNativeWsClient({
        url: wsUrl(app, '/ws'),
        auth: { token: 't-1' },
        timeout: CLIENT_TIMEOUT_MS,
      });
      await client.connect();
      const after = Date.now();

      const seen = await client.emit<WsClientData>('whoami', {});

      expect(seen.id).toMatch(UUID_PATTERN);
      expect(seen.rooms).toEqual([]);
      expect(seen.connectedAt).toBeGreaterThanOrEqual(before);
      expect(seen.connectedAt).toBeLessThanOrEqual(after);
      // No `authenticate` hook on this gateway: the token is parsed, the client is not authenticated
      expect(seen.auth).toEqual({ authenticated: false, token: 't-1' });
      expect(seen.metadata).toEqual({});
      expect(seen.protocol).toBe('native');

      // `rooms` is "the list of rooms the client has joined" — it grows when it joins one
      await client.emit('join', 'room:general');
      expect((await client.emit<WsClientData>('whoami', {})).rooms).toEqual(['room:general']);

      client.disconnect();
    } finally {
      await app.stop();
    }
  });

  /**
   * WsAuthData is what the `authenticate` hook attaches, and what the built-in guards read: the
   * `permissions` list is not decoration, it decides whether a guarded handler runs.
   *
   * @source docs:api/websocket.md#wsauthdata
   */
  it('fills WsAuthData from the authenticate hook and gates a handler on its permissions', async () => {
    @WebSocketGateway({
      path: '/ws',
      authenticate({ token }) {
        if (!token) {
          return null;
        }

        return token === 'writer'
          ? { userId: 'u-writer', permissions: ['chat:write'] }
          : { userId: 'u-reader', permissions: ['chat:read'] };
      },
    })
    class AuthDataGateway extends BaseWebSocketGateway {
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'whoami', data: { auth: client.auth } };
      }

      @UseWsGuards(new WsPermissionGuard('chat:write'))
      @OnMessage('publish')
      publish(@Client() client: WsClientData) {
        return { event: 'published', data: { by: client.auth?.userId } };
      }
    }

    @Module({ controllers: [AuthDataGateway] })
    class AuthDataModule {}

    const app = new OneBunApplication(AuthDataModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    const connect = async (token?: string) => {
      const client = createNativeWsClient({
        url: wsUrl(app, '/ws'),
        auth: token ? { token } : undefined,
        timeout: CLIENT_TIMEOUT_MS,
      });
      await client.connect();

      return client;
    };

    try {
      const writer = await connect('writer');
      const reader = await connect('reader');
      const anonymous = await connect();

      expect(await writer.emit<JsonRecord>('whoami', {})).toEqual({
        auth: {
          authenticated: true,
          token: 'writer',
          userId: 'u-writer',
          permissions: ['chat:write'],
        },
      });

      // A hook returning `null` admits the client without authenticating it
      expect(await anonymous.emit<JsonRecord>('whoami', {})).toEqual({ auth: null });

      // WsPermissionGuard reads exactly that permissions list
      expect(await writer.emit<JsonRecord>('publish', {})).toEqual({ by: 'u-writer' });
      expect(await reader.emit<JsonRecord>('publish', {})).toEqual({
        code: 'FORBIDDEN',
        event: 'publish',
        message: 'Guard denied this message',
      });

      writer.disconnect();
      reader.disconnect();
      anonymous.disconnect();
    } finally {
      await app.stop();
    }
  });

  /**
   * A WsRoom is a name plus the ids currently in it — it tracks joins and leaves, and disappears
   * once the last member is gone.
   *
   * @source docs:api/websocket.md#wsroom
   */
  it('reports a WsRoom whose clientIds follow the members in and out', async () => {
    @WebSocketGateway({ path: '/ws' })
    class RoomGateway extends BaseWebSocketGateway {
      @OnConnect()
      handleConnect(@Client() client: WsClientData) {
        return { event: 'welcome', data: { id: client.id } };
      }

      @OnJoinRoom('room:{roomId}')
      async handleJoin(@Client() client: WsClientData, @RoomName() room: string) {
        await this.joinRoom(client.id, room);

        return { event: 'room:joined', data: { room } };
      }

      @OnLeaveRoom('room:{roomId}')
      async handleLeave(@Client() client: WsClientData, @RoomName() room: string) {
        await this.leaveRoom(client.id, room);

        return { event: 'room:left', data: { room } };
      }

      @OnMessage('room:info')
      async roomInfo(@MessageData('room') room: string) {
        return { event: 'room:info', data: (await this.getRoom(room)) ?? null };
      }
    }

    @Module({ controllers: [RoomGateway] })
    class RoomModule {}

    const app = new OneBunApplication(RoomModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const first = createNativeWsClient({ url: wsUrl(app, '/ws'), timeout: CLIENT_TIMEOUT_MS });
      const second = createNativeWsClient({ url: wsUrl(app, '/ws'), timeout: CLIENT_TIMEOUT_MS });
      const firstWelcomes: { id: string }[] = [];
      const secondWelcomes: { id: string }[] = [];
      first.on<{ id: string }>('welcome', (data) => firstWelcomes.push(data));
      second.on<{ id: string }>('welcome', (data) => secondWelcomes.push(data));

      await first.connect();
      await second.connect();
      const firstId = (await waitUntil(() => firstWelcomes[0], 'first welcome')).id;
      const secondId = (await waitUntil(() => secondWelcomes[0], 'second welcome')).id;

      await first.emit('join', 'room:general');
      await second.emit('join', 'room:general');

      // `metadata` is optional and unset here, so the room is exactly name + membership
      expect(await first.emit<WsRoom>('room:info', { room: 'room:general' })).toEqual({
        name: 'room:general',
        clientIds: [firstId, secondId],
      });

      await second.emit('leave', 'room:general');
      expect(await first.emit<WsRoom>('room:info', { room: 'room:general' })).toEqual({
        name: 'room:general',
        clientIds: [firstId],
      });

      // The last member out takes the room with them
      await first.emit('leave', 'room:general');
      expect(await first.emit<WsRoom | null>('room:info', { room: 'room:general' })).toBeNull();

      first.disconnect();
      second.disconnect();
    } finally {
      await app.stop();
    }
  });
});

// --- docs/examples/websocket-chat.md ---------------------------------------------------------

describe('docs/examples/websocket-chat.md', () => {
  /**
   * The chat service owns message ids and history windows; the gateway just calls it.
   *
   * Driven through a running application on purpose: `new ChatService()` in a test file reaches
   * no framework code at all, so it would keep passing with `@Service()` registering nothing and
   * with the gateway's constructor injection dead. Here the messages are saved by real sockets
   * and read back off the instance `app.getService()` answers with — which only holds them if the
   * container built one service and handed that one to the gateway.
   *
   * @source docs:examples/websocket-chat.md#step-2-chat-service
   */
  it('assigns incrementing message ids and returns the tail of a room history', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- classes held in consts
    const { ChatModule, ChatService } = createChatFixture();

    const app = new OneBunApplication(ChatModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const service = app.getService(ChatService);
      const url = wsUrl(app, '/chat');
      const alice = createNativeWsClient({ url, auth: { token: 'alice-jwt' }, timeout: CLIENT_TIMEOUT_MS });
      const bob = createNativeWsClient({ url, auth: { token: 'bob-jwt' }, timeout: CLIENT_TIMEOUT_MS });

      await alice.connect();
      await bob.connect();
      await alice.emit('join', 'room:general');
      await bob.emit('join', 'room:random');

      // `msg_${++this.messageIdCounter}` — one counter per service, not per room
      expect(await alice.emit<JsonRecord>('chat:general:message', { text: 'one' })).toEqual({ messageId: 'msg_1' });
      expect(await alice.emit<JsonRecord>('chat:general:message', { text: 'two' })).toEqual({ messageId: 'msg_2' });
      expect(await bob.emit<JsonRecord>('chat:random:message', { text: 'other room' })).toEqual({ messageId: 'msg_3' });

      // History is per room, in arrival order — read off the instance the container built
      expect(await service.getMessageHistory('general')).toEqual([
        {
          id: 'msg_1', roomId: 'general', userId: expect.any(String), text: 'one', timestamp: expect.any(Number), 
        },
        {
          id: 'msg_2', roomId: 'general', userId: expect.any(String), text: 'two', timestamp: expect.any(Number), 
        },
      ]);
      expect((await service.getMessageHistory('random')).map((message) => message.text)).toEqual(['other room']);
      expect(await service.getMessageHistory('never-used')).toEqual([]);

      // `limit` keeps the LAST n, which is what a chat backlog needs
      expect((await service.getMessageHistory('general', 1)).map((message) => message.id)).toEqual(['msg_2']);

      // ...and that window is what a joining client is replayed
      const joined = await bob.emit<RoomJoinedPayload>('join', 'room:general');
      expect(joined.history.map((message) => message.text)).toEqual(['one', 'two']);

      await service.clearRoom('general');
      expect(await service.getMessageHistory('general')).toEqual([]);
      expect((await service.getMessageHistory('random')).map((message) => message.id)).toEqual(['msg_3']);

      // The cleared room replays nothing to the next joiner, and the counter keeps counting
      expect((await alice.emit<RoomJoinedPayload>('join', 'room:general')).history).toEqual([]);
      expect(await alice.emit<JsonRecord>('chat:general:message', { text: 'after clear' })).toEqual({
        messageId: 'msg_4',
      });

      alice.disconnect();
      bob.disconnect();
    } finally {
      await app.stop();
    }
  });

  /**
   * The gateway handlers of Step 1, driven by the typed client of Option A: joining returns the
   * room's history and members, others are told about the join while the joiner is not, and a
   * message is both acknowledged to its sender and broadcast to the room.
   *
   * @source docs:examples/websocket-chat.md#step-1-create-the-gateway
   * @source docs:examples/websocket-chat.md#step-4-register-the-gateway-in-the-module
   * @source docs:examples/websocket-chat.md#option-a-typed-client-native-websocket-with-definition
   */
  it('joins, broadcasts and acknowledges chat messages through the typed client', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- classes held in consts
    const { ChatGateway, ChatModule } = createChatFixture();

    // Step 4: a gateway listed under `controllers` is what the definition finds...
    const definition = createWsServiceDefinition(ChatModule);
    expect([...definition._gateways.keys()]).toEqual(['ChatGateway']);
    expect(definition._gateways.get('ChatGateway')?.path).toBe('/chat');

    // ...and "Do not add it to providers" is load-bearing: a gateway registered there is invisible
    @Module({ providers: [ChatGateway] })
    class MisregisteredModule {}
    expect([...createWsServiceDefinition(MisregisteredModule)._gateways.keys()]).toEqual([]);

    const app = new OneBunApplication(ChatModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const url = wsUrl(app, '/chat');
      const makeClient = (token: string) => createWsClient(definition, {
        url,
        protocol: 'native',
        auth: { token },
        reconnect: true,
        reconnectInterval: 2000,
        maxReconnectAttempts: 5,
        timeout: CLIENT_TIMEOUT_MS,
      });

      const alice = makeClient('alice-jwt');
      const aliceChat = gatewayOf(alice, 'ChatGateway');
      const lifecycle: string[] = [];
      const aliceWelcomes: WelcomePayload[] = [];
      const aliceJoins: MembershipPayload[] = [];
      const aliceMessages: ChatMessageRecord[] = [];
      alice.on('connect', () => lifecycle.push('connect'));
      alice.on('disconnect', () => lifecycle.push('disconnect'));
      aliceChat.on<WelcomePayload>('welcome', (data) => aliceWelcomes.push(data));
      aliceChat.on<MembershipPayload>('user:joined', (data) => aliceJoins.push(data));
      aliceChat.on<ChatMessageRecord>('chat:message', (data) => aliceMessages.push(data));

      await alice.connect();
      const aliceWelcome = await waitUntil(() => aliceWelcomes[0], 'alice welcome');
      expect(aliceWelcome.message).toBe('Welcome to the chat!');
      expect(aliceWelcome.clientId).toMatch(UUID_PATTERN);
      expect(lifecycle).toEqual(['connect']);

      // Joining an empty room: no history yet, and the joiner is the only member
      const firstJoin = await aliceChat.emit<RoomJoinedPayload>('join', 'room:general');
      expect(firstJoin.room).toBe('general');
      expect(firstJoin.history).toEqual([]);
      expect(firstJoin.users).toEqual([aliceWelcome.clientId]);

      const bob = makeClient('bob-jwt');
      const bobChat = gatewayOf(bob, 'ChatGateway');
      const bobWelcomes: WelcomePayload[] = [];
      const bobJoins: MembershipPayload[] = [];
      bobChat.on<WelcomePayload>('welcome', (data) => bobWelcomes.push(data));
      bobChat.on<MembershipPayload>('user:joined', (data) => bobJoins.push(data));

      await bob.connect();
      const bobWelcome = await waitUntil(() => bobWelcomes[0], 'bob welcome');

      const bobJoin = await bobChat.emit<RoomJoinedPayload>('join', 'room:general');
      expect(bobJoin.users).toEqual([aliceWelcome.clientId, bobWelcome.clientId]);

      // `[client.id]` on emitToRoom: everyone else is told, the joiner is not
      expect(await waitUntil(() => aliceJoins[0], 'user:joined for alice')).toEqual({
        userId: bobWelcome.clientId,
        room: 'room:general',
      });
      expect(bobJoins).toEqual([]);

      // The guarded handler runs for an authenticated client: sender gets the id, room gets the message
      const ack = await bobChat.emit<{ messageId: string }>('chat:general:message', { text: 'Hello everyone!' });
      expect(ack.messageId).toBe('msg_1');

      expect(await waitUntil(() => aliceMessages[0], 'chat:message for alice')).toEqual({
        id: 'msg_1',
        roomId: 'general',
        userId: bobWelcome.clientId,
        text: 'Hello everyone!',
        timestamp: expect.any(Number),
      });

      // "Joined room with history": a later join replays what the room already said
      const rejoin = await aliceChat.emit<RoomJoinedPayload>('join', 'room:general');
      expect(rejoin.history).toEqual([aliceMessages[0]]);

      alice.disconnect();
      bob.disconnect();

      // Awaited, not assumed. `disconnect()` closes the socket and the client emits its
      // `disconnect` event from the resulting `onclose` — which Bun 1.3 delivered synchronously,
      // inside the call, and 1.4 does not. The assertion read `['connect']` and the runtime was
      // the only thing that had changed.
      await waitUntil(
        () => (lifecycle.length === 2 ? lifecycle : undefined),
        'the disconnect lifecycle event',
      );

      expect(lifecycle).toEqual(['connect', 'disconnect']);
    } finally {
      await app.stop();
    }
  });

  /**
   * ChatAuthGuard is the whole reason `authenticate` exists: it reads
   * `client.auth.authenticated` and refuses the handler to anyone the gateway did not
   * authenticate — the refusal comes back as an `error` frame, the socket stays open.
   *
   * @source docs:examples/websocket-chat.md#step-3-auth-guard
   */
  it('lets ChatAuthGuard through an authenticated client and denies an anonymous one', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- classes held in consts
    const { ChatModule } = createChatFixture();

    const app = new OneBunApplication(ChatModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const url = wsUrl(app, '/chat');
      const member = createNativeWsClient({ url, auth: { token: 'member-jwt' }, timeout: CLIENT_TIMEOUT_MS });
      const stranger = createNativeWsClient({ url, timeout: CLIENT_TIMEOUT_MS });

      await member.connect();
      await stranger.connect();
      await member.emit('join', 'room:general');
      await stranger.emit('join', 'room:general');

      // Authenticated: the handler runs and saves the message
      expect(await member.emit<JsonRecord>('chat:general:message', { text: 'hi' })).toEqual({ messageId: 'msg_1' });

      // Not authenticated (the hook returned null): the guard denies before the handler runs, so
      // no second message was ever saved
      expect(await stranger.emit<JsonRecord>('chat:general:message', { text: 'let me in' })).toEqual({
        code: 'FORBIDDEN',
        event: 'chat:general:message',
        message: 'Guard denied this message',
      });
      expect(await member.emit<JsonRecord>('chat:general:message', { text: 'still here' })).toEqual({ messageId: 'msg_2' });

      // The denial did not tear the stranger's connection down
      expect(stranger.isConnected()).toBe(true);

      member.disconnect();
      stranger.disconnect();
    } finally {
      await app.stop();
    }
  });

  /**
   * The entry point: `websocket: {}` is enough, and after `start()` the accessors the snippet
   * logs report the real listener the native client then connects to.
   *
   * @source docs:examples/websocket-chat.md#step-5-application-entry-and-websocket-config
   */
  it('reports the bound port and serves the chat gateway at ws://host:port/chat after start()', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- classes held in consts
    const { ChatModule } = createChatFixture();

    // src/config.ts
    const envSchema = {
      chat: {
        name: Env.string({ default: 'onebun-chat', env: 'ONEBUN_DOCS_WS_CHAT_NAME' }),
      },
    };

    // TypedEnv caches one config per key process-wide; every application in this process asks
    // for the same 'default' key, so it is cleared on both sides of this test.
    TypedEnv.clear();

    // src/index.ts
    const app = new OneBunApplication(ChatModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      envSchema,
      websocket: {},
    });

    await app.start();

    try {
      // The port is read back OUT of getHttpUrl() and is the one the client then connects on, so
      // a URL naming anything but the live listener fails the connect — and that pins getPort()
      // as well, since getHttpUrl() embeds it (a getPort() off by one fails the connect below).
      // Comparing getHttpUrl() to a template built from getPort() would pin neither: both sides
      // would be the same accessor.
      const reported = new URL(app.getHttpUrl());
      expect(reported.protocol).toBe('http:');
      expect(reported.hostname).toBe(HOST);
      expect(app.getConfigValue<string>('chat.name')).toBe('onebun-chat');

      // "Native WebSocket: ws://localhost:<port>/chat"
      const client = createNativeWsClient({
        url: `ws://${HOST}:${reported.port}/chat`,
        timeout: CLIENT_TIMEOUT_MS,
      });
      const welcomes: WelcomePayload[] = [];
      client.on<WelcomePayload>('welcome', (data) => welcomes.push(data));

      await client.connect();
      expect((await waitUntil(() => welcomes[0], 'welcome')).message).toBe('Welcome to the chat!');

      client.disconnect();
    } finally {
      await app.stop();
      TypedEnv.clear();
    }
  });

  /**
   * Option B: the same chat flow with no service definition and no dependency on the backend
   * module — connect, join, typing, message, leave — using the flat `emit`/`send`/`on` API.
   *
   * @source docs:examples/websocket-chat.md#option-b-standalone-client-no-definition
   */
  it('runs the whole chat flow from a standalone client with no definition', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- classes held in consts
    const { ChatModule } = createChatFixture();

    const app = new OneBunApplication(ChatModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const url = wsUrl(app, '/chat');
      const alice = createNativeWsClient({
        url,
        protocol: 'native',
        auth: { token: 'alice-jwt' },
        reconnect: true,
        timeout: CLIENT_TIMEOUT_MS,
      });
      const bob = createNativeWsClient({ url, auth: { token: 'bob-jwt' }, timeout: CLIENT_TIMEOUT_MS });

      const aliceLifecycle: string[] = [];
      const aliceWelcomes: WelcomePayload[] = [];
      const bobWelcomes: WelcomePayload[] = [];
      const bobTyping: { userId: string }[] = [];
      const aliceTyping: { userId: string }[] = [];
      const bobMessages: ChatMessageRecord[] = [];
      const bobLeaves: MembershipPayload[] = [];

      alice.on('connect', () => aliceLifecycle.push('connect'));
      alice.on('disconnect', () => aliceLifecycle.push('disconnect'));
      alice.on<WelcomePayload>('welcome', (data) => aliceWelcomes.push(data));
      alice.on<{ userId: string }>('typing', (data) => aliceTyping.push(data));
      bob.on<WelcomePayload>('welcome', (data) => bobWelcomes.push(data));
      bob.on<{ userId: string }>('typing', (data) => bobTyping.push(data));
      bob.on<ChatMessageRecord>('chat:message', (data) => bobMessages.push(data));
      bob.on<MembershipPayload>('user:left', (data) => bobLeaves.push(data));

      await alice.connect();
      await bob.connect();

      const aliceId = (await waitUntil(() => aliceWelcomes[0], 'alice welcome')).clientId;
      const bobId = (await waitUntil(() => bobWelcomes[0], 'bob welcome')).clientId;
      expect(aliceLifecycle).toEqual(['connect']);
      expect(aliceId).not.toBe(bobId);

      await alice.emit('join', 'room:general');
      await bob.emit('join', 'room:general');

      // send() is fire-and-forget, and the typing indicator skips its own sender
      alice.send('typing:general', {});
      expect(await waitUntil(() => bobTyping[0], 'typing for bob')).toEqual({ userId: aliceId });
      expect(aliceTyping).toEqual([]);

      // emit() awaits the acknowledgement while the room gets the broadcast
      expect(await alice.emit<JsonRecord>('chat:general:message', { text: 'Hello everyone!' })).toEqual({ messageId: 'msg_1' });
      expect(await waitUntil(() => bobMessages[0], 'chat:message for bob')).toEqual({
        id: 'msg_1',
        roomId: 'general',
        userId: aliceId,
        text: 'Hello everyone!',
        timestamp: expect.any(Number),
      });

      // leave() really removes the membership: the room hears about it and the guarded handler
      // now takes the "Not in room" branch for the same client
      alice.send('leave', 'room:general');
      expect(await waitUntil(() => bobLeaves[0], 'user:left for bob')).toEqual({
        userId: aliceId,
        room: 'room:general',
      });
      expect(await alice.emit<JsonRecord>('chat:general:message', { text: 'anyone?' })).toEqual({ message: 'Not in room' });

      alice.disconnect();
      bob.disconnect();
      await waitUntil(() => (aliceLifecycle.length > 1 ? aliceLifecycle : undefined), 'alice disconnect');
      expect(aliceLifecycle).toEqual(['connect', 'disconnect']);
    } finally {
      await app.stop();
    }
  });

  /**
   * "Clients can authenticate by providing a token in the connection options ... The token can be
   * validated in a connect handler or guard." Both halves: the token reaches `client.auth.token`,
   * and an `@OnConnect` handler that validates it is what flips `authenticated` for the guard.
   *
   * @source docs:examples/websocket-chat.md#token-based-authentication
   */
  it('carries the client-option token to the connect handler, which unlocks the guarded handler', async () => {
    const validTokens = new Set(['your-jwt-token']);
    const seenTokens: (string | null)[] = [];

    // eslint-disable-next-line @typescript-eslint/naming-convention -- a guard class in a const
    const AuthenticatedOnly = createGuard((context: WsExecutionContext) =>
      context.getClient().auth?.authenticated === true);

    @WebSocketGateway({ path: '/chat' })
    class TokenGateway extends BaseWebSocketGateway {
      @OnConnect()
      async handleConnect(@Client() client: WsClientData) {
        seenTokens.push(client.auth?.token ?? null);

        if (client.auth?.token) {
          if (validTokens.has(client.auth.token)) {
            client.auth.authenticated = true;
            client.auth.userId = `user-of-${client.auth.token}`;
          } else {
            client.auth.authenticated = false;
          }
        }

        return { event: 'welcome', data: { token: client.auth?.token ?? null } };
      }

      @UseWsGuards(AuthenticatedOnly)
      @OnMessage('secret')
      secret(@Client() client: WsClientData) {
        return { event: 'secret', data: { userId: client.auth?.userId } };
      }
    }

    @Module({ controllers: [TokenGateway] })
    class TokenModule {}

    const definition = createWsServiceDefinition(TokenModule);
    const app = new OneBunApplication(TokenModule, {
      ...baseOptions,
      loggerLayer: makeMockLoggerLayer(),
      websocket: {},
    });

    await app.start();

    try {
      const url = wsUrl(app, '/chat');
      const valid = createWsClient(definition, { url, auth: { token: 'your-jwt-token' }, timeout: CLIENT_TIMEOUT_MS });
      const invalid = createWsClient(definition, { url, auth: { token: 'forged' }, timeout: CLIENT_TIMEOUT_MS });

      const validGateway = gatewayOf(valid, 'TokenGateway');
      const invalidGateway = gatewayOf(invalid, 'TokenGateway');
      const validWelcomes: { token: string | null }[] = [];
      validGateway.on<{ token: string | null }>('welcome', (data) => validWelcomes.push(data));

      await valid.connect();
      await invalid.connect();

      // The token from the client options is what the connect handler is given
      expect((await waitUntil(() => validWelcomes[0], 'welcome')).token).toBe('your-jwt-token');
      await waitUntil(() => (seenTokens.length > 1 ? seenTokens : undefined), 'both connect handlers');
      expect([...seenTokens].sort()).toEqual(['forged', 'your-jwt-token']);

      // Validated in the connect handler → the guard lets the message through
      expect(await validGateway.emit<JsonRecord>('secret', {})).toEqual({ userId: 'user-of-your-jwt-token' });

      // A token the handler rejected leaves `authenticated` false, so the guard denies
      expect(await invalidGateway.emit<JsonRecord>('secret', {})).toEqual({
        code: 'FORBIDDEN',
        event: 'secret',
        message: 'Guard denied this message',
      });

      valid.disconnect();
      invalid.disconnect();
    } finally {
      await app.stop();
    }
  });
});

/**
 * A Socket.IO CONNECT that moves a connection to another gateway authenticates it there.
 *
 * At upgrade a Socket.IO connection is bound to one gateway, and that gateway's `authenticate`
 * hook decides who it is. A CONNECT naming another gateway's namespace moves it. A gateway with a
 * hook of its own runs it at the move, with the token and the upgrade request the upgrade had, and
 * the connection's `auth` and `metadata` become what that hook returned; a refusal leaves the
 * connection where it was, as it was. A gateway without a hook never receives a connection another
 * gateway's hook authenticated: that move is refused. Between two gateways without a hook the move
 * carries the connection as it is.
 *
 * Every test boots a real application and speaks Socket.IO by hand over a real WebSocket, so the
 * test decides when each packet goes out — including the ones a standard client would hold back.
 *
 * Gateway metadata is a process-wide map keyed by class, so every test declares its own gateways.
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import type { Guard } from '../http-guards/http-guards';
import type { ExecutionContext, Interceptor } from '../types';

import { OneBunApplication } from '../application/application';
import {
  Module,
  UseGuards,
  UseInterceptors,
} from '../decorators/decorators';
import { clearGlobalServicesRegistry } from '../module/module';
import { makeMockLoggerLayer, useFakeTimers } from '../testing/test-utils';
import { isWsContext } from '../types';

import { BaseWebSocketGateway } from './ws-base-gateway';
import {
  Client,
  MessageData,
  OnConnect,
  OnDisconnect,
  OnMessage,
  WebSocketGateway,
} from './ws-decorators';
import { WsAuthGuard, WsPermissionGuard } from './ws-guards';
import {
  type WsAuthContext,
  type WsAuthResult,
  type WsClientData,
  type WsGuard,
} from './ws.types';

const HOST = '127.0.0.1';
const WAIT_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 5;

/** How long a move waits for the target gateway's hook, as docs/api/websocket.md states it. */
const MOVE_AUTHENTICATE_TIMEOUT_MS = 10_000;

/** What a move the target gateway's hook refused is answered with — what a refused upgrade answers. */
const UNAUTHORIZED = { message: 'Unauthorized' };
/** What a move that could not be made once the hook allowed it is answered with. */
const MOVE_FAILED = { message: 'The connection could not be moved' };
/** How many EVENTs a move holds, as docs/api/websocket.md states it. */
const MAX_HELD_MESSAGES = 100;
/** What a move that held more than that is answered with, and the close reason past refusal. */
const HELD_OVERFLOW = { message: 'Too many messages arrived while the connection was being moved' };
/** What a CONNECT arriving while another of the connection is decided is answered with. */
const CONNECT_PENDING = { message: 'A previous CONNECT of this connection is still being decided' };
/** What a CONNECT arriving while a hook call for the connection has not settled is answered with. */
const AUTHENTICATION_PENDING = { message: 'A previous authentication of this connection has not finished' };
/** What a message a move stopped before its next guard or its handler is answered with. */
const CANCELLED_BY_MOVE = {
  event: 'error',
  data: { code: 'FORBIDDEN', message: 'Message cancelled: the connection moved to another gateway' },
};

/** Every guard decision and handler body, in the order they ran. */
const calls: string[] = [];

/** The gateway instances the running applications built, in construction order. */
const constructed: MoveGateway[] = [];

/**
 * Shared base for the gateways below. Undecorated, so it contributes no handlers: only its
 * constructor, which hands the test the instance, and read-only helpers.
 */
class MoveGateway extends BaseWebSocketGateway {
  constructor() {
    super();
    constructed.push(this);
  }

  /** Whether this gateway serves the connection. */
  holds(clientId: string): boolean {
    return this.getSocket(clientId) !== undefined;
  }

  /** The connection's live client data, as this gateway's handlers and guards see it. */
  live(clientId: string): WsClientData | undefined {
    return this.getSocket(clientId)?.data;
  }

  /** The client record as the storage holds it, unfiltered. */
  async stored(clientId: string): Promise<WsClientData | null> {
    return await this.storage?.getClient(clientId) ?? null;
  }

  /**
   * Make the storage's reads of a client's rooms answer only when released, as a remote storage's
   * do — a move's room cleanup waits on one. Patched on the storage instance itself, which the
   * framework shares with this gateway.
   */
  holdStoredRoomReads(): () => void {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }
    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    const read = storage.getRoomsForClient.bind(storage);
    storage.getRoomsForClient = async (clientId: string): Promise<string[]> => {
      await opened;

      return await read(clientId);
    };

    return () => open();
  }

  /**
   * Make the next write of a client record be applied and then fail, as one whose reply a remote
   * storage lost does. Later writes go through.
   */
  loseNextRecordReply(): void {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }
    const update = storage.updateClient.bind(storage);
    let lost = false;
    storage.updateClient = async (clientId: string, data: Partial<WsClientData>): Promise<void> => {
      await update(clientId, data);
      if (!lost) {
        lost = true;
        throw new Error('connection reset before the reply');
      }
    };
  }

  /**
   * Make the next read of a client's stored rooms fail, as a storage that drops its connection
   * does — a move's room cleanup reads them. Patched on the storage instance itself.
   */
  failNextStoredRoomRead(): void {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }
    const read = storage.getRoomsForClient.bind(storage);
    let failed = false;
    storage.getRoomsForClient = async (clientId: string): Promise<string[]> => {
      if (!failed) {
        failed = true;
        throw new Error('storage unavailable');
      }

      return await read(clientId);
    };
  }

  /**
   * Make the storage's writes of a client record wait until released, as a remote storage's do.
   * Patched on the storage instance itself.
   */
  holdRecordWrites(): { held(): boolean; release(): void } {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }
    const opening = gate();
    let held = false;
    const update = storage.updateClient.bind(storage);
    storage.updateClient = async (clientId: string, data: Partial<WsClientData>): Promise<void> => {
      held = true;
      await opening.opened;
      await update(clientId, data);
    };

    return { held: () => held, release: () => opening.open() };
  }

  /** Where the server lists this client for the room: storage, `client.rooms`, subscription. */
  async membership(clientId: string, room: string): Promise<[boolean, boolean, boolean]> {
    const socket = this.getSocket(clientId);

    return [
      (await this.storage?.getClientsInRoom(room) ?? []).includes(clientId),
      socket?.data.rooms.includes(room) ?? false,
      socket?.isSubscribed(room) ?? false,
    ];
  }
}

function gatewayOf<T extends MoveGateway>(gatewayClass: new () => T): T {
  const found = constructed.find((instance): instance is T => instance instanceof gatewayClass);
  if (!found) {
    throw new Error(`No ${gatewayClass.name} was constructed`);
  }

  return found;
}

/** A guard that asks `inner` and records `<name>:<userId>:<verdict>`. */
function watching(name: string, inner: WsGuard): new () => Guard {
  return class WatchingGuard implements Guard {
    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      if (!isWsContext(ctx)) {
        return false;
      }
      const allowed = await inner.canActivate(ctx);
      calls.push(`${name}:${ctx.getClient().auth?.userId ?? 'anonymous'}:${allowed ? 'allow' : 'deny'}`);

      return allowed;
    }
  };
}

interface Gate {
  /** Resolves when the test opens it. */
  readonly opened: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { opened, open: () => open() };
}

/** A guard that records it was asked, then allows once the gate opens. */
function gatedGuard(name: string, opening: Gate): new () => Guard {
  return class GatedGuard implements Guard {
    async canActivate(): Promise<boolean> {
      calls.push(`${name}:asked`);
      await opening.opened;

      return true;
    }
  };
}

/** A guard that allows after a short real wait, as one asking a cache does. */
function slowGuard(ms: number): new () => Guard {
  return class SlowGuard implements Guard {
    async canActivate(): Promise<boolean> {
      await Bun.sleep(ms);

      return true;
    }
  };
}

interface HookGate {
  hook: (context: WsAuthContext) => Promise<WsAuthResult>;
  /** How many times the hook was called. */
  asked(): number;
  /** Let the pending call answer. */
  answer(result: WsAuthResult): void;
}

/** An `authenticate` hook that answers only when the test lets it, as one waiting on a database does. */
function gatedHook(): HookGate {
  let asked = 0;
  let answer: (result: WsAuthResult) => void = () => undefined;

  return {
    async hook() {
      asked += 1;

      return await new Promise<WsAuthResult>((resolve) => {
        answer = resolve;
      });
    },
    asked: () => asked,
    answer: (result) => answer(result),
  };
}

async function waitUntil<T>(probe: () => T | undefined | Promise<T | undefined>, label: string): Promise<T> {
  const deadline = performance.now() + WAIT_TIMEOUT_MS;

  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (performance.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    // Not `setTimeout`: one test runs with fake timers.
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

const running: OneBunApplication[] = [];
const sockets: WebSocket[] = [];

async function boot(gatewayClasses: Function[]): Promise<OneBunApplication> {
  @Module({ controllers: gatewayClasses })
  class MoveModule {}

  const app = new OneBunApplication(MoveModule, {
    port: 0,
    host: HOST,
    loggerLayer: makeMockLoggerLayer(),
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
    websocket: { socketio: { enabled: true, path: '/socket.io' } },
  });
  running.push(app);
  await app.start();

  return app;
}

interface SocketioPeer {
  id: string;
  /** Raw Engine.IO frames, as received. */
  frames: string[];
  send(frame: string): void;
  close(): void;
  /** The close reason the server sent, once the connection has closed. */
  closedWith(): string | undefined;
}

/**
 * A Socket.IO client spoken by hand: the Engine.IO handshake is awaited and nothing more, so the
 * test decides when — and whether — the CONNECT packet goes out.
 */
async function connectSocketio(
  app: OneBunApplication,
  query = '',
  headers?: Record<string, string>,
): Promise<SocketioPeer> {
  const frames: string[] = [];
  const socket = new WebSocket(
    `ws://${HOST}:${app.getPort()}/socket.io/?EIO=4&transport=websocket${query}`,
    headers ? { headers } : undefined,
  );
  sockets.push(socket);
  socket.addEventListener('message', (message) => frames.push(String(message.data)));
  let closeReason: string | undefined;
  socket.addEventListener('close', (event) => {
    closeReason = event.reason;
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('Socket.IO upgrade failed')));
  });
  const open = await waitUntil(() => frames.find((frame) => frame.startsWith('0')), 'the Engine.IO handshake');

  return {
    id: (JSON.parse(open.slice(1)) as { sid: string }).sid,
    frames,
    send: (frame) => socket.send(frame),
    close: () => socket.close(),
    closedWith: () => closeReason,
  };
}

/** Wait for the answer to a CONNECT for `nsp` that was served. */
async function connected(peer: SocketioPeer, nsp: string): Promise<void> {
  const prefix = `42${nsp === '/' ? '' : `${nsp},`}["connect"`;
  await waitUntil(() => peer.frames.find((frame) => frame.startsWith(prefix)), `the CONNECT answer for ${nsp}`);
}

/** The CONNECT_ERROR payloads answering CONNECTs for `nsp`, in arrival order. */
function refusals(peer: SocketioPeer, nsp: string): unknown[] {
  const prefix = `44${nsp},`;

  return peer.frames
    .filter((frame) => frame.startsWith(prefix))
    .map((frame) => (JSON.parse(frame.slice(prefix.length)) as unknown[])[0]);
}

/** Wait for the first CONNECT_ERROR for `nsp` and return its payload. */
async function refused(peer: SocketioPeer, nsp: string): Promise<unknown> {
  return await waitUntil(() => refusals(peer, nsp)[0], `the CONNECT_ERROR for ${nsp}`);
}

/** The payload of the ack packet answering `ack`. */
async function ackOf(peer: SocketioPeer, ack: number): Promise<unknown[]> {
  const prefix = `43${ack}[`;
  const frame = await waitUntil(() => peer.frames.find((candidate) => candidate.startsWith(prefix)), `ack ${ack}`);

  return JSON.parse(frame.slice(prefix.length - 1)) as unknown[];
}

/** Frames that answer a CONNECT, served or refused. */
const connectAnswers = (peer: SocketioPeer): string[] =>
  peer.frames.filter((frame) => frame.startsWith('44') || frame.includes('["connect"'));

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  for (const app of running.splice(0)) {
    await app.stop();
  }
  clearGlobalServicesRegistry();
  calls.length = 0;
  constructed.length = 0;
});

describe('a Socket.IO CONNECT that moves a connection to a gateway with its own authenticate hook', () => {
  it('runs that hook with the upgrade\'s token and request, and the connection becomes who it says', async () => {
    const seen: { gateway: string; [input: string]: unknown }[] = [];
    const record = (gateway: string, { token, request }: WsAuthContext): void => {
      seen.push({
        gateway,
        token,
        url: request.url,
        tenant: new URL(request.url).searchParams.get('tenant'),
        cookie: request.headers.get('cookie'),
        authorization: request.headers.get('authorization'),
      });
    };

    @WebSocketGateway({
      path: '/ws',
      namespace: 'main',
      authenticate(context) {
        record('main', context);

        return { userId: 'main-user', permissions: ['main', 'chat:write'], metadata: { via: 'main', plan: 'gold' } };
      },
    })
    class MainGateway extends MoveGateway {}

    @WebSocketGateway({
      path: '/ws',
      namespace: 'chat',
      authenticate(context) {
        record('chat', context);

        return context.token === 'good'
          ? { userId: 'chat-user', permissions: ['chat:write'], metadata: { via: 'chat' } }
          : false;
      },
    })
    class ChatGateway extends MoveGateway {
      @OnConnect()
      onConnect(@Client() client: WsClientData) {
        calls.push(`chat:connect:${client.auth?.userId}`);
      }

      @UseGuards(watching('chat-auth', new WsAuthGuard()), watching('chat-write', new WsPermissionGuard('chat:write')))
      @OnMessage('say')
      say(@Client() client: WsClientData) {
        return { event: 'said', data: { by: client.auth?.userId } };
      }
    }

    const app = await boot([MainGateway, ChatGateway]);
    const main = gatewayOf(MainGateway);
    const chat = gatewayOf(ChatGateway);

    // No `?namespace=`: the connection is bound to the first gateway, whose hook runs at upgrade.
    const peer = await connectSocketio(app, '&tenant=acme', { authorization: 'Bearer good', cookie: 'sid=abc' });
    expect(main.live(peer.id)?.auth?.userId).toBe('main-user');

    peer.send('40/chat,');
    await connected(peer, '/chat');

    expect(chat.holds(peer.id)).toBe(true);
    expect(main.holds(peer.id)).toBe(false);

    // The chat hook was given exactly what the main hook was given at upgrade.
    expect(seen).toHaveLength(2);
    const [atUpgrade, atMove] = seen;
    expect({ ...atMove, gateway: 'main' }).toEqual(atUpgrade);
    expect(atMove).toMatchObject({
      token: 'good',
      tenant: 'acme',
      cookie: 'sid=abc',
      authorization: 'Bearer good',
    });

    // Who the connection is now: the chat hook's answer and nothing of the main hook's.
    const identity = {
      auth: {
        authenticated: true,
        token: 'good',
        userId: 'chat-user',
        permissions: ['chat:write'],
      },
      metadata: { via: 'chat' },
    };
    const live = chat.live(peer.id);
    expect({ auth: live?.auth, metadata: live?.metadata }).toEqual(identity);
    const stored = await chat.stored(peer.id);
    expect({ auth: stored?.auth, metadata: stored?.metadata }).toEqual(identity);
    expect(stored?.gatewayKey).toBe('/ws:chat');

    peer.send('421["say",{}]');
    expect(await ackOf(peer, 1)).toEqual([{ event: 'said', data: { by: 'chat-user' } }]);
    expect(calls).toEqual(['chat:connect:chat-user', 'chat-auth:chat-user:allow', 'chat-write:chat-user:allow']);
  });

  it('refuses the move when that hook refuses, and leaves the connection on its gateway as it was', async () => {
    @WebSocketGateway({
      path: '/ws',
      namespace: 'public',
      authenticate: ({ token }) => (token ? { userId: `public-${token}`, permissions: ['admin'], metadata: { via: 'public' } } : null),
    })
    class PublicGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'me', data: { gateway: 'public', userId: client.auth?.userId } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => false })
    class AdminGateway extends MoveGateway {
      @OnConnect()
      onConnect() {
        calls.push('admin:connect');
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, '&namespace=public&token=t1');

    peer.send('42["join","lobby"]');
    await waitUntil(
      async () => ((await publicGateway.membership(peer.id, 'lobby')).every(Boolean) ? true : undefined),
      'the join on the public gateway',
    );
    const before = structuredClone({
      auth: publicGateway.live(peer.id)?.auth,
      metadata: publicGateway.live(peer.id)?.metadata,
    });
    expect(before.auth?.userId).toBe('public-t1');

    peer.send('40/admin,');
    expect(await refused(peer, '/admin')).toEqual(UNAUTHORIZED);

    // Still on the public gateway, as the same client, in the same room.
    expect(publicGateway.holds(peer.id)).toBe(true);
    expect(admin.holds(peer.id)).toBe(false);
    const live = publicGateway.live(peer.id);
    expect({ auth: live?.auth, metadata: live?.metadata }).toEqual(before);
    const stored = await publicGateway.stored(peer.id);
    expect({ auth: stored?.auth, metadata: stored?.metadata }).toEqual(before);
    expect(stored?.gatewayKey).toBe('/ws:public');
    expect(await publicGateway.membership(peer.id, 'lobby')).toEqual([true, true, true]);

    publicGateway.emitToRoom('lobby', 'news', {});
    await waitUntil(() => peer.frames.find((frame) => frame.startsWith('42["news"')), 'the lobby broadcast');
    peer.send('421["whoami",{}]');
    expect(await ackOf(peer, 1)).toEqual([{ event: 'me', data: { gateway: 'public', userId: 'public-t1' } }]);

    // The refusal is not the end of the connection: it can still name a namespace it may reach.
    peer.send('40/public,');
    await connected(peer, '/public');
    expect(calls).toEqual([]);
  });

  it('treats a hook that throws as a refusal', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {}

    @WebSocketGateway({
      path: '/ws',
      namespace: 'admin',
      authenticate() {
        throw new Error('directory unavailable');
      },
    })
    class AdminGateway extends MoveGateway {}

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=public&token=t1');

    peer.send('40/admin,');

    expect(await refused(peer, '/admin')).toEqual(UNAUTHORIZED);
    expect(gatewayOf(PublicGateway).holds(peer.id)).toBe(true);
    expect(gatewayOf(AdminGateway).holds(peer.id)).toBe(false);
  });

  it('keeps the connection on its gateway while the hook decides, and lets nothing reach the target meanwhile', async () => {
    const hookGate = gatedHook();

    @WebSocketGateway({
      path: '/ws',
      namespace: 'public',
      authenticate: ({ token }) => (token ? { userId: 'public-user', permissions: ['admin'] } : null),
    })
    class PublicGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        calls.push('public:whoami');

        return { event: 'me', data: { gateway: 'public', userId: client.auth?.userId } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: hookGate.hook })
    class AdminGateway extends MoveGateway {
      @OnConnect()
      onConnect(@Client() client: WsClientData) {
        calls.push(`admin:connect:${client.auth?.userId}`);
      }

      @UseGuards(watching('admin-permission', new WsPermissionGuard('admin')))
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        calls.push('admin:whoami');

        return { event: 'me', data: { gateway: 'admin', userId: client.auth?.userId } };
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, '&namespace=public&token=t1');

    peer.send('40/admin,');
    await waitUntil(() => (hookGate.asked() === 1 ? true : undefined), 'the admin hook');

    // Events in the window, addressed to the target namespace and to the default one: the
    // connection is still the public gateway's, so the public gateway serves both.
    peer.send('42/admin,1["whoami",{}]');
    peer.send('422["whoami",{}]');
    // A second CONNECT while the first is decided is refused, without a second hook call.
    peer.send('40/admin,');
    peer.send('40/public,');
    peer.send('423["whoami",{}]');

    const fromPublic = [{ event: 'me', data: { gateway: 'public', userId: 'public-user' } }];
    expect(await ackOf(peer, 1)).toEqual(fromPublic);
    expect(await ackOf(peer, 2)).toEqual(fromPublic);
    expect(await ackOf(peer, 3)).toEqual(fromPublic);
    expect(hookGate.asked()).toBe(1);
    expect(refusals(peer, '/admin')).toEqual([CONNECT_PENDING]);
    expect(refusals(peer, '/public')).toEqual([CONNECT_PENDING]);
    expect(connectAnswers(peer)).toHaveLength(2);
    expect(admin.holds(peer.id)).toBe(false);
    expect(publicGateway.holds(peer.id)).toBe(true);
    expect(calls).toEqual(['public:whoami', 'public:whoami', 'public:whoami']);

    hookGate.answer({ userId: 'admin-user', permissions: ['admin'] });
    await connected(peer, '/admin');
    peer.send('424["whoami",{}]');

    expect(await ackOf(peer, 4)).toEqual([{ event: 'me', data: { gateway: 'admin', userId: 'admin-user' } }]);
    expect(connectAnswers(peer)).toHaveLength(3);
    expect(calls.slice(3)).toEqual(['admin:connect:admin-user', 'admin-permission:admin-user:allow', 'admin:whoami']);
  });

  it('refuses the move when the hook has not answered within the bound, and asks it no more until it settles', async () => {
    let asked = 0;

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami() {
        return { event: 'me', data: { gateway: 'public' } };
      }
    }

    @WebSocketGateway({
      path: '/ws',
      namespace: 'admin',
      async authenticate() {
        asked += 1;
        // Never settles.
        await new Promise<never>(() => undefined);

        return false;
      },
    })
    class AdminGateway extends MoveGateway {}

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=public');

    const timers = useFakeTimers();
    try {
      peer.send('40/admin,');
      await waitUntil(() => (asked === 1 ? true : undefined), 'the admin hook');

      peer.send('421["whoami",{}]');
      expect(await ackOf(peer, 1)).toEqual([{ event: 'me', data: { gateway: 'public' } }]);

      timers.advanceTime(MOVE_AUTHENTICATE_TIMEOUT_MS - 1);
      peer.send('422["whoami",{}]');
      await ackOf(peer, 2);
      expect(refusals(peer, '/admin')).toEqual([]);

      timers.advanceTime(1);
      expect(await refused(peer, '/admin')).toEqual(UNAUTHORIZED);
    } finally {
      timers.restore();
    }

    expect(gatewayOf(PublicGateway).holds(peer.id)).toBe(true);
    expect(gatewayOf(AdminGateway).holds(peer.id)).toBe(false);

    // The call past its bound has not settled: each further CONNECT to the gateway is refused
    // without calling its hook again.
    peer.send('40/admin,');
    peer.send('40/admin,');
    await waitUntil(() => (refusals(peer, '/admin').length === 3 ? true : undefined), 'the later refusals');
    expect(refusals(peer, '/admin').slice(1)).toEqual([AUTHENTICATION_PENDING, AUTHENTICATION_PENDING]);
    expect(asked).toBe(1);

    // Not wedged: a CONNECT that asks no hook is served.
    peer.send('40/public,');
    await connected(peer, '/public');
    peer.send('423["whoami",{}]');
    expect(await ackOf(peer, 3)).toEqual([{ event: 'me', data: { gateway: 'public' } }]);
  });

  it('drops the move when the connection closes while the hook decides', async () => {
    const hookGate = gatedHook();

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: hookGate.hook })
    class AdminGateway extends MoveGateway {
      @OnConnect()
      onConnect() {
        calls.push('admin:connect');
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, '&namespace=public');

    peer.send('40/admin,');
    await waitUntil(() => (hookGate.asked() === 1 ? true : undefined), 'the admin hook');
    peer.close();
    await waitUntil(async () => ((await publicGateway.stored(peer.id)) === null ? true : undefined), 'the close');

    hookGate.answer({ userId: 'admin-user' });
    // The next macrotask: the hook's answer has been handled by then.
    await Bun.sleep(POLL_INTERVAL_MS);

    expect(admin.holds(peer.id)).toBe(false);
    expect(await admin.stored(peer.id)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('a Socket.IO CONNECT that moves a connection to a gateway without an authenticate hook', () => {
  it('is refused when a hook authenticated the connection, so its permissions never reach that gateway', async () => {
    @WebSocketGateway({
      path: '/ws',
      namespace: 'public',
      authenticate: ({ token }) => (token === 'good' ? { userId: 'u1', permissions: ['admin'] } : null),
    })
    class PublicGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'me', data: { gateway: 'public', userId: client.auth?.userId } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends MoveGateway {
      @OnConnect()
      onConnect() {
        calls.push('admin:connect');
      }

      @UseGuards(watching('admin-permission', new WsPermissionGuard('admin')))
      @OnMessage('secret')
      secret() {
        calls.push('admin:secret');

        return { event: 'secret', data: {} };
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);

    // Straight to the admin gateway, the same token carries no permission: it has no hook.
    const direct = await connectSocketio(app, '&namespace=admin&token=good');
    direct.send('40/admin,');
    await connected(direct, '/admin');
    direct.send('421["secret",{}]');
    expect(await ackOf(direct, 1)).toEqual([
      { event: 'error', data: { code: 'FORBIDDEN', event: 'secret', message: 'Guard denied this message' } },
    ]);
    expect(calls).toEqual(['admin:connect', 'admin-permission:anonymous:deny']);
    calls.length = 0;

    // Through the public gateway, whose hook granted `admin`, it does not get there at all.
    const peer = await connectSocketio(app, '&namespace=public&token=good');
    peer.send('40/admin,');

    expect(await refused(peer, '/admin')).toEqual({
      message: 'Namespace "/admin" has no authenticate hook, and this connection was authenticated by '
        + 'another gateway\'s; connect with ?namespace=admin',
    });
    expect(admin.holds(peer.id)).toBe(false);
    expect(publicGateway.holds(peer.id)).toBe(true);
    expect((await publicGateway.stored(peer.id))?.gatewayKey).toBe('/ws:public');

    peer.send('421["whoami",{}]');
    expect(await ackOf(peer, 1)).toEqual([{ event: 'me', data: { gateway: 'public', userId: 'u1' } }]);
    peer.send('40/public,');
    await connected(peer, '/public');
    expect(calls).toEqual([]);
  });

  it('carries the connection as it is when neither gateway has a hook', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends MoveGateway {
      @OnConnect()
      onConnect(@Client() client: WsClientData) {
        calls.push(`admin:connect:${client.auth?.token}`);
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, '&namespace=public&token=t1');

    peer.send('40/admin,');
    await connected(peer, '/admin');

    expect(admin.holds(peer.id)).toBe(true);
    expect(gatewayOf(PublicGateway).holds(peer.id)).toBe(false);
    const identity = { auth: { authenticated: false, token: 't1' }, metadata: {} };
    const live = admin.live(peer.id);
    expect({ auth: live?.auth, metadata: live?.metadata }).toEqual(identity);
    const stored = await admin.stored(peer.id);
    expect({ auth: stored?.auth, metadata: stored?.metadata }).toEqual(identity);
    expect(stored?.gatewayKey).toBe('/ws:admin');
    expect(calls).toEqual(['admin:connect:t1']);
  });
});

describe('a Socket.IO move to a gateway with a hook swaps the identity only once the current gateway is done', () => {
  it('lets no guard of the gateway being left read the identity the new gateway\'s hook grants', async () => {
    // The reviewer's spray: a hook-less admin gateway whose permission guard comes after an
    // async one, and a public gateway whose hook grants `admin`.
    @WebSocketGateway({
      path: '/ws',
      namespace: 'public',
      async authenticate({ token }) {
        await Bun.sleep(30);

        return token === 'good' ? { userId: 'u-pub', permissions: ['admin'] } : null;
      },
    })
    class PublicGateway extends MoveGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends MoveGateway {
      @UseGuards(slowGuard(1), watching('admin-permission', new WsPermissionGuard('admin')))
      @OnMessage('secret')
      secret() {
        calls.push('admin:secret');

        return { event: 'secret', data: 'SECRET' };
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=admin&token=good');

    peer.send('40/public,');
    for (let ack = 0; ack < 40; ack += 1) {
      peer.send(`42${ack}["secret",{}]`);
      await Bun.sleep(1);
    }
    await connected(peer, '/public');
    // A marker after everything: whatever the spray was answered with has arrived before it.
    gatewayOf(PublicGateway).emit(peer.id, 'marker', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"marker"')), 'the marker');

    expect(peer.frames.filter((frame) => frame.includes('SECRET'))).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call !== 'admin-permission:anonymous:deny')).toEqual([]);
  });

  it('waits for a handler of the gateway being left, and gives the new gateway only its hook\'s identity', async () => {
    const profileGate = gate();
    const lateWrite = gate();

    @WebSocketGateway({
      path: '/ws',
      namespace: 'tenantA',
      authenticate: ({ token }) => (token ? { userId: `a-${token}`, permissions: [] } : null),
    })
    class TenantA extends MoveGateway {
      @UseGuards(slowGuard(20), watching('a-admin', new WsPermissionGuard('admin')))
      @OnMessage('wipe')
      wipe() {
        calls.push('a:wipe');

        return { event: 'wiped', data: {} };
      }

      @OnMessage('profile')
      async profile(@Client() client: WsClientData, @MessageData() data: Record<string, unknown>) {
        const metadata = client.metadata;
        // A write through a reference kept past the handler's end.
        void lateWrite.opened.then(() => Object.assign(metadata, { late: true }));
        await profileGate.opened;
        Object.assign(client.metadata, data);
        calls.push('a:profile-written');
      }
    }

    @WebSocketGateway({
      path: '/ws',
      namespace: 'tenantB',
      authenticate: ({ token }) => (token
        ? { userId: `b-${token}`, permissions: ['admin'], metadata: { tenant: 'B', role: 'viewer' } }
        : false),
    })
    class TenantB extends MoveGateway {
      @OnMessage('meta')
      meta(@Client() client: WsClientData) {
        return { event: 'meta', data: client.metadata };
      }
    }

    const app = await boot([TenantA, TenantB]);
    const tenantA = gatewayOf(TenantA);
    const tenantB = gatewayOf(TenantB);
    const peer = await connectSocketio(app, '&namespace=tenantA&token=t1');

    peer.send('421["wipe",{}]');
    peer.send('42["profile",{"tenant":"evil","role":"owner"}]');
    peer.send('40/tenantB,');
    expect(await ackOf(peer, 1)).toEqual([
      { event: 'error', data: { code: 'FORBIDDEN', event: 'wipe', message: 'Guard denied this message' } },
    ]);

    // The hook has allowed the move, and it waits for `profile`, still running on tenantA.
    await Bun.sleep(20);
    expect(connectAnswers(peer)).toEqual([]);
    expect(tenantA.holds(peer.id)).toBe(true);

    profileGate.open();
    await connected(peer, '/tenantB');
    lateWrite.open();
    await Bun.sleep(POLL_INTERVAL_MS);

    const identity = { tenant: 'B', role: 'viewer' };
    expect(tenantB.live(peer.id)?.metadata).toEqual(identity);
    expect((await tenantB.stored(peer.id))?.metadata).toEqual(identity);
    peer.send('422["meta",{}]');
    expect(await ackOf(peer, 2)).toEqual([{ event: 'meta', data: identity }]);
    expect(calls).toEqual(['a-admin:a-t1:deny', 'a:profile-written']);
  });

  it('holds what the client sends while the move waits, and serves it on the new gateway', async () => {
    const slow = gate();

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @OnMessage('slow')
      async slow() {
        await slow.opened;
        calls.push('public:slow');
      }

      @OnMessage('whoami')
      whoami() {
        calls.push('public:whoami');

        return { event: 'me', data: { gateway: 'public' } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'admin-user' }) })
    class AdminGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        calls.push('admin:whoami');

        return { event: 'me', data: { gateway: 'admin', userId: client.auth?.userId } };
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=public');

    peer.send('42["slow",{}]');
    peer.send('40/admin,');
    await Bun.sleep(POLL_INTERVAL_MS);
    // Neither gateway's yet: held.
    peer.send('421["whoami",{}]');
    peer.send('42/admin,2["whoami",{}]');
    await Bun.sleep(POLL_INTERVAL_MS);
    expect(peer.frames.filter((frame) => frame.startsWith('43'))).toEqual([]);
    expect(connectAnswers(peer)).toEqual([]);

    slow.open();
    await connected(peer, '/admin');
    const fromAdmin = [{ event: 'me', data: { gateway: 'admin', userId: 'admin-user' } }];
    expect(await ackOf(peer, 1)).toEqual(fromAdmin);
    expect(await ackOf(peer, 2)).toEqual(fromAdmin);
    expect(calls).toEqual(['public:slow', 'admin:whoami', 'admin:whoami']);
  });

  it('refuses the move when a handler of the gateway being left does not settle within the bound', async () => {
    const never = gate();

    @WebSocketGateway({
      path: '/ws',
      namespace: 'public',
      authenticate: ({ token }) => (token ? { userId: 'public-user', metadata: { via: 'public' } } : null),
    })
    class PublicGateway extends MoveGateway {
      @OnMessage('stall')
      async stall() {
        await never.opened;
      }

      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'me', data: { gateway: 'public', userId: client.auth?.userId } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'admin-user' }) })
    class AdminGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami() {
        calls.push('admin:whoami');

        return { event: 'me', data: { gateway: 'admin' } };
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const peer = await connectSocketio(app, '&namespace=public&token=t1');
    peer.send('42["join","lobby"]');
    await waitUntil(
      async () => ((await publicGateway.membership(peer.id, 'lobby')).every(Boolean) ? true : undefined),
      'the join',
    );
    peer.send('42["stall",{}]');

    const timers = useFakeTimers();
    try {
      peer.send('40/admin,');
      await Bun.sleep(POLL_INTERVAL_MS);
      peer.send('421["whoami",{}]');
      await Bun.sleep(POLL_INTERVAL_MS);
      expect(peer.frames.filter((frame) => frame.startsWith('43'))).toEqual([]);

      timers.advanceTime(MOVE_AUTHENTICATE_TIMEOUT_MS);
      expect(await refused(peer, '/admin')).toEqual(MOVE_FAILED);
    } finally {
      timers.restore();
    }

    // Still on the public gateway, as it was; what it held is served there.
    expect(await ackOf(peer, 1)).toEqual([{ event: 'me', data: { gateway: 'public', userId: 'public-user' } }]);
    expect(publicGateway.holds(peer.id)).toBe(true);
    expect(gatewayOf(AdminGateway).holds(peer.id)).toBe(false);
    const live = publicGateway.live(peer.id);
    expect(live?.auth?.userId).toBe('public-user');
    expect(live?.metadata).toEqual({ via: 'public' });
    expect((await publicGateway.stored(peer.id))?.gatewayKey).toBe('/ws:public');
    expect(await publicGateway.membership(peer.id, 'lobby')).toEqual([true, true, true]);
    expect(calls).toEqual([]);
    never.open();
  });

  it('puts the client record back when its write fails after it was applied', async () => {
    @WebSocketGateway({
      path: '/ws',
      namespace: 'public',
      authenticate: ({ token }) => (token ? { userId: 'public-user', metadata: { via: 'public' } } : null),
    })
    class PublicGateway extends MoveGateway {
      @OnMessage('whoami')
      whoami(@Client() client: WsClientData) {
        return { event: 'me', data: { gateway: 'public', userId: client.auth?.userId } };
      }
    }

    @WebSocketGateway({
      path: '/ws',
      namespace: 'admin',
      authenticate: () => ({ userId: 'admin-user', permissions: ['admin'], metadata: { via: 'admin' } }),
    })
    class AdminGateway extends MoveGateway {}

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const peer = await connectSocketio(app, '&namespace=public&token=t1');
    const before = await publicGateway.stored(peer.id);

    publicGateway.loseNextRecordReply();
    peer.send('40/admin,');

    expect(await refused(peer, '/admin')).toEqual(MOVE_FAILED);
    expect(publicGateway.holds(peer.id)).toBe(true);
    expect(gatewayOf(AdminGateway).holds(peer.id)).toBe(false);
    expect(await publicGateway.stored(peer.id)).toEqual(before);
    peer.send('421["whoami",{}]');
    expect(await ackOf(peer, 1)).toEqual([{ event: 'me', data: { gateway: 'public', userId: 'public-user' } }]);
  });
});

describe('a message the connection\'s gateway was serving when a Socket.IO move landed', () => {
  it('runs no further guard and no handler body of it, and answers it as cancelled', async () => {
    const between = gate();
    const last = gate();

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @UseGuards(gatedGuard('between-gate', between), watching('between-next', new WsAuthGuard()))
      @OnMessage('between')
      onBetween() {
        calls.push('public:between');

        return { event: 'between', data: {} };
      }

      @UseGuards(gatedGuard('last-gate', last))
      @OnMessage('last')
      onLast() {
        calls.push('public:last');

        return { event: 'last', data: {} };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends MoveGateway {}

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=public');

    peer.send('421["between",{}]');
    peer.send('422["last",{}]');
    await waitUntil(() => (calls.length === 2 ? true : undefined), 'both gated guards');
    // Neither gateway has a hook: the move does not wait for the messages.
    peer.send('40/admin,');
    await connected(peer, '/admin');

    between.open();
    last.open();

    expect(await ackOf(peer, 1)).toEqual([{ ...CANCELLED_BY_MOVE, data: { ...CANCELLED_BY_MOVE.data, event: 'between' } }]);
    expect(await ackOf(peer, 2)).toEqual([{ ...CANCELLED_BY_MOVE, data: { ...CANCELLED_BY_MOVE.data, event: 'last' } }]);
    expect(calls).toEqual(['between-gate:asked', 'last-gate:asked']);
  });

  it('runs no @OnConnect of the new gateway for a connection that closed while the move cleared its rooms', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends MoveGateway {
      @OnConnect()
      onConnect() {
        calls.push('admin:connect');
      }

      @OnDisconnect()
      onDisconnect() {
        calls.push('admin:disconnect');
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, '&namespace=public');
    const releaseReads = admin.holdStoredRoomReads();

    peer.send('40/admin,');
    await waitUntil(() => (admin.holds(peer.id) ? true : undefined), 'the move');
    peer.close();
    await waitUntil(() => (calls.includes('admin:disconnect') ? true : undefined), 'the close');
    releaseReads();
    await Bun.sleep(POLL_INTERVAL_MS);

    expect(calls).toEqual(['admin:disconnect']);
  });
});

describe('a message of a connection that closes while it is being served', () => {
  for (const protocol of ['native', 'socketio'] as const) {
    it(`runs its handler body after an async guard or interceptor, with two gateways (${protocol})`, async () => {
      const guardGate = gate();
      const interceptorGate = gate();

      class GatedInterceptor implements Interceptor {
        async intercept(_context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
          calls.push('interceptor:asked');
          await interceptorGate.opened;

          return await next();
        }
      }

      @WebSocketGateway({ path: '/ws', namespace: 'main' })
      class MainGateway extends MoveGateway {
        @UseGuards(gatedGuard('guard', guardGate))
        @OnMessage('save')
        save() {
          calls.push('save:body');
        }

        @UseInterceptors(GatedInterceptor)
        @OnMessage('log')
        log() {
          calls.push('log:body');
        }

        @OnDisconnect()
        onDisconnect() {
          calls.push('main:disconnect');
        }
      }

      // A second gateway: the connection is never moved, it just closes.
      @WebSocketGateway({ path: '/other', namespace: 'other' })
      class OtherGateway extends MoveGateway {}

      const app = await boot([MainGateway, OtherGateway]);
      let close: () => void;
      if (protocol === 'native') {
        const socket = new WebSocket(`ws://${HOST}:${app.getPort()}/ws?namespace=main`);
        sockets.push(socket);
        await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
        await waitUntil(() => (gatewayOf(MainGateway).clients.size === 1 ? true : undefined), 'the connection');
        socket.send(JSON.stringify({ event: 'save', data: {} }));
        socket.send(JSON.stringify({ event: 'log', data: {} }));
        close = () => socket.close();
      } else {
        const peer = await connectSocketio(app, '&namespace=main');
        peer.send('40/main,');
        await connected(peer, '/main');
        peer.send('42["save",{}]');
        peer.send('42["log",{}]');
        close = () => peer.close();
      }

      await waitUntil(() => (calls.length === 2 ? true : undefined), 'the guard and the interceptor');
      close();
      await waitUntil(() => (calls.includes('main:disconnect') ? true : undefined), 'the close');
      guardGate.open();
      interceptorGate.open();
      await waitUntil(() => (calls.length === 5 ? true : undefined), 'both handler bodies');

      expect([...calls].sort()).toEqual(['guard:asked', 'interceptor:asked', 'log:body', 'main:disconnect', 'save:body']);
    });
  }
});

describe('what a move holds', () => {
  it('serves what it held on the new gateway in the order it arrived, ahead of what comes after', async () => {
    const slow = gate();

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @OnMessage('slow')
      async slow() {
        await slow.opened;
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'admin-user' }) })
    class AdminGateway extends MoveGateway {
      @OnMessage('echo')
      echo(@MessageData('n') n: number) {
        calls.push(`admin:${n}`);

        return { event: 'echo', data: { n } };
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=public');
    const held = 40;

    peer.send('42["slow",{}]');
    peer.send('40/admin,');
    await Bun.sleep(POLL_INTERVAL_MS);
    for (let n = 1; n <= held; n += 1) {
      peer.send(`42${n}["echo",{"n":${n}}]`);
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    slow.open();
    await connected(peer, '/admin');
    peer.send(`42${held + 1}["echo",{"n":${held + 1}}]`);
    await ackOf(peer, held + 1);

    expect(calls).toEqual(Array.from({ length: held + 1 }, (_, index) => `admin:${index + 1}`));
  });

  it('refuses the move once it holds more than its bound, and serves all of it on the gateway it stays on', async () => {
    const slow = gate();

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @OnMessage('slow')
      async slow() {
        await slow.opened;
      }

      @OnMessage('echo')
      echo(@MessageData('n') n: number) {
        calls.push(`public:${n}`);

        return { event: 'echo', data: { n } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'admin-user' }) })
    class AdminGateway extends MoveGateway {
      @OnMessage('echo')
      echo() {
        calls.push('admin:echo');
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const peer = await connectSocketio(app, '&namespace=public');
    // Past the bound, and on after the refusal: everything is served by the public gateway, in order.
    const sent = MAX_HELD_MESSAGES + 50;

    peer.send('42["slow",{}]');
    peer.send('40/admin,');
    await Bun.sleep(POLL_INTERVAL_MS);
    for (let n = 1; n <= sent; n += 1) {
      peer.send(`42${n}["echo",{"n":${n}}]`);
    }

    expect(await refused(peer, '/admin')).toEqual(HELD_OVERFLOW);
    await ackOf(peer, sent);
    expect(calls).toEqual(Array.from({ length: sent }, (_, index) => `public:${index + 1}`));
    expect(gatewayOf(PublicGateway).holds(peer.id)).toBe(true);
    expect(gatewayOf(AdminGateway).holds(peer.id)).toBe(false);
    slow.open();
  });

  it('closes the connection that floods it once the move can no longer be refused', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @OnMessage('echo')
      echo() {
        calls.push('public:echo');
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'admin-user' }) })
    class AdminGateway extends MoveGateway {
      @OnMessage('echo')
      echo() {
        calls.push('admin:echo');
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const peer = await connectSocketio(app, '&namespace=public');
    // The record write of the move answers late: the move is past waiting on the gateway.
    const writes = publicGateway.holdRecordWrites();

    peer.send('40/admin,');
    await waitUntil(() => (writes.held() ? true : undefined), 'the record write');
    for (let n = 1; n <= MAX_HELD_MESSAGES + 1; n += 1) {
      peer.send(`42["echo",{"n":${n}}]`);
    }
    await waitUntil(() => peer.closedWith(), 'the close');
    writes.release();
    await waitUntil(async () => ((await publicGateway.stored(peer.id)) === null ? true : undefined), 'the record removal');

    expect(peer.closedWith()).toBe(HELD_OVERFLOW.message);
    expect(calls).toEqual([]);
    expect(gatewayOf(AdminGateway).holds(peer.id)).toBe(false);
  });

  it('answers the CONNECT and closes the connection when the rooms it leaves cannot be removed', async () => {
    const slow = gate();

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends MoveGateway {
      @OnMessage('slow')
      async slow() {
        await slow.opened;
      }

      @OnMessage('echo')
      echo() {
        calls.push('public:echo');
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'admin-user' }) })
    class AdminGateway extends MoveGateway {
      @OnMessage('echo')
      echo() {
        calls.push('admin:echo');
      }
    }

    const app = await boot([PublicGateway, AdminGateway]);
    const publicGateway = gatewayOf(PublicGateway);
    const peer = await connectSocketio(app, '&namespace=public');
    peer.send('42["join","lobby"]');
    await waitUntil(
      async () => ((await publicGateway.membership(peer.id, 'lobby')).every(Boolean) ? true : undefined),
      'the join',
    );
    publicGateway.failNextStoredRoomRead();

    peer.send('42["slow",{}]');
    peer.send('40/admin,');
    await Bun.sleep(POLL_INTERVAL_MS);
    peer.send('421["echo",{}]');
    await Bun.sleep(POLL_INTERVAL_MS);
    slow.open();

    expect(await refused(peer, '/admin')).toEqual(MOVE_FAILED);
    await waitUntil(() => peer.closedWith(), 'the close');
    await waitUntil(async () => ((await publicGateway.stored(peer.id)) === null ? true : undefined), 'the record removal');

    expect(peer.closedWith()).toBe(MOVE_FAILED.message);
    expect(connectAnswers(peer)).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});

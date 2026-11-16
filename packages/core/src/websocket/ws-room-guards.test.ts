/**
 * A guard on `@OnJoinRoom` decides whether the client joins the room; a guard on `@OnLeaveRoom`
 * never keeps a client in one.
 *
 * Every test boots a real application and talks to it over a real WebSocket, then reads the
 * three places a membership lives on the server: the room storage, the socket's `client.rooms`
 * and its Bun pub/sub subscription. A broadcast through both fan-out paths — `emitToRoom()`,
 * which walks the storage, and a raw `publish()`, which follows the subscription — shows that a
 * client kept out of a room hears nothing from it.
 *
 * "Heard nothing" is decided without a sleep: after the broadcast has reached a member, the
 * gateway sends the outsider a direct `marker` frame. Frames on one socket arrive in order, so
 * once the marker is in, any broadcast addressed to that socket would already be there too.
 *
 * Gateway metadata is a process-wide map keyed by class, so every test declares its own gateway.
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
import { BaseService, Service } from '../module/service';
import { makeMockLoggerLayer } from '../testing/test-utils';
import { isWsContext } from '../types';

import { BaseWebSocketGateway } from './ws-base-gateway';
import {
  Client,
  MessageData,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  RoomName,
  WebSocketGateway,
} from './ws-decorators';
import { WsHandlerType, type WsClientData } from './ws.types';

const HOST = '127.0.0.1';
const ROOM = 'room:1';
const SECRET = 'admin:secret';
const WAIT_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 5;

/** The frame a denied `@OnMessage` answers with, as the client receives it. */
const FORBIDDEN_DATA = { code: 'FORBIDDEN', message: 'Guard denied this message' };
/** What a join cancelled by a leave of the same room is answered with. */
const CANCELLED_BY_LEAVE = { code: 'FORBIDDEN', event: 'join', message: 'Room join cancelled by a leave of the same room' };
/** What a join cancelled by a Socket.IO move is answered with. */
const CANCELLED_BY_MOVE = {
  code: 'FORBIDDEN',
  event: 'join',
  message: 'Room join cancelled: the connection moved to another gateway',
};

interface Frame {
  event: string;
  data?: unknown;
  ack?: number;
}

interface Membership {
  inStorage: boolean;
  inClientRooms: boolean;
  subscribed: boolean;
}

const OUT: Membership = { inStorage: false, inClientRooms: false, subscribed: false };
const IN: Membership = { inStorage: true, inClientRooms: true, subscribed: true };

/**
 * Every guard decision and handler body, in the order they ran, with whether the client was
 * already listed in the room at that moment: `<name>:<in|out>`.
 */
const calls: string[] = [];

function inRoom(client: WsClientData, room: string): string {
  return client.rooms.includes(room) ? 'in' : 'out';
}

function recordingGuard(name: string, verdict: boolean): new () => Guard {
  return class RecordingGuard implements Guard {
    canActivate(ctx: ExecutionContext): boolean {
      calls.push(`${name}:${isWsContext(ctx) ? inRoom(ctx.getClient(), ROOM) : 'not-ws'}`);

      return verdict;
    }
  };
}

function throwingGuard(name: string): new () => Guard {
  return class ThrowingGuard implements Guard {
    canActivate(): boolean {
      calls.push(`${name}:throw`);
      throw new Error('guard failed');
    }
  };
}

/** A room only the server fills. */
const USER_ROOM = 'user:42';

/**
 * Every way a client can name `USER_ROOM` in a join, as `[event, data]`. The room is the string
 * data, else a truthy `data.room`, else the `join:` suffix — so the data alone does not say which
 * room is joined, and the last one names it in the data while the event names another.
 */
const USER_ROOM_SPELLINGS: [string, unknown][] = [
  ['join', USER_ROOM],
  ['join', { room: USER_ROOM }],
  [`join:${USER_ROOM}`, undefined],
  [`join:${USER_ROOM}`, { room: '' }],
  [`join:${USER_ROOM}`, { room: null }],
  [`join:${USER_ROOM}`, 5],
  [`join:${USER_ROOM}`, []],
  [`join:${USER_ROOM}`, {}],
  ['join:lobby', USER_ROOM],
];

/** Keeps clients out of `user:*` rooms, deciding by the room the context names. */
class NoUserRoomsGuard implements Guard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!isWsContext(ctx)) {
      return false;
    }
    const room = ctx.getRoomName();
    calls.push(`room:${room}`);

    return !room?.startsWith('user:');
  }
}

interface Gate {
  guard: new () => Guard;
  /** Let the guard answer. */
  release(): void;
  asked(): boolean;
  answered(): boolean;
}

/** A guard that answers only when the test releases it, as a guard waiting on a database does. */
function gatedGuard(name: string, verdict: boolean): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let asked = false;
  let answered = false;

  return {
    guard: class GatedGuard implements Guard {
      async canActivate(ctx: ExecutionContext): Promise<boolean> {
        asked = true;
        calls.push(`${name}:${isWsContext(ctx) ? inRoom(ctx.getClient(), ROOM) : 'not-ws'}`);
        await opened;
        answered = true;

        return verdict;
      }
    },
    release: () => open(),
    asked: () => asked,
    answered: () => answered,
  };
}

/** One macrotask: every continuation the last event queued has run by then. */
const nextTick = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, 0));

async function waitUntil<T>(probe: () => T | undefined | Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** The gateway instances the running applications built, in construction order. */
const constructed: RoomGateway[] = [];

/**
 * Shared base for the gateways below. Undecorated, so it contributes no handlers: only its
 * constructor, which hands the test the instance, and read-only helpers.
 */
class RoomGateway extends BaseWebSocketGateway {
  constructor() {
    super();
    constructed.push(this);
  }

  /**
   * Where the server lists this client for the room. `subscribed` covers every topic a member of
   * the room may hold through this gateway, the raw room name and the gateway-scoped one.
   */
  async membership(clientId: string, room: string): Promise<Membership> {
    const socket = this.getSocket(clientId);

    return {
      inStorage: (await this.storedMembers(room)).includes(clientId),
      inClientRooms: socket?.data.rooms.includes(room) ?? false,
      subscribed: this._roomTopics(room).some((topic) => socket?.isSubscribed(topic) ?? false),
    };
  }

  /** The room's members as the storage records them, unfiltered — dead ids included. */
  async storedMembers(room: string): Promise<string[]> {
    return await this.storage?.getClientsInRoom(room) ?? [];
  }

  /** Every room name the storage holds. */
  async storedRoomNames(): Promise<unknown[]> {
    return (await this.storage?.getAllRooms() ?? []).map((room) => room.name);
  }

  async storedClient(clientId: string): Promise<WsClientData | null> {
    return await this.storage?.getClient(clientId) ?? null;
  }

  /** Whether this gateway's socket for the client is subscribed to any of `topics`. */
  subscribedToAny(clientId: string, topics: string[]): boolean {
    const socket = this.getSocket(clientId);

    return topics.some((topic) => socket?.isSubscribed(topic) ?? false);
  }

  /** Record a client in the storage directly, as another instance sharing it does. */
  async addStoredClient(client: WsClientData): Promise<void> {
    await this.storage?.addClient(client);
  }

  /** Change a stored client record directly, as another instance sharing the storage does. */
  async updateStoredClient(clientId: string, data: Partial<WsClientData>): Promise<void> {
    await this.storage?.updateClient(clientId, data);
  }

  /** Record a membership in the storage alone, as another instance's server-side join does. */
  async addStoredMembership(clientId: string, room: string): Promise<void> {
    await this.storage?.addClientToRoom(clientId, room);
  }

  /**
   * Hold this gateway's own room writes until released, as a remote storage's latency does. The
   * framework's calls go to the storage directly and are not held. `late` (the default) applies a
   * held write on release; `early` applies it at once and holds only its answer, as a remote
   * storage that has executed a command still has to send the reply back.
   */
  holdRoomWrites(apply: 'late' | 'early' = 'late'): { held(): boolean; release(): void } {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }

    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    let held = false;

    this.storage = new Proxy(storage, {
      get(target, property) {
        if (property === 'addClientToRoom') {
          return async (clientId: string, roomName: string): Promise<void> => {
            held = true;
            if (apply === 'early') {
              await target.addClientToRoom(clientId, roomName);
              await opened;

              return;
            }
            await opened;
            await target.addClientToRoom(clientId, roomName);
          };
        }
        const value: unknown = Reflect.get(target, property);

        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    return { held: () => held, release: () => open() };
  }

  /**
   * Make the storage's reads of a client's rooms answer late, as a remote storage's do: a read
   * takes its value when it is issued and delivers it on release. A sweep that reads and removes
   * in one call (`removeClientFromAllRooms`) is held until release and reads then. Patched on the
   * storage instance itself, which the framework shares with this gateway.
   */
  delayStoredRoomReads(): { release(): void } {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }

    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    const readRooms = storage.getRoomsForClient.bind(storage);
    const sweepRooms = storage.removeClientFromAllRooms.bind(storage);

    storage.getRoomsForClient = async (clientId: string): Promise<string[]> => {
      const rooms = readRooms(clientId);
      await opened;

      return await rooms;
    };
    storage.removeClientFromAllRooms = async (clientId: string): Promise<void> => {
      await opened;
      await sweepRooms(clientId);
    };

    return { release: () => open() };
  }

  /**
   * Make the storage's writes of a client record answer late, as a remote storage's do. Patched on
   * the storage instance itself, which the framework shares with this gateway.
   */
  holdClientUpdates(): { held(): boolean; release(): void } {
    const storage = this.storage;
    if (!storage) {
      throw new Error('The gateway has no storage');
    }

    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    let held = false;
    const update = storage.updateClient.bind(storage);

    storage.updateClient = async (clientId: string, data: Partial<WsClientData>): Promise<void> => {
      held = true;
      await opened;
      await update(clientId, data);
    };

    return { held: () => held, release: () => open() };
  }
}

function currentGateway(): RoomGateway {
  const last = constructed.at(-1);
  if (!last) {
    throw new Error('No gateway was constructed');
  }

  return last;
}

function gatewayOf<T extends RoomGateway>(gatewayClass: new () => T): T {
  const found = constructed.find((instance): instance is T => instance instanceof gatewayClass);
  if (!found) {
    throw new Error(`No ${gatewayClass.name} was constructed`);
  }

  return found;
}

interface Peer {
  id: string;
  frames: Frame[];
  send(event: string, data: unknown, ack?: number): void;
  /** The frame answering `ack`. */
  reply(ack: number): Promise<Frame>;
  /** Wait for a direct `marker` frame from the gateway: everything sent before it has arrived. */
  drain(): Promise<void>;
  close(): void;
}

const running: OneBunApplication[] = [];
const sockets: WebSocket[] = [];

async function boot(
  gatewayClasses: Function | Function[],
  socketio = false,
  providers: Function[] = [],
): Promise<OneBunApplication> {
  @Module({ controllers: Array.isArray(gatewayClasses) ? gatewayClasses : [gatewayClasses], providers })
  class RoomModule {}

  const app = new OneBunApplication(RoomModule, {
    port: 0,
    host: HOST,
    loggerLayer: makeMockLoggerLayer(),
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
    websocket: socketio ? { socketio: { enabled: true, path: '/socket.io' } } : {},
  });
  running.push(app);
  await app.start();

  return app;
}

let markers = 0;

async function connect(app: OneBunApplication): Promise<Peer> {
  const owner = currentGateway();
  const before = new Set(owner.clients.keys());
  const frames: Frame[] = [];

  const socket = new WebSocket(`ws://${HOST}:${app.getPort()}/ws`);
  sockets.push(socket);
  socket.addEventListener('message', (message) => {
    frames.push(JSON.parse(String(message.data)) as Frame);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('WebSocket upgrade failed')));
  });
  const id = await waitUntil(
    () => [...owner.clients.keys()].find((clientId) => !before.has(clientId)),
    'the server side of the new socket',
  );

  return {
    id,
    frames,
    send(event, data, ack) {
      socket.send(JSON.stringify(ack === undefined ? { event, data } : { event, data, ack }));
    },
    async reply(ack) {
      return await waitUntil(() => frames.find((frame) => frame.ack === ack), `the reply to ack ${ack}`);
    },
    async drain() {
      const marker = ++markers;
      owner.emit(id, 'marker', { marker });
      await waitUntil(
        () => frames.find((frame) => frame.event === 'marker' && (frame.data as { marker: number }).marker === marker),
        `marker ${marker}`,
      );
    },
    close() {
      socket.close();
    },
  };
}

interface SocketioPeer {
  id: string;
  /** Raw Engine.IO frames, as received. */
  frames: string[];
  send(frame: string): void;
  /** The payload of the ack packet answering `ack`. */
  ack(ack: number): Promise<unknown[]>;
}

/**
 * A Socket.IO client spoken by hand: the Engine.IO handshake is awaited and nothing more, so the
 * test decides when — and whether — the CONNECT packet goes out.
 */
async function connectSocketio(app: OneBunApplication, provisional: RoomGateway, query = ''): Promise<SocketioPeer> {
  const before = new Set(provisional.clients.keys());
  const frames: string[] = [];

  const socket = new WebSocket(`ws://${HOST}:${app.getPort()}/socket.io/?EIO=4&transport=websocket${query}`);
  sockets.push(socket);
  socket.addEventListener('message', (message) => frames.push(String(message.data)));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('Socket.IO upgrade failed')));
  });
  await waitUntil(() => frames.find((frame) => frame.startsWith('0')), 'the Engine.IO handshake');
  const id = await waitUntil(
    () => [...provisional.clients.keys()].find((clientId) => !before.has(clientId)),
    'the server side of the new socket',
  );

  return {
    id,
    frames,
    send: (frame) => socket.send(frame),
    async ack(ack) {
      const prefix = `43${ack}[`;
      const frame = await waitUntil(() => frames.find((candidate) => candidate.startsWith(prefix)), `ack ${ack}`);

      return JSON.parse(frame.slice(prefix.length - 1)) as unknown[];
    },
  };
}

/**
 * Broadcast to the room through storage and through the raw topic, and wait until `member`
 * has both. A peer that is not a member must then see neither.
 */
async function broadcastTo(member: Peer): Promise<void> {
  const owner = currentGateway();
  owner.emitToRoom(ROOM, 'news', {});
  owner.getWsServer()?.publish(ROOM, JSON.stringify({ event: 'raw-news', data: {} }));
  await waitUntil(() => (member.frames.some((frame) => frame.event === 'news') ? true : undefined), 'news');
  await waitUntil(() => (member.frames.some((frame) => frame.event === 'raw-news') ? true : undefined), 'raw-news');
}

/** Wait until the storage lists the client in the room: an allowed join no handler answers sends no reply. */
async function untilStored(clientId: string, room: string): Promise<void> {
  await waitUntil(
    async () => ((await currentGateway().membership(clientId, room)).inStorage ? true : undefined),
    `the join of ${room}`,
  );
}

/** A member added server-side, so a broadcast has someone to reach whatever the guards say. */
async function memberOf(app: OneBunApplication): Promise<Peer> {
  const member = await connect(app);
  await currentGateway().joinRoom(member.id, ROOM);

  return member;
}

const eventsOf = (peer: Peer): string[] => peer.frames.map((frame) => frame.event);

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

describe('a guard on @OnJoinRoom decides whether the client joins the room', () => {
  it('keeps a client whose join guard denies out of the room, answers FORBIDDEN once and runs no handler', async () => {
    const deny = recordingGuard('deny', false);

    @WebSocketGateway({ path: '/ws' })
    class DeniedJoinGateway extends RoomGateway {
      @UseGuards(deny)
      @OnJoinRoom('room:{id}')
      onJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`handler:${inRoom(client, room)}`);

        return { event: 'joined', data: { room } };
      }
    }

    const app = await boot(DeniedJoinGateway);
    const member = await memberOf(app);
    const outsider = await connect(app);

    outsider.send('join', ROOM, 1);
    const reply = await outsider.reply(1);

    expect(reply).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' }, ack: 1 });
    expect(await currentGateway().membership(outsider.id, ROOM)).toEqual(OUT);

    await broadcastTo(member);
    await outsider.drain();

    expect(eventsOf(outsider)).toEqual(['error', 'marker']);
    expect(calls).toEqual(['deny:out']);
  });

  it('answers a denied join with the same frame a denied @OnMessage gets, naming the event the client sent', async () => {
    const deny = recordingGuard('deny', false);

    @WebSocketGateway({ path: '/ws' })
    class SameFrameGateway extends RoomGateway {
      @UseGuards(deny)
      @OnMessage('secret')
      onSecret() {
        calls.push('secret');

        return { event: 'secret', data: {} };
      }

      @UseGuards(deny)
      @OnJoinRoom()
      onJoin() {
        calls.push('handler');
      }
    }

    const app = await boot(SameFrameGateway);
    const peer = await connect(app);

    peer.send('secret', {}, 1);
    const messageFrame = await peer.reply(1);
    // The `join:<room>` spelling names the room in the event; the frame echoes it as sent.
    peer.send(`join:${ROOM}`, undefined, 2);
    const joinFrame = await peer.reply(2);

    expect(messageFrame).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'secret' }, ack: 1 });
    expect(joinFrame).toEqual({
      ...messageFrame,
      data: { ...(messageFrame.data as object), event: `join:${ROOM}` },
      ack: 2,
    });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['deny:out', 'deny:out']);
  });

  it('joins a client whose join guard allows, running the guard before the room change and the handler after it', async () => {
    const allow = recordingGuard('allow', true);

    @WebSocketGateway({ path: '/ws' })
    class AllowedJoinGateway extends RoomGateway {
      @UseGuards(allow)
      @OnJoinRoom('room:{id}')
      async onJoin(@Client() client: WsClientData, @RoomName() room: string) {
        const stored = (await this.getClientsByRoom(room)).some((member) => member.id === client.id);
        calls.push(`handler:${inRoom(client, room)}:${stored ? 'stored' : 'not-stored'}`);

        return { event: 'joined', data: { room } };
      }
    }

    const app = await boot(AllowedJoinGateway);
    const peer = await connect(app);

    peer.send('join', { room: ROOM }, 1);

    expect(await peer.reply(1)).toEqual({ event: 'joined', data: { room: ROOM }, ack: 1 });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    expect(calls).toEqual(['allow:out', 'handler:in:stored']);

    await broadcastTo(peer);
  });

  it('applies a gateway-level guard to the join', async () => {
    const deny = recordingGuard('class-deny', false);

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(deny)
    class ClassGuardGateway extends RoomGateway {
      @OnJoinRoom()
      onJoin() {
        calls.push('handler');
      }
    }

    const app = await boot(ClassGuardGateway);
    const member = await memberOf(app);
    const outsider = await connect(app);

    outsider.send('join', ROOM, 1);

    expect((await outsider.reply(1)).data).toEqual({ ...FORBIDDEN_DATA, event: 'join' });
    expect(await currentGateway().membership(outsider.id, ROOM)).toEqual(OUT);
    await broadcastTo(member);
    await outsider.drain();
    expect(eventsOf(outsider)).toEqual(['error', 'marker']);
    expect(calls).toEqual(['class-deny:out']);
  });

  it('applies a guard inherited from the base method to an overriding join handler', async () => {
    const deny = recordingGuard('base-deny', false);

    class JoinBase extends RoomGateway {
      @UseGuards(deny)
      onJoin(): void {
        calls.push('base-handler');
      }
    }

    @WebSocketGateway({ path: '/ws' })
    class InheritedGuardGateway extends JoinBase {
      @OnJoinRoom()
      override onJoin(): void {
        calls.push('handler');
      }
    }

    const app = await boot(InheritedGuardGateway);
    const member = await memberOf(app);
    const outsider = await connect(app);

    outsider.send('join', ROOM, 1);

    expect((await outsider.reply(1)).data).toEqual({ ...FORBIDDEN_DATA, event: 'join' });
    expect(await currentGateway().membership(outsider.id, ROOM)).toEqual(OUT);
    await broadcastTo(member);
    await outsider.drain();
    expect(eventsOf(outsider)).toEqual(['error', 'marker']);
    expect(calls).toEqual(['base-deny:out']);
  });

  it('keeps the client out when one of several matching join handlers denies, and runs none of them', async () => {
    const allow = recordingGuard('wildcard-allow', true);
    const deny = recordingGuard('param-deny', false);
    const vipDeny = recordingGuard('vip-deny', false);

    @WebSocketGateway({ path: '/ws' })
    class SeveralHandlersGateway extends RoomGateway {
      @OnJoinRoom()
      onAnyJoin() {
        calls.push('any-handler');
      }

      @UseGuards(allow)
      @OnJoinRoom('room:*')
      onWildcardJoin() {
        calls.push('wildcard-handler');
      }

      @UseGuards(deny)
      @OnJoinRoom('room:{id}')
      onParamJoin() {
        calls.push('param-handler');
      }

      // Its pattern does not match the room, so its guard has no say in this join.
      @UseGuards(vipDeny)
      @OnJoinRoom('vip:*')
      onVipJoin() {
        calls.push('vip-handler');
      }
    }

    const app = await boot(SeveralHandlersGateway);
    const member = await memberOf(app);
    const outsider = await connect(app);

    outsider.send('join', ROOM, 1);

    expect((await outsider.reply(1)).data).toEqual({ ...FORBIDDEN_DATA, event: 'join' });
    expect(await currentGateway().membership(outsider.id, ROOM)).toEqual(OUT);
    await broadcastTo(member);
    await outsider.drain();
    expect(eventsOf(outsider)).toEqual(['error', 'marker']);
    expect(calls).toEqual(['wildcard-allow:out', 'param-deny:out']);
  });

  it('runs every matching join handler after the room change when all their guards allow, each guard once', async () => {
    const wildcardAllow = recordingGuard('wildcard-allow', true);
    const paramAllow = recordingGuard('param-allow', true);

    @WebSocketGateway({ path: '/ws' })
    class AllAllowGateway extends RoomGateway {
      @OnJoinRoom()
      onAnyJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`any-handler:${inRoom(client, room)}`);
      }

      @UseGuards(wildcardAllow)
      @OnJoinRoom('room:*')
      onWildcardJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`wildcard-handler:${inRoom(client, room)}`);
      }

      @UseGuards(paramAllow)
      @OnJoinRoom('room:{id}')
      onParamJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`param-handler:${inRoom(client, room)}`);

        return { event: 'joined', data: { room } };
      }
    }

    const app = await boot(AllAllowGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);

    expect(await peer.reply(1)).toEqual({ event: 'joined', data: { room: ROOM }, ack: 1 });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    expect(calls).toEqual([
      'wildcard-allow:out',
      'param-allow:out',
      'any-handler:in',
      'wildcard-handler:in',
      'param-handler:in',
    ]);
  });

  it('changes nothing when a client already in the room is denied a join to it', async () => {
    const deny = recordingGuard('deny', false);

    @WebSocketGateway({ path: '/ws' })
    class RejoinGateway extends RoomGateway {
      @UseGuards(deny)
      @OnJoinRoom()
      onJoin() {
        calls.push('handler');
      }
    }

    const app = await boot(RejoinGateway);
    const member = await memberOf(app);

    member.send('join', ROOM, 1);

    expect((await member.reply(1)).data).toEqual({ ...FORBIDDEN_DATA, event: 'join' });
    // A denied join is not a leave: the membership it found is the membership it leaves.
    expect(await currentGateway().membership(member.id, ROOM)).toEqual(IN);
    expect(calls).toEqual(['deny:in']);
  });

  it('treats a join guard that throws as a denial', async () => {
    const broken = throwingGuard('broken');

    @WebSocketGateway({ path: '/ws' })
    class ThrowingGuardGateway extends RoomGateway {
      @UseGuards(broken)
      @OnJoinRoom()
      onJoin() {
        calls.push('handler');
      }
    }

    const app = await boot(ThrowingGuardGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);

    expect((await peer.reply(1)).data).toEqual({ ...FORBIDDEN_DATA, event: 'join' });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['broken:throw']);
  });
});

describe('the gateway-level guards decide every client join, whether or not an @OnJoinRoom handler matches', () => {
  it('keeps a client they deny out of a room no @OnJoinRoom handler matches, and answers FORBIDDEN once', async () => {
    const deny = recordingGuard('class-deny', false);
    const vipDeny = recordingGuard('vip-deny', false);

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(deny)
    class UnmatchedDeniedGateway extends RoomGateway {
      // Its pattern does not match the room, so neither its own guard nor its body has a say.
      @UseGuards(vipDeny)
      @OnJoinRoom('vip:*')
      onVipJoin() {
        calls.push('vip-handler');
      }
    }

    const app = await boot(UnmatchedDeniedGateway);
    const member = await memberOf(app);
    const outsider = await connect(app);

    outsider.send('join', ROOM, 1);
    expect(await outsider.reply(1)).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' }, ack: 1 });
    // The `join:<room>` spelling is decided the same way.
    outsider.send(`join:${ROOM}`, undefined, 2);
    expect(await outsider.reply(2)).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: `join:${ROOM}` }, ack: 2 });
    expect(await currentGateway().membership(outsider.id, ROOM)).toEqual(OUT);

    await broadcastTo(member);
    await outsider.drain();

    // One frame per join and nothing from the room. The server-side join of `member` asked no guard.
    expect(eventsOf(outsider)).toEqual(['error', 'error', 'marker']);
    expect(calls).toEqual(['class-deny:out', 'class-deny:out']);
  });

  it('answers a denied join of a room no handler matches over Socket.IO with the frame a denied @OnMessage gets', async () => {
    const deny = recordingGuard('class-deny', false);

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(deny)
    class SocketioUnmatchedGateway extends RoomGateway {}

    const app = await boot(SocketioUnmatchedGateway, true);
    const peer = await connectSocketio(app, currentGateway());
    peer.send('40');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    peer.send(`421["join","${ROOM}"]`);
    const joinAck = await peer.ack(1);
    // Without an ack id the denial is an `error` event.
    peer.send(`42["join",{"room":"${ROOM}"}]`);
    const joinEvent = await waitUntil(() => peer.frames.find((frame) => frame.startsWith('42["error"')), 'the error event');

    expect(joinAck).toEqual([{ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' } }]);
    expect(JSON.parse(joinEvent.slice(2))).toEqual(['error', { ...FORBIDDEN_DATA, event: 'join' }]);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['class-deny:out', 'class-deny:out']);
  });

  it('joins a room no handler matches once they allow, each asked once, in order, with the context of a join without a handler', async () => {
    const allow = recordingGuard('class-allow', true);
    const seen: unknown[] = [];

    class InspectingGuard implements Guard {
      canActivate(ctx: ExecutionContext): boolean {
        if (isWsContext(ctx)) {
          const handler = ctx.getHandler();
          calls.push('inspect');
          seen.push({
            type: handler.type,
            handler: handler.handler,
            pattern: handler.pattern,
            handlerParams: handler.params,
            guards: handler.guards?.length,
            patternParams: ctx.getPatternParams(),
            room: ctx.getRoomName(),
            data: ctx.getData(),
            rooms: [...ctx.getClient().rooms],
          });
        }

        return true;
      }
    }

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(allow, InspectingGuard)
    class UnmatchedAllowedGateway extends RoomGateway {
      @OnJoinRoom('vip:*')
      onVipJoin() {
        calls.push('vip-handler');
      }
    }

    const app = await boot(UnmatchedAllowedGateway);
    const peer = await connect(app);

    peer.send('join', ROOM);
    await untilStored(peer.id, ROOM);
    // The room comes from the event here: the data names none.
    peer.send('join:room:2', { room: '' });
    await untilStored(peer.id, 'room:2');

    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    expect(await currentGateway().membership(peer.id, 'room:2')).toEqual(IN);
    expect(calls).toEqual(['class-allow:out', 'inspect', 'class-allow:in', 'inspect']);
    // No handler: an empty handler name, no pattern, no parameters, the gateway-level guards. The
    // room is the one being joined; the data is whatever the client sent.
    const bareJoin = {
      type: WsHandlerType.JOIN_ROOM,
      handler: '',
      pattern: undefined,
      handlerParams: [],
      guards: 2,
      patternParams: {},
    };
    expect(seen).toEqual([
      {
        ...bareJoin,
        room: ROOM,
        data: ROOM,
        rooms: [],
      },
      {
        ...bareJoin,
        room: 'room:2',
        data: { room: '' },
        rooms: [ROOM],
      },
    ]);

    await broadcastTo(peer);
  });

  it('applies the gateway-level guards a base gateway class declares, base class first', async () => {
    const baseAllow = recordingGuard('base-allow', true);
    const ownDeny = recordingGuard('own-deny', false);

    @UseGuards(baseAllow)
    class GuardedBase extends RoomGateway {}

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(ownDeny)
    class InheritingGateway extends GuardedBase {}

    const app = await boot(InheritingGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);

    expect((await peer.reply(1)).data).toEqual({ ...FORBIDDEN_DATA, event: 'join' });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['base-allow:out', 'own-deny:out']);
  });

  it('denies a join no handler matches when a gateway-level guard written for @OnMessage handlers throws on it', async () => {
    // Reads the pattern every @OnMessage handler has. A join without a handler has none.
    class ChatOnlyGuard implements Guard {
      canActivate(ctx: ExecutionContext): boolean {
        if (!isWsContext(ctx)) {
          return false;
        }
        calls.push('chat-only');

        return (ctx.getHandler().pattern as string).startsWith('chat:');
      }
    }

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(ChatOnlyGuard)
    class ChatGateway extends RoomGateway {
      @OnMessage('chat:say')
      say() {
        return { event: 'said', data: {} };
      }
    }

    const app = await boot(ChatGateway);
    const peer = await connect(app);

    peer.send('chat:say', {}, 1);
    expect(await peer.reply(1)).toEqual({ event: 'said', data: {}, ack: 1 });
    peer.send('join', ROOM, 2);

    expect(await peer.reply(2)).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' }, ack: 2 });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['chat-only', 'chat-only']);
  });

  it('asks them once on a join a handler matches, before that handler\'s own guards', async () => {
    const classAllow = recordingGuard('class-allow', true);
    const ownAllow = recordingGuard('own-allow', true);

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(classAllow)
    class MatchedOnceGateway extends RoomGateway {
      @UseGuards(ownAllow)
      @OnJoinRoom('room:{id}')
      onRoomJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`room-handler:${inRoom(client, room)}`);

        return { event: 'joined', data: { room } };
      }

      @OnJoinRoom('open:*')
      onOpenJoin(@RoomName() room: string) {
        calls.push('open-handler');

        return { event: 'joined', data: { room } };
      }
    }

    const app = await boot(MatchedOnceGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    expect(await peer.reply(1)).toEqual({ event: 'joined', data: { room: ROOM }, ack: 1 });
    expect(calls).toEqual(['class-allow:out', 'own-allow:out', 'room-handler:in']);

    // A handler without guards of its own: the gateway-level ones alone, still once.
    calls.length = 0;
    peer.send('join', 'open:1', 2);
    expect(await peer.reply(2)).toEqual({ event: 'joined', data: { room: 'open:1' }, ack: 2 });
    expect(calls).toEqual(['class-allow:in', 'open-handler']);
  });

  it('joins a room no handler matches on a gateway without gateway-level guards, asking no guard', async () => {
    const vipDeny = recordingGuard('vip-deny', false);

    @WebSocketGateway({ path: '/ws' })
    class OpenGateway extends RoomGateway {
      @UseGuards(vipDeny)
      @OnJoinRoom('vip:*')
      onVipJoin() {
        calls.push('vip-handler');
      }
    }

    const app = await boot(OpenGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    await untilStored(peer.id, ROOM);

    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    await broadcastTo(peer);
    // The two fan-out paths race each other, so only the set of frames is fixed. No reply to the join.
    expect(eventsOf(peer).sort()).toEqual(['news', 'raw-news']);
    expect(calls).toEqual([]);
  });

  it('hands a room-based gateway-level guard the room being joined however the client spells it (native)', async () => {
    @WebSocketGateway({ path: '/ws' })
    @UseGuards(NoUserRoomsGuard)
    class UserRoomsNativeGateway extends RoomGateway {}

    const app = await boot(UserRoomsNativeGateway);
    const peer = await connect(app);

    for (const [index, [event, data]] of USER_ROOM_SPELLINGS.entries()) {
      peer.send(event, data, index + 1);
      expect(await peer.reply(index + 1)).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event }, ack: index + 1 });
    }
    // Data that names a room wins over the event, for the guard as for the join.
    peer.send(`join:${USER_ROOM}`, 'lobby');
    await untilStored(peer.id, 'lobby');

    expect(await currentGateway().membership(peer.id, USER_ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual(['lobby']);
    expect(calls).toEqual([...USER_ROOM_SPELLINGS.map(() => `room:${USER_ROOM}`), 'room:lobby']);
  });

  it('hands a room-based gateway-level guard the room being joined however the client spells it (Socket.IO)', async () => {
    @WebSocketGateway({ path: '/ws' })
    @UseGuards(NoUserRoomsGuard)
    class UserRoomsSocketioGateway extends RoomGateway {}

    const app = await boot(UserRoomsSocketioGateway, true);
    const peer = await connectSocketio(app, currentGateway());
    peer.send('40');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    for (const [index, [event, data]] of USER_ROOM_SPELLINGS.entries()) {
      const args = data === undefined ? [event] : [event, data];
      peer.send(`42${index + 1}${JSON.stringify(args)}`);
      expect(await peer.ack(index + 1)).toEqual([{ event: 'error', data: { ...FORBIDDEN_DATA, event } }]);
    }
    // Extra arguments, and a packet naming another namespace, are the same join.
    peer.send(`4299${JSON.stringify(['join', USER_ROOM, 'more'])}`);
    expect(await peer.ack(99)).toEqual([{ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' } }]);
    peer.send(`42/other,${JSON.stringify(['join', USER_ROOM])}`);
    await waitUntil(() => peer.frames.find((frame) => frame.startsWith('42["error"')), 'the error event');
    peer.send(`42${JSON.stringify([`join:${USER_ROOM}`, 'lobby'])}`);
    await untilStored(peer.id, 'lobby');

    expect(await currentGateway().membership(peer.id, USER_ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual(['lobby']);
    expect(calls).toEqual([...[...USER_ROOM_SPELLINGS, [], []].map(() => `room:${USER_ROOM}`), 'room:lobby']);
  });

  it('gives every room guard and interceptor the room the join or leave changes, and none to a message', async () => {
    class RoomSeenGuard implements Guard {
      canActivate(ctx: ExecutionContext): boolean {
        if (isWsContext(ctx)) {
          calls.push(`guard:${ctx.getHandler().handler || 'bare'}:${ctx.getRoomName() ?? 'none'}`);
        }

        return true;
      }
    }

    class RoomSeenInterceptor implements Interceptor {
      async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
        if (isWsContext(ctx)) {
          calls.push(`interceptor:${ctx.getHandler().handler}:${ctx.getRoomName() ?? 'none'}`);
        }

        return await next();
      }
    }

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(RoomSeenGuard)
    @UseInterceptors(RoomSeenInterceptor)
    class RoomContextGateway extends RoomGateway {
      @OnJoinRoom('room:{id}')
      onJoin(@RoomName() room: string) {
        calls.push(`onJoin:${room}`);

        return { event: 'joined', data: { room } };
      }

      @OnLeaveRoom('room:*')
      onLeave(@RoomName() room: string) {
        calls.push(`onLeave:${room}`);

        return { event: 'left', data: { room } };
      }

      @OnMessage('ping')
      ping() {
        calls.push('ping');

        return { event: 'pong', data: {} };
      }
    }

    const app = await boot(RoomContextGateway);
    const peer = await connect(app);

    peer.send(`join:${ROOM}`, { room: '' }, 1);
    expect(await peer.reply(1)).toEqual({ event: 'joined', data: { room: ROOM }, ack: 1 });
    peer.send('join', { room: 'lobby' });
    await untilStored(peer.id, 'lobby');
    peer.send(`leave:${ROOM}`, undefined, 2);
    expect(await peer.reply(2)).toEqual({ event: 'left', data: { room: ROOM }, ack: 2 });
    peer.send('ping', {}, 3);
    expect(await peer.reply(3)).toEqual({ event: 'pong', data: {}, ack: 3 });

    expect(calls).toEqual([
      `guard:onJoin:${ROOM}`,
      `interceptor:onJoin:${ROOM}`,
      `onJoin:${ROOM}`,
      'guard:bare:lobby',
      `guard:onLeave:${ROOM}`,
      `interceptor:onLeave:${ROOM}`,
      `onLeave:${ROOM}`,
      'guard:ping:none',
      'interceptor:ping:none',
      'ping',
    ]);
  });

  it('decides a join no handler matches with a gateway-level guard whose dependencies come from DI', async () => {
    @Service()
    class RoomPolicy extends BaseService {
      allows(room: string | undefined): boolean {
        return room === 'room:open';
      }
    }

    @Service()
    class PolicyGuard implements Guard {
      constructor(private readonly policy: RoomPolicy) {}

      canActivate(ctx: ExecutionContext): boolean {
        if (!isWsContext(ctx)) {
          return false;
        }
        calls.push(`policy:${ctx.getRoomName()}`);

        return this.policy.allows(ctx.getRoomName());
      }
    }

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(PolicyGuard)
    class PolicyGateway extends RoomGateway {}

    const app = await boot(PolicyGateway, false, [RoomPolicy]);
    const peer = await connect(app);

    peer.send('join', 'room:open');
    await untilStored(peer.id, 'room:open');
    peer.send('join', 'room:closed', 1);

    expect(await peer.reply(1)).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' }, ack: 1 });
    expect(await currentGateway().membership(peer.id, 'room:open')).toEqual(IN);
    expect(await currentGateway().membership(peer.id, 'room:closed')).toEqual(OUT);
    expect(calls).toEqual(['policy:room:open', 'policy:room:closed']);
  });

  it('adds a client through a server-side joinRoom() without asking them', async () => {
    const deny = recordingGuard('class-deny', false);

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(deny)
    class ServerJoinGateway extends RoomGateway {}

    const app = await boot(ServerJoinGateway);
    const peer = await connect(app);

    await currentGateway().joinRoom(peer.id, ROOM);

    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    await broadcastTo(peer);
    expect(calls).toEqual([]);
  });
});

describe('a guard on @OnLeaveRoom never keeps the client in the room', () => {
  it('removes a client whose leave guard denies, without running the handler or sending a frame', async () => {
    const deny = recordingGuard('leave-deny', false);

    @WebSocketGateway({ path: '/ws' })
    class DeniedLeaveGateway extends RoomGateway {
      @UseGuards(deny)
      @OnLeaveRoom('room:{id}')
      onLeave() {
        calls.push('handler');

        return { event: 'left', data: {} };
      }
    }

    const app = await boot(DeniedLeaveGateway);
    const member = await memberOf(app);
    const leaver = await connect(app);

    leaver.send('join', ROOM);
    await waitUntil(async () => ((await currentGateway().membership(leaver.id, ROOM)).inStorage ? true : undefined), 'the join');
    expect(await currentGateway().membership(leaver.id, ROOM)).toEqual(IN);

    leaver.send('leave', ROOM, 2);
    await waitUntil(() => (calls.includes('leave-deny:out') ? true : undefined), 'the leave guard');

    expect(await currentGateway().membership(leaver.id, ROOM)).toEqual(OUT);
    await broadcastTo(member);
    await leaver.drain();
    expect(eventsOf(leaver)).toEqual(['marker']);
    // The guard runs after the client has left: it sees the client out of the room.
    expect(calls).toEqual(['leave-deny:out']);
  });

  it('removes the client and runs the handler when the leave guard allows', async () => {
    const allow = recordingGuard('leave-allow', true);

    @WebSocketGateway({ path: '/ws' })
    class AllowedLeaveGateway extends RoomGateway {
      @UseGuards(allow)
      @OnLeaveRoom()
      onLeave(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`handler:${inRoom(client, room)}`);

        return { event: 'left', data: { room } };
      }
    }

    const app = await boot(AllowedLeaveGateway);
    const leaver = await connect(app);

    leaver.send('join', ROOM);
    await waitUntil(async () => ((await currentGateway().membership(leaver.id, ROOM)).inStorage ? true : undefined), 'the join');

    leaver.send('leave', ROOM, 2);

    expect(await leaver.reply(2)).toEqual({ event: 'left', data: { room: ROOM }, ack: 2 });
    expect(await currentGateway().membership(leaver.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['leave-allow:out', 'handler:out']);
  });
});

describe('a join that waits on its guards', () => {
  /** Join behind a guard that answers when released, and read the membership before the answer. */
  async function joinBehindLateGuard(verdict: boolean): Promise<{ peer: Peer; before: Membership; reply: Frame }> {
    const gate = gatedGuard('late', verdict);

    @WebSocketGateway({ path: '/ws' })
    class LateGuardGateway extends RoomGateway {
      @UseGuards(gate.guard)
      @OnJoinRoom()
      onJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`handler:${inRoom(client, room)}`);

        return { event: 'joined', data: { room } };
      }
    }

    const app = await boot(LateGuardGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the guard');
    await nextTick();
    const before = await currentGateway().membership(peer.id, ROOM);
    expect(await currentGateway().storedRoomNames()).toEqual([]);

    gate.release();

    return { peer, before, reply: await peer.reply(1) };
  }

  it('keeps the client out of the room until a late guard allows, then joins it', async () => {
    const { peer, before, reply } = await joinBehindLateGuard(true);

    expect(before).toEqual(OUT);
    expect(reply).toEqual({ event: 'joined', data: { room: ROOM }, ack: 1 });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    expect(calls).toEqual(['late:out', 'handler:in']);
  });

  it('keeps the client out of the room before and after a late guard denies', async () => {
    const { peer, before, reply } = await joinBehindLateGuard(false);

    expect(before).toEqual(OUT);
    expect(reply).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' }, ack: 1 });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['late:out']);
  });

  it('does not write a client that disconnected while its join guard was deciding back into the room', async () => {
    const gate = gatedGuard('late-allow', true);

    @WebSocketGateway({ path: '/ws' })
    class DisconnectRaceGateway extends RoomGateway {
      @UseGuards(gate.guard)
      @OnJoinRoom()
      onJoin() {
        calls.push('handler');
      }
    }

    const app = await boot(DisconnectRaceGateway);
    const owner = currentGateway();
    const peer = await connect(app);

    peer.send('join', ROOM);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the guard');
    peer.close();
    await waitUntil(async () => ((await owner.storedClient(peer.id)) === null ? true : undefined), 'the disconnect');

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await nextTick();

    expect(await owner.storedMembers(ROOM)).toEqual([]);
    expect(await owner.storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['late-allow:out']);
  });

  it('lets a leave take effect at once and cancel a join of the same room whose guard has not answered', async () => {
    const gate = gatedGuard('late-allow', true);

    @WebSocketGateway({ path: '/ws' })
    class LeaveCancelsGateway extends RoomGateway {
      @UseGuards(gate.guard)
      @OnJoinRoom()
      onJoin(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`join-handler:${inRoom(client, room)}`);
      }

      @OnLeaveRoom()
      onLeave(@Client() client: WsClientData, @RoomName() room: string) {
        calls.push(`leave-handler:${inRoom(client, room)}`);

        return { event: 'left', data: { room } };
      }
    }

    const app = await boot(LeaveCancelsGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the guard');
    // The guard has not answered, and the leave does not wait for it.
    peer.send('leave', ROOM, 2);

    expect(await peer.reply(2)).toEqual({ event: 'left', data: { room: ROOM }, ack: 2 });
    // The cancelled join is answered there and then, while its guard is still deciding.
    expect(await peer.reply(1)).toEqual({ event: 'error', data: CANCELLED_BY_LEAVE, ack: 1 });
    expect(gate.answered()).toBe(false);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);

    // The guard's late verdict is ignored: no second answer, no join.
    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await peer.drain();
    expect(peer.frames.filter((frame) => frame.ack === 1)).toHaveLength(1);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['late-allow:out', 'leave-handler:out']);
  });

  it('serves a leave and other joins while a join guard never answers', async () => {
    const never = gatedGuard('never', true);

    @WebSocketGateway({ path: '/ws' })
    class NeverAnswersGateway extends RoomGateway {
      @UseGuards(never.guard)
      @OnJoinRoom('stuck:*')
      onStuckJoin() {
        calls.push('stuck-handler');
      }

      @OnJoinRoom('room:*')
      onJoin(@RoomName() room: string) {
        return { event: 'joined', data: { room } };
      }

      @OnLeaveRoom()
      onLeave(@RoomName() room: string) {
        return { event: 'left', data: { room } };
      }
    }

    const app = await boot(NeverAnswersGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    expect(await peer.reply(1)).toEqual({ event: 'joined', data: { room: ROOM }, ack: 1 });
    peer.send('join', 'stuck:1', 2);
    await waitUntil(() => (never.asked() ? true : undefined), 'the guard that never answers');

    peer.send('leave', ROOM, 3);
    expect(await peer.reply(3)).toEqual({ event: 'left', data: { room: ROOM }, ack: 3 });
    peer.send('join', 'room:2', 4);
    expect(await peer.reply(4)).toEqual({ event: 'joined', data: { room: 'room:2' }, ack: 4 });

    // Leaving the stuck room answers the join its guard never will.
    peer.send('leave', 'stuck:1', 5);
    expect(await peer.reply(2)).toEqual({ event: 'error', data: CANCELLED_BY_LEAVE, ack: 2 });
    expect(await peer.reply(5)).toEqual({ event: 'left', data: { room: 'stuck:1' }, ack: 5 });

    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().membership(peer.id, 'room:2')).toEqual(IN);
    expect(await currentGateway().membership(peer.id, 'stuck:1')).toEqual(OUT);
  });

  it('lets a server-side leaveRoom() cancel a client join whose guard is still deciding', async () => {
    const gate = gatedGuard('late-allow', true);

    @WebSocketGateway({ path: '/ws' })
    class KickGateway extends RoomGateway {
      @UseGuards(gate.guard)
      @OnJoinRoom()
      onJoin() {
        calls.push('join-handler');
      }
    }

    const app = await boot(KickGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the guard');
    // A kick from the server while the client's join is still being decided.
    await currentGateway().leaveRoom(peer.id, ROOM);

    expect(await peer.reply(1)).toEqual({ event: 'error', data: CANCELLED_BY_LEAVE, ack: 1 });

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await nextTick();

    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['late-allow:out']);
  });

  it('asks no further guard once the connection closed while an earlier guard was deciding', async () => {
    const gate = gatedGuard('first', true);
    const second = recordingGuard('second', true);

    @WebSocketGateway({ path: '/ws' })
    class TwoGuardsGateway extends RoomGateway {
      @UseGuards(gate.guard)
      @OnJoinRoom()
      onAnyJoin() {
        calls.push('any-handler');
      }

      @UseGuards(second)
      @OnJoinRoom('room:*')
      onRoomJoin() {
        calls.push('room-handler');
      }
    }

    const app = await boot(TwoGuardsGateway);
    const owner = currentGateway();
    const peer = await connect(app);

    peer.send('join', ROOM);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the first guard');
    peer.close();
    await waitUntil(async () => ((await owner.storedClient(peer.id)) === null ? true : undefined), 'the disconnect');

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await nextTick();

    expect(calls).toEqual(['first:out']);
    expect(await owner.storedRoomNames()).toEqual([]);
  });
});

describe('a join no @OnJoinRoom handler matches that waits on the gateway-level guards', () => {
  /** A gateway whose only guard is a gateway-level one that answers when released, and a client of it. */
  async function behindLateClassGuard(name: string, verdict: boolean): Promise<{ gate: Gate; peer: Peer }> {
    const gate = gatedGuard(name, verdict);

    @WebSocketGateway({ path: '/ws' })
    @UseGuards(gate.guard)
    class LateClassGuardGateway extends RoomGateway {}

    const app = await boot(LateClassGuardGateway);
    const peer = await connect(app);

    peer.send('join', ROOM, 1);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the gateway-level guard');
    await nextTick();
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual([]);

    return { gate, peer };
  }

  it('keeps the client out until a late gateway-level guard allows, then joins it', async () => {
    const { gate, peer } = await behindLateClassGuard('class-late', true);

    gate.release();
    await untilStored(peer.id, ROOM);

    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(IN);
    await broadcastTo(peer);
    expect(calls).toEqual(['class-late:out']);
  });

  it('keeps the client out before and after a late gateway-level guard denies', async () => {
    const { gate, peer } = await behindLateClassGuard('class-late', false);

    gate.release();

    expect(await peer.reply(1)).toEqual({ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' }, ack: 1 });
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['class-late:out']);
  });

  it('lets a leave cancel it at once, answer it once, and ignore the guard\'s late verdict', async () => {
    const { gate, peer } = await behindLateClassGuard('class-late', true);

    peer.send('leave', ROOM, 2);

    expect(await peer.reply(1)).toEqual({ event: 'error', data: CANCELLED_BY_LEAVE, ack: 1 });
    expect(gate.answered()).toBe(false);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await peer.drain();
    expect(peer.frames.filter((frame) => frame.ack === 1)).toHaveLength(1);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['class-late:out']);
  });

  it('lets a server-side leaveRoom() cancel it', async () => {
    const { gate, peer } = await behindLateClassGuard('class-late', true);

    await currentGateway().leaveRoom(peer.id, ROOM);

    expect(await peer.reply(1)).toEqual({ event: 'error', data: CANCELLED_BY_LEAVE, ack: 1 });

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await peer.drain();
    expect(peer.frames.filter((frame) => frame.ack === 1)).toHaveLength(1);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(await currentGateway().storedRoomNames()).toEqual([]);
  });

  it('does not write a client that disconnected while the guard was deciding into the room', async () => {
    const { gate, peer } = await behindLateClassGuard('class-late', true);
    const owner = currentGateway();

    peer.close();
    await waitUntil(async () => ((await owner.storedClient(peer.id)) === null ? true : undefined), 'the disconnect');

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    await nextTick();

    expect(await owner.storedMembers(ROOM)).toEqual([]);
    expect(await owner.storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['class-late:out']);
  });

  it('is cancelled and answered at once by a Socket.IO move to a gateway without a hook', async () => {
    const gate = gatedGuard('public-late', true);

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    @UseGuards(gate.guard)
    class PublicGateway extends RoomGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    peer.send(`421["join","${SECRET}"]`);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the public gateway-level guard');
    peer.send('40/admin,');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    expect(await peer.ack(1)).toEqual([{ event: 'error', data: CANCELLED_BY_MOVE }]);
    expect(gate.answered()).toBe(false);

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    admin.emit(peer.id, 'marker', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"marker"')), 'the marker');

    expect(peer.frames.filter((frame) => frame.startsWith('431['))).toHaveLength(1);
    expect(await admin.membership(peer.id, SECRET)).toEqual(OUT);
    expect(await admin.storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['public-late:out']);
  });

  it('is waited for by a Socket.IO move to a gateway with a hook, and left at the move', async () => {
    const gate = gatedGuard('public-late', true);

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    @UseGuards(gate.guard)
    class PublicGateway extends RoomGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin', authenticate: () => ({ userId: 'u-admin' }) })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    peer.send(`421["join","${SECRET}"]`);
    await waitUntil(() => (gate.asked() ? true : undefined), 'the public gateway-level guard');
    peer.send('40/admin,');

    // The admin hook allows the move, and the move waits for the join the public guard is deciding.
    await Bun.sleep(20);
    expect(peer.frames.filter((frame) => frame.includes('"connect"'))).toEqual([]);
    expect(publicGateway.clients.has(peer.id)).toBe(true);

    gate.release();
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    expect(admin.clients.has(peer.id)).toBe(true);
    expect(await admin.membership(peer.id, SECRET)).toEqual(OUT);
    expect(await admin.storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['public-late:out']);
  });
});

describe('room messages the guards cannot be bypassed with', () => {
  it('answers a denied join over Socket.IO with the frame a denied @OnMessage gets', async () => {
    const deny = recordingGuard('deny', false);

    @WebSocketGateway({ path: '/ws' })
    class SocketioJoinGateway extends RoomGateway {
      @UseGuards(deny)
      @OnMessage('secret')
      onSecret() {
        calls.push('secret');

        return { event: 'secret', data: {} };
      }

      @UseGuards(deny)
      @OnJoinRoom()
      onJoin() {
        calls.push('handler');
      }
    }

    const app = await boot(SocketioJoinGateway, true);
    const peer = await connectSocketio(app, currentGateway());
    peer.send('40');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    peer.send('421["secret",{}]');
    const messageAck = await peer.ack(1);
    peer.send(`422["join","${ROOM}"]`);
    const joinAck = await peer.ack(2);
    // Without an ack id the denial is an `error` event.
    peer.send(`42["join","${ROOM}"]`);
    const joinEvent = await waitUntil(() => peer.frames.find((frame) => frame.startsWith('42["error"')), 'the error event');

    expect(messageAck).toEqual([{ event: 'error', data: { ...FORBIDDEN_DATA, event: 'secret' } }]);
    expect(joinAck).toEqual([{ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' } }]);
    expect(JSON.parse(joinEvent.slice(2))).toEqual(['error', { ...FORBIDDEN_DATA, event: 'join' }]);
    expect(await currentGateway().membership(peer.id, ROOM)).toEqual(OUT);
    expect(calls).toEqual(['deny:out', 'deny:out', 'deny:out']);
  });

  it('leaves every room behind at the move, without waiting for a join the old gateway\'s guard never answers', async () => {
    const never = gatedGuard('public-never', true);
    const deny = recordingGuard('admin-deny', false);

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {
      @UseGuards(never.guard)
      @OnJoinRoom('slow:*')
      onSlowJoin() {
        calls.push('public-handler');
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {
      @UseGuards(deny)
      @OnJoinRoom('admin:*')
      onJoin() {
        calls.push('admin-handler');
      }
    }

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    // Before its CONNECT the connection belongs to the public gateway, which has no handler for
    // this room, so nothing guards the join.
    peer.send(`42["join","${SECRET}"]`);
    await waitUntil(
      async () => ((await publicGateway.membership(peer.id, SECRET)).inStorage ? true : undefined),
      'the join on the public gateway',
    );
    // And a join the public gateway's guard holds, and never answers.
    peer.send('421["join","slow:x"]');
    await waitUntil(() => (never.asked() ? true : undefined), 'the public guard');

    peer.send('40/admin,');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    // The move cancelled that join and answered it, though its guard never will.
    expect(await peer.ack(1)).toEqual([{ event: 'error', data: CANCELLED_BY_MOVE }]);
    expect(admin.clients.has(peer.id)).toBe(true);
    expect(await admin.membership(peer.id, SECRET)).toEqual(OUT);
    expect(await admin.storedRoomNames()).toEqual([]);

    // Neither fan-out path reaches it: the storage one, and the raw topic.
    await admin.emitToRooms([SECRET], 'news', {});
    admin.getWsServer()?.publish(SECRET, '42["raw-news",{}]');
    admin.emit(peer.id, 'marker', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"marker"')), 'the marker');
    expect(peer.frames.filter((frame) => frame.includes('news'))).toEqual([]);

    // On the admin gateway the same join is its guards' to decide.
    peer.send(`422["join","${SECRET}"]`);
    expect(await peer.ack(2)).toEqual([{ event: 'error', data: { ...FORBIDDEN_DATA, event: 'join' } }]);
    expect(calls).toEqual(['public-never:out', 'admin-deny:out']);
  });

  it('answers a join the move cancelled at the move, and ignores the old gateway\'s late verdict', async () => {
    const gate = gatedGuard('public-late', true);

    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {
      @UseGuards(gate.guard)
      @OnJoinRoom('slow:*')
      onSlowJoin() {
        calls.push('public-handler');
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    peer.send('421["join","slow:x"]');
    await waitUntil(() => (gate.asked() ? true : undefined), 'the public guard');
    peer.send('40/admin,');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    expect(await peer.ack(1)).toEqual([{ event: 'error', data: CANCELLED_BY_MOVE }]);
    expect(gate.answered()).toBe(false);

    gate.release();
    await waitUntil(() => (gate.answered() ? true : undefined), 'the verdict');
    admin.emit(peer.id, 'marker', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"marker"')), 'the marker');

    expect(peer.frames.filter((frame) => frame.startsWith('431['))).toHaveLength(1);
    expect(await admin.membership(peer.id, 'slow:x')).toEqual(OUT);
    expect(await admin.storedRoomNames()).toEqual([]);
    expect(calls).toEqual(['public-late:out']);
  });

  it('takes back a server-side joinRoom() whose write was still in flight when the connection moved', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {
      @OnMessage('sub')
      async sub(@Client() client: WsClientData, @MessageData('room') room: string) {
        await this.joinRoom(client.id, room);

        return { event: 'subbed', data: { room } };
      }
    }

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');
    // The public gateway's room writes answer late, as a remote storage's do.
    const writes = publicGateway.holdRoomWrites();

    peer.send(`42["sub",{"room":"${SECRET}"}]`);
    await waitUntil(() => (writes.held() ? true : undefined), 'the joinRoom write');
    peer.send('40/admin,');
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    writes.release();
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"subbed"')), 'the end of joinRoom');

    expect(await admin.membership(peer.id, SECRET)).toEqual(OUT);
    expect(admin.subscribedToAny(peer.id, publicGateway._roomTopics(SECRET))).toBe(false);
    expect(await admin.storedMembers(SECRET)).toEqual([]);

    admin.getWsServer()?.publish(SECRET, '42["raw-news",{}]');
    admin.emit(peer.id, 'marker', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"marker"')), 'the marker');
    expect(peer.frames.filter((frame) => frame.includes('news'))).toEqual([]);
  });

  it('keeps a room the new gateway adds while the move is still cleaning up the stored rooms', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    peer.send('42["join","x:1"]');
    await waitUntil(
      async () => ((await publicGateway.membership(peer.id, 'x:1')).inStorage ? true : undefined),
      'the join on the public gateway',
    );

    // The move's reads of the stored rooms answer late, so its cleanup is still running when the
    // admin gateway, which owns the socket from the move on, adds a room of its own.
    const reads = admin.delayStoredRoomReads();
    peer.send('40/admin,');
    await waitUntil(() => (admin.clients.has(peer.id) ? true : undefined), 'the move');
    const joining = admin.joinRoom(peer.id, 'lobby');

    reads.release();
    await joining;
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');

    expect(await admin.membership(peer.id, 'lobby')).toEqual(IN);
    expect(await admin.membership(peer.id, 'x:1')).toEqual(OUT);
    await admin.emitToRooms(['lobby'], 'news', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"news"')), 'the lobby broadcast');
  });

  it('keeps a room the storage alone recorded at the move that the new gateway joins the client to again', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    // A membership only the storage records, as another instance's server-side join leaves one.
    // The move removes it — and the admin gateway joins the client to the same room meanwhile.
    await publicGateway.addStoredMembership(peer.id, 'lobby');
    const reads = admin.delayStoredRoomReads();
    peer.send('40/admin,');
    await waitUntil(() => (admin.clients.has(peer.id) ? true : undefined), 'the move');
    // The admin gateway's write is executed at once and answered late.
    const writes = admin.holdRoomWrites('early');
    const joining = admin.joinRoom(peer.id, 'lobby');

    reads.release();
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');
    writes.release();
    await joining;

    expect(await admin.membership(peer.id, 'lobby')).toEqual(IN);
    await admin.emitToRooms(['lobby'], 'news', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"news"')), 'the lobby broadcast');
  });

  it('refuses a server-side joinRoom() the old gateway makes once the move has begun', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    const app = await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);
    const peer = await connectSocketio(app, publicGateway, '&namespace=public');

    // The move's write of the client record answers late, as a remote storage's does.
    const updates = admin.holdClientUpdates();
    peer.send('40/admin,');
    await waitUntil(() => (updates.held() ? true : undefined), 'the record update');
    await publicGateway.joinRoom(peer.id, SECRET);

    updates.release();
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"connect"')), 'the CONNECT answer');
    // And one made once the move is over.
    await publicGateway.joinRoom(peer.id, 'later');

    expect(admin.clients.has(peer.id)).toBe(true);
    expect(await admin.membership(peer.id, SECRET)).toEqual(OUT);
    expect(await admin.storedMembers(SECRET)).toEqual([]);
    expect(await admin.storedMembers('later')).toEqual([]);

    await admin.emitToRooms([SECRET, 'later'], 'news', {});
    admin.emit(peer.id, 'marker', {});
    await waitUntil(() => peer.frames.find((frame) => frame.includes('"marker"')), 'the marker');
    expect(peer.frames.filter((frame) => frame.includes('news'))).toEqual([]);
  });

  it('takes back a joinRoom() for a client of another instance whose record moved to another gateway during the write', async () => {
    @WebSocketGateway({ path: '/ws', namespace: 'public' })
    class PublicGateway extends RoomGateway {}

    @WebSocketGateway({ path: '/ws', namespace: 'admin' })
    class AdminGateway extends RoomGateway {}

    await boot([PublicGateway, AdminGateway], true);
    const publicGateway = gatewayOf(PublicGateway);
    const admin = gatewayOf(AdminGateway);

    // Two clients of the public gateway connected to another instance: only their records are here.
    const remote = (id: string): WsClientData => ({
      id,
      rooms: [],
      connectedAt: 0,
      auth: null,
      metadata: {},
      protocol: 'socketio',
      gatewayKey: '/ws:public',
    });
    await publicGateway.addStoredClient(remote('moving'));
    await publicGateway.addStoredClient(remote('staying'));

    const writes = publicGateway.holdRoomWrites();
    const moving = publicGateway.joinRoom('moving', SECRET);
    const staying = publicGateway.joinRoom('staying', SECRET);
    await waitUntil(() => (writes.held() ? true : undefined), 'the joinRoom writes');
    // That instance moves one of them to the admin gateway while the writes are in flight.
    await admin.updateStoredClient('moving', { gatewayKey: '/ws:admin' });
    writes.release();
    await Promise.all([moving, staying]);

    expect(await admin.storedMembers(SECRET)).toEqual(['staying']);
  });

  it('drops a join or leave whose room is not a string, and keeps serving the connection', async () => {
    @WebSocketGateway({ path: '/ws' })
    class MalformedRoomGateway extends RoomGateway {
      @OnJoinRoom('room:{id}')
      onJoin(@RoomName() room: string) {
        calls.push(`join:${room}`);

        return { event: 'joined', data: { room } };
      }

      @OnLeaveRoom('room:{id}')
      onLeave(@RoomName() room: string) {
        calls.push(`leave:${room}`);
      }
    }

    const app = await boot(MalformedRoomGateway);
    const peer = await connect(app);

    peer.send('join', { room: ['x'] }, 1);
    peer.send('leave', { room: { name: 'x' } }, 2);
    peer.send('join', ROOM, 3);

    expect(await peer.reply(3)).toEqual({ event: 'joined', data: { room: ROOM }, ack: 3 });
    await peer.drain();
    expect(peer.frames.flatMap((frame) => (frame.ack === undefined ? [] : [frame.ack]))).toEqual([3]);
    expect(await currentGateway().storedRoomNames()).toEqual([ROOM]);
    expect(calls).toEqual([`join:${ROOM}`]);
  });
});

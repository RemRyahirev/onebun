/**
 * Room membership reads the same through either storage adapter, and it does not survive a leave.
 *
 * `BaseWebSocketGateway.joinRoom()` wrote to storage and subscribed the socket, and never touched
 * `socket.data.rooms` — the field `WsRoomGuard` reads and `gateway.rooms` is built from. In memory
 * mode it appeared to work by accident: `InMemoryWsStorage.addClient()` kept a shallow copy whose
 * `rooms` ARRAY was still the caller's, so the `push()` inside `addClientToRoom` landed on
 * `ws.data.rooms`. Under Redis there is no shared array, so the same call populated storage and
 * nothing else. Measured before the fix:
 *
 *   memory: join -> ws.data.rooms ["vip"], guard true
 *           leave -> storage [], ws.data.rooms ["vip"], guard STILL true
 *   redis : join -> ws.data.rooms [],      guard false — never granted at all
 *
 * The leave half is the sharp end: a client removed from a room keeps passing `WsRoomGuard` for
 * that room until it disconnects. The removal path REASSIGNS `client.rooms` instead of mutating
 * it, so it neither propagates nor leaves the alias intact for the joins that follow.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

import type { WsStorageAdapter } from './ws-storage';
import type { WsClientData, WsHandlerMetadata } from './ws.types';
import type { ServerWebSocket } from 'bun';

import { createRedisClient, type RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { WsExecutionContextImpl, WsRoomGuard } from './ws-guards';
import { InMemoryWsStorage } from './ws-storage-memory';
import { createRedisWsStorage } from './ws-storage-redis';

const CONTAINER_STARTUP_MS = 120_000;

interface SocketDouble {
  data: WsClientData;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  subscribe: ReturnType<typeof mock>;
  unsubscribe: ReturnType<typeof mock>;
}

function createSocket(client: WsClientData): SocketDouble {
  return {
    data: client,
    send: mock(() => undefined),
    close: mock(() => undefined),
    subscribe: mock(() => undefined),
    unsubscribe: mock(() => undefined),
  };
}

function createClient(id: string): WsClientData {
  return {
    id,
    rooms: [],
    connectedAt: Date.now(),
    auth: null,
    metadata: {},
    protocol: 'native',
  };
}

class RoomGateway extends BaseWebSocketGateway {}

/** What `WsRoomGuard` decides for the live socket — the reason `ws.data.rooms` has to be right. */
function guardAllows(roomName: string, socket: SocketDouble): boolean {
  const context = new WsExecutionContextImpl(
    socket.data,
    socket as unknown as ServerWebSocket<WsClientData>,
    undefined,
    {} as WsHandlerMetadata,
    {},
  );

  return new WsRoomGuard(roomName).canActivate(context);
}

/**
 * The same sequence, whatever the adapter underneath.
 *
 * Written once on purpose: the two storage suites share no assertions, which is why an adapter
 * difference this large stayed invisible to both of them.
 */
async function membershipReadsBack(storage: WsStorageAdapter): Promise<{
  afterJoin: { socketRooms: string[]; storageRooms: string[]; guard: boolean; gatewayRooms: string[] };
  afterLeave: { socketRooms: string[]; storageRooms: string[]; guard: boolean; gatewayRooms: string[] };
}> {
  const gateway = new RoomGateway();
  const client = createClient('member-1');
  const socket = createSocket(client);

  gateway._initialize(storage, {} as never);
  gateway._registerSocket(client.id, socket as unknown as ServerWebSocket<WsClientData>);
  await storage.addClient(client);

  await gateway.joinRoom(client.id, 'vip');
  const afterJoin = {
    socketRooms: [...socket.data.rooms],
    storageRooms: await storage.getRoomsForClient(client.id),
    guard: guardAllows('vip', socket),
    gatewayRooms: [...gateway.rooms.keys()],
  };

  await gateway.leaveRoom(client.id, 'vip');
  const afterLeave = {
    socketRooms: [...socket.data.rooms],
    storageRooms: await storage.getRoomsForClient(client.id),
    guard: guardAllows('vip', socket),
    gatewayRooms: [...gateway.rooms.keys()],
  };

  gateway._detachPubSub();

  return { afterJoin, afterLeave };
}

describe('room membership, whichever adapter is underneath', () => {
  describe('in-memory storage', () => {
    test('grants the room on join and revokes it on leave', async () => {
      const { afterJoin, afterLeave } = await membershipReadsBack(new InMemoryWsStorage());

      expect(afterJoin.socketRooms).toEqual(['vip']);
      expect(afterJoin.storageRooms).toEqual(['vip']);
      expect(afterJoin.guard).toBe(true);
      expect(afterJoin.gatewayRooms).toEqual(['vip']);

      // This is what used to stay true. `leaveRoom` emptied storage and left `ws.data.rooms`
      // holding the room, so the guard kept admitting a client the room no longer had.
      expect(afterLeave.socketRooms).toEqual([]);
      expect(afterLeave.storageRooms).toEqual([]);
      expect(afterLeave.guard).toBe(false);
      expect(afterLeave.gatewayRooms).toEqual([]);
    });

    test('hands out copies, so a caller cannot reach into stored state', async () => {
      const storage = new InMemoryWsStorage();
      const client = createClient('caller-1');

      await storage.addClient(client);

      // The caller keeps its own object after handing it over. Pushing to it used to push
      // straight into storage, because the stored "copy" shared this very array.
      client.rooms.push('never-joined');
      client.metadata.tampered = true;

      expect(await storage.getRoomsForClient(client.id)).toEqual([]);
      expect((await storage.getClient(client.id))?.metadata).toEqual({});

      const read = await storage.getClient(client.id);
      read?.rooms.push('also-never-joined');
      expect(await storage.getRoomsForClient(client.id)).toEqual([]);
    });

    test('keeps an absent room metadata absent instead of materialising an empty object', async () => {
      const storage = new InMemoryWsStorage();
      await storage.createRoom({ name: 'plain', clientIds: [] });

      // `{...room.metadata}` on an optional key would turn `undefined` into `{}` and change the
      // shape every reader sees.
      expect(await storage.getRoom('plain')).toEqual({ name: 'plain', clientIds: [] });
    });
  });

  describe('redis storage', () => {
    let container: TestContainer;
    let redis: RedisClient;
    let storage: WsStorageAdapter;

    beforeAll(async () => {
      container = await createRedisContainer();
      redis = createRedisClient({ url: container.url, keyPrefix: 'ws:membership:' });
      await redis.connect();
    }, CONTAINER_STARTUP_MS);

    afterAll(async () => {
      await redis.disconnect();
      await container.stop();
    });

    beforeEach(async () => {
      storage = createRedisWsStorage(redis);
      await storage.clear();
    });

    afterEach(async () => {
      await storage.close();
    });

    test('grants the room on join and revokes it on leave, exactly as in memory', async () => {
      const { afterJoin, afterLeave } = await membershipReadsBack(storage);

      // Every one of these used to differ from the in-memory answer: the join granted nothing,
      // so there was nothing for the leave to revoke.
      expect(afterJoin.socketRooms).toEqual(['vip']);
      expect(afterJoin.storageRooms).toEqual(['vip']);
      expect(afterJoin.guard).toBe(true);
      expect(afterJoin.gatewayRooms).toEqual(['vip']);

      expect(afterLeave.socketRooms).toEqual([]);
      expect(afterLeave.storageRooms).toEqual([]);
      expect(afterLeave.guard).toBe(false);
      expect(afterLeave.gatewayRooms).toEqual([]);
    });
  });
});

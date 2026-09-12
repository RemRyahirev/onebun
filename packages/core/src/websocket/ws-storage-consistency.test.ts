/**
 * The two storage adapters answer the same questions the same way.
 *
 * `RedisWsStorage` kept room membership TWICE — in the `ws:client:rooms:<id>` SET, and mirrored
 * into the `rooms` array of the client JSON at `ws:clients:<id>`. `getRoomsForClient()` read the
 * set; `getClient().rooms` read the JSON, and `getClient().rooms` is what `WsRoomGuard` and the
 * gateway's own `getClient`/`getClientsByRoom` hand to user code. Every mirror update was an
 * unguarded read-modify-write, so the two copies drifted:
 *
 *   deleteRoom   — only the set was cleaned, so a deleted room granted the guard access forever
 *   concurrent joins — three joins in one tick left the JSON holding one of them
 *   empty-room teardown — `SCARD` then `DEL`, non-atomically, so a leave could delete a room a
 *                         concurrent join had just entered
 *
 * The set is now the single source of truth and `getClient()` reads it, so there is no mirror to
 * drift; the teardown is one server-side script, so there is no window between the count and the
 * delete. The in-memory adapter was never affected by any of this — which is the point of running
 * the same sequences through both.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { WsStorageAdapter } from './ws-storage';
import type { WsClientData } from './ws.types';
import type { ServerWebSocket } from 'bun';

import { createRedisClient, type RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';
import { createMockSyncLogger } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { WebSocketGateway } from './ws-decorators';
import { WsHandler } from './ws-handler';
import { InMemoryWsStorage } from './ws-storage-memory';
import { createRedisWsStorage } from './ws-storage-redis';

const CONTAINER_STARTUP_MS = 120_000;
const RACE_OFFSETS = 8;

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

/** A deleted room must not go on granting its former members access. */
async function roomsAfterDeletingTheRoom(storage: WsStorageAdapter): Promise<{
  fromClientRecord: string[];
  fromRoomSet: string[];
}> {
  await storage.addClient(createClient('member'));
  await storage.addClientToRoom('member', 'doomed');
  await storage.deleteRoom('doomed');

  return {
    fromClientRecord: (await storage.getClient('member'))?.rooms ?? [],
    fromRoomSet: await storage.getRoomsForClient('member'),
  };
}

/** Three joins in one tick. Read-modify-write loses two of them; a SET loses none. */
async function roomsAfterConcurrentJoins(storage: WsStorageAdapter): Promise<{
  fromClientRecord: string[];
  fromRoomSet: string[];
}> {
  await storage.addClient(createClient('busy'));
  await Promise.all([
    storage.addClientToRoom('busy', 'alpha'),
    storage.addClientToRoom('busy', 'beta'),
    storage.addClientToRoom('busy', 'gamma'),
  ]);

  return {
    fromClientRecord: ((await storage.getClient('busy'))?.rooms ?? []).slice().sort(),
    fromRoomSet: (await storage.getRoomsForClient('busy')).slice().sort(),
  };
}

describe('storage adapters agree about room membership', () => {
  describe('in-memory storage', () => {
    let storage: WsStorageAdapter;

    beforeEach(() => {
      storage = new InMemoryWsStorage();
    });

    test('forgets a deleted room on both sides of the record', async () => {
      expect(await roomsAfterDeletingTheRoom(storage)).toEqual({ fromClientRecord: [], fromRoomSet: [] });
    });

    test('keeps every room joined in the same tick', async () => {
      expect(await roomsAfterConcurrentJoins(storage)).toEqual({
        fromClientRecord: ['alpha', 'beta', 'gamma'],
        fromRoomSet: ['alpha', 'beta', 'gamma'],
      });
    });
  });

  describe('redis storage', () => {
    let container: TestContainer;
    let redis: RedisClient;
    let storage: WsStorageAdapter;

    beforeAll(async () => {
      container = await createRedisContainer();
      redis = createRedisClient({ url: container.url, keyPrefix: 'ws:consistency:' });
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

    test('forgets a deleted room on both sides of the record', async () => {
      // Was `{ fromClientRecord: ['doomed'], fromRoomSet: [] }` — `deleteRoom` cleaned the set
      // and left the mirror, and the mirror is the copy the guard reads.
      expect(await roomsAfterDeletingTheRoom(storage)).toEqual({ fromClientRecord: [], fromRoomSet: [] });
    });

    test('keeps every room joined in the same tick', async () => {
      // Was `{ fromClientRecord: ['gamma'], fromRoomSet: ['alpha','beta','gamma'] }` — each join
      // read the record, pushed one room and wrote the whole thing back, so the last write won.
      expect(await roomsAfterConcurrentJoins(storage)).toEqual({
        fromClientRecord: ['alpha', 'beta', 'gamma'],
        fromRoomSet: ['alpha', 'beta', 'gamma'],
      });
    });

    test('never deletes a room a concurrent join has just entered', async () => {
      // The window is between the leave's `SCARD` and its `DEL`, and reaching it takes a precise
      // number of intervening round trips — which is why a plain `Promise.all` misses it and this
      // sweeps the offset instead.
      for (let offset = 1; offset <= RACE_OFFSETS; offset++) {
        const room = `lobby-${offset}`;
        await storage.addClient(createClient('leaver'));
        await storage.addClient(createClient('joiner'));
        await storage.addClientToRoom('leaver', room);

        const leaving = storage.removeClientFromRoom('leaver', room);
        for (let step = 0; step < offset; step++) {
          await redis.exists('race-pacing');
        }
        const joining = storage.addClientToRoom('joiner', room);
        await Promise.all([leaving, joining]);

        const members = await storage.getClientsInRoom(room);
        if (members.length > 0) {
          expect(await storage.getRoom(room)).not.toBeNull();
          expect(await storage.getRoomsForClient('joiner')).toContain(room);
        } else {
          expect(await storage.getRoomsForClient('joiner')).not.toContain(room);
        }

        await storage.clear();
      }
    });

    test('should remove only its own clients on shutdown, not the whole namespace', async () => {
      const handler = new WsHandler(createMockSyncLogger());
      handler.setStorage(storage);

      @WebSocketGateway({ path: '/shutdown' })
      class ShutdownGateway extends BaseWebSocketGateway {}

      const gateway = new ShutdownGateway();
      handler.registerGateway(ShutdownGateway, gateway);

      await storage.addClient(createClient('ours'));
      gateway._registerSocket('ours', { data: { id: 'ours' } } as unknown as ServerWebSocket<WsClientData>);

      // Another pod's connection, on the same Redis. It is not in this handler's socket map and
      // this handler has no business touching it.
      await storage.addClient(createClient('another-pods'));
      await storage.addClientToRoom('another-pods', 'lobby');

      await handler.cleanup();

      // Was gone: `cleanup()` called `storage.clear()`, which globs the whole prefix. One pod
      // shutting down cleanly emptied every other pod's clients and rooms — so a rolling deploy
      // blanked the survivors on every replica it cycled.
      expect(await storage.getClient('another-pods')).not.toBeNull();
      expect(await storage.getClientsInRoom('lobby')).toEqual(['another-pods']);

      expect(await storage.getClient('ours')).toBeNull();
    });
  });
});

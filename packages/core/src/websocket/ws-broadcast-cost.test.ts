/**
 * What a pattern broadcast costs the Redis it runs against, counted at the server.
 *
 * `emitToRoomPattern` went through the FENCED read path: `getRoomsByPattern` resolved every
 * member of every matching room to decide whether the room was visible — one `GET` and one
 * `SMEMBERS` per member — and then `emitToRooms` fetched each room's member set AGAIN. In a
 * multi-instance fleet most members belong to other instances, so most of those round trips
 * were for clients this gateway could never send to. Measured on 50 rooms of 20 members:
 * 1151 commands and 71 ms for one broadcast.
 *
 * The fence on this path is `ownSockets` — every send goes to a socket this gateway admitted —
 * so resolving a remote member's record changes no outcome. The membership already returned by
 * the pattern lookup is used as-is.
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

import { createRedisClient, type RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { createRedisWsStorage } from './ws-storage-redis';

const CONTAINER_STARTUP_MS = 120_000;
const ROOMS = 5;
const MEMBERS_PER_ROOM = 4;

class CostGateway extends BaseWebSocketGateway {}

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

/** Per-command call counts, straight from the server. */
async function commandCounts(redis: RedisClient): Promise<Record<string, number>> {
  const info = await redis.raw<string>('INFO', 'commandstats');
  const counts: Record<string, number> = {};

  for (const line of String(info).split('\n')) {
    const match = line.trim().match(/^cmdstat_([a-z|]+):calls=(\d+)/);
    if (match) {
      counts[match[1]] = Number(match[2]);
    }
  }

  return counts;
}

describe('the cost of a pattern broadcast', () => {
  let container: TestContainer;
  let redis: RedisClient;
  let storage: WsStorageAdapter;
  let gateway: CostGateway;

  beforeAll(async () => {
    container = await createRedisContainer();
    redis = createRedisClient({ url: container.url, keyPrefix: 'ws:cost:' });
    await redis.connect();
  }, CONTAINER_STARTUP_MS);

  afterAll(async () => {
    await redis.disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    storage = createRedisWsStorage(redis);
    await storage.clear();
    gateway = new CostGateway();
    gateway._initialize(storage, {} as never);

    // Rooms full of members that belong to OTHER instances — no local socket for any of them,
    // which is the normal state of a room in the fleet this adapter exists for.
    for (let room = 0; room < ROOMS; room++) {
      for (let member = 0; member < MEMBERS_PER_ROOM; member++) {
        const id = `remote-${room}-${member}`;
        await storage.addClient(createClient(id));
        await storage.addClientToRoom(id, `chat:room:${room}`);
      }
    }
    // One room the pattern must not reach, to keep the filter honest.
    await storage.addClient(createClient('elsewhere'));
    await storage.addClientToRoom('elsewhere', 'admin:room:0');
  });

  afterEach(async () => {
    gateway._detachPubSub();
    await storage.close();
  });

  test('should not resolve a member it could never send to', async () => {
    await redis.raw('CONFIG', 'RESETSTAT');

    await gateway.emitToRoomPattern('chat:room:*', 'ping', {});

    const counts = await commandCounts(redis);

    // One GET and one SMEMBERS per MATCHING room, and nothing per member. Was 25 GETs and
    // 30 SMEMBERS for this shape: five rooms, then twenty members resolved one at a time, then
    // every matching room's member set fetched a second time by `emitToRooms`.
    expect(counts.get ?? 0).toBe(ROOMS);
    expect(counts.smembers ?? 0).toBe(ROOMS);

    // And the non-matching room was never loaded: filtering happens on the name.
    expect(counts.scan ?? 0).toBeGreaterThan(0);
    expect(counts.keys ?? 0).toBe(0);
  });

  test('should still reach only this gateway\'s own sockets', async () => {
    const sent: string[] = [];
    const mine = createClient('mine');
    await storage.addClient(mine);
    await storage.addClientToRoom('mine', 'chat:room:0');
    gateway._registerSocket('mine', {
      data: mine,
      send: (frame: string) => sent.push(frame),
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await gateway.emitToRoomPattern('chat:room:*', 'ping', { n: 1 });

    // Twenty remote members in those rooms; exactly one local socket.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"ping"');
  });
});

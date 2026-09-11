/**
 * What a crashed instance leaves behind in Redis, and who cleans it up.
 *
 * No WebSocket key ever got a TTL and nothing recorded which instance owned which client, so a
 * pod that died without running its shutdown path left its `ws:clients:*`, `ws:rooms:*`,
 * `ws:room:members:*` and `ws:client:rooms:*` keys forever. Measured against a real Redis: eight
 * keys, all with `pttl = -1`, and a FRESH adapter on the same Redis then reported
 * `getClientCount() = 2` for two sockets that no longer existed, listed them as members of
 * `lobby`, and handed their full records — original `connectedAt` and all — to
 * `getClientsByRoom()`. Presence and capacity readings were both wrong, permanently.
 *
 * A bare TTL on the client keys would not have worked. Native connections have no per-connection
 * heartbeat at all (`startPingInterval` runs only for Socket.IO), so there is nothing to refresh
 * one with: measured, a naive TTL evicted a live native client one second into its session while
 * its room membership stayed behind. The liveness is therefore per INSTANCE — one key, one
 * timer, refreshed regardless of protocol — and the instance's clients are reaped by whoever
 * notices the key is gone.
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

import type { WsClientData } from './ws.types';

import { createRedisClient, type RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';

import { RedisWsStorage, createRedisWsStorage } from './ws-storage-redis';

const CONTAINER_STARTUP_MS = 120_000;

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

describe('a crashed instance leaves nothing behind for long', () => {
  let container: TestContainer;
  let redis: RedisClient;
  let crashed: RedisWsStorage;
  let survivor: RedisWsStorage;

  beforeAll(async () => {
    container = await createRedisContainer();
    redis = createRedisClient({ url: container.url, keyPrefix: 'ws:crash:' });
    await redis.connect();
  }, CONTAINER_STARTUP_MS);

  afterAll(async () => {
    await redis.disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    crashed = createRedisWsStorage(redis) as RedisWsStorage;
    survivor = createRedisWsStorage(redis) as RedisWsStorage;
    await crashed.clear();
  });

  afterEach(async () => {
    await crashed.close();
    await survivor.close();
  });

  test('should reap the clients of an instance whose liveness key has expired', async () => {
    await crashed.addClient(createClient('gone-1'));
    await crashed.addClient(createClient('gone-2'));
    await crashed.addClientToRoom('gone-1', 'lobby');
    await crashed.addClientToRoom('gone-2', 'lobby');

    expect(await crashed.getClientCount()).toBe(2);

    // Exactly what expiry does, without waiting for it: the data stays, the liveness goes.
    await redis.del(`ws:instance:alive:${crashed.instanceId}`);

    // Another instance taking its first connection is what notices.
    await survivor.addClient(createClient('alive'));

    // Was 3: the two ghosts plus the real one, with no way for anything to tell them apart.
    expect(await survivor.getClientCount()).toBe(1);
    expect(await survivor.getClient('gone-1')).toBeNull();
    expect(await survivor.getClient('gone-2')).toBeNull();

    // Rooms too — the reaper goes through `removeClient`, which already knows how to leave
    // every room and drop a room that empties.
    expect(await survivor.getClientsInRoom('lobby')).toEqual([]);
    expect(await survivor.getRoom('lobby')).toBeNull();
  });

  test('should keep a live instance\'s clients, and keep its liveness key fresh', async () => {
    await survivor.addClient(createClient('still-here'));
    await survivor.addClientToRoom('still-here', 'lobby');

    await crashed.addClient(createClient('also-here'));

    // Neither instance is dead, so neither sweeps the other — the whole mechanism hangs on
    // that key being present, which is why it carries a TTL and a refresh rather than a
    // timestamp somebody has to interpret.
    expect(await survivor.getClientCount()).toBe(2);
    expect(await survivor.getClientsInRoom('lobby')).toEqual(['still-here']);

    const ttl = await redis.ttl(`ws:instance:alive:${survivor.instanceId}`);
    expect(ttl).toBeGreaterThan(0);
  });

  test('should let a graceful close be swept too, if anything was left in it', async () => {
    await crashed.addClient(createClient('left-over'));

    // `close()` drops the liveness key and deliberately does NOT delete the ownership index:
    // anything the shutdown path failed to remove must stay reapable, or a close that ran
    // half-way leaks exactly as a crash used to.
    await crashed.close();

    await survivor.addClient(createClient('alive'));

    expect(await survivor.getClient('left-over')).toBeNull();
    expect(await survivor.getClientCount()).toBe(1);
  });
});

/**
 * `RedisRateLimitStore` against a real Redis.
 *
 * The property under test is the one the class exists for and the one a fake cannot show:
 * concurrent increments from independent clients — replicas, as far as Redis is concerned —
 * all land. A GET-then-SET implementation passes every single-caller test and loses updates
 * here, which is exactly how it shipped documented as atomic.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';

import { RedisRateLimitStore } from './rate-limit-middleware';

const WINDOW_MS = 60_000;

describe('RedisRateLimitStore (real Redis)', () => {
  let container: TestContainer;
  let client: RedisClient;

  beforeAll(async () => {
    container = await createRedisContainer();
    client = new RedisClient({ url: container.url });
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await container.stop();
  });

  it('counts every concurrent increment — nothing is lost between replicas', async () => {
    // Separate clients, not one: a shared connection could serialise the traffic by itself
    // and hide the race the store is responsible for closing.
    const replicas = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const replica = new RedisClient({ url: container.url });
        await replica.connect();

        return new RedisRateLimitStore(replica);
      }),
    );
    const key = `concurrent-${Date.now()}`;
    const perReplica = 25;

    const results = await Promise.all(
      replicas.flatMap((store) => Array.from(
        { length: perReplica },
        async () => await store.increment(key, WINDOW_MS),
      )),
    );

    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    // Every increment saw a distinct count: 1..100 with no repeats and no gaps.
    expect(counts).toEqual(Array.from({ length: replicas.length * perReplica }, (_, i) => i + 1));
    expect(await client.get(`rl:${key}`)).toBe('100');
  });

  it('keeps the deadline where the first request put it', async () => {
    const store = new RedisRateLimitStore(client);
    const key = `window-${Date.now()}`;

    const first = await store.increment(key, WINDOW_MS);
    await Bun.sleep(50);
    const second = await store.increment(key, WINDOW_MS);

    expect([first.count, second.count]).toEqual([1, 2]);
    // The window does not slide: 50 ms of knocking moved the deadline by less than a
    // millisecond, where an implementation that re-armed the expiry would have moved it by 50.
    // (`PTTL` rounds, so the two answers are allowed to differ by a millisecond either way.)
    expect(Math.abs(second.resetAt - first.resetAt)).toBeLessThanOrEqual(2);
    // And the key carries the expiry, so an idle bucket is not a leak.
    expect(await client.ttl(`rl:${key}`)).toBeGreaterThan(0);
  });

  it('starts a new window once the old one expires', async () => {
    const store = new RedisRateLimitStore(client);
    const key = `expiry-${Date.now()}`;
    const shortWindow = 120;

    const first = await store.increment(key, shortWindow);
    await Bun.sleep(shortWindow + 50);
    const afterExpiry = await store.increment(key, shortWindow);

    expect(first.count).toBe(1);
    expect(afterExpiry.count).toBe(1);
    expect(afterExpiry.resetAt).toBeGreaterThan(first.resetAt);
  });

  it('separates applications that share one Redis by key prefix', async () => {
    const key = `tenant-${Date.now()}`;
    const intake = new RedisRateLimitStore(client, { keyPrefix: 'intake:rl:' });
    const worker = new RedisRateLimitStore(client, { keyPrefix: 'worker:rl:' });

    const first = await intake.increment(key, WINDOW_MS);
    const second = await intake.increment(key, WINDOW_MS);
    const other = await worker.increment(key, WINDOW_MS);

    expect([first.count, second.count]).toEqual([1, 2]);
    // The same caller, the same key, a different application: its own budget.
    expect(other.count).toBe(1);
    expect(await client.get(`intake:rl:${key}`)).toBe('2');
    expect(await client.get(`worker:rl:${key}`)).toBe('1');
  });

  it('replaces a counter left behind by an older release instead of erroring on it', async () => {
    const store = new RedisRateLimitStore(client);
    const key = `legacy-${Date.now()}`;
    // What releases up to 0.8.0 wrote under this key. `INCR` on it fails with
    // "value is not an integer", which would be a 500 for the length of one window
    // after an upgrade — the script starts a fresh window instead.
    await client.set(
      `rl:${key}`,
      JSON.stringify({ count: 7, resetAt: Date.now() + WINDOW_MS }),
      WINDOW_MS,
    );

    const afterUpgrade = await store.increment(key, WINDOW_MS);

    expect(afterUpgrade.count).toBe(1);
    expect(await client.get(`rl:${key}`)).toBe('1');
  });

  it('floors a zero-length window to a millisecond rather than erroring', async () => {
    const store = new RedisRateLimitStore(client);
    const key = `zero-${Date.now()}`;

    // `PX 0` is rejected by Redis with "invalid expire time", so a degenerate option would
    // otherwise become a 500 on every request. The bucket expires immediately instead.
    const first = await store.increment(key, 0);

    expect(first.count).toBe(1);
    expect(first.resetAt).toBeLessThanOrEqual(Date.now() + 1);
    await Bun.sleep(5);
    expect(await client.get(`rl:${key}`)).toBeNull();
  });
});

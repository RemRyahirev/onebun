/**
 * RedisClient integration tests
 *
 * These run against a real Redis container, not a stub. The methods under test are the ones the
 * queue adapter reaches Redis through, and the bug they exist to pin was invisible to a mock: the
 * old `raw()` indexed Bun's driver by command name, which type-checks, looks correct, and rejects
 * at runtime for every uppercase name.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { createRedisContainer, type TestContainer } from '../testing/containers';

import { RedisClient } from './redis-client';

const CONTAINER_TEST_TIMEOUT_MS = 30_000;

describe('RedisClient against a real Redis', () => {
  let redis: TestContainer;
  let client: RedisClient;
  let keyCounter = 0;

  /** A fresh unprefixed key per test, so one test's leftovers cannot satisfy another's assertion. */
  const nextKey = (): string => `redis-client-test:${keyCounter += 1}`;

  beforeAll(async () => {
    redis = await createRedisContainer();
  });

  afterAll(async () => {
    await redis.stop();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  describe('raw()', () => {
    it('round-trips a list through RPUSH and LPOP', async () => {
      // The regression guard for the whole item. `raw()` used to be `client[command](...args)`,
      // and Bun's driver exposes only lowercase commands — so this exact call rejected with
      // "is not a function" and the Redis queue adapter could not write a single message.
      client = new RedisClient({ url: redis.url });
      await client.connect();

      const key = nextKey();

      await client.raw('RPUSH', key, 'first');
      await client.raw('RPUSH', key, 'second');

      expect(await client.raw<string | null>('LPOP', key)).toBe('first');
      expect(await client.raw<string | null>('LPOP', key)).toBe('second');
      expect(await client.raw<string | null>('LPOP', key)).toBeNull();
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('takes a multi-argument command such as SCAN', async () => {
      // Uppercase and multi-argument: the two properties the old dispatch could not carry.
      client = new RedisClient({ url: redis.url });
      await client.connect();

      const key = nextKey();
      await client.raw('RPUSH', key, 'value');

      const [cursor, keys] = await client.raw<[string, string[]]>(
        'SCAN', '0', 'MATCH', `${key}*`, 'COUNT', '100',
      );

      expect(typeof cursor).toBe('string');
      expect(keys).toContain(key);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('does not prefix its key, unlike the typed methods', async () => {
      // `raw()` takes fully-qualified names because a raw command may put keys in any position,
      // or none at all. A caller that forgets this writes outside its namespace.
      client = new RedisClient({ url: redis.url, keyPrefix: 'ns:' });
      await client.connect();

      const key = nextKey();

      await client.raw('RPUSH', key, 'unprefixed');

      // Written where it was asked, not under `ns:`.
      expect(await client.raw<string | null>('LPOP', key)).toBe('unprefixed');
      expect(await client.raw<string | null>('LPOP', `ns:${key}`)).toBeNull();
    }, CONTAINER_TEST_TIMEOUT_MS);
  });

  describe('scan()', () => {
    it('returns every match across pages, even when most pages come back empty', async () => {
      // The hazard this is built around: a SCAN page can be EMPTY while the cursor is still
      // non-zero. A loop that stops on an empty page returns a fraction of the matches — with a
      // small COUNT against mostly-noise keys, that is most pages.
      client = new RedisClient({ url: redis.url, keyPrefix: 'scan-test:' });
      await client.connect();

      const noise = 3000;
      const matches = 40;
      for (let at = 0; at < noise; at += 1) {
        await client.set(`noise:${at}`, 'x');
      }
      for (let at = 0; at < matches; at += 1) {
        await client.set(`wanted:${at}`, 'x');
      }

      const found = await client.scan('wanted:*', 10);

      expect(found).toHaveLength(matches);
      // Prefix stripped, exactly as `keys()` strips it — the callers use the result as a key
      // name and would otherwise get `scan-test:wanted:0` back.
      expect(found).toContain('wanted:0');
      expect(found.every((key) => !key.startsWith('scan-test:'))).toBe(true);
      // SCAN may hand the same key back twice; the result is a set, not a stream.
      expect(new Set(found).size).toBe(found.length);

      await client.unlink(...found, ...Array.from({ length: noise }, (_, at) => `noise:${at}`));
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('sees only its own namespace', async () => {
      const mine = new RedisClient({ url: redis.url, keyPrefix: 'scan-mine:' });
      await mine.connect();
      const theirs = new RedisClient({ url: redis.url, keyPrefix: 'scan-theirs:' });
      await theirs.connect();

      await mine.set('shared-name', 'a');
      await theirs.set('shared-name', 'b');

      expect(await mine.scan('shared-*')).toEqual(['shared-name']);
      expect(await theirs.scan('shared-*')).toEqual(['shared-name']);
      expect(await mine.get('shared-name')).toBe('a');

      await mine.unlink('shared-name');
      await theirs.unlink('shared-name');
      await theirs.disconnect();
      client = mine;
    }, CONTAINER_TEST_TIMEOUT_MS);
  });

  describe('typed list and sorted-set methods', () => {
    it('prefixes keys, so two namespaces do not collide', async () => {
      const key = nextKey();

      const namespaced = new RedisClient({ url: redis.url, keyPrefix: 'tenant-a:' });
      await namespaced.connect();
      await namespaced.rpush(key, 'a-value');

      const other = new RedisClient({ url: redis.url, keyPrefix: 'tenant-b:' });
      await other.connect();

      // Same key name, different namespace: `tenant-b` must see nothing.
      expect(await other.lpop(key)).toBeNull();
      expect(await namespaced.lpop(key)).toBe('a-value');

      await other.disconnect();
      client = namespaced;
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('exposes its prefix, so a caller can build a glob for it', async () => {
      // `keyPrefix` is what lets the queue adapter build a `SCAN … MATCH` argument that stays
      // inside its own namespace — the client prefixes single keys but cannot prefix a pattern.
      client = new RedisClient({ url: redis.url, keyPrefix: 'scan-ns:' });
      await client.connect();

      expect(client.keyPrefix).toBe('scan-ns:');
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('pops a sorted set in score order, returning members with their scores', async () => {
      // `zpopmin` normalises two wire shapes: RESP2 answers with a flat [member, score, …] array
      // and RESP3 with nested pairs. A caller must not have to know which it got.
      client = new RedisClient({ url: redis.url });
      await client.connect();

      const key = nextKey();

      await client.zadd(key, 30, 'low-priority');
      await client.zadd(key, 10, 'urgent');
      await client.zadd(key, 20, 'normal');

      expect(await client.zpopmin(key, 2)).toEqual([
        { member: 'urgent', score: 10 },
        { member: 'normal', score: 20 },
      ]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('selects a score range and honours its limit', async () => {
      client = new RedisClient({ url: redis.url });
      await client.connect();

      const key = nextKey();

      await client.zadd(key, 100, 'due-soon');
      await client.zadd(key, 200, 'due-later');
      await client.zadd(key, 300, 'not-due');

      expect(await client.zrangebyscore(key, '-inf', '250')).toEqual(['due-soon', 'due-later']);
      expect(await client.zrangebyscore(key, '-inf', '250', 1)).toEqual(['due-soon']);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('removes a member from a sorted set', async () => {
      client = new RedisClient({ url: redis.url });
      await client.connect();

      const key = nextKey();

      await client.zadd(key, 1, 'claimed');
      expect(await client.zrem(key, 'claimed')).toBe(1);

      // Removing what is already gone reports zero rather than failing — the queue adapter
      // relies on that when two pollers race for the same delayed message.
      expect(await client.zrem(key, 'claimed')).toBe(0);
      expect(await client.zrangebyscore(key, '-inf', '+inf')).toEqual([]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('lpush puts a value back at the head, ahead of what is already queued', async () => {
      // This is the requeue primitive: a nacked message goes back to the front, not the end.
      client = new RedisClient({ url: redis.url });
      await client.connect();

      const key = nextKey();

      await client.rpush(key, 'already-queued');
      await client.lpush(key, 'requeued');

      expect(await client.lpop(key)).toBe('requeued');
      expect(await client.lpop(key)).toBe('already-queued');
    }, CONTAINER_TEST_TIMEOUT_MS);
  });
});

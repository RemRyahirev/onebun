/**
 * Redis Queue Adapter Tests
 *
 * Tests using testcontainers for real Redis integration
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';

import { SharedRedisProvider } from '../../redis/shared-redis';
import { createRedisContainer, type TestContainer } from '../../testing/containers';


import { RedisQueueAdapter, createRedisQueueAdapter } from './redis.adapter';

const CONTAINER_TEST_TIMEOUT_MS = 30_000;

/** Poll until `predicate` holds, so a test never depends on a fixed sleep being long enough. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await Bun.sleep(20);
  }

  throw new Error(`condition not met within ${timeoutMs}ms`);
}

describe('RedisQueueAdapter', () => {
  let redis: TestContainer;
  let adapter: RedisQueueAdapter;

  beforeAll(async () => {
    redis = await createRedisContainer();

    // Configure shared Redis
    SharedRedisProvider.configure({ url: redis.url });
  });

  afterAll(async () => {
    await SharedRedisProvider.reset();
    await redis.stop();
  });

  beforeEach(async () => {
    adapter = createRedisQueueAdapter({
      useSharedClient: true,
      keyPrefix: `test:${Date.now()}:`,
    });
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  describe('lifecycle', () => {
    it('should create adapter with default options', () => {
      const defaultAdapter = new RedisQueueAdapter();
      
      expect(defaultAdapter.name).toBe('redis');
      expect(defaultAdapter.type).toBe('redis');
    });

    it('should create adapter using factory function', () => {
      const factoryAdapter = createRedisQueueAdapter({
        keyPrefix: 'factory:',
      });
      
      expect(factoryAdapter).toBeInstanceOf(RedisQueueAdapter);
    });

    it('should connect successfully', async () => {
      await adapter.connect();
      
      expect(adapter.isConnected()).toBe(true);
    });

    it('should not connect twice', async () => {
      await adapter.connect();
      await adapter.connect(); // Should be no-op
      
      expect(adapter.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await adapter.connect();
      await adapter.disconnect();
      
      expect(adapter.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw
      await adapter.disconnect();
      
      expect(adapter.isConnected()).toBe(false);
    });

    it('should emit onReady event on connect', async () => {
      const onReady = mock(() => undefined);
      adapter.on('onReady', onReady);
      
      await adapter.connect();
      
      expect(onReady).toHaveBeenCalledTimes(1);
    });
  });

  describe('with own client', () => {
    it('should create own client when useSharedClient is false', async () => {
      const ownAdapter = new RedisQueueAdapter({
        useSharedClient: false,
        url: redis.url,
        keyPrefix: 'own:',
      });

      await ownAdapter.connect();
      
      expect(ownAdapter.isConnected()).toBe(true);
      
      await ownAdapter.disconnect();
    });

    it('should throw when URL missing and not using shared client', async () => {
      const ownAdapter = new RedisQueueAdapter({
        useSharedClient: false,
        // No URL
      });

      await expect(ownAdapter.connect()).rejects.toThrow(
        'Redis URL is required',
      );
    });
  });

  describe('publishing', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should throw when publishing while disconnected', async () => {
      await adapter.disconnect();
      
      await expect(
        adapter.publish('test:topic', { data: 1 }),
      ).rejects.toThrow('not connected');
    });
  });

  describe('end-to-end against a real Redis', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    // These four rode the same broken call: the raw-command helper indexed the driver by the
    // command name — `client['RPUSH'](...)` — which Bun does not expose, so every publish path
    // rejected with "is not a function" and the adapter could not write a single message. The
    // test that used to stand here was a comment saying so.

    it('delivers a published message to a subscriber', async () => {
      const received: Array<{ id: string; data: unknown }> = [];

      await adapter.subscribe('orders.created', async (message) => {
        received.push({ id: message.id, data: message.data });
      });

      const messageId = await adapter.publish('orders.created', { orderId: 7 });

      await waitFor(() => received.length > 0);
      // Settle before asserting the COUNT. `waitFor` returns on the first delivery, so asserting
      // immediately checks the counter mid-flight and passes even when a second copy is on its
      // way — which is exactly how the duplicate delivery went unnoticed.
      await Bun.sleep(400);

      expect(received).toHaveLength(1);
      expect(received[0].data).toEqual({ orderId: 7 });
      expect(received[0].id).toBe(messageId);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('holds a delayed message until its delay elapses, then delivers it', async () => {
      const received: number[] = [];

      await adapter.subscribe('reports.due', async () => {
        received.push(Date.now());
      });

      const publishedAt = Date.now();
      await adapter.publish('reports.due', { reportId: 1 }, { delay: 250 });

      // Still held: the message is in the delayed sorted set, not the queue.
      await Bun.sleep(80);
      expect(received).toHaveLength(0);

      await waitFor(() => received.length > 0);
      await Bun.sleep(400);

      expect(received).toHaveLength(1);
      expect(received[0] - publishedAt).toBeGreaterThanOrEqual(200);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('promotes a priority message out of the priority set', async () => {
      const received: unknown[] = [];

      await adapter.subscribe('jobs.urgent', async (message) => {
        received.push(message.data);
      });

      await adapter.publish('jobs.urgent', { jobId: 'a' }, { priority: 5 });

      await waitFor(() => received.length > 0);
      await Bun.sleep(400);

      // Promoted out of the priority set, and delivered once: promotion writes to the list and
      // signals the channel, and only the list hands the message over.
      expect(received).toEqual([{ jobId: 'a' }]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('delivers a message published before the subscription existed, exactly once', async () => {
      // The reason the list leg exists at all: pub/sub reaches only subscribers that are already
      // listening, so without the list this message would be lost. It must still arrive once, not
      // once per leg.
      await adapter.publish('orders.backlog', { orderId: 99 });

      const received: unknown[] = [];
      await adapter.subscribe('orders.backlog', async (message) => {
        received.push(message.data);
      });

      await waitFor(() => received.length > 0);
      await Bun.sleep(400);

      expect(received).toEqual([{ orderId: 99 }]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('delivers to a {param} subscription, carrying the concrete topic', async () => {
      const seen: string[] = [];

      await adapter.subscribe('orders.{id}', async (message) => {
        seen.push(message.pattern);
      });

      await adapter.publish('orders.123', { total: 10 });

      await waitFor(() => seen.length > 0);
      await Bun.sleep(400);

      // The subscription used to listen on the literal channel `queue:ch:orders.{id}` and LPOP the
      // literal key `queue:q:orders.{id}` — names nothing ever writes to — so it was silently dead.
      expect(seen).toEqual(['orders.123']);

      // The captured `{id}` value is NOT asserted here because no adapter exposes it: the matcher
      // computes `match.params` and every adapter discards it. Tracked separately — pinning a
      // value the framework never delivers would be a test of nothing.
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('matches * for one token only, not for a deeper topic', async () => {
      const received: string[] = [];

      await adapter.subscribe('events.*', async (message) => {
        received.push(message.pattern);
      });

      await adapter.publish('events.created', { a: 1 });
      await adapter.publish('events.a.b', { a: 2 });

      await waitFor(() => received.length > 0);
      await Bun.sleep(500);

      // The Redis glob for `events.*` also matches `events.a.b` — globs are character-based. The
      // in-process matcher is what holds the arity, and this pins that it is the authority.
      expect(received).toEqual(['events.created']);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('matches # across any number of tokens', async () => {
      const received: string[] = [];

      await adapter.subscribe('logs.#', async (message) => {
        received.push(message.pattern);
      });

      await adapter.publish('logs.a.b.c', { level: 'warn' });

      await waitFor(() => received.length > 0);
      await Bun.sleep(400);

      expect(received).toEqual(['logs.a.b.c']);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('drains a pattern backlog of differently-named topics published before subscribing', async () => {
      // Nothing is listening yet, so the wake signal reaches no one — these two are found only by
      // the SCAN the poll loop runs for a pattern subscription.
      await adapter.publish('backlog.first', { n: 1 });
      await adapter.publish('backlog.second', { n: 2 });

      const received: string[] = [];
      await adapter.subscribe('backlog.{name}', async (message) => {
        received.push(message.pattern);
      });

      await waitFor(() => received.length >= 2);
      await Bun.sleep(400);

      expect(received.sort()).toEqual(['backlog.first', 'backlog.second']);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('refuses a pattern whose # is not the final token', async () => {
      await expect(adapter.subscribe('#.created', async () => undefined)).rejects.toThrow(/final token/i);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('delivers exactly once when no retry is configured, and keeps nothing afterwards', async () => {
      let calls = 0;

      await adapter.subscribe('orders.oneshot', async () => {
        calls += 1;
        throw new Error('handler exploded');
      });

      await adapter.publish('orders.oneshot', { orderId: 1 });
      await waitFor(() => calls > 0);
      await Bun.sleep(500);

      expect(calls).toBe(1);

      // Nothing under this adapter's prefix still holds it. Without `deadLetter` the message is
      // dropped, and the docs say so — what must not happen is it sitting on a list forever.
      const client = (adapter as unknown as {
        client: { raw: (cmd: string, ...args: string[]) => Promise<[string, string[]]> };
      }).client;
      const prefix = (adapter as unknown as { options: { keyPrefix: string } }).options.keyPrefix;
      const [, keys] = await client.raw('SCAN', '0', 'MATCH', `${prefix}queue:q:orders.oneshot`, 'COUNT', '100');

      expect(keys).toEqual([]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('honours retry.attempts, numbering the attempts it delivers', async () => {
      const seen: Array<{ attempt?: number; maxAttempts?: number; redelivered?: boolean }> = [];

      await adapter.subscribe('orders.retried', async (message) => {
        seen.push({
          attempt: message.attempt,
          maxAttempts: message.maxAttempts,
          redelivered: message.redelivered,
        });
        throw new Error('handler exploded');
      }, { retry: { attempts: 3, backoff: 'fixed', delay: 10 } });

      await adapter.publish('orders.retried', { orderId: 1 });
      await waitFor(() => seen.length >= 3, 10_000);
      await Bun.sleep(600);

      expect(seen).toEqual([
        { attempt: 1, maxAttempts: 3, redelivered: false },
        { attempt: 2, maxAttempts: 3, redelivered: true },
        { attempt: 3, maxAttempts: 3, redelivered: true },
      ]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('parks a delayed retry in Redis, carrying the attempt counter, not in this process', async () => {
      // Two claims in one test, and both matter. The counter has to survive the round trip
      // through Redis — a retry is a re-push, and the replica that claims it next is not
      // necessarily the one that failed, so an in-process counter would restart at 1 on every
      // hop and make `attempts: 2` loop forever. And the WAIT has to be in Redis too: a retry
      // sleeping in a closure is a message held by one process and written nowhere.
      const client = (adapter as unknown as {
        client: { zrangebyscore: (k: string, min: string, max: string) => Promise<string[]> };
      }).client;
      const prefix = (adapter as unknown as { options: { keyPrefix: string } }).options.keyPrefix;
      const delayedKey = `${prefix}queue:delayed`;

      let calls = 0;
      // Long enough to look at the delayed set while the retry is still waiting in it.
      await adapter.subscribe('orders.persisted', async () => {
        calls += 1;
        throw new Error('handler exploded');
      }, { retry: { attempts: 2, backoff: 'fixed', delay: 900 } });

      await adapter.publish('orders.persisted', { orderId: 1 });
      await waitFor(() => calls >= 1);

      let parked: string[] = [];
      await waitFor(async () => {
        parked = await client.zrangebyscore(delayedKey, '-inf', '+inf');

        return parked.length > 0;
      });

      const envelope = JSON.parse(parked[0]);
      expect(envelope.attempt).toBe(2);
      expect(envelope.pattern).toBe('orders.persisted');
      expect(envelope.data).toEqual({ orderId: 1 });

      // And it does come back — the parked copy is a real redelivery, not a leak.
      await waitFor(() => calls >= 2, 10_000);
      await Bun.sleep(600);
      expect(calls).toBe(2);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('reports a polling failure instead of discarding it', async () => {
      const errors: Error[] = [];
      adapter.on('onError', (error) => {
        errors.push(error as Error);
      });

      await adapter.subscribe('orders.polled', async () => undefined);

      // Break the command the poll loop uses. The loop used to swallow this in a bare `catch {}`,
      // so an unreachable Redis was indistinguishable from an empty queue.
      const client = (adapter as unknown as { client: { lpop: (key: string) => Promise<unknown> } }).client;
      const originalLpop = client.lpop.bind(client);
      client.lpop = () => Promise.reject(new Error('LPOP exploded'));

      try {
        await waitFor(() => errors.length > 0);
        expect(errors[0].message).toContain('LPOP exploded');
      } finally {
        client.lpop = originalLpop;
      }
    }, CONTAINER_TEST_TIMEOUT_MS);
  });


  describe('features', () => {
    it('should support all standard queue features', () => {
      expect(adapter.supports('delayed-messages')).toBe(true);
      expect(adapter.supports('priority')).toBe(true);
      expect(adapter.supports('dead-letter-queue')).toBe(true);
      expect(adapter.supports('retry')).toBe(true);
      expect(adapter.supports('consumer-groups')).toBe(true);
      expect(adapter.supports('pattern-subscriptions')).toBe(true);
    });
  });

  describe('events', () => {
    it('should register and unregister event handlers', () => {
      const handler = mock(() => undefined);
      
      adapter.on('onReady', handler);
      adapter.off('onReady', handler);
      
      // No assertion needed - just checking no errors
    });

    it('should emit onError event on connection failure', async () => {
      const originalCreateClient = SharedRedisProvider.createClient.bind(SharedRedisProvider);
      SharedRedisProvider.createClient = () => ({
        connect: () => Promise.reject(new Error('Connection refused')),
      }) as ReturnType<typeof SharedRedisProvider.createClient>;

      try {
        const badAdapter = new RedisQueueAdapter({
          useSharedClient: false,
          url: 'redis://localhost:9999',
        });

        const onError = mock(() => undefined);
        badAdapter.on('onError', onError);

        await expect(badAdapter.connect()).rejects.toThrow('Connection refused');
        expect(onError).toHaveBeenCalledTimes(1);
      } finally {
        SharedRedisProvider.createClient = originalCreateClient;
      }
    });
  });
});

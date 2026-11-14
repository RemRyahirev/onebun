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

import type { Message } from '../types';

import { SharedRedisProvider } from '../../redis/shared-redis';
import { createRedisContainer, type TestContainer } from '../../testing/containers';
import { QueueScheduler } from '../scheduler';


import { RedisQueueAdapter, createRedisQueueAdapter } from './redis.adapter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** Reaches the adapter's raw client and key layout, to write what `publish()` never would. */
function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}

const CONTAINER_TEST_TIMEOUT_MS = 30_000;
/** Starting and stopping the Redis container takes far longer than a hook's default 5 s. */
const CONTAINER_BOOT_MS = 120_000;

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
    // The provider holds ONE configuration per process and refuses a conflicting second one,
    // so take it over explicitly rather than inheriting whatever an earlier FILE left behind.
    await SharedRedisProvider.reset();
    SharedRedisProvider.configure({ url: redis.url });
  }, CONTAINER_BOOT_MS);

  afterAll(async () => {
    await SharedRedisProvider.reset();
    await redis.stop();
  }, CONTAINER_BOOT_MS);

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
      const captured: Array<Record<string, string>> = [];

      await adapter.subscribe('orders.{id}', async (message) => {
        seen.push(message.pattern);
        captured.push(message.params);
      });

      await adapter.publish('orders.123', { total: 10 });

      await waitFor(() => seen.length > 0);
      await Bun.sleep(400);

      // The subscription used to listen on the literal channel `queue:ch:orders.{id}` and LPOP the
      // literal key `queue:q:orders.{id}` — names nothing ever writes to — so it was silently dead.
      expect(seen).toEqual(['orders.123']);

      // And the captured value reaches the handler. It is derived from the delivered topic on
      // this side of the wire — the envelope carries the topic, never the captures, so a
      // requeued message cannot deliver another subscription's values.
      expect(captured).toEqual([{ id: '123' }]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('reports the topic as the subject, with pattern and params unchanged for a published message', async () => {
      const received: Array<{ subject?: string; pattern: string; params: Record<string, string>; stream?: string }> = [];

      await adapter.subscribe('orders.{id}', async (message) => {
        received.push({
          subject: message.subject, pattern: message.pattern, params: message.params, stream: message.stream,
        });
      });

      await adapter.publish('orders.321', { total: 1 });
      await adapter.publish('orders.654', { total: 2 }, { delay: 50 });
      await adapter.publish('orders.987', { total: 3 }, { priority: 5 });

      await waitFor(() => received.length === 3);

      // Direct, delayed and priority publishes all reach the list their envelope names, so the
      // list topic and the envelope agree on every path `publish()` takes.
      expect(received.map(m => m.subject).sort()).toEqual(['orders.321', 'orders.654', 'orders.987']);
      for (const message of received) {
        expect(message.pattern).toBe(message.subject!);
        expect(message.params).toEqual({ id: message.subject!.split('.')[1] });
        expect(message.stream).toBeUndefined();
      }
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('takes pattern and params from the list a message was claimed from, not from its envelope', async () => {
      // A writer with access to `orders.1`'s list pushes an envelope naming another topic.
      const subjects: Array<string | undefined> = [];
      const captured: Array<Record<string, string>> = [];

      await adapter.subscribe('orders.{id}', async (message) => {
        subjects.push(message.subject);
        captured.push(message.params);

        if (subjects.length === 1) {
          throw new Error('retry me');
        }
      }, { retry: { attempts: 2, delay: 0 } });

      const raw = asAny(adapter);
      await raw.client.rpush(raw.keys.queue('orders.1'), JSON.stringify({
        id: 'forged-1', pattern: 'orders.999', data: {}, timestamp: Date.now(), metadata: {},
      }));
      await raw.client.publish(raw.keys.wake, 'orders.1');

      await waitFor(() => subjects.length === 2);

      // The retry goes back onto the same list: the claimed topic is the message's topic from
      // then on, so the envelope cannot move it onto another one either.
      expect(subjects).toEqual(['orders.1', 'orders.1']);
      expect(captured).toEqual([{ id: '1' }, { id: '1' }]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    describe('a message published with undefined data', () => {
      // `JSON.stringify` drops `data: undefined`, so these entries carry no `data` key at all —
      // and they are still the framework's own writes, which every check has to let through.

      /** Collects every delivery and every reported error on `adapter`. */
      function observe(): { received: Message[]; errors: Error[] } {
        const received: Message[] = [];
        const errors: Error[] = [];
        adapter.on('onError', (error) => {
          errors.push(error);
        });

        return { received, errors };
      }

      it('delivers a direct publish on a literal and on a pattern subscription', async () => {
        const { received, errors } = observe();
        await adapter.subscribe('empty.direct', async (message) => {
          received.push(message);
        });
        await adapter.subscribe('emptyp.*', async (message) => {
          received.push(message);
        });

        await adapter.publish('empty.direct', undefined);
        await adapter.publish('emptyp.direct', undefined);
        await waitFor(() => received.length === 2);

        expect(received.map(m => m.subject).sort()).toEqual(['empty.direct', 'emptyp.direct']);
        expect(received.every(m => m.data === undefined && typeof m.id === 'string')).toBe(true);
        expect(errors).toEqual([]);
      }, CONTAINER_TEST_TIMEOUT_MS);

      it('delivers a delayed publish', async () => {
        const { received, errors } = observe();
        await adapter.subscribe('empty.delayed', async (message) => {
          received.push(message);
        });

        await adapter.publish('empty.delayed', undefined, { delay: 50 });
        await waitFor(() => received.length === 1);

        expect(received[0].data).toBeUndefined();
        expect(errors).toEqual([]);
      }, CONTAINER_TEST_TIMEOUT_MS);

      it('delivers what an interval job whose method returns nothing publishes', async () => {
        const { received, errors } = observe();
        await adapter.subscribe('empty.tick', async (message) => {
          received.push(message);
        });

        // `runOnStart` defaults to true, so the first tick publishes as soon as the job starts.
        const scheduler = new QueueScheduler(adapter);
        scheduler.addIntervalJob('empty-tick', 60_000, 'empty.tick', async () => undefined);
        scheduler.start();

        try {
          await waitFor(() => received.length === 1);
        } finally {
          scheduler.stop();
        }

        expect(received[0].data).toBeUndefined();
        expect(errors).toEqual([]);
      }, CONTAINER_TEST_TIMEOUT_MS);
    });

    // A list is a plain key: anything with keyspace access can push onto it. Only what
    // `publish()` writes may reach a handler; the rest is reported, naming the topic, and the
    // drain carries on with the next entry.
    const foreignEntries: Array<[label: string, raw: string]> = [
      ['an empty object', '{}'],
      ['an array', '[1]'],
      ['an object with data but no id or timestamp', '{"data":1}'],
      ['a number', '42'],
      ['a string', '"x"'],
      ['text that is not JSON', 'not json'],
      ['an envelope whose metadata is not an object', '{"id":"m","timestamp":1,"data":{},"metadata":[]}'],
      ['an envelope whose attempt is not a number', '{"id":"m","timestamp":1,"data":{},"attempt":"2"}'],
    ];

    for (const [index, [label, raw]] of foreignEntries.entries()) {
      for (const subscription of ['literal', 'pattern'] as const) {
        it(`reports ${label} on a ${subscription} subscription instead of delivering it`, async () => {
          const topic = `junk.${subscription}.${index}`;
          const handled: string[] = [];
          const errors: Error[] = [];
          adapter.on('onError', (error) => {
            errors.push(error);
          });

          await adapter.subscribe(subscription === 'literal' ? topic : `junk.${subscription}.*`, async (message) => {
            handled.push(message.id);
          });

          const client = asAny(adapter);
          await client.client.rpush(client.keys.queue(topic), raw);
          await client.client.rpush(client.keys.queue(topic), JSON.stringify({
            id: 'valid-after', pattern: topic, data: {}, timestamp: Date.now(), metadata: {},
          }));
          await client.client.publish(client.keys.wake, topic);

          // The valid entry behind the foreign one is the sync point: once it is handled, the
          // foreign one has been claimed and dealt with.
          await waitFor(() => handled.length === 1);

          expect(handled).toEqual(['valid-after']);
          expect(errors).toHaveLength(1);
          expect(errors[0].message).toContain(`"${topic}"`);
          expect(errors[0].message).toContain('not handed to any handler');
        }, CONTAINER_TEST_TIMEOUT_MS);
      }
    }

    it('captures every parameter of a multi-parameter pattern', async () => {
      // One parameter can be right by coincidence — a regex capturing the wrong segment still
      // produces something. Two at different depths cannot.
      const captured: Array<Record<string, string>> = [];

      await adapter.subscribe('orders.{id}.items.{itemId}', async (message) => {
        captured.push(message.params);
      });

      await adapter.publish('orders.42.items.abc', { qty: 1 });

      await waitFor(() => captured.length > 0);

      expect(captured).toEqual([{ id: '42', itemId: 'abc' }]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('answers with an empty object for a pattern that captures nothing', async () => {
      const captured: Array<Record<string, string>> = [];

      await adapter.subscribe('events.*', async (message) => {
        captured.push(message.params);
      });

      await adapter.publish('events.created', { a: 1 });

      await waitFor(() => captured.length > 0);

      // Never undefined, so a handler reads `message.params.x` without guarding the access.
      expect(captured[0]).toEqual({});
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

    it('never lets a polling failure become a process-level unhandled rejection', async () => {
      // The poll loop is invoked without an `await` and re-scheduled by a bare `setTimeout`, so
      // anything escaping it lands on the process, not on the adapter. An operator got
      // `[unhandledRejection] ...` instead of the queue error event the adapter defines for it.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);

      const errors: Error[] = [];
      adapter.on('onError', (error) => {
        errors.push(error as Error);
      });

      const client = (adapter as unknown as {
        client: { lpop: (key: string) => Promise<unknown> };
      }).client;
      const originalLpop = client.lpop.bind(client);

      try {
        await adapter.subscribe('orders.unhandled', async () => undefined);
        client.lpop = () => Promise.reject(new Error('LPOP exploded'));

        await waitFor(() => errors.length > 0);
        // Let several poll cycles run: one escaping rejection anywhere in the loop is enough.
        await Bun.sleep(600);

        expect(errors.length).toBeGreaterThan(0);
        expect(unhandled).toEqual([]);
      } finally {
        client.lpop = originalLpop;
        process.off('unhandledRejection', onUnhandled);
      }
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('backs off a repeatedly failing poll instead of retrying at full rate', async () => {
      // A 100 ms poll against a dead broker is ten connection attempts and ten error events per
      // second, per subscription — reporting the failure without slowing down turns an outage
      // into a flood. The backoff is what makes the report survivable.
      const errors: Error[] = [];
      adapter.on('onError', (error) => {
        errors.push(error as Error);
      });

      const client = (adapter as unknown as {
        client: { lpop: (key: string) => Promise<unknown> };
      }).client;
      const originalLpop = client.lpop.bind(client);

      try {
        await adapter.subscribe('orders.backoff', async () => undefined);
        client.lpop = () => Promise.reject(new Error('LPOP exploded'));

        await waitFor(() => errors.length > 0);
        await Bun.sleep(1000);

        // At the unthrottled 100 ms interval this second would hold ~10 failures. The backoff
        // doubles from 100 ms to the 1000 ms ceiling, so it holds far fewer.
        expect(errors.length).toBeLessThan(8);
      } finally {
        client.lpop = originalLpop;
      }
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('recovers the full poll rate once a poll succeeds again', async () => {
      // A backoff that never resets is an outage that outlives itself.
      const errors: Error[] = [];
      adapter.on('onError', (error) => {
        errors.push(error as Error);
      });

      const client = (adapter as unknown as {
        client: { lpop: (key: string) => Promise<unknown> };
      }).client;
      const originalLpop = client.lpop.bind(client);

      try {
        const received: unknown[] = [];
        await adapter.subscribe('orders.recover', async (message) => {
          received.push(message.data);
        });

        client.lpop = () => Promise.reject(new Error('LPOP exploded'));
        await waitFor(() => errors.length > 0);
        await Bun.sleep(400);

        client.lpop = originalLpop;
        await adapter.publish('orders.recover', { orderId: 1 });

        // Delivered on the normal cadence, not after a backed-off wait.
        await waitFor(() => received.length > 0, 3000);
        expect(received).toEqual([{ orderId: 1 }]);
      } finally {
        client.lpop = originalLpop;
      }
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('republishes an exhausted message to deadLetter.queue, consumable with subscribe()', async () => {
      // The whole point of the change. The old implementation RPUSHed to a per-pattern list that
      // had no reader — no LPOP, no SCAN, no subscription — so a "dead-lettered" message was
      // indistinguishable from a dropped one unless you went in with redis-cli.
      let attempts = 0;
      const dead: Array<{ pattern: string; data: unknown; id: string; timestamp: number }> = [];

      await adapter.subscribe('orders.dlq-src', async () => {
        attempts += 1;
        throw new Error('handler exploded');
      }, { deadLetter: { queue: 'orders.dead', maxRetries: 2 } });

      await adapter.subscribe('orders.dead', async (message) => {
        dead.push({
          pattern: message.pattern,
          data: message.data,
          id: message.id,
          timestamp: message.timestamp,
        });
      });

      const messageId = await adapter.publish('orders.dlq-src', { orderId: 42 });

      await waitFor(() => dead.length > 0, 10_000);
      await Bun.sleep(600);

      // `maxRetries: 2` capped the attempts, then the terminal delivery was routed.
      expect(attempts).toBe(2);
      expect(dead).toHaveLength(1);
      expect(dead[0].data).toEqual({ orderId: 42 });
      expect(dead[0].id).toBe(messageId);
      expect(dead[0].timestamp).toBeGreaterThan(0);
      // The dead-lettered copy is addressed to the DLQ; its origin lives in metadata.
      expect(dead[0].pattern).toBe('orders.dead');
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('lets retry.attempts win over deadLetter.maxRetries when both are set', async () => {
      // The cap chain is `retry.attempts ?? deadLetter.maxRetries ?? 1`, the same precedence
      // JetStream uses for `max_deliver`. With both present the explicit retry budget decides.
      let attempts = 0;
      const dead: unknown[] = [];

      await adapter.subscribe('orders.prec-src', async () => {
        attempts += 1;
        throw new Error('handler exploded');
      }, { retry: { attempts: 3, backoff: 'fixed', delay: 10 }, deadLetter: { queue: 'orders.prec-dead', maxRetries: 1 } });

      await adapter.subscribe('orders.prec-dead', async (message) => {
        dead.push(message.data);
      });

      await adapter.publish('orders.prec-src', { orderId: 11 });

      await waitFor(() => dead.length > 0, 10_000);
      await Bun.sleep(600);

      // 3, not the 1 that `maxRetries` alone would have given.
      expect(attempts).toBe(3);
      expect(dead).toEqual([{ orderId: 11 }]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('stamps the dead letter with its origin, delivery count and error', async () => {
      const dead: Array<Record<string, unknown>> = [];

      await adapter.subscribe('orders.stamped-src', async () => {
        throw new Error('inventory unavailable');
      }, { deadLetter: { queue: 'orders.stamped-dead', maxRetries: 1 } });

      await adapter.subscribe('orders.stamped-dead', async (message) => {
        dead.push(message.metadata as Record<string, unknown>);
      });

      await adapter.publish('orders.stamped-src', { orderId: 7 }, { metadata: { headers: { tenant: 'acme' } } });

      await waitFor(() => dead.length > 0, 10_000);
      await Bun.sleep(400);

      expect(dead[0]['dlq.originalPattern']).toBe('orders.stamped-src');
      expect(dead[0]['dlq.deliveryCount']).toBe(1);
      expect(dead[0]['dlq.error']).toBe('inventory unavailable');
      // The caller's own metadata survives — the `dlq.` prefix is what keeps them apart.
      expect(dead[0].headers).toEqual({ tenant: 'acme' });
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('does not dead-letter a message whose handler succeeds', async () => {
      const dead: unknown[] = [];
      let handled = 0;

      await adapter.subscribe('orders.happy-src', async () => {
        handled += 1;
      }, { deadLetter: { queue: 'orders.happy-dead', maxRetries: 3 } });

      await adapter.subscribe('orders.happy-dead', async (message) => {
        dead.push(message.data);
      });

      await adapter.publish('orders.happy-src', { orderId: 1 });

      await waitFor(() => handled > 0);
      await Bun.sleep(600);

      expect(handled).toBe(1);
      expect(dead).toEqual([]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('dead-letters a message at most once, even when the DLQ handler also throws', async () => {
      // Without the marker this ping-pongs: the DLQ subscriber fails, routes to its own DLQ,
      // which is itself, forever.
      let sourceAttempts = 0;
      let deadAttempts = 0;

      await adapter.subscribe('orders.loop-src', async () => {
        sourceAttempts += 1;
        throw new Error('source exploded');
      }, { deadLetter: { queue: 'orders.loop-dead', maxRetries: 1 } });

      await adapter.subscribe('orders.loop-dead', async () => {
        deadAttempts += 1;
        throw new Error('dead-letter handler exploded too');
      }, { deadLetter: { queue: 'orders.loop-dead', maxRetries: 1 } });

      await adapter.publish('orders.loop-src', { orderId: 5 });

      await waitFor(() => deadAttempts > 0, 10_000);
      // Long enough for a loop to be obvious if the guard were missing.
      await Bun.sleep(1200);

      expect(sourceAttempts).toBe(1);
      expect(deadAttempts).toBe(1);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('retries without dead-lettering when retry is set and deadLetter is not', async () => {
      // The two options are independent: `retry` alone must not invent a destination.
      let attempts = 0;

      await adapter.subscribe('orders.no-dlq', async () => {
        attempts += 1;
        throw new Error('handler exploded');
      }, { retry: { attempts: 3, backoff: 'fixed', delay: 10 } });

      await adapter.publish('orders.no-dlq', { orderId: 3 });
      await waitFor(() => attempts >= 3, 10_000);
      await Bun.sleep(600);

      expect(attempts).toBe(3);

      // Nothing was written anywhere under this adapter's prefix.
      const client = (adapter as unknown as {
        client: { raw: (cmd: string, ...args: string[]) => Promise<[string, string[]]> };
      }).client;
      const prefix = (adapter as unknown as { options: { keyPrefix: string } }).options.keyPrefix;
      const [, keys] = await client.raw('SCAN', '0', 'MATCH', `${prefix}queue:q:*`, 'COUNT', '1000');

      expect(keys).toEqual([]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('keeps redelivering under attempts: -1 and never dead-letters by count', async () => {
      const seen: Array<{ attempt?: number; maxAttempts?: number }> = [];
      const dead: unknown[] = [];

      await adapter.subscribe('orders.endless', async (message) => {
        seen.push({ attempt: message.attempt, maxAttempts: message.maxAttempts });
        throw new Error('handler exploded');
      }, { retry: { attempts: -1, backoff: 'fixed', delay: 10 }, deadLetter: { queue: 'orders.endless-dead' } });

      await adapter.subscribe('orders.endless-dead', async (message) => {
        dead.push(message.data);
      });

      await adapter.publish('orders.endless', { orderId: 21 });
      // Past the default of 1 and past the `deadLetter.maxRetries` default a cap would fall to.
      await waitFor(() => seen.length >= 8, 15_000);

      expect(seen.slice(0, 8).map((entry) => entry.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(seen.every((entry) => entry.maxAttempts === -1)).toBe(true);
      expect(dead).toEqual([]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('reads attempts: 0 and deadLetter.maxRetries: -1 as no limit as well', async () => {
      let zero = 0;
      let fromDeadLetter = 0;
      const reported = new Set<number | undefined>();
      const dead: unknown[] = [];

      await adapter.subscribe('orders.zero', async (message) => {
        zero += 1;
        reported.add(message.maxAttempts);
        throw new Error('handler exploded');
      }, { retry: { attempts: 0, delay: 10 }, deadLetter: { queue: 'orders.unlimited-dead' } });

      await adapter.subscribe('orders.maxretries', async (message) => {
        fromDeadLetter += 1;
        reported.add(message.maxAttempts);
        throw new Error('handler exploded');
      }, { deadLetter: { queue: 'orders.unlimited-dead', maxRetries: -1 } });

      await adapter.subscribe('orders.unlimited-dead', async (message) => {
        dead.push(message.data);
      });

      await adapter.publish('orders.zero', { orderId: 1 });
      await adapter.publish('orders.maxretries', { orderId: 2 });
      await waitFor(() => zero >= 4 && fromDeadLetter >= 4, 15_000);

      expect([...reported]).toEqual([-1]);
      expect(dead).toEqual([]);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('parks the retry of deadLetter.maxRetries: -1 with no retry for the default delay, never zero', async () => {
      // A zero wait skips the delayed set and LPUSHes straight back: with no last attempt that is
      // a message cycling through Redis as fast as it answers.
      const client = (adapter as unknown as {
        client: { zrangebyscore: (k: string, min: string, max: string) => Promise<string[]> };
      }).client;
      const prefix = (adapter as unknown as { options: { keyPrefix: string } }).options.keyPrefix;
      const delayedKey = `${prefix}queue:delayed`;

      let calls = 0;
      await adapter.subscribe('orders.dl-only', async () => {
        calls += 1;
        throw new Error('handler exploded');
      }, { deadLetter: { queue: 'orders.dl-only-dead', maxRetries: -1 } });

      await adapter.publish('orders.dl-only', { orderId: 8 });
      await waitFor(() => calls >= 1);

      let parked: string[] = [];
      await waitFor(async () => {
        parked = await client.zrangebyscore(delayedKey, '-inf', '+inf');

        return parked.length > 0;
      });
      expect(JSON.parse(parked[0]).attempt).toBe(2);

      // Paced by the 100 ms default: a handful of attempts in half a second, not hundreds.
      await Bun.sleep(500);
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThan(10);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('parks a retry in the delayed set no further out than retry.maxDelay', async () => {
      const client = (adapter as unknown as {
        client: { zrangebyscore: (k: string, min: string, max: string) => Promise<string[]> };
      }).client;
      const prefix = (adapter as unknown as { options: { keyPrefix: string } }).options.keyPrefix;
      const delayedKey = `${prefix}queue:delayed`;

      let calls = 0;
      // The formula alone would park the first retry 10 s out.
      await adapter.subscribe('orders.max-delay', async () => {
        calls += 1;
        throw new Error('handler exploded');
      }, {
        retry: {
          attempts: 2, backoff: 'fixed', delay: 10_000, maxDelay: 900, 
        }, 
      });

      await adapter.publish('orders.max-delay', { orderId: 1 });
      await waitFor(() => calls >= 1);

      // The delayed set is scored by due time: a member at or below now + 2 s was parked by the
      // ceiling, not by the 10 s the formula gives.
      let dueSoon: string[] = [];
      await waitFor(async () => {
        dueSoon = await client.zrangebyscore(delayedKey, '-inf', String(Date.now() + 2000));

        return dueSoon.length > 0;
      });
      expect(JSON.parse(dueSoon[0]).attempt).toBe(2);

      await waitFor(() => calls >= 2, 10_000);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('refuses an invalid retry.maxDelay when the subscription is registered', async () => {
      await expect(adapter.subscribe('orders.bad-max-delay', async () => undefined, { retry: { maxDelay: -1 } }))
        .rejects.toThrow(/retry\.maxDelay.*"orders\.bad-max-delay"/);
    });

    it('registers and polls nothing when it refuses an invalid retry.maxDelay', async () => {
      const internals = adapter as unknown as { subscriptions: unknown[]; startQueuePolling: () => void };
      let polled = 0;
      const original = internals.startQueuePolling.bind(adapter);
      internals.startQueuePolling = () => {
        polled += 1;
        original();
      };

      try {
        await expect(adapter.subscribe('orders.refused', async () => undefined, { retry: { maxDelay: Number.NaN } }))
          .rejects.toThrow(/retry\.maxDelay/);

        expect(internals.subscriptions).toHaveLength(0);
        expect(polled).toBe(0);
      } finally {
        internals.startQueuePolling = original;
      }
    });

    it('stops an unlimited retry as soon as the handler succeeds', async () => {
      let calls = 0;
      let processed = 0;
      adapter.on('onMessageProcessed', () => {
        processed += 1;
      });

      await adapter.subscribe('orders.recovers', async () => {
        calls += 1;
        if (calls < 5) {
          throw new Error('transient');
        }
      }, { retry: { attempts: -1, backoff: 'fixed', delay: 10 } });

      await adapter.publish('orders.recovers', { orderId: 4 });
      await waitFor(() => processed > 0, 15_000);
      await Bun.sleep(400);

      expect(calls).toBe(5);
      expect(processed).toBe(1);
    }, CONTAINER_TEST_TIMEOUT_MS);

    it('reports a dead letter that could not be republished instead of losing it silently', async () => {
      const errors: Error[] = [];
      adapter.on('onError', (error) => {
        errors.push(error as Error);
      });

      const client = (adapter as unknown as {
        client: { rpush: (key: string, ...values: string[]) => Promise<number> };
      }).client;
      const originalRpush = client.rpush.bind(client);

      // Broken from inside the handler, so the original publish still lands and only the
      // dead-letter republish that follows this throw fails.
      await adapter.subscribe('orders.dlq-broken', async () => {
        client.rpush = () => Promise.reject(new Error('RPUSH exploded'));
        throw new Error('handler exploded');
      }, { deadLetter: { queue: 'orders.dlq-broken-dead', maxRetries: 1 } });

      try {
        await adapter.publish('orders.dlq-broken', { orderId: 9 });
        await waitFor(() => errors.some((e) => e.message.includes('dead letter')), 10_000);

        const reported = errors.find((e) => e.message.includes('dead letter'))!;
        expect(reported.message).toContain('orders.dlq-broken');
        expect(reported.message).toContain('orders.dlq-broken-dead');
        expect((reported.cause as Error).message).toBe('RPUSH exploded');
      } finally {
        client.rpush = originalRpush;
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

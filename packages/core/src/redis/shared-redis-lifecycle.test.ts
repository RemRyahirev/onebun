/**
 * Who owns a hold on the shared Redis client.
 *
 * The count was not an ownership record. Acquisition was per CONSUMER — a cache, a queue
 * adapter — while release was one per APPLICATION, in `stop()`, gated on the client being
 * connected rather than on this application having acquired anything. Measured against a live
 * Redis, that broke in both directions:
 *
 *   [after redis-LESS app stop]  leaseCount=0 isConnected=false
 *   [queue] publish after THREW: Redis client not connected. Call connect() first.
 *
 * — an application with no Redis at all took a sibling's hold to zero on its own shutdown, and
 * the sibling's next publish failed. And:
 *
 *   [after boot] leaseCount=2 ... [after stop] leaseCount=1 isConnected=true
 *
 * — an application with two consumers gave back one of two, so the socket outlived every
 * application in the process.
 *
 * The rule now: whoever acquires gives back, and the connection closes when the last holder
 * lets go. An application releases nothing.
 *
 * NOTE for anyone extending this file: never check the fix through a `RedisCache` round trip.
 * `ensureClient()` re-dials silently, so a torn-down connection still answers `get`/`set` and
 * the test measures nothing. Assert on the QUEUE, on a captured client handle, or on the count.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import type { Message } from '../queue/types';

import { OneBunApplication } from '../application/application';
import { Controller, Module } from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { Subscribe } from '../queue/decorators';
import { createRedisContainer, type TestContainer } from '../testing/containers';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { SharedRedisProvider } from './shared-redis';

const QUEUE_PREFIX = 'wi370:';
const DELIVERY_TIMEOUT_MS = 3000;

describe('shared Redis holds belong to whoever took them', () => {
  let redis: TestContainer;

  beforeAll(async () => {
    redis = await createRedisContainer();
  });

  afterAll(async () => {
    await SharedRedisProvider.reset();
    await redis.stop();
  });

  afterEach(async () => {
    await SharedRedisProvider.reset();
  });

  /** An application with a Redis-backed queue, and nothing else Redis-related. */
  function queueApp(received: Array<{ id: string }>): OneBunApplication {
    @Controller('/orders')
    class OrderProcessor extends BaseController {
      @Subscribe('wi370.created')
      handle(message: Message<{ id: string }>): void {
        received.push(message.data);
      }
    }

    @Module({ controllers: [OrderProcessor] })
    class QueueModule {}

    return new OneBunApplication(QueueModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      queue: { adapter: 'redis', redis: { useSharedProvider: true, prefix: QUEUE_PREFIX } },
    });
  }

  /** An application that has nothing to do with Redis at all. */
  function plainApp(): OneBunApplication {
    @Controller('/health')
    class HealthController extends BaseController {}

    @Module({ controllers: [HealthController] })
    class PlainModule {}

    return new OneBunApplication(PlainModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
  }

  it('does not let an application with no Redis break one that has it', async () => {
    SharedRedisProvider.configure({ url: redis.url });

    const received: Array<{ id: string }> = [];
    const withQueue = queueApp(received);
    await withQueue.start();

    const handle = await SharedRedisProvider.reacquire();
    const heldBefore = SharedRedisProvider.leaseCount();

    const plain = plainApp();
    await plain.start();
    await plain.stop();

    try {
      // Before: `plain` never acquired anything, released on stop anyway, and the count went to
      // zero — disconnecting the client the queue was still using.
      expect(SharedRedisProvider.leaseCount()).toBe(heldBefore);
      expect(handle.isConnected()).toBe(true);

      // The assertion that matters: a live application still works. This threw
      // `Redis client not connected. Call connect() first.`
      await withQueue.getQueueService()!.publish('wi370.created', { id: 'after-sibling-stop' });

      const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(received).toEqual([{ id: 'after-sibling-stop' }]);
    } finally {
      await withQueue.stop();
    }
  }, 30_000);

  it('closes the connection only when the last holder lets go', async () => {
    SharedRedisProvider.configure({ url: redis.url });

    const withQueue = queueApp([]);
    await withQueue.start();

    // A second consumer in the same process, standing in for anything else that takes a hold.
    const other = await SharedRedisProvider.acquire('a-second-consumer');

    expect(SharedRedisProvider.leaseCount()).toBe(2);

    await withQueue.stop();

    // Before: the application released ONE hold for however many its consumers took, so the
    // arithmetic was wrong in both directions. Now it releases none and its queue adapter
    // releases its own.
    expect(SharedRedisProvider.leaseCount()).toBe(1);
    expect(other.client.isConnected()).toBe(true);

    await other.release();

    expect(SharedRedisProvider.isConnected()).toBe(false);
    await expect(other.client.set('wi370:dead', 'x')).rejects.toThrow();
  }, 30_000);

  it('leaves a hold taken outside any application for its taker to give back', async () => {
    SharedRedisProvider.configure({ url: redis.url });

    // The documented recipe: take the client by hand, hand it to something, release it yourself.
    const client = await SharedRedisProvider.getClient();
    const plain = plainApp();

    await plain.start();
    await plain.stop();

    // The application does not tidy up after code it never knew about — and the holder is
    // named in the shutdown diagnostic so a process that will not exit says why.
    expect(client.isConnected()).toBe(true);
    expect(SharedRedisProvider.leaseHolders()[0]).toMatch(/shared-redis-lifecycle\.test\.ts:\d+:\d+/);

    await SharedRedisProvider.release();

    expect(SharedRedisProvider.isConnected()).toBe(false);
  }, 30_000);
});

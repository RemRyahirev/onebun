/**
 * Documentation coverage tests for docs/api/queue.md sections that `docs-examples.test.ts`
 * leaves unpinned.
 *
 * The `### RedisQueueAdapter` section prints two application configurations and promises a
 * behavioural difference between them — shared Redis connection versus a dedicated one —
 * plus a key prefix that the adapter is supposed to honour. Nothing about that survives a
 * compile check: both snippets typecheck even if `prefix` is dropped on the floor or
 * `useSharedProvider: false` quietly reuses the shared client. These tests run a real
 * application against a real Redis and observe which connection is taken and which channel
 * the subscription actually listens on.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

// Through the public specifier, as the page tells the reader to import them.
import {
  BaseController,
  Controller,
  Module,
  OneBunApplication,
  RedisClient,
  SharedRedisProvider,
  Subscribe,
  type Message,
  type SharedRedisOptions,
} from '@onebun/core';

// `@onebun/core/testing` is the documented specifier for these helpers, but it does not
// resolve from inside the core package itself, so core's own tests use the barrel path.
import {
  createRedisContainer,
  makeMockLoggerLayer,
  type TestContainer,
} from '../testing';

/** Prefix printed in the docs snippet for the shared-provider configuration. */
const SHARED_PREFIX = 'myapp:queue:';
/** Prefix the application falls back to when `redis.prefix` is not honoured. */
const DEFAULT_PREFIX = 'onebun:queue:';
/** Distinct prefix for the dedicated-connection configuration. */
const DEDICATED_PREFIX = 'dedicated:queue:';

const DELIVERY_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 10;
const TEST_TIMEOUT_MS = 30000;

/**
 * The wire shape RedisQueueAdapter parses off a pub/sub channel before dispatching to a
 * `@Subscribe` handler.
 */
function wireMessage(pattern: string, data: unknown): string {
  return JSON.stringify({
    id: `docs-${Math.random().toString(36).slice(2)}`,
    pattern,
    data,
    timestamp: Date.now(),
    metadata: {},
  });
}

/**
 * Put a message where the adapter takes it from, and ring the bell.
 *
 * The list is the delivery path and the channel is a wake-up signal — publishing the payload to
 * the channel alone reaches no handler, by design: pub/sub fans out to every subscriber with no
 * way to claim a message, which is what used to deliver each one twice.
 */
async function enqueue(
  client: RedisClient,
  prefix: string,
  pattern: string,
  data: unknown,
): Promise<void> {
  const wire = wireMessage(pattern, data);
  await client.rpush(`${prefix}queue:q:${pattern}`, wire);
  await client.publish(`${prefix}queue:ch:${pattern}`, wire);
}

async function waitForDelivery(received: unknown[]): Promise<void> {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (received.length > 0) {
      return;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for the queue handler to receive a message');
}

describe('RedisQueueAdapter (docs/api/queue.md)', () => {
  let container: TestContainer;
  let publisher: RedisClient;
  let originalSharedOptions: SharedRedisOptions | null = null;

  beforeAll(async () => {
    // The shared provider is process-global: remember whatever another suite configured so
    // this file can hand it back untouched.
    originalSharedOptions = SharedRedisProvider.getOptions();
    container = await createRedisContainer();

    // An independent connection standing in for "some other service publishing to Redis".
    publisher = new RedisClient({ url: container.url, keyPrefix: '' });
    await publisher.connect();
  });

  afterAll(async () => {
    await publisher.disconnect();
    await SharedRedisProvider.reset();
    if (originalSharedOptions) {
      SharedRedisProvider.configure(originalSharedOptions);
    }
    await container.stop();
  });

  /**
   * @source docs:api/queue.md#redisqueueadapter
   */
  it(
    'takes the shared Redis connection and subscribes under the configured prefix',
    async () => {
      SharedRedisProvider.configure({ url: container.url });

      const received: Array<{ id: string }> = [];

      @Controller('/orders')
      class SharedOrderProcessor extends BaseController {
        @Subscribe('orders.created')
        async handleOrderCreated(message: Message<{ id: string }>): Promise<void> {
          received.push(message.data);
        }
      }

      @Module({ controllers: [SharedOrderProcessor] })
      class SharedQueueModule {}

      const app = new OneBunApplication(SharedQueueModule, {
        port: 0,
        loggerLayer: makeMockLoggerLayer(),
        queue: {
          adapter: 'redis',
          redis: { useSharedProvider: true, prefix: SHARED_PREFIX },
        },
      });

      const leasesBefore = SharedRedisProvider.leaseCount();
      await app.start();

      try {
        // `adapter: 'redis'` is what actually got wired, not the memory fallback.
        expect(app.getQueueService()!.getAdapter().name).toBe('redis');
        // "Uses SharedRedisProvider by default": the queue holds one lease on the shared
        // client instead of dialling its own connection.
        expect(SharedRedisProvider.leaseCount()).toBe(leasesBefore + 1);
        expect(SharedRedisProvider.isConnected()).toBe(true);

        // Both publishes go out on the same connection in order, so Redis hands the
        // subscriber whatever it is subscribed to in that same order. If `prefix` were
        // ignored, the default-prefix message would be the one that lands.
        await enqueue(publisher, DEFAULT_PREFIX, 'orders.created', { id: 'default-prefix' });
        await enqueue(publisher, SHARED_PREFIX, 'orders.created', { id: 'configured-prefix' });

        await waitForDelivery(received);

        expect(received).toEqual([{ id: 'configured-prefix' }]);
      } finally {
        await app.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );

  /**
   * @source docs:api/queue.md#redisqueueadapter
   */
  it(
    'opens a dedicated connection from the url when useSharedProvider is false',
    async () => {
      // Nothing configured on the shared provider: the dedicated form must not need it,
      // and any fallback to `SharedRedisProvider.getClient()` would throw
      // "SharedRedisProvider not configured" during start().
      await SharedRedisProvider.reset();

      const received: Array<{ id: string }> = [];

      @Controller('/orders')
      class DedicatedOrderProcessor extends BaseController {
        @Subscribe('orders.created')
        async handleOrderCreated(message: Message<{ id: string }>): Promise<void> {
          received.push(message.data);
        }
      }

      @Module({ controllers: [DedicatedOrderProcessor] })
      class DedicatedQueueModule {}

      const app = new OneBunApplication(DedicatedQueueModule, {
        port: 0,
        loggerLayer: makeMockLoggerLayer(),
        queue: {
          adapter: 'redis',
          redis: { useSharedProvider: false, url: container.url, prefix: DEDICATED_PREFIX },
        },
      });

      await app.start();

      try {
        expect(app.getQueueService()!.getAdapter().name).toBe('redis');
        // The shared singleton was never touched — this connection belongs to the queue.
        expect(SharedRedisProvider.isConfigured()).toBe(false);
        expect(SharedRedisProvider.isConnected()).toBe(false);
        expect(SharedRedisProvider.leaseCount()).toBe(0);

        await enqueue(publisher, DEDICATED_PREFIX, 'orders.created', { id: 'over-dedicated-connection' });

        await waitForDelivery(received);

        expect(received).toEqual([{ id: 'over-dedicated-connection' }]);
      } finally {
        await app.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );

  /**
   * @source docs:api/queue.md#redisqueueadapter
   */
  it(
    'refuses to start a dedicated Redis queue with no url rather than falling back to the shared client',
    async () => {
      // The shared client IS available here, so a silent fallback would succeed and make
      // the documented distinction between the two snippets meaningless.
      SharedRedisProvider.configure({ url: container.url });

      @Controller('/orders')
      class UrllessOrderProcessor extends BaseController {
        @Subscribe('orders.created')
        async handleOrderCreated(): Promise<void> {
          // Never reached: start() fails while wiring the adapter.
        }
      }

      @Module({ controllers: [UrllessOrderProcessor] })
      class UrllessQueueModule {}

      const app = new OneBunApplication(UrllessQueueModule, {
        port: 0,
        loggerLayer: makeMockLoggerLayer(),
        queue: {
          adapter: 'redis',
          redis: { useSharedProvider: false },
        },
      });

      const leasesBefore = SharedRedisProvider.leaseCount();

      await expect(app.start()).rejects.toThrow(
        'Redis queue adapter requires either useSharedProvider: true or a url',
      );
      expect(SharedRedisProvider.leaseCount()).toBe(leasesBefore);
    },
    TEST_TIMEOUT_MS,
  );
});

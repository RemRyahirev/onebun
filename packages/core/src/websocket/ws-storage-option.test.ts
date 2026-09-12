/**
 * `websocket.storage` decides where WebSocket state lives — it used to decide nothing.
 *
 * The option was declared on `WebSocketApplicationOptions`, exported from the package, and
 * documented in three places, and no code read it: `WsHandler`'s constructor built
 * `new InMemoryWsStorage()` before looking at any option. Measured against a real application
 * with `storage: { type: 'redis' }` and a live upgrade — the in-memory adapter held the client,
 * and Redis held zero keys. Anyone following the documentation believed they were running
 * multi-instance and was silently single-instance.
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

import { OneBunApplication } from '../application/application';
import { Module } from '../decorators/decorators';
import { createRedisClient, type RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { WebSocketGateway } from './ws-decorators';
import { createRedisWsStorage } from './ws-storage-redis';

const CONTAINER_STARTUP_MS = 120_000;
const OPEN_TIMEOUT_MS = 2000;
const SETTLE_MS = 150;
const WS_PREFIX = 'ws:option:';

@WebSocketGateway({ path: '/ws' })
class StorageGateway extends BaseWebSocketGateway {}

@Module({ controllers: [StorageGateway] })
class StorageModule {}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out opening ${url}`)), OPEN_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`failed to open ${url}`));
    });
  });

  return socket;
}

const settle = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe('websocket.storage', () => {
  let container: TestContainer;
  let observer: RedisClient;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const running: OneBunApplication<any, any>[] = [];
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    container = await createRedisContainer();
    observer = createRedisClient({ url: container.url, keyPrefix: WS_PREFIX });
    await observer.connect();
  }, CONTAINER_STARTUP_MS);

  afterAll(async () => {
    await observer.disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    await createRedisWsStorage(observer).clear();
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
    await Promise.all(running.splice(0).map((app) => app.stop().catch(() => undefined)));
  });

  function boot(storage: Record<string, unknown> | undefined): OneBunApplication {
    const app = new OneBunApplication(StorageModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
      websocket: storage ? { storage } : {},
    } as never);
    running.push(app as never);

    return app;
  }

  /**
   * @source docs:api/websocket.md#storage-adapters
   */
  test('should keep a connection in Redis when the option asks for Redis', async () => {
    const app = boot({ type: 'redis', redis: { url: container.url, prefix: WS_PREFIX } });
    await app.start();

    const socket = await connect(`${app.getHttpUrl().replace('http://', 'ws://')}/ws`);
    sockets.push(socket);
    await settle();

    // Was 0. The option was read by nobody, so the client lived in a Map that dies with the pod.
    const seenFromAnotherConnection = createRedisWsStorage(observer);
    expect(await seenFromAnotherConnection.getClientCount()).toBe(1);
  });

  test('should keep the documented prefix', async () => {
    const app = boot({ type: 'redis', redis: { url: container.url, prefix: WS_PREFIX } });
    await app.start();

    const socket = await connect(`${app.getHttpUrl().replace('http://', 'ws://')}/ws`);
    sockets.push(socket);
    await settle();

    // `prefix` had no parameter to land in — the adapter hardcodes its key names, so the option
    // only means anything if it reaches the CLIENT, which is what owns the namespace. The
    // observer carries the same prefix, so a match here is a match under `ws:option:`.
    expect(await observer.keys('ws:clients:*')).toHaveLength(1);

    // And nothing was written outside it.
    const everything = await observer.raw<string[]>('KEYS', '*');
    expect(everything.every((key) => key.startsWith(WS_PREFIX))).toBe(true);
  });

  test('should stay in memory when the option does not ask for Redis', async () => {
    const app = boot({ type: 'memory' });
    await app.start();

    const socket = await connect(`${app.getHttpUrl().replace('http://', 'ws://')}/ws`);
    sockets.push(socket);
    await settle();

    expect(await createRedisWsStorage(observer).getClientCount()).toBe(0);
  });

  test('should refuse to start when Redis is asked for and no URL can be found', async () => {
    const app = boot({ type: 'redis' });

    // The alternative is starting in memory while the operator believes otherwise, which is
    // exactly the failure this option had for its whole life.
    await expect(app.start()).rejects.toThrow(/websocket\.storage/);
  });
});

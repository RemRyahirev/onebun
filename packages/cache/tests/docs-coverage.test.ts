/**
 * Behavioural coverage for the sections of `docs/api/cache.md` that no test names.
 *
 * The compile gate proves those snippets typecheck; it cannot prove the framework still DOES
 * what the prose around them promises. Every test here drives the documented recipe and asserts
 * the consequence the reader is being sold — the value returned, the entry that expired, the
 * repository call that did NOT happen, the HTTP status, the error text.
 *
 * NOTE ON THE FILENAME: `scripts/docs-xref.ts` scans files named exactly `docs-examples.test.ts`
 * for `@source` tags. This file is deliberately named otherwise, because the package already has
 * a `docs-examples.test.ts`; until the scanner learns this name too, the tags below are
 * documentation for humans rather than coverage the gate counts.
 *
 * @source docs:api/cache.md
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import {
  CacheModule,
  CacheService,
  CacheType,
  cacheServiceTag,
  createCacheModule,
  createInMemoryCache,
  createRedisCache,
  RedisCache,
  SharedRedisProvider,
} from '@onebun/cache';
import {
  BaseController,
  BaseService,
  Body,
  Controller,
  Get,
  HttpException,
  Module,
  OneBunApplication,
  Param,
  Post,
  resetRegistrations,
  Service,
} from '@onebun/core';
import { createTestService, useFakeTimers } from '@onebun/core/testing';

/**
 * Every environment variable any test here writes. Saved and put back around each test, because
 * `process.env` is shared by the whole run.
 */
const ENV_KEYS = [
  'CACHE_TYPE',
  'CACHE_DEFAULT_TTL',
  'CACHE_MAX_SIZE',
  'CACHE_CLEANUP_INTERVAL',
  'CACHE_ALLOW_DEGRADED_START',
  'CACHE_REDIS_HOST',
  'CACHE_REDIS_PORT',
  'CACHE_REDIS_PASSWORD',
  'CACHE_REDIS_DATABASE',
  'CACHE_REDIS_CONNECT_TIMEOUT',
  'CACHE_REDIS_KEY_PREFIX',
  'ORDERS_CACHE_TYPE',
  'ORDERS_CACHE_REDIS_HOST',
  'ORDERS_CACHE_REDIS_PORT',
  'ORDERS_CACHE_REDIS_DATABASE',
  'ORDERS_CACHE_REDIS_CONNECT_TIMEOUT',
];

const savedEnv: Record<string, string | undefined> = {};

/**
 * A port nothing listens on: bound, its number read, then released. Connecting there is what
 * "Redis is unreachable" looks like without depending on a fixed port being free.
 */
function reserveDeadPort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') });
  // `port` is optional on the server type (a unix-socket server has none); this one was bound to
  // a TCP port, so assert rather than silently widen the return type to `number | undefined`.
  const port = server.port;
  server.stop(true);

  if (port === undefined) {
    throw new Error('Bun.serve did not report a port for a TCP listener');
  }

  return port;
}

/**
 * The message `connect()` failed with, or `'connected'` when it did not fail at all.
 *
 * Both outcomes have to be distinguishable: a cache that unexpectedly SUCCEEDS must not read as
 * "failed the way I expected", which is exactly what a bare `rejects.toThrow()` would allow.
 */
async function connectFailure(cache: RedisCache): Promise<string> {
  try {
    await cache.connect();

    return 'connected';
  } catch (error) {
    return (error as Error).message;
  }
}

interface User {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetRegistrations();
  CacheModule.clearOptions();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  resetRegistrations();
  CacheModule.clearOptions();
});

describe('CacheModule setup (docs/api/cache.md)', () => {
  /**
   * From "Basic Setup": `CacheModule.forRoot()` is imported ONCE in the root module and
   * "CacheService is automatically available in all submodules" — the submodule in the snippet
   * imports nothing. The second half of the promise is that `cacheOptions.defaultTtl` is a
   * default that actually applies, which a read-back straight after a write cannot show.
   *
   * @source docs:api/cache.md#basic-setup
   */
  it('reaches a submodule that imports nothing, carrying the configured defaultTtl', async () => {
    const defaultTtlMs = 30;

    @Service()
    class UserService extends BaseService {
      constructor(public cacheService: CacheService) {
        super();
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      constructor(private users: UserService) {
        super();
      }

      @Get('/:id')
      async findOne(@Param('id') id: string): Promise<User> {
        const cached = await this.users.cacheService.get<User>(`user:${id}`);

        return cached ?? { id, name: 'from-db' };
      }
    }

    // From docs: the submodule declares NO cache import at all.
    @Module({ controllers: [UserController], providers: [UserService], exports: [UserService] })
    class UserModule {}

    @Module({
      imports: [
        CacheModule.forRoot({
          type: CacheType.MEMORY,
          cacheOptions: { defaultTtl: defaultTtlMs },
        }),
        UserModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const { cacheService } = app.getService(UserService);

      // The submodule really got a working cache, not a stub: the route reads what was written.
      await cacheService.set('user:7', { id: '7', name: 'Ann' });
      const hit = await (await fetch(`http://127.0.0.1:${app.getPort()}/users/7`)).json() as
        { result: User };
      expect(hit.result).toEqual({ id: '7', name: 'Ann' });

      // `defaultTtl` is a deadline, not decoration. An entry written with no options is gone
      // once it passes; one that opted out of expiry is not.
      await cacheService.set('user:8', { id: '8', name: 'Bob' });
      await cacheService.set('user:9', { id: '9', name: 'Cid' }, { ttl: 0 });
      await Bun.sleep(defaultTtlMs * 3);

      expect(await cacheService.get('user:8')).toBeUndefined();
      expect(await cacheService.get<User>('user:9')).toEqual({ id: '9', name: 'Cid' });

      const miss = await (await fetch(`http://127.0.0.1:${app.getPort()}/users/8`)).json() as
        { result: User };
      expect(miss.result).toEqual({ id: '8', name: 'from-db' });
    } finally {
      await app.stop();
    }
  });

  /**
   * From "Injection": a constructor parameter typed `CacheService` is enough — no `@Inject`, no
   * token. And there is exactly ONE `CacheService` per application, so two services that ask for
   * it see each other's writes.
   *
   * @source docs:api/cache.md#injection
   */
  it('injects the one CacheService into every constructor that names the type', async () => {
    @Service()
    class UserService extends BaseService {
      constructor(public cacheService: CacheService) {
        super();
      }
    }

    @Service()
    class ReportService extends BaseService {
      constructor(public cacheService: CacheService) {
        super();
      }
    }

    @Controller('/probe')
    class ProbeController extends BaseController {
      @Get('/')
      ping(): string {
        return 'ok';
      }
    }

    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY })],
      controllers: [ProbeController],
      providers: [UserService, ReportService],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const users = app.getService(UserService);
      const reports = app.getService(ReportService);

      expect(users.cacheService).toBe(reports.cacheService);

      // Injected, initialized and shared — a write through one is a read through the other.
      await users.cacheService.set('user:1', { id: '1', name: 'Ann' });
      expect(await reports.cacheService.get<User>('user:1')).toEqual({ id: '1', name: 'Ann' });

      expect(users.cacheService.getBackendStatus()).toEqual({
        configured: CacheType.MEMORY,
        active: CacheType.MEMORY,
        degraded: false,
      });
    } finally {
      await app.stop();
    }
  });
});

describe('Cache configuration sources (docs/api/cache.md)', () => {
  /**
   * From "Redis Configuration": the fields of `redisOptions` are documented as reaching the
   * connection. Two halves are decidable without a Redis server:
   *
   * - `host` and `port` open a real socket. Pointed at a listener that accepts and hangs up, the
   *   DRIVER is what fails, in a millisecond; a cache that dialled somewhere else would sit there
   *   until the deadline fired and the cause would read "timed out".
   * - `host`, `port`, `database` and `connectTimeout` are named in the startup error, which is
   *   what a misconfigured deployment reads.
   *
   * The `password` is configured on purpose, and deliberately never asserted ABSENT: measured
   * against this driver, no in-process failure produces a message built from the connection URL
   * — hangup, deadline, bad protocol and malformed-URL errors all omit it — so `redactSecrets()`
   * has nothing to redact and a `not.toContain(password)` line would pass with redaction deleted.
   * What the password does buy is the positive assertion below. The page promises the target is
   * rebuilt from host, port and database rather than from the URL the driver dials; a target that
   * ever carried credentials would read `redis://:hunter2-secret@127.0.0.1:…` and break the
   * exact-substring match. `keyPrefix` is unpinned here — it is only observable on the keys a live
   * server would store.
   *
   * @source docs:api/cache.md#redis-configuration
   */
  it('opens the configured host and port, and names host, port, database and timeout in the error', async () => {
    // Answers the driver's handshake with a protocol error and hangs up — "something is here,
    // and it is not Redis". Unlike a dead port, where the driver retries forever and only the
    // framework's deadline ever answers, this rejects in about a millisecond, so the error text
    // says which of the two happened.
    const notRedis = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open: () => undefined,
        data(socket) {
          socket.write('-ERR not a redis server\r\n');
          socket.end();
        },
      },
    });
    const { port } = notRedis;
    // Generous next to the ~1ms hangup, and still nothing like the 5000ms default.
    const connectTimeout = 500;

    CacheModule.forRoot({
      type: CacheType.REDIS,
      cacheOptions: { defaultTtl: 300000 },
      redisOptions: {
        host: '127.0.0.1',
        port,
        password: 'hunter2-secret',
        database: 7,
        connectTimeout,
        keyPrefix: 'myapp:cache:',
      },
    });

    const { instance: service } = createTestService(CacheService);

    let thrown: Error | undefined;
    try {
      await service.waitForInit();
    } catch (error) {
      thrown = error as Error;
    }

    // Defaults would have produced redis://localhost:6379/0 and a 5000ms bound.
    expect(thrown?.message).toContain(`redis://127.0.0.1:${port}/7`);
    expect(thrown?.message).toContain(`within ${connectTimeout}ms`);
    // The socket reached THAT listener: the cause is the hangup, not the framework's deadline.
    expect(thrown?.message).toContain('Connection closed');

    await service.close();
    notRedis.stop(true);
  });

  /**
   * From "Environment Variable Configuration": importing `CacheModule` WITHOUT `.forRoot()`
   * reads the whole configuration from `CACHE_*`. Two of those variables are pinned through
   * behaviour that would look identical if they were ignored — capacity and expiry.
   *
   * @source docs:api/cache.md#environment-variable-configuration
   */
  it('auto-configures from CACHE_* when the module is imported without forRoot()', async () => {
    process.env.CACHE_TYPE = 'memory';
    process.env.CACHE_DEFAULT_TTL = '40';
    process.env.CACHE_MAX_SIZE = '3';

    @Service()
    class MyService extends BaseService {
      constructor(public cacheService: CacheService) {
        super();
      }
    }

    @Controller('/probe')
    class ProbeController extends BaseController {
      @Get('/')
      ping(): string {
        return 'ok';
      }
    }

    // From docs: plain `CacheModule`, no forRoot() anywhere.
    @Module({ imports: [CacheModule], controllers: [ProbeController], providers: [MyService] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const { cacheService } = app.getService(MyService);

      expect(cacheService.getBackendStatus().active).toBe(CacheType.MEMORY);

      // CACHE_MAX_SIZE=3 — five writes, three survivors, the oldest evicted first.
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        await cacheService.set(id, id, { ttl: 0 });
      }
      expect((await cacheService.getStats()).entries).toBe(3);
      expect(await cacheService.mget<string>(['a', 'b', 'c', 'd', 'e']))
        .toEqual([undefined, undefined, 'c', 'd', 'e']);

      // CACHE_DEFAULT_TTL=40 — an entry written with no options expires on its own.
      await cacheService.clear();
      await cacheService.set('ephemeral', 'value');
      await Bun.sleep(120);

      expect(await cacheService.get('ephemeral')).toBeUndefined();
      expect(await cacheService.has('ephemeral')).toBe(false);
    } finally {
      await app.stop();
    }
  });

  /**
   * From "Custom Environment Prefix": `envPrefix: 'ORDERS_CACHE'` makes the service read
   * `ORDERS_CACHE_REDIS_HOST` and friends. Decoys are planted under the DEFAULT `CACHE_` prefix,
   * so a service that ignored `envPrefix` would connect somewhere else and say so.
   *
   * @source docs:api/cache.md#custom-environment-prefix
   */
  it('reads the prefixed variables and ignores the default-prefixed ones', async () => {
    const port = reserveDeadPort();

    process.env.ORDERS_CACHE_REDIS_HOST = '127.0.0.1';
    process.env.ORDERS_CACHE_REDIS_PORT = String(port);
    process.env.ORDERS_CACHE_REDIS_DATABASE = '4';
    process.env.ORDERS_CACHE_REDIS_CONNECT_TIMEOUT = '200';

    // Same settings under the default prefix, pointing somewhere else entirely.
    process.env.CACHE_REDIS_HOST = 'decoy.invalid';
    process.env.CACHE_REDIS_PORT = '6380';
    process.env.CACHE_REDIS_DATABASE = '9';

    // From docs: uses ORDERS_CACHE_REDIS_HOST, etc.
    CacheModule.forRoot({
      type: CacheType.REDIS,
      envPrefix: 'ORDERS_CACHE',
    });

    const { instance: service } = createTestService(CacheService);

    let thrown: Error | undefined;
    try {
      await service.waitForInit();
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toContain(`redis://127.0.0.1:${port}/4`);
    expect(thrown?.message).toContain('within 200ms');
    expect(thrown?.message).not.toContain('decoy.invalid');
    // The escape hatch the error names is prefixed too, not hardcoded to CACHE_.
    expect(thrown?.message).toContain('ORDERS_CACHE_ALLOW_DEGRADED_START=true');

    await service.close();
  });

  /**
   * From "Memory Configuration": three options, three separate promises. `maxSize` caps how many
   * entries are kept, `defaultTtl` expires them, and `cleanupInterval` sweeps the expired ones
   * WITHOUT anybody reading them — which is the only way to tell a sweep from lazy expiry.
   *
   * @source docs:api/cache.md#memory-configuration
   */
  it('honours maxSize, defaultTtl and cleanupInterval', async () => {
    CacheModule.forRoot({
      type: CacheType.MEMORY,
      cacheOptions: {
        defaultTtl: 40,
        maxSize: 3,
        cleanupInterval: 25,
      },
    });

    const { instance: service } = createTestService(CacheService);
    await service.waitForInit();

    try {
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        await service.set(id, id, { ttl: 0 });
      }

      // maxSize: five writes, three survivors.
      expect((await service.getStats()).entries).toBe(3);
      expect(await service.get('a')).toBeUndefined();
      expect(await service.get<string>('e')).toBe('e');

      await service.clear();
      await service.set('swept', 'value');

      // Nothing reads `swept`. If the entry disappears anyway, both defaultTtl (it expired) and
      // cleanupInterval (something removed it) did their jobs; with either option dropped the
      // entry would still be sitting there.
      await Bun.sleep(120);
      expect((await service.getStats()).entries).toBe(0);
    } finally {
      await service.close();
    }
  });
});

describe('Caching patterns (docs/api/cache.md)', () => {
  /**
   * From "Cache-Aside Pattern": the point of the recipe is the call that does NOT happen. Reading
   * the value back twice proves nothing — the repository could be consulted every time and still
   * return the same user.
   *
   * @source docs:api/cache.md#cache-aside-pattern
   */
  it('consults the repository only on a miss', async () => {
    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { defaultTtl: 0 } });

    const { instance: cacheService } = createTestService(CacheService);
    await cacheService.waitForInit();

    let dbCalls = 0;
    const repository = {
      async findById(id: string): Promise<User | null> {
        dbCalls += 1;

        return { id, name: 'John from DB' };
      },
    };

    @Service()
    class UserService extends BaseService {
      constructor(
        private cache: CacheService,
        private repo: typeof repository,
      ) {
        super();
      }

      async findById(id: string): Promise<User | null> {
        const cacheKey = `user:${id}`;

        const cached = await this.cache.get<User>(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit', { key: cacheKey });

          return cached;
        }

        this.logger.debug('Cache miss', { key: cacheKey });
        const user = await this.repo.findById(id);

        if (user) {
          await this.cache.set(cacheKey, user, { ttl: 300_000 });
        }

        return user;
      }
    }

    const { instance: users, logger } = createTestService(UserService, {
      deps: [cacheService, repository],
    });

    try {
      expect(await users.findById('123')).toEqual({ id: '123', name: 'John from DB' });
      expect(dbCalls).toBe(1);

      // Second call is served from the cache — the repository is not touched again.
      expect(await users.findById('123')).toEqual({ id: '123', name: 'John from DB' });
      expect(dbCalls).toBe(1);

      // The key is per-id, so another id is another miss.
      await users.findById('456');
      expect(dbCalls).toBe(2);

      // ...and dropping the documented key sends the next read back to the repository.
      expect(await cacheService.delete('user:123')).toBe(true);
      await users.findById('123');
      expect(dbCalls).toBe(3);

      const debugCalls = (logger.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(debugCalls).toContainEqual(['Cache hit', { key: 'user:123' }]);
      expect(debugCalls).toContainEqual(['Cache miss', { key: 'user:456' }]);
    } finally {
      await cacheService.close();
    }
  });

  /**
   * From "Cache Invalidation": `update()` drops the entity and the list, `delete()` drops the
   * entity and everything derived from it. Both are TARGETED — an implementation that reached for
   * `clear()` would satisfy "the key is gone" and quietly throw away every other tenant's data.
   *
   * @source docs:api/cache.md#cache-invalidation
   */
  it('drops exactly the related keys and leaves the rest of the cache alone', async () => {
    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { defaultTtl: 0 } });

    const { instance: cacheService } = createTestService(CacheService);
    await cacheService.waitForInit();

    const repository = {
      update: async (id: string, data: { name: string }): Promise<User> => ({ id, ...data }),
      delete: async (): Promise<void> => undefined,
    };

    @Service()
    class UserService extends BaseService {
      constructor(
        private cache: CacheService,
        private repo: typeof repository,
      ) {
        super();
      }

      async update(id: string, data: { name: string }): Promise<User> {
        const user = await this.repo.update(id, data);

        await this.cache.delete(`user:${id}`);
        await this.cache.delete('users:list');

        return user;
      }

      async delete(id: string): Promise<void> {
        await this.repo.delete();

        await Promise.all([
          this.cache.delete(`user:${id}`),
          this.cache.delete(`user:${id}:posts`),
          this.cache.delete(`user:${id}:settings`),
          this.cache.delete('users:list'),
        ]);
      }
    }

    const { instance: users } = createTestService(UserService, {
      deps: [cacheService, repository],
    });

    try {
      const seed = async (): Promise<void> => {
        await cacheService.mset([
          { key: 'user:123', value: { id: '123', name: 'John' } },
          { key: 'user:123:posts', value: ['p1'] },
          { key: 'user:123:settings', value: { theme: 'dark' } },
          { key: 'users:list', value: [{ id: '123' }] },
          { key: 'user:456', value: { id: '456', name: 'Ann' } },
        ]);
      };

      await seed();
      expect(await users.update('123', { name: 'Johnny' })).toEqual({ id: '123', name: 'Johnny' });

      expect(await cacheService.get('user:123')).toBeUndefined();
      expect(await cacheService.get('users:list')).toBeUndefined();
      // update() invalidates the entity and the list — and nothing else.
      expect(await cacheService.get<string[]>('user:123:posts')).toEqual(['p1']);
      expect(await cacheService.get<User>('user:456')).toEqual({ id: '456', name: 'Ann' });

      await seed();
      await users.delete('123');

      expect(await cacheService.mget(['user:123', 'user:123:posts', 'user:123:settings', 'users:list']))
        .toEqual([undefined, undefined, undefined, undefined]);
      // Another user's entry survives a targeted invalidation.
      expect(await cacheService.get<User>('user:456')).toEqual({ id: '456', name: 'Ann' });
    } finally {
      await cacheService.close();
    }
  });

  /**
   * From "Cache Warming": one `mset()` puts every row under `user:<id>` with a one-hour TTL. The
   * keys are checkable by reading them back; the TTL is not, until the clock moves — and an
   * `mset` that dropped the per-entry options would leave these entries immortal, since this
   * cache's default is "no expiry".
   *
   * @source docs:api/cache.md#cache-warming
   */
  it('writes every warmed row under its own key with the requested one-hour TTL', async () => {
    const oneHourMs = 3_600_000;

    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { defaultTtl: 0 } });

    const { instance: cacheService } = createTestService(CacheService);
    await cacheService.waitForInit();

    const warmed: User[] = [
      { id: '1', name: 'Ann' },
      { id: '2', name: 'Bob' },
      { id: '3', name: 'Cid' },
    ];
    const limits: number[] = [];
    const userRepository = {
      async findAll({ limit }: { limit: number }): Promise<User[]> {
        limits.push(limit);

        return warmed;
      },
    };

    @Service()
    class CacheWarmerService extends BaseService {
      constructor(
        private cache: CacheService,
        private repo: typeof userRepository,
      ) {
        super();
      }

      async warmUserCache(): Promise<void> {
        this.logger.info('Warming user cache');

        const rows = await this.repo.findAll({ limit: 1000 });

        await this.cache.mset(
          rows.map(user => ({ key: `user:${user.id}`, value: user, options: { ttl: oneHourMs } })),
        );

        this.logger.info('User cache warmed', { count: rows.length });
      }
    }

    const { instance: warmer, logger } = createTestService(CacheWarmerService, {
      deps: [cacheService, userRepository],
    });

    const timers = useFakeTimers();
    try {
      await warmer.warmUserCache();

      expect(limits).toEqual([1000]);
      expect(await cacheService.mget<User>(['user:1', 'user:2', 'user:3'])).toEqual(warmed);
      expect(await cacheService.get('user:4')).toBeUndefined();
      const infoCalls = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(infoCalls).toContainEqual(['User cache warmed', { count: 3 }]);

      // Still warm a minute short of the hour...
      timers.advanceTime(oneHourMs - 1);
      expect(await cacheService.get<User>('user:1')).toEqual({ id: '1', name: 'Ann' });

      // ...and cold once it passes. The cache default is "never expire", so this deadline can
      // only come from the per-entry options the warmer passed.
      timers.advanceTime(2);
      expect(await cacheService.mget(['user:1', 'user:2', 'user:3']))
        .toEqual([undefined, undefined, undefined]);
    } finally {
      timers.restore();
      await cacheService.close();
    }
  });

  /**
   * From "Memoization": rarely changing data is fetched once and served from the cache
   * afterwards. The observable promise is the fetch count, and the fact that the entry lives
   * under exactly `config:feature-flags` — invalidate that key and the next call refetches.
   *
   * @source docs:api/cache.md#memoization
   */
  it('fetches once and serves the rest from the documented cache key', async () => {
    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { defaultTtl: 0 } });

    const { instance: cacheService } = createTestService(CacheService);
    await cacheService.waitForInit();

    interface FeatureFlags {
      darkMode: boolean;
      revision: number;
    }

    @Service()
    class ConfigService extends BaseService {
      fetches = 0;

      constructor(private cache: CacheService) {
        super();
      }

      async getFeatureFlags(): Promise<FeatureFlags> {
        const cacheKey = 'config:feature-flags';

        let flags = await this.cache.get<FeatureFlags>(cacheKey);

        if (!flags) {
          flags = await this.fetchFeatureFlags();
          await this.cache.set(cacheKey, flags, { ttl: 3_600_000 });
        }

        return flags;
      }

      private async fetchFeatureFlags(): Promise<FeatureFlags> {
        this.fetches += 1;

        return { darkMode: true, revision: this.fetches };
      }
    }

    const { instance: config } = createTestService(ConfigService, { deps: [cacheService] });

    try {
      const first = await config.getFeatureFlags();
      expect(first).toEqual({ darkMode: true, revision: 1 });

      expect(await config.getFeatureFlags()).toEqual({ darkMode: true, revision: 1 });
      expect(await config.getFeatureFlags()).toEqual({ darkMode: true, revision: 1 });
      expect(config.fetches).toBe(1);

      // The memo lives under the key the docs name, and nowhere else.
      expect(await cacheService.get<FeatureFlags>('config:feature-flags'))
        .toEqual({ darkMode: true, revision: 1 });

      expect(await cacheService.delete('config:feature-flags')).toBe(true);
      expect(await config.getFeatureFlags()).toEqual({ darkMode: true, revision: 2 });
      expect(config.fetches).toBe(2);
    } finally {
      await cacheService.close();
    }
  });
});

describe('Cache types (docs/api/cache.md)', () => {
  /**
   * From "CacheSetOptions": `ttl?: number` — milliseconds, `0` for no expiration, and the whole
   * options object optional. Four writes, four different ways of saying it, one clock to tell
   * them apart.
   *
   * @source docs:api/cache.md#cachesetoptions
   */
  it('treats ttl as milliseconds, 0 as forever, and an absent ttl as the cache default', async () => {
    const defaultTtl = 1000;
    const explicitTtl = 5000;
    const oneDay = 86_400_000;

    const timers = useFakeTimers();
    const cache = createInMemoryCache({ defaultTtl });

    try {
      await cache.set('omitted', 'a');
      await cache.set('empty-options', 'b', {});
      await cache.set('no-expiry', 'c', { ttl: 0 });
      await cache.set('explicit', 'd', { ttl: explicitTtl });

      // One tick past the cache default: both entries that named no ttl are gone.
      timers.advanceTime(defaultTtl + 1);
      expect(await cache.get('omitted')).toBeUndefined();
      expect(await cache.get('empty-options')).toBeUndefined();
      expect(await cache.get<string>('no-expiry')).toBe('c');
      expect(await cache.get<string>('explicit')).toBe('d');

      // 5000 means five seconds, not five thousand of them.
      timers.advanceTime(explicitTtl - defaultTtl);
      expect(await cache.get('explicit')).toBeUndefined();

      // `0` is "no expiration", not "falsy, so use the default".
      timers.advanceTime(oneDay);
      expect(await cache.get<string>('no-expiry')).toBe('c');
      expect(await cache.has('no-expiry')).toBe(true);
    } finally {
      await cache.close();
      timers.restore();
    }
  });

  /**
   * From "CacheStats": four fields, and `hitRate` is the one with arithmetic behind it. Counting
   * is per key looked up, `has()` is not a lookup, and `clear()` resets the counters as well as
   * the contents.
   *
   * @source docs:api/cache.md#cachestats
   */
  it('counts hits, misses and entries, and derives hitRate from them', async () => {
    const cache = createInMemoryCache({ defaultTtl: 0 });

    try {
      await cache.set('a', 1);
      await cache.set('b', 2);

      await cache.get('a');
      await cache.get('a');
      await cache.get('x');
      await cache.get('y');
      await cache.get('z');

      expect(await cache.getStats()).toEqual({
        hits: 2,
        misses: 3,
        entries: 2,
        hitRate: 0.4,
      });

      // has() answers a question about presence; it is not a read and moves neither counter.
      await cache.has('a');
      await cache.has('nope');
      expect(await cache.getStats()).toEqual({
        hits: 2,
        misses: 3,
        entries: 2,
        hitRate: 0.4,
      });

      // mget counts once per requested key, not once per call.
      await cache.mget(['a', 'b', 'x']);
      expect(await cache.getStats()).toEqual({
        hits: 4,
        misses: 4,
        entries: 2,
        hitRate: 0.5,
      });

      await cache.clear();
      expect(await cache.getStats()).toEqual({
        hits: 0,
        misses: 0,
        entries: 0,
        hitRate: 0,
      });
    } finally {
      await cache.close();
    }
  });
});

describe('Shared Redis connection (docs/api/cache.md)', () => {
  /**
   * From "Shared Redis Connection": a cache can be handed a client instead of opening one. The
   * benefit the section sells — one connection pool for cache and WebSocket — only holds if the
   * cache never disconnects a client it does not own, so that is asserted on the client itself.
   *
   * `isUsingSharedClient()` is deliberately NOT asserted here: before `connect()` it returns
   * `true` for every cache ever built (`useShared || !ownsClient`, and `ownsClient` starts
   * `false`), so it would pass with the option deleted from the framework. The test below drives
   * both caches past `connect()`, which is where the answer becomes real.
   *
   * @source docs:api/cache.md#shared-redis-connection
   */
  it('uses the client it was handed and never disconnects one it does not own', async () => {
    // The provider is a process-global singleton: put back exactly what was found.
    const saved = SharedRedisProvider.getOptions();

    try {
      // From docs: configure shared Redis at app startup
      SharedRedisProvider.configure({ url: 'redis://localhost:6379', keyPrefix: 'myapp:' });
      expect(SharedRedisProvider.isConfigured()).toBe(true);
      expect(SharedRedisProvider.getOptions()).toEqual({
        url: 'redis://localhost:6379',
        keyPrefix: 'myapp:',
      });

      // Option 1: a cache told to use the shared client opens nothing by itself — configuring
      // the provider is lazy.
      const viaOptions = createRedisCache({ useSharedClient: true, defaultTtl: 60000 });
      expect(viaOptions.getClient()).toBeNull();

      // Option 2: pass a RedisClient directly. Building it from the provider is only possible
      // because configure() recorded a url — without one, createClient() throws.
      const sharedClient = SharedRedisProvider.createClient();
      const cache = new RedisCache(sharedClient);

      expect(cache.getClient()).toBe(sharedClient);

      // Substituted on the instance, not the module: close() must not tear down a borrowed
      // connection that WebSocket (or anything else) is still using.
      let disconnects = 0;
      sharedClient.disconnect = async (): Promise<void> => {
        disconnects += 1;
      };

      await cache.close();
      expect(disconnects).toBe(0);
      expect(cache.getClient()).toBeNull();
    } finally {
      if (saved) {
        SharedRedisProvider.configure(saved);
      } else {
        await SharedRedisProvider.reset();
      }
    }
  });

  /**
   * The other half of "Shared Redis Connection": `useSharedClient` decides WHERE the cache gets
   * its client, and `isUsingSharedClient()` reports the answer the section prints.
   *
   * Both are observable without a server. With the provider deliberately left unconfigured, a
   * cache that honours the option complains about the PROVIDER and still owns nothing; an
   * otherwise identical cache without it goes and opens its own connection, and from then on
   * reports `false`. Delete the option from the framework and the first cache takes the second
   * path — different error, different answer.
   *
   * The url is unopenable by construction (a protocol the driver rejects before any socket), so
   * the standalone half fails in a millisecond instead of retrying a dead port forever.
   *
   * @source docs:api/cache.md#shared-redis-connection
   */
  it('sends a useSharedClient cache to the provider and a plain one to its own connection', async () => {
    const saved = SharedRedisProvider.getOptions();

    try {
      // Cold on purpose: an unconfigured provider is what makes the shared path announce itself.
      await SharedRedisProvider.reset();
      expect(SharedRedisProvider.isConfigured()).toBe(false);

      const unopenable = 'http://not-a-redis-url';
      const shared = createRedisCache({ useSharedClient: true, url: unopenable });
      const standalone = createRedisCache({ url: unopenable });

      const sharedFailure = await connectFailure(shared);
      const standaloneFailure = await connectFailure(standalone);

      // The option is the only difference between these two caches, and it is what decides who
      // is asked for a client: the provider, or the driver.
      expect(sharedFailure).toContain('SharedRedisProvider not configured');
      expect(standaloneFailure).not.toContain('SharedRedisProvider');

      // …and therefore who owns what. The shared cache built nothing, so it is still sharing;
      // the standalone one built its own client and must never be counted as shared, or close()
      // would leave that connection open forever.
      expect(shared.isUsingSharedClient()).toBe(true);
      expect(standalone.isUsingSharedClient()).toBe(false);

      await shared.close();
      await standalone.close();
    } finally {
      if (saved) {
        SharedRedisProvider.configure(saved);
      } else {
        await SharedRedisProvider.reset();
      }
    }
  });
});

describe('Effect.js integration (docs/api/cache.md)', () => {
  /**
   * From "Effect.js Integration": `createCacheModule()` builds a Layer, `cacheServiceTag`
   * resolves the cache inside a program, and `Effect.provide` wires them together. What the
   * program gets has to be a real cache, so it is driven through a write and two reads.
   *
   * @source docs:api/cache.md#effectjs-integration
   */
  it('resolves a working cache through cacheServiceTag and the provided layer', async () => {
    const cacheLayer = createCacheModule({
      type: CacheType.MEMORY,
      cacheOptions: { defaultTtl: 300000 },
    });

    const program = pipe(
      cacheServiceTag,
      Effect.flatMap((cache) => Effect.promise(async () => {
        await cache.set('user:123', { id: '123', name: 'John' });

        return [
          await cache.get<User>('user:123'),
          await cache.get<User>('user:absent'),
        ];
      })),
    );

    const [hit, miss] = await Effect.runPromise(Effect.provide(program, cacheLayer));

    expect(hit).toEqual({ id: '123', name: 'John' });
    expect(miss).toBeUndefined();
  });
});

describe('Complete example (docs/api/cache.md)', () => {
  /**
   * From "Complete Example": the whole page assembled — a cached read path, a 404 for an unknown
   * id, and a write that invalidates both the entity and the list. The invalidation is the part
   * worth running end to end: without it the second GET would serve the pre-update stock from the
   * cache and the API would lie.
   *
   * @source docs:api/cache.md#complete-example
   */
  it('serves cached products over HTTP and invalidates them on a stock change', async () => {
    @Service()
    class ProductService extends BaseService {
      private products = new Map<string, Product>();

      constructor(private cacheService: CacheService) {
        super();
        this.products.set('1', {
          id: '1', name: 'Widget', price: 9.99, stock: 100,
        });
        this.products.set('2', {
          id: '2', name: 'Gadget', price: 19.99, stock: 50,
        });
      }

      async findById(id: string): Promise<Product | null> {
        const cacheKey = `product:${id}`;

        const cached = await this.cacheService.get<Product>(cacheKey);
        if (cached) {
          this.logger.debug('Product cache hit', { id });

          return cached;
        }

        const product = this.products.get(id) || null;

        if (product) {
          await this.cacheService.set(cacheKey, product, { ttl: 60_000 });
        }

        return product;
      }

      async findAll(): Promise<Product[]> {
        const cacheKey = 'products:all';

        const cached = await this.cacheService.get<Product[]>(cacheKey);
        if (cached) {
          return cached;
        }

        const products = Array.from(this.products.values());
        await this.cacheService.set(cacheKey, products, { ttl: 30_000 });

        return products;
      }

      async updateStock(id: string, quantity: number): Promise<Product | null> {
        const product = this.products.get(id);
        if (!product) {
          return null;
        }

        product.stock += quantity;
        this.products.set(id, product);

        await Promise.all([
          this.cacheService.delete(`product:${id}`),
          this.cacheService.delete('products:all'),
        ]);

        return product;
      }
    }

    @Controller('/products')
    class ProductController extends BaseController {
      constructor(private productService: ProductService) {
        super();
      }

      @Get('/')
      async findAll(): Promise<Product[]> {
        return await this.productService.findAll();
      }

      @Get('/:id')
      async findOne(@Param('id') id: string): Promise<Product> {
        const product = await this.productService.findById(id);

        if (!product) {
          throw new HttpException(404, 'Product not found');
        }

        return product;
      }

      @Post('/:id/stock')
      async updateStock(
        @Param('id') id: string,
        @Body() body: { quantity: number },
      ): Promise<Product> {
        const product = await this.productService.updateStock(id, body.quantity);

        if (!product) {
          throw new HttpException(404, 'Product not found');
        }

        return product;
      }
    }

    @Module({
      imports: [
        CacheModule.forRoot({
          type: CacheType.MEMORY,
          cacheOptions: { defaultTtl: 300000, maxSize: 1000 },
        }),
      ],
      controllers: [ProductController],
      providers: [ProductService],
    })
    class ProductModule {}

    const app = new OneBunApplication(ProductModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const base = `http://127.0.0.1:${app.getPort()}/products`;
      const cache = app.getService(ProductService)['cacheService'] as CacheService;

      const listResponse = await fetch(`${base}/`);
      expect(listResponse.status).toBe(200);
      expect((await listResponse.json() as { result: Product[] }).result).toHaveLength(2);
      // The list really went through the cache, under the documented key.
      expect(await cache.get<Product[]>('products:all')).toHaveLength(2);

      const oneResponse = await fetch(`${base}/1`);
      expect(oneResponse.status).toBe(200);
      expect((await oneResponse.json() as { result: Product }).result).toEqual({
        id: '1', name: 'Widget', price: 9.99, stock: 100,
      });
      expect((await cache.get<Product>('product:1'))?.stock).toBe(100);

      // Unknown id: HttpException(404) reaches the wire as a 404, with its message.
      const missingResponse = await fetch(`${base}/999`);
      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json() as { success: boolean; error: string }).toMatchObject({
        success: false,
        error: 'Product not found',
      });

      const stockResponse = await fetch(`${base}/1/stock`, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: -10 }),
      });
      expect(stockResponse.status).toBe(200);
      expect((await stockResponse.json() as { result: Product }).result.stock).toBe(90);

      // Both cached entries were invalidated, so the next reads see the new stock rather than
      // the copies written a few lines above.
      expect(await cache.get('product:1')).toBeUndefined();
      expect(await cache.get('products:all')).toBeUndefined();

      const afterOne = await (await fetch(`${base}/1`)).json() as { result: Product };
      expect(afterOne.result.stock).toBe(90);

      const afterList = await (await fetch(`${base}/`)).json() as { result: Product[] };
      expect(afterList.result.find((product) => product.id === '1')?.stock).toBe(90);

      const stockMissing = await fetch(`${base}/999/stock`, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1 }),
      });
      expect(stockMissing.status).toBe(404);
    } finally {
      await app.stop();
    }
  });
});

/**
 * Documentation Examples Tests for @onebun/cache
 *
 * @source docs:api/cache.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Global,
  Module,
  OneBunApplication,
  resetRegistrations,
  Service,
} from '@onebun/core';
import { createTestService, useFakeTimers } from '@onebun/core/testing';

import {
  createInMemoryCache,
  createRedisCache,
  CacheType,
  createCacheModule,
  cacheServiceTag,
  CacheModule,
  CacheService,
} from '../src';

// forRoot() writes into a process-wide registry that outlives the file. Two unnamed calls that
// configure the module differently are refused at app.start(), so a test that boots must not
// inherit a registration written by an earlier test — or by an earlier FILE in the same run,
// which is how this suite used to leak across package boundaries.
beforeEach(() => {
  resetRegistrations();
});

describe('Cache README Examples', () => {
  describe('Basic In-Memory Cache (README)', () => {
    it('should create in-memory cache with options', async () => {
      // From README: Basic In-Memory Cache section
      const cache = createInMemoryCache({
        defaultTtl: 60000, // 1 minute
        maxSize: 1000, // maximum 1000 entries
        cleanupInterval: 30000, // cleanup every 30 seconds
      });

      expect(cache).toBeDefined();
      expect(typeof cache.set).toBe('function');
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.delete).toBe('function');
      expect(typeof cache.clear).toBe('function');
    });

    it('should set and get value', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      // From README: Set value
      await cache.set('user:123', { name: 'John', email: 'john@example.com' });

      // From README: Get value
      const user = await cache.get<{ name: string; email: string }>('user:123');

      expect(user).toEqual({ name: 'John', email: 'john@example.com' });
    });

    it('should delete value', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('user:123', { name: 'John' });

      // From README: Delete value
      await cache.delete('user:123');

      const user = await cache.get('user:123');
      expect(user).toBeUndefined();
    });

    it('should clear all values', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // From README: Clear all
      await cache.clear();

      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBeUndefined();
    });
  });

  describe('Statistics (README)', () => {
    it('should get cache statistics', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('user:123', { name: 'John' });
      await cache.get('user:123'); // hit
      await cache.get('user:456'); // miss

      // From README: Get cache statistics
      const stats = await cache.getStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('hitRate');
      expect(typeof stats.hits).toBe('number');
      expect(typeof stats.misses).toBe('number');
    });
  });

  describe('Effect.js Integration (README)', () => {
    it('should create cache layer with Effect.js', async () => {
      // From README: Create cache layer
      const cacheLayer = createCacheModule({ type: CacheType.MEMORY });

      expect(cacheLayer).toBeDefined();
    });

    it('should use cache in Effect program', async () => {
      // From README: Effect.js Integration example
      const cacheLayer = createCacheModule({ type: CacheType.MEMORY });

      // From README: Use in Effect program
      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('user:123', { name: 'John' }),
            Effect.andThen(() => cache.getEffect('user:123')),
          ),
        ),
      );

      // Run program
      const user = await Effect.runPromise(Effect.provide(program, cacheLayer));

      expect(user).toEqual({ name: 'John' });
    });
  });
});

describe('Cache API Documentation Examples', () => {
  describe('CacheService Interface (docs/api/cache.md)', () => {
    let cache: ReturnType<typeof createInMemoryCache>;

    beforeEach(() => {
      cache = createInMemoryCache({
        defaultTtl: 300000,
        maxSize: 1000,
      });
    });

    afterEach(async () => {
      await cache.close();
    });

    it('should implement get<T>() method', async () => {
      // From docs: get<T>() example
      await cache.set('user:123', { name: 'John', email: 'john@example.com' });

      const user = await cache.get<{ name: string; email: string }>('user:123');

      expect(user).toBeDefined();
      if (user) {
        expect(user.name).toBe('John');
        expect(user.email).toBe('john@example.com');
      }
    });

    it('should return undefined for cache miss', async () => {
      // From docs: Cache miss scenario
      const user = await cache.get<{ name: string }>('user:123');

      expect(user).toBeUndefined();
    });

    it('should implement set() with default TTL', async () => {
      // From docs: set() with default TTL
      await cache.set('user:123', { name: 'John' });

      const user = await cache.get('user:123');
      expect(user).toEqual({ name: 'John' });
    });

    it('should implement set() with custom TTL', async () => {
      // From docs: set() with custom TTL (in milliseconds)
      await cache.set('user:123', { name: 'John' }, { ttl: 600 });

      const user = await cache.get('user:123');
      expect(user).toEqual({ name: 'John' });
    });

    it('should implement set() without expiration', async () => {
      // From docs: set() no expiration
      await cache.set('user:123', { name: 'John' }, { ttl: 0 });

      const user = await cache.get('user:123');
      expect(user).toEqual({ name: 'John' });
    });

    it('should implement delete() method', async () => {
      // From docs: delete() example
      await cache.set('user:123', { name: 'John' });

      const deleted = await cache.delete('user:123');

      expect(deleted).toBe(true);
      expect(await cache.get('user:123')).toBeUndefined();
    });

    it('should implement has() method', async () => {
      // From docs: has() example
      await cache.set('user:123', { name: 'John' });

      if (await cache.has('user:123')) {
        // Key exists
        expect(true).toBe(true);
      } else {
        expect(false).toBe(true); // Should not reach here
      }
    });

    it('should implement clear() method', async () => {
      // From docs: clear() example
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      await cache.clear();

      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(false);
    });
  });

  /**
   * "set()" documents three different TTL behaviours behind one call: options omitted → the cache's
   * `defaultTtl`, `{ ttl: N }` → N **milliseconds** instead of the default, `{ ttl: 0 }` → no
   * expiration. Reading the value straight back cannot tell those apart — all three are a hit one
   * microsecond after the write — so each case here drives a fake clock across the boundary the
   * section promises.
   */
  describe('set() TTL semantics (docs/api/cache.md)', () => {
    const DEFAULT_TTL = 60_000;
    const CUSTOM_TTL = 600_000;

    /**
     * @source docs:api/cache.md#set
     */
    it('should set with default TTL', async () => {
      const timers = useFakeTimers();
      const cache = createInMemoryCache({ defaultTtl: DEFAULT_TTL, maxSize: 1000 });

      try {
        // From docs: `await this.cacheService.set('user:123', user)` — with default TTL
        await cache.set('user:123', { name: 'John' });

        // Still inside the default window
        timers.advanceTime(DEFAULT_TTL - 1);
        expect(await cache.get<{ name: string }>('user:123')).toEqual({ name: 'John' });

        // The default TTL is a real deadline, not "forever": one tick past it the entry is gone
        timers.advanceTime(2);
        expect(await cache.get('user:123')).toBeUndefined();
        expect(await cache.has('user:123')).toBe(false);
      } finally {
        await cache.close();
        timers.restore();
      }
    });

    /**
     * @source docs:api/cache.md#set
     */
    it('should set with custom TTL', async () => {
      const timers = useFakeTimers();
      const cache = createInMemoryCache({ defaultTtl: DEFAULT_TTL, maxSize: 1000 });

      try {
        // From docs: `set(key, value, { ttl: 600_000 })` — custom TTL, in milliseconds
        await cache.set('defaulted', 'value1');
        await cache.set('custom', 'value2', { ttl: CUSTOM_TTL });

        // Past the default deadline: the explicit ttl replaced it, it did not add to it
        timers.advanceTime(DEFAULT_TTL + 1);
        expect(await cache.get<string>('defaulted')).toBeUndefined();
        expect(await cache.get<string>('custom')).toBe('value2');

        // Milliseconds, not seconds: 600_000 dies after 600 seconds, not after 600_000 of them
        timers.advanceTime(CUSTOM_TTL - DEFAULT_TTL);
        expect(await cache.get<string>('custom')).toBeUndefined();
      } finally {
        await cache.close();
        timers.restore();
      }
    });

    /**
     * @source docs:api/cache.md#set
     */
    it('should set without expiration', async () => {
      const timers = useFakeTimers();
      const cache = createInMemoryCache({
        defaultTtl: DEFAULT_TTL,
        maxSize: 1000,
        // Documented in "Memory Configuration"; running it proves the sweep spares ttl: 0 too
        cleanupInterval: 30_000,
      });

      try {
        // From docs: `set(key, value, { ttl: 0 })` — no expiration
        await cache.set('immortal', 'value3', { ttl: 0 });
        await cache.set('mortal', 'value4');

        // A hundred default windows, with the cleanup timer firing right through them
        timers.advanceTime(DEFAULT_TTL * 100);

        expect(await cache.get<string>('immortal')).toBe('value3');
        expect(await cache.has('immortal')).toBe(true);
        // Control: a defaulted entry did expire, so the clock really moved and 0 is not "falsy →
        // fall back to defaultTtl"
        expect(await cache.get<string>('mortal')).toBeUndefined();
      } finally {
        await cache.close();
        timers.restore();
      }
    });
  });

  describe('Batch operations (docs/api/cache.md)', () => {
    const DEFAULT_TTL = 60_000;
    const CUSTOM_TTL = 300_000;

    /**
     * From "`mget<T>()`": the return type is `(T | undefined)[]` and the example indexes into it
     * with `if (user)`, so the array must carry one slot per REQUESTED key, in the requested order,
     * holding `undefined` where there is no value. An implementation that returned only the hits
     * would still satisfy a three-keys-three-hits check.
     *
     * @source docs:api/cache.md#mgett
     */
    it('should get multiple values', async () => {
      const cache = createInMemoryCache({ defaultTtl: DEFAULT_TTL, maxSize: 1000 });

      try {
        await cache.set('user:1', { name: 'Ann' });
        await cache.set('user:3', { name: 'Cid' });

        // From docs: mget over a list that includes a key nobody wrote
        const results = await cache.mget<{ name: string }>(['user:1', 'user:2', 'user:3']);

        expect(results).toHaveLength(3);
        expect(results).toEqual([{ name: 'Ann' }, undefined, { name: 'Cid' }]);

        // Slots follow the argument order, not the cache's insertion order
        expect(await cache.mget<{ name: string }>(['user:3', 'user:1'])).toEqual([{ name: 'Cid' }, { name: 'Ann' }]);
        expect(await cache.mget([])).toEqual([]);
      } finally {
        await cache.close();
      }
    });

    /**
     * From "`mset<T>()`": each entry may carry its own `options`, and the documented example gives
     * exactly one of two entries a `ttl`. Reading both values back proves only that they were
     * stored; it is the clock that proves the per-entry options were not dropped on the way in.
     *
     * @source docs:api/cache.md#msett
     */
    it('should set multiple values', async () => {
      const timers = useFakeTimers();
      const cache = createInMemoryCache({ defaultTtl: DEFAULT_TTL, maxSize: 1000 });

      try {
        // From docs: second entry carries its own options
        await cache.mset([
          { key: 'user:1', value: { name: 'Ann' } },
          { key: 'user:2', value: { name: 'Bob' }, options: { ttl: CUSTOM_TTL } },
        ]);

        expect(await cache.mget<{ name: string }>(['user:1', 'user:2'])).toEqual([{ name: 'Ann' }, { name: 'Bob' }]);

        // The entry without options follows the cache default; the one with options ignores it
        timers.advanceTime(DEFAULT_TTL + 1);
        expect(await cache.get('user:1')).toBeUndefined();
        expect(await cache.get<{ name: string }>('user:2')).toEqual({ name: 'Bob' });

        // ...and honours its own deadline when that one arrives
        timers.advanceTime(CUSTOM_TTL - DEFAULT_TTL);
        expect(await cache.get('user:2')).toBeUndefined();
      } finally {
        await cache.close();
        timers.restore();
      }
    });
  });

  describe('Cache-Aside Pattern (docs/api/cache.md)', () => {
    it('should implement cache-aside pattern', async () => {
      // From docs: Cache-Aside Pattern
      const cache = createInMemoryCache({
        defaultTtl: 300000,
        maxSize: 1000,
      });

      // Simulate repository
      const repository = {
        findById: async (id: string) => ({ id, name: 'John from DB' }),
      };

      const findById = async (id: string) => {
        const cacheKey = `user:${id}`;

        // Try cache first
        const cached = await cache.get<{ id: string; name: string }>(cacheKey);
        if (cached) {
          return cached;
        }

        // Cache miss - fetch from database
        const user = await repository.findById(id);

        // Store in cache
        if (user) {
          await cache.set(cacheKey, user, { ttl: 300 });
        }

        return user;
      };

      // First call - cache miss
      const user1 = await findById('123');
      expect(user1.name).toBe('John from DB');

      // Second call - cache hit
      const user2 = await findById('123');
      expect(user2.name).toBe('John from DB');

      await cache.close();
    });
  });

  describe('Cache Invalidation (docs/api/cache.md)', () => {
    it('should invalidate cache on update', async () => {
      // From docs: Cache Invalidation pattern
      const cache = createInMemoryCache({
        defaultTtl: 300000,
        maxSize: 1000,
      });

      // Setup
      await cache.set('user:123', { name: 'John' });
      await cache.set('users:list', [{ id: '123', name: 'John' }]);

      // Simulate update
      const update = async (id: string) => {
        // Update logic here...

        // Invalidate cache
        await cache.delete(`user:${id}`);

        // Also invalidate related caches
        await cache.delete('users:list');
      };

      await update('123');

      expect(await cache.get('user:123')).toBeUndefined();
      expect(await cache.get('users:list')).toBeUndefined();

      await cache.close();
    });
  });
});

describe('Environment Variable Configuration (docs/api/cache.md)', () => {
  it('should document env-based configuration priority', () => {
    // From docs/api/cache.md: Configuration Priority section
    // Priority: module options > env vars > defaults
    // This test verifies that CacheModule.forRoot options structure
    // matches what's documented
    const moduleOptions = {
      type: CacheType.MEMORY,
      cacheOptions: {
        defaultTtl: 300000,
        maxSize: 1000,
        cleanupInterval: 60000,
      },
    };

    expect(moduleOptions.type).toBe(CacheType.MEMORY);
    expect(moduleOptions.cacheOptions.defaultTtl).toBe(300000);
    expect(moduleOptions.cacheOptions.maxSize).toBe(1000);
  });

  it('should accept custom env prefix', () => {
    // From docs/api/cache.md: Custom Environment Prefix
    const module = CacheModule.forRoot({
      type: CacheType.MEMORY,
      envPrefix: 'ORDERS_CACHE',
    });

    expect(module).toBeDefined();
  });

  it('should accept Redis configuration options', () => {
    // From docs/api/cache.md: Redis Configuration
    const redisOptions = {
      type: CacheType.REDIS,
      cacheOptions: {
        defaultTtl: 300000,
      },
      redisOptions: {
        host: 'localhost',
        port: 6379,
        password: '',
        database: 0,
        connectTimeout: 5000,
        keyPrefix: 'myapp:cache:',
      },
    };

    expect(redisOptions.type).toBe(CacheType.REDIS);
    expect(redisOptions.redisOptions.host).toBe('localhost');
    expect(redisOptions.redisOptions.port).toBe(6379);
    expect(redisOptions.redisOptions.connectTimeout).toBe(5000);
    expect(redisOptions.redisOptions.keyPrefix).toBe('myapp:cache:');
  });
});

describe('CacheModule.forRoot Examples', () => {
  it('should create CacheModule with MEMORY type', () => {
    // From README: With module options
    const module = CacheModule.forRoot({
      type: CacheType.MEMORY,
      cacheOptions: {
        defaultTtl: 60000,
        maxSize: 1000,
      },
    });

    expect(module).toBeDefined();
  });

  it('should create CacheModule with custom env prefix', () => {
    // From README: With custom environment prefix
    const module = CacheModule.forRoot({
      envPrefix: 'MY_CACHE', // Will use MY_CACHE_TYPE, MY_CACHE_REDIS_HOST, etc.
    });

    expect(module).toBeDefined();
  });
});

describe('CacheModule Global Mode Examples (docs/api/cache.md)', () => {
  it('should be global by default - CacheService available everywhere', () => {
    // From docs: CacheModule is global by default
    // Import once in root module, CacheService available in all submodules
    const module = CacheModule.forRoot({
      type: CacheType.MEMORY,
      cacheOptions: {
        defaultTtl: 300000,
      },
    });

    expect(module).toBe(CacheModule);
    // isGlobal is undefined (treated as true by default)
    // or can be explicitly set to true
  });

  it('should support non-global mode with isGlobal: false', () => {
    // From docs: Non-Global Mode section
    // For multi-cache scenarios, disable global mode
    const module = CacheModule.forRoot({
      type: CacheType.REDIS,
      isGlobal: false, // Each import creates new instance
    });

    expect(module).toBe(CacheModule);
    expect(CacheModule.getOptions()?.isGlobal).toBe(false);
  });

  it('should support forFeature for explicit import in submodules', () => {
    // From docs: Feature modules must explicitly import CacheModule
    // when using non-global mode
    const featureModule = CacheModule.forFeature();

    expect(featureModule).toBe(CacheModule);
  });

  /**
   * @source docs:api/cache.md#non-global-mode
   */
  it('should share ONE CacheService between the root and every module that imports it', async () => {
    // From docs: forFeature() shares the registration. This case previously pinned the
    // opposite — each importer got its own instance, state was not shared, and a root plus
    // two leaves produced 3 CacheService instances and 3 initializations. It was written to
    // force a deliberate edit when that changed, and this is that edit.
    CacheModule.forRoot({ type: CacheType.MEMORY, isGlobal: false });

    @Service()
    class LeftService extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Service()
    class RightService extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Module({ imports: [CacheModule.forFeature()], providers: [LeftService], exports: [LeftService] })
    class LeftModule {}

    @Module({ imports: [CacheModule.forFeature()], providers: [RightService], exports: [RightService] })
    class RightModule {}

    @Controller('/probe')
    class ProbeController extends BaseController {
      @Get('/')
      get(): string {
        return 'ok';
      }
    }

    @Module({ imports: [LeftModule, RightModule], controllers: [ProbeController] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const left = app.getService(LeftService);
      const right = app.getService(RightService);

      expect(left.cache).toBe(right.cache);

      await left.cache.set('shared-key', 'written-left');
      expect(await right.cache.get<string>('shared-key')).toBe('written-left');
    } finally {
      await app.stop();
      CacheModule.clearOptions();
    }
  });

  it('should support explicit isGlobal: true', () => {
    // From docs: Global mode (default) can be explicitly set
    const module = CacheModule.forRoot({
      type: CacheType.MEMORY,
      cacheOptions: { defaultTtl: 60000 },
      isGlobal: true,
    });

    expect(module).toBe(CacheModule);
    expect(CacheModule.getOptions()?.isGlobal).toBe(true);
  });
});

/**
 * Import order must not decide whether a nested consumer resolves.
 *
 * `imports: [Feature, CacheModule.forRoot(...)]` used to fail at boot with
 * `Could not resolve dependency CacheService for service LeafSvc` while
 * `[CacheModule.forRoot(...), Feature]` booted — at depth 1 and at depth 3. Exercised
 * against the REAL CacheModule rather than a fixture, because that is where it was found
 * and a fixture does not carry forRoot's interaction with the global registry.
 */
describe('import order independence (real CacheModule)', () => {
  const makeTree = (globalFirst: boolean, depth: number): Function => {
    @Service()
    class LeafSvc extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Controller('/order-probe')
    class LeafController extends BaseController {
      @Get('/')
      get(): string {
        return 'ok';
      }
    }

    @Module({ providers: [LeafSvc], controllers: [LeafController] })
    class Leaf {}

    let current: Function = Leaf;
    for (let i = 0; i < depth; i++) {
      const inner = current;

      @Module({ imports: [inner] })
      class Wrapper {}
      current = Wrapper;
    }

    const cache = CacheModule.forRoot({ type: CacheType.MEMORY });
    const feature = current;

    @Module({ imports: globalFirst ? [cache, feature] : [feature, cache] })
    class Root {}

    return Root;
  };

  const boot = async (root: Function): Promise<void> => {
    const app = new OneBunApplication(root as never, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
    await app.stop();
  };

  beforeEach(() => {
    // An earlier test in this file calls forRoot({ isGlobal: false }), which runs
    // removeFromGlobalModules(CacheModule) — process-wide and permanent, with no way to undo
    // it through forRoot. Re-applying the decorator is the workaround the repo already
    // carries in drizzle-module.test.ts and cache-module.test.ts; WI-233 deletes the latch
    // and this block with it.
    Global()(CacheModule);
  });

  afterEach(() => {
    CacheModule.clearOptions();
  });

  it('resolves at depth 1 with the module declared AFTER the feature', async () => {
    // Pre-fix: Could not resolve dependency CacheService for service LeafSvc.
    await boot(makeTree(false, 0));
  });

  it('resolves at depth 3 with the module declared AFTER the feature', async () => {
    await boot(makeTree(false, 2));
  });

  it('still resolves at depth 1 and 3 with the module declared FIRST', async () => {
    await boot(makeTree(true, 0));
    await boot(makeTree(true, 2));
  });
});

describe('CacheService.get() miss marker (docs/api/cache.md)', () => {
  beforeEach(() => {
    CacheModule.clearOptions();
  });

  afterEach(() => {
    CacheModule.clearOptions();
  });

  /**
   * From "Methods → get<T>()": the signature is `Promise<T | undefined>`, and `undefined` is the
   * ONLY miss marker. A `null` that was written is a hit and comes back as `null`, so the
   * `value === null` miss test a `Promise<T | null>` signature invites never fires.
   *
   * @source docs:api/cache.md#methods
   */
  it('returns undefined for a miss and null for a cached null', async () => {
    CacheModule.forRoot({ type: CacheType.MEMORY });

    const { instance: service } = createTestService(CacheService);
    await service.waitForInit();

    try {
      const miss = await service.get<{ name: string }>('user:absent');
      expect(miss).toBeUndefined();

      await service.set('user:null', null);
      const hit = await service.get<unknown>('user:null');

      expect(hit).toBeNull();
      expect(await service.has('user:null')).toBe(true);
    } finally {
      await service.close();
    }
  });
});

describe('Connection Lifecycle (docs/api/cache.md)', () => {
  /**
   * @source docs:api/cache.md#connection-lifecycle
   */
  it('closes the cache when the application stops', async () => {
    Global()(CacheModule);
    CacheModule.forRoot({ type: CacheType.MEMORY });

    @Service()
    class UsesCache extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health(): string {
        return 'ok';
      }
    }

    @Module({
      imports: [CacheModule.forFeature()],
      providers: [UsesCache],
      controllers: [HealthController],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    const closeSpy = spyOn(CacheService.prototype, 'close');

    try {
      await app.start();
      const service = app.getService(UsesCache).cache;

      await service.set('k', 'v');
      expect(await service.get<string>('k')).toBe('v');
      expect(closeSpy).toHaveBeenCalledTimes(0);

      await app.stop();

      // From docs: the cache is closed on app.stop(). Asserted on the documented action
      // rather than on BaseService.isInitialized, which reports logger/config init and is
      // unrelated to the cache connection.
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
      CacheModule.clearOptions();
    }
  });
});

/**
 * @source docs:api/cache.md#multiple-caches
 */
describe('Multiple caches (docs/api/cache.md)', () => {
  const sessions = Symbol('SESSIONS');
  const fragments = Symbol('FRAGMENTS');

  afterEach(() => {
    resetRegistrations();
    CacheModule.clearOptions();
  });

  it('names each configuration with `as` and selects it with forFeature', () => {
    // From docs: two registrations, each with its own configuration.
    const first = CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 10 }, as: sessions });
    const second = CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 20 }, as: fragments });

    // Distinct module identities, and forFeature selects them by token. The end-to-end
    // assertion that each cache uses its OWN options lives in registration.test.ts.
    expect(first).not.toBe(second);
    expect(CacheModule.forFeature(fragments)).toBe(second);
    expect(CacheModule.forFeature(sessions)).toBe(first);
  });

  it('refuses `as` combined with isGlobal: true', () => {
    // From docs: "Combining `as` with `isGlobal: true` throws."
    expect(() => CacheModule.forRoot({ type: CacheType.MEMORY, as: sessions, isGlobal: true }))
      .toThrow(/never global/);
  });
});

describe('Unreachable Redis at startup (docs/api/cache.md)', () => {
  const CONNECT_TIMEOUT_MS = 250;
  // Long enough to show a bare connect() has not settled, short enough not to slow the suite.
  const UNSETTLED_WINDOW_MS = 600;
  const ENV_KEYS = ['CACHE_TYPE', 'CACHE_REDIS_HOST', 'CACHE_REDIS_PORT', 'CACHE_REDIS_CONNECT_TIMEOUT'];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
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
    CacheModule.clearOptions();
    resetRegistrations();
  });

  /**
   * @source docs:api/cache.md#accepting-a-degraded-cache
   */
  it('starts on a process-local cache when allowDegradedStart says that is acceptable', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    server.stop(true);

    process.env.CACHE_REDIS_HOST = '127.0.0.1';
    process.env.CACHE_REDIS_PORT = String(port);
    process.env.CACHE_REDIS_CONNECT_TIMEOUT = String(CONNECT_TIMEOUT_MS);

    // From docs: start on a process-local cache if Redis is down
    CacheModule.forRoot({
      type: CacheType.REDIS,
      allowDegradedStart: true,
    });

    const { instance: service } = createTestService(CacheService);
    await service.waitForInit();

    expect(service.getBackendStatus().degraded).toBe(true);

    await service.close();
  });

  /**
   * From "Telling this failure apart from any other": the boot failure is not catchable by class
   * — `CacheBackendUnavailableError` is not exported, and the rejection reaches the caller
   * Effect-wrapped, so `name` carries a `(FiberFailure) ` prefix and strict equality fails. The
   * page documents a substring test as the discriminator that works; this pins it.
   *
   * @source docs:api/cache.md#telling-this-failure-apart-from-any-other
   */
  it('rejects app.start() with a wrapped, name-identifiable error when Redis is unreachable', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    server.stop(true);

    @Controller('/boot-probe')
    class BootProbeController extends BaseController {
      @Get('/')
      get(): string {
        return 'ok';
      }
    }

    @Module({
      imports: [
        CacheModule.forRoot({
          type: CacheType.REDIS,
          redisOptions: { host: '127.0.0.1', port, connectTimeout: CONNECT_TIMEOUT_MS },
        }),
      ],
      controllers: [BootProbeController],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    let thrown: Error | undefined;
    try {
      await app.start();
      await app.stop();
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    // instanceof is impossible (the class is not exported) and strict equality fails
    expect(thrown?.name).not.toBe('CacheBackendUnavailableError');
    expect(String(thrown?.name)).toContain('CacheBackendUnavailableError');
    expect(thrown?.message).toContain('did not become usable');
    expect(thrown?.message).toContain('CACHE_ALLOW_DEGRADED_START=true');
  });

  /**
   * From "Cache Failover (Redis → In-Memory)": every `connect()` in a wrapper MUST be bounded.
   * The driver connects with `reconnect: true`, so `connect()` against an unreachable host never
   * settles — an unbounded `await` hangs instead of throwing and the `catch` never runs.
   *
   * @source docs:api/cache.md#cache-failover-redis-in-memory
   */
  it('needs a deadline around connect(), because a bare connect() never settles', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    server.stop(true);

    const withDeadline = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        return await Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
          }),
        ]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    };

    const bare = createRedisCache({ host: '127.0.0.1', port, defaultTtl: 0 });
    let settled = false;
    const markSettled = (): void => {
      settled = true;
    };

    void bare.connect().then(markSettled, markSettled);
    await Bun.sleep(UNSETTLED_WINDOW_MS);
    expect(settled).toBe(false);
    await bare.close().catch(() => undefined);

    const bounded = createRedisCache({ host: '127.0.0.1', port, defaultTtl: 0 });
    await expect(withDeadline(bounded.connect(), CONNECT_TIMEOUT_MS))
      .rejects.toThrow(`timed out after ${CONNECT_TIMEOUT_MS}ms`);
    await bounded.close().catch(() => undefined);
  });

  /**
   * @source docs:api/cache.md#which-backend-is-actually-serving
   */
  it('reports which backend is configured and which one is actually serving', async () => {
    const { instance: service } = createTestService(CacheService);
    await service.waitForInit();

    // From docs: getBackendStatus() answers from state, synchronously
    const status = service.getBackendStatus();

    expect(status).toEqual({
      configured: CacheType.MEMORY,
      active: CacheType.MEMORY,
      degraded: false,
    });

    await service.close();
  });
});

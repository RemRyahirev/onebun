---
description: CacheModule for in-memory and Redis caching. CacheService methods, TTL configuration, cache statistics.
---

# Cache API

Package: `@onebun/cache`

## Overview

OneBun provides a caching module with support for:
- In-memory cache
- Redis cache
- Module-based integration with DI

## CacheModule

CacheModule is **global by default** — once imported in the root module, `CacheService` is automatically available in all submodules without explicit import. Use `isGlobal: false` to require an explicit import instead; see [Non-Global Mode](#non-global-mode).

### Basic Setup

```typescript
import { Module } from '@onebun/core';
import { CacheModule, CacheType } from '@onebun/cache';
import { UserController } from './user.controller';
import { UserService } from './user.service';

// CacheModule imported once in root — CacheService available everywhere
@Module({
  imports: [
    CacheModule.forRoot({
      type: CacheType.MEMORY,  // CacheType.MEMORY or CacheType.REDIS
      cacheOptions: {
        defaultTtl: 300000,   // Default TTL in milliseconds
      },
    }),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class AppModule {}

// CacheService is automatically available in all submodules
@Module({
  controllers: [UserController],
  providers: [UserService], // UserService can inject CacheService
})
export class UserModule {}
```

### Non-Global Mode

`isGlobal: false` stops `CacheService` from being ambiently available: a module reaches it only by importing `CacheModule` explicitly. There is still exactly ONE `CacheService` per application — the two modes differ in VISIBILITY, not in how many instances exist.

```typescript
// Root module: non-global cache
@Module({
  imports: [
    CacheModule.forRoot({
      type: CacheType.REDIS,
      isGlobal: false,
    }),
  ],
})
export class AppModule {}

// Feature modules must explicitly import CacheModule
@Module({
  imports: [CacheModule.forFeature()],
  providers: [OrderService],
})
export class OrderModule {}
```

### Multiple caches

Name each configuration with `as`, and let each feature module select the one it needs. The token is a `symbol` or a `string`:

```typescript
export const SESSIONS = Symbol('SESSIONS_CACHE');
export const FRAGMENTS = Symbol('FRAGMENTS_CACHE');

@Module({
  imports: [
    CacheModule.forRoot({ type: CacheType.REDIS,  redisOptions: { database: 1 }, as: SESSIONS }),
    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 1000 }, as: FRAGMENTS }),
    PageModule,
  ],
})
export class AppModule {}

// The feature selects its registration at its own boundary...
@Module({
  imports: [CacheModule.forFeature(FRAGMENTS)],
  providers: [PageService],
})
export class PageModule {}

// ...and its providers write the ordinary constructor. No @Inject and no token at the
// injection site — the module's import already decided which registration it resolves to.
@Service()
export class PageService extends BaseService {
  constructor(private cache: CacheService) { super(); }
}
```

Registering one token twice throws rather than silently replacing the first, and selecting a token that no `forRoot()` configured fails at startup naming the missing call.

**One registration per module.** A module that selects two registrations of the same service cannot resolve it by type — the service has a single injection identity — so it must name each one with `@Inject(TOKEN)`. Without the annotation the application refuses to start, naming both candidates.

**A named registration is never global.** That is what makes two of them safe: ambient visibility has one slot per service, so a named registration reaches a module only by being imported. Combining `as` with `isGlobal: true` throws; `isGlobal: false` alongside `as` is accepted and does nothing, because it asks for what a named registration already guarantees. Neither spelling changes `CacheModule`'s own globality — only an unnamed `forRoot()` decides that, and it keeps the global behaviour it always had.

`forFeature()` with no token still SHARES: every module importing the same registration receives the same `CacheService`, so a value written through one is visible through another and the cache is initialized once. `isGlobal` controls visibility, never instance count.

### Redis Configuration

```typescript
CacheModule.forRoot({
  type: CacheType.REDIS,
  cacheOptions: {
    defaultTtl: 300000,  // TTL in milliseconds
  },
  redisOptions: {
    host: 'localhost',
    port: 6379,
    password: 'secret',
    database: 0,
    connectTimeout: 5000,     // Connection timeout in ms
    keyPrefix: 'myapp:cache:', // Key prefix for all cache keys
  },
  // Prefer env-based configuration (see below) or use getConfig() for dynamic values
})
```

### Environment Variable Configuration

CacheService auto-initializes from environment variables. When you import `CacheModule` **without** `.forRoot()`, it reads all configuration from env vars — no explicit options needed.

```bash
# Cache type: 'memory' or 'redis'
CACHE_TYPE=redis

# Common options
CACHE_DEFAULT_TTL=300000        # Default TTL in ms (default: 0 = no expiry)
CACHE_MAX_SIZE=1000             # Max items for in-memory cache
CACHE_CLEANUP_INTERVAL=60000   # Cleanup interval in ms
CACHE_ALLOW_DEGRADED_START=true # Start on a process-local in-memory cache when the configured Redis
                                # is unreachable, instead of failing app.start() (default: false;
                                # only meaningful with CACHE_TYPE=redis) — see "Unreachable Redis
                                # at startup" below for what it costs

# Redis options (only used when CACHE_TYPE=redis)
CACHE_REDIS_HOST=localhost
CACHE_REDIS_PORT=6379
CACHE_REDIS_PASSWORD=secret
CACHE_REDIS_DATABASE=0
CACHE_REDIS_CONNECT_TIMEOUT=5000
CACHE_REDIS_KEY_PREFIX=myapp:cache:
```

Import `CacheModule` without `.forRoot()` — configuration comes entirely from env vars:

```typescript
import { Module, Service, BaseService } from '@onebun/core';
import { CacheModule, CacheService } from '@onebun/cache';

// CacheModule without .forRoot() — auto-configures from env vars
@Module({
  imports: [CacheModule],
  providers: [MyService],
})
class AppModule {}

@Service()
class MyService extends BaseService {
  constructor(private cacheService: CacheService) {
    super();
  }
}
```

::: tip
`CacheModule` must be imported at least once (in the root module) — it registers `CacheService` in the DI container. Since it's global by default, submodules get `CacheService` automatically. The difference is only whether you use `.forRoot(options)` (explicit config) or plain `CacheModule` (env-only config).
:::

### Configuration Priority

Configuration is resolved in this order (first wins):

1. `CacheModule.forRoot()` options (explicit module configuration)
2. Environment variables (`CACHE_*`)
3. Default values (in-memory, no TTL)

### Custom Environment Prefix

Use `envPrefix` to avoid collisions when running multiple cache instances:

```typescript
CacheModule.forRoot({
  type: CacheType.REDIS,
  envPrefix: 'ORDERS_CACHE',  // Uses ORDERS_CACHE_REDIS_HOST, etc.
})
```

### Unreachable Redis at startup

**Configured means required.** If the application configured `type: REDIS` (or `CACHE_TYPE=redis`) and Redis is not reachable, `app.start()` **fails** and the process never takes traffic. The failure is raised from `CacheService`'s `onModuleInit`, so it arrives as a rejected `app.start()`, not as a log line after the server is already listening.

The connect attempt is **bounded** by `connectTimeout` (default `5000` ms). The driver's own reconnect never gives up on a host that swallows packets, so without that bound a black-holed Redis leaves the boot hanging indefinitely.

The error names the backend, the target, how long it waited and the one option that opts out. It never contains the password — the target is rebuilt from host, port and database rather than from the connection URL:

```
Cache backend "redis" at redis://cache.internal:6379/0 did not become usable within 5000ms
(gave up after 5003ms). Cause: Error: timed out after 5000ms. The application configured redis
explicitly, so startup fails instead of silently serving a process-local in-memory cache.
Set allowDegradedStart: true (or CACHE_ALLOW_DEGRADED_START=true) to accept a degraded cache at boot.
```

An application that configures **nothing** is unaffected: with no `type` and no `CACHE_TYPE`, the cache is in-memory by choice and there is nothing to fail.

#### Telling this failure apart from any other

The boot failure is **not catchable by class**. `CacheBackendUnavailableError` is not exported from
`@onebun/cache`, and because the failure is raised from `onModuleInit` the rejection reaches the
caller wrapped by Effect: the constructor is `FiberFailureImpl` and the name is prefixed, so strict
equality fails too. What works today is a substring test — the message survives intact:

```typescript
try {
  await app.start();
} catch (error) {
  // error.name is '(FiberFailure) CacheBackendUnavailableError'
  if (String((error as Error).name).includes('CacheBackendUnavailableError')) {
    // the configured cache backend never became usable
  }
  throw error;
}
```

The `error instanceof EnvValidationError` pattern from
[Environment Configuration](./envs.md#catching-startup-errors) does **not** transfer here: env
validation runs before the module hooks and surfaces its error unwrapped, this one does not.

Once a start has succeeded under `allowDegradedStart` there is nothing to catch — use
[`getBackendStatus()`](#which-backend-is-actually-serving) instead.

#### Accepting a degraded cache

Where a cold, unshared cache is genuinely acceptable at boot, say so:

```typescript
CacheModule.forRoot({
  type: CacheType.REDIS,
  allowDegradedStart: true,  // start on a process-local cache if Redis is down
})
```

The same switch is readable from the environment as `CACHE_ALLOW_DEGRADED_START=true` (with the configured `envPrefix`), for deployments whose whole cache configuration comes from env vars.

Know what it buys:

- the fallback is **permanent for the life of the process** — nothing retries, and a Redis that comes up three seconds later changes nothing;
- the fallback cache is **per-process** — two replicas hold different data, and cross-replica invalidation silently does nothing;
- one `WARN` line says exactly that, naming the configured backend and the target.

#### Which backend is actually serving

```typescript
const status = cacheService.getBackendStatus();
// { configured: CacheType.REDIS, active: CacheType.MEMORY, degraded: true }
```

`getBackendStatus()` is synchronous and answers from state, so a readiness endpoint can call it on every probe — treat `degraded: true` as NOT ready. It is meaningful once initialization has settled, which the framework awaits before the application starts.

<llm-only>

**Technical details for AI agents:**
- `CacheModule` is decorated with `@Global()` — by default `CacheService` is available in all modules without explicit import
- `isGlobal` option in `CacheModuleOptions` (default: `true`). When `isGlobal: false`, calls `removeFromGlobalModules(CacheModule)` so each module must explicitly import CacheModule. A later unnamed `forRoot()` that does not opt out puts the module back — symmetric, but not isolation: the registry holds one entry per module CLASS for the whole process. Two unnamed `forRoot()` calls that disagree about `isGlobal`, or about what they configure, are REFUSED: an application importing CacheModule fails at `start()` with `OneBunConflictingRegistrationError` naming both call sites. It used to be last-writer-wins — measured, `{isGlobal:false}` then default left both applications global with the opt-out silently ignored, and default then `{isGlobal:false}` left both failing to resolve `CacheService`. An application that does not import CacheModule is unaffected, and two calls that agree stay silent. Use `forRoot({ as: TOKEN })` with `forFeature(TOKEN)` when two configurations must coexist
- `isGlobal: false` is NOT the multi-cache mechanism — that is `forRoot({ as: TOKEN })` plus `forFeature(TOKEN)`, which gives each registration its own options and its own `CacheService`. An unnamed `forRoot()` still writes to a single class-static slot shared by the process
- `as: symbol | string` names a registration. Registering one token twice throws; selecting an unconfigured token fails at startup; `as` with `isGlobal: true` throws and `as` with `isGlobal: false` is inert (a named registration is already non-global, and neither spelling changes `CacheModule`'s globality); a module holding two registrations must name each with `@Inject(TOKEN)`
- `CacheModule.forFeature()` returns the module class, so it is an ordinary import. A module class is constructed ONCE per application, so every importer shares one CacheService — `isGlobal` controls visibility, never instance count
- `CacheService` auto-initializes in the constructor via `autoInitialize()` (called as `this.initPromise = this.autoInitialize()`). The promise is NOT awaited there — `onModuleInit()` awaits it, which is what makes a failure reject `app.start()`. A rejection handler is attached in the constructor so the pending rejection is not reported as unhandled before the hook runs
- `createCacheEnvSchema(prefix)` creates env schema with configurable prefix (default: `CACHE`)
- Auto-init flow: check `CacheModule.forRoot()` options → load env vars → merge (module > env > defaults) → create cache instance
- A configured Redis that does not connect within `connectTimeout` THROWS out of `autoInitialize()` and fails the application start. `allowDegradedStart: true` (or `<PREFIX>_ALLOW_DEGRADED_START=true`) turns that into a `WARN` plus `createInMemoryCache()`. A `connectTimeout` of `0` means "no driver timeout" and is treated here as the default `5000` ms rather than as an instant failure
- The connect is wrapped in `withDeadline()`: the driver retries a black-holed host forever with `reconnect: true`, so nothing else bounds it. On timeout the abandoned `RedisCache` is closed, otherwise its client keeps reconnecting for the life of the process
- A failure in loading/parsing the env configuration itself is a different path: it still logs `ERROR: Failed to auto-initialize cache from environment` and falls back to in-memory, since the configured backend is not known at that point
- `getBackendStatus()` returns `{ configured, active, degraded }` (`CacheType` values); `degraded` is `active !== configured` and is only reachable with `allowDegradedStart`
- Redis cache uses `createRedisCache(options)` which creates a Bun-native Redis client
- In-memory cache uses `InMemoryCache` with LRU eviction, TTL, and periodic cleanup
- `CacheService` implements `getStats()` returning `{ hits, misses, entries, hitRate }`
- Shared Redis via `useSharedClient: true` in `createRedisCache()` reuses `SharedRedisProvider`

</llm-only>

### Memory Configuration

```typescript
CacheModule.forRoot({
  type: CacheType.MEMORY,
  cacheOptions: {
    defaultTtl: 300000,       // TTL in milliseconds
    maxSize: 1000,            // Maximum items
    cleanupInterval: 60000,   // Cleanup every 60 seconds (ms)
  },
})
```

## CacheService

### Connection Lifecycle

`CacheService` implements `OnModuleDestroy` and closes the cache when the application stops. It **does not disconnect a shared Redis client**: `close()` disconnects only a client the service owns.

A shared client is **reference-counted, and whoever takes a hold gives it back**. The cache releases its hold when it closes; the Redis queue adapter releases its when it disconnects; code that took the client itself with `SharedRedisProvider.getClient()` releases it with `SharedRedisProvider.release()`. The connection is closed when the last holder lets go — and never because an application stopped.

`app.stop()` releases nothing. It used to release exactly one hold per stop, whether or not anything in that application had ever acquired: measured, a service with no Redis at all took a sibling's hold to zero on its own shutdown and the sibling's next queue publish threw `Redis client not connected`, while a service with a cache AND a queue gave back one of the two holds it took, so the socket outlived every application in the process. `stop({ closeSharedRedis })` is deprecated and ignored.

If a process will not exit, the shutdown log names what still holds the connection (`Shared Redis still held by 1: …`) at debug level.

If the shared client is gone when a cache operation runs, the cache re-acquires it rather than reporting a miss. When it cannot — the server is unreachable — the operation **throws**. A cache read returns `undefined` only for a key that genuinely is not there; a broken cache is an error, because code that treats a miss as "not present" (rate limits, replay guards, locks) would otherwise decide wrongly. The re-acquire is bounded by a short deadline, since the driver's auto-reconnect retries indefinitely and would otherwise turn a dead cache into a hung request.

```typescript
const app = new OneBunApplication(AppModule);
await app.start();
await app.stop();               // the cache is closed, and it releases its own shared hold

// A hold you took yourself is yours to give back:
const client = await SharedRedisProvider.getClient();
// ...
await SharedRedisProvider.release();
```

Before 0.4.5 nothing in the lifecycle called `close()`, so a cache built by one test suite stayed open into the next.

### Injection

```typescript
import { Service, BaseService } from '@onebun/core';
import { CacheService } from '@onebun/cache';

@Service()
export class UserService extends BaseService {
  constructor(private cacheService: CacheService) {
    super();
  }
}
```

### Methods

#### `get<T>()`

Retrieve value from cache.

<!-- typecheck: skip -->
```typescript
async get<T = unknown>(key: string): Promise<T | undefined>
```

```typescript
const user = await this.cacheService.get<User>('user:123');

if (user) {
  // Cache hit
  return user;
}

// Cache miss
```

`undefined` is the only miss marker. A `null` that was written to the cache is a **hit** and comes
back as `null` — `has()` returns `true` for it — so `value === null` never means "absent".

#### set()

Store value in cache.

<!-- typecheck: skip -->
```typescript
async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>
```

```typescript
// With default TTL
await this.cacheService.set('user:123', user);

// With custom TTL (in milliseconds)
await this.cacheService.set('user:123', user, { ttl: 600_000 }); // 10 minutes

// No expiration
await this.cacheService.set('user:123', user, { ttl: 0 });
```

#### delete()

Remove value from cache.

<!-- typecheck: skip -->
```typescript
async delete(key: string): Promise<boolean>
```

```typescript
const deleted = await this.cacheService.delete('user:123');
```

#### has()

Check if key exists.

<!-- typecheck: skip -->
```typescript
async has(key: string): Promise<boolean>
```

```typescript
if (await this.cacheService.has('user:123')) {
  // Key exists
}
```

#### clear()

Delete every entry **in this cache's key prefix**.

<!-- typecheck: skip -->
```typescript
async clear(): Promise<void>
```

```typescript
await this.cacheService.clear();
```

The scope is the prefix, and only the prefix. A cache configured with `keyPrefix: 'myapp:cache:'`
deletes `myapp:cache:*` and nothing else, so sessions, queues and rate-limit counters sharing that
Redis database are untouched.

::: danger A cache with no prefix refuses to clear
`clear()` and `getStats()` throw when the client they run on has an empty `keyPrefix`, because a
cache that cannot name its own keyspace cannot delete inside it either — the pattern would be `*`,
and the deletion would take every other tenant of the database with it. The error names the mode and
what to configure.

This is reachable: `CacheModule.forRoot({ redisOptions: { keyPrefix: '' } })`, an explicit
`createRedisCache({ keyPrefix: '' })`, or a `RedisClient` you construct without one and pass in.
Environment configuration cannot reach it — an empty `CACHE_REDIS_KEY_PREFIX` reads as unset and
falls back to the default.
:::

Which prefix applies depends on where the client comes from:

| Mode | Prefix that applies | Key on the wire for `set('user:1', …)` |
|---|---|---|
| Standalone (`createRedisCache({ keyPrefix: 'myapp:cache:' })`) | the cache's own `keyPrefix`, passed to the client it creates | `myapp:cache:user:1` |
| Shared (`useSharedClient: true`) | the **shared** client's prefix, from `SharedRedisProvider.configure({ keyPrefix: 'shared:' })` | `shared:user:1` |
| Injected (`new RedisCache(client)`) | the prefix that client was constructed with | that client's prefix + `user:1` |

**The client is the sole owner of the prefix.** It applies one on every command, prefixes the
patterns `clear()` and `getStats()` scope themselves with, and strips it back off results. Nothing
above it prefixes as well, because two owners that do not know about each other is precisely how
`myapp:cache:myapp:cache:user:1` happened.

That is also why a `keyPrefix` **cannot** be combined with `useSharedClient: true` — the shared
client owns the keyspace, so a cache-level prefix has nowhere to go. It is rejected at
construction, naming `SharedRedisProvider.configure()` as the place to set it. It used to be
dropped in silence, so keys landed under the shared prefix alone and anything written against the
configured name found nothing. A `keyPrefix` cannot be supplied alongside an injected client
either: the constructor takes options **or** a client, never both.

Before 0.5.1 the standalone path applied the prefix twice — entries were stored under
`prefix + prefix + key` — so any reader outside the cache (a runbook, `SCAN`, a Redis ACL key
pattern, another service) looked in the wrong place. Caches warmed by an older release will miss
on their first read after upgrading and refill normally.

#### `mget<T>()`

Get multiple values at once.

<!-- typecheck: skip -->
```typescript
async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]>
```

```typescript
const results = await this.cacheService.mget<User>([
  'user:1',
  'user:2',
  'user:3',
]);

for (const user of results) {
  if (user) {
    this.logger.info('Found user', { name: user.name });
  }
}
```

#### `mset<T>()`

Set multiple values at once.

<!-- typecheck: skip -->
```typescript
async mset<T = unknown>(
  entries: Array<{ key: string; value: T; options?: CacheSetOptions }>
): Promise<void>
```

```typescript
await this.cacheService.mset([
  { key: 'user:1', value: user1 },
  { key: 'user:2', value: user2, options: { ttl: 300_000 } },
]);
```

## Caching Patterns

### Cache-Aside Pattern

```typescript
@Service()
export class UserService extends BaseService {
  constructor(
    private cacheService: CacheService,
    private repository: UserRepository,
  ) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const cacheKey = `user:${id}`;

    // Try cache first
    const cached = await this.cacheService.get<User>(cacheKey);
    if (cached) {
      this.logger.debug('Cache hit', { key: cacheKey });
      return cached;
    }

    // Cache miss - fetch from database
    this.logger.debug('Cache miss', { key: cacheKey });
    const user = await this.repository.findById(id);

    // Store in cache
    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300_000 }); // 5 minutes
    }

    return user;
  }
}
```

### Cache Invalidation

```typescript
@Service()
export class UserService extends BaseService {
  async update(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.repository.update(id, data);

    // Invalidate cache
    await this.cacheService.delete(`user:${id}`);

    // Also invalidate related caches
    await this.cacheService.delete('users:list');

    return user;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);

    // Invalidate all related caches
    await Promise.all([
      this.cacheService.delete(`user:${id}`),
      this.cacheService.delete(`user:${id}:posts`),
      this.cacheService.delete(`user:${id}:settings`),
      this.cacheService.delete('users:list'),
    ]);
  }
}
```

### Cache Warming

```typescript
@Service()
export class CacheWarmerService extends BaseService {
  constructor(
    private cacheService: CacheService,
    private userRepository: UserRepository,
  ) {
    super();
  }

  async warmUserCache(): Promise<void> {
    this.logger.info('Warming user cache');

    const users = await this.userRepository.findAll({ limit: 1000 });

    await this.cacheService.mset(
      users.map(user => ({ key: `user:${user.id}`, value: user, options: { ttl: 3_600_000 } }))
    );

    this.logger.info('User cache warmed', { count: users.length });
  }
}
```

### Memoization

```typescript
@Service()
export class ConfigService extends BaseService {
  constructor(private cacheService: CacheService) {
    super();
  }

  async getFeatureFlags(): Promise<FeatureFlags> {
    const cacheKey = 'config:feature-flags';

    // Very long TTL for rarely changing data
    let flags = await this.cacheService.get<FeatureFlags>(cacheKey);

    if (!flags) {
      flags = await this.fetchFeatureFlags();
      await this.cacheService.set(cacheKey, flags, { ttl: 3_600_000 }); // 1 hour
    }

    return flags;
  }
}
```

## Cache Types

### CacheSetOptions

```typescript
interface CacheSetOptions {
  /** Time-to-live in milliseconds. 0 for no expiration */
  ttl?: number;
}
```

### CacheStats

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  hitRate: number;
}
```

## Shared Redis Connection

For applications using both cache and WebSocket (or other Redis-based features), you can share a single Redis connection:

```typescript
import { SharedRedisProvider } from '@onebun/core';
import { createRedisCache, RedisCache } from '@onebun/cache';

// Configure shared Redis at app startup
SharedRedisProvider.configure({
  url: 'redis://localhost:6379',
  keyPrefix: 'myapp:',
});

// Option 1: Use shared client via options
const cache = createRedisCache({
  useSharedClient: true,
  defaultTtl: 60000,
});
await cache.connect();

// Option 2: Pass RedisClient directly  
const sharedClient = await SharedRedisProvider.getClient();
const cache = new RedisCache(sharedClient);

// Check if using shared connection
console.log(cache.isUsingSharedClient()); // true
```

**Benefits:**
- Single connection pool for cache and WebSocket
- Reduced memory footprint
- Consistent key prefixing across features

**One configuration per process.** There is a single shared connection, so there is a single
configuration: a second `configure()` asking for a different URL, key prefix, `reconnect` or
`tls` throws `OneBunSharedRedisConflictError`, naming both targets and both call sites. It used
to be accepted and ignored — two applications pointing at different Redis databases both kept
whichever connection existed first, under the first one's key prefix, so one application's
`clear()` reached the other's data. Re-stating the same configuration is fine. For a second,
genuinely different target use a dedicated client — `SharedRedisProvider.createClient({ url })`,
or the consumer's own connection options — and in tests call `SharedRedisProvider.reset()`
between configurations.

## Effect.js Integration

For Effect.js-based usage:

```typescript
import { createCacheModule, cacheServiceTag, CacheType } from '@onebun/cache';
import { Effect, pipe } from 'effect';

// Create service
const cacheLayer = createCacheModule({
  type: CacheType.MEMORY,
  cacheOptions: {
    defaultTtl: 300000,
  },
});

// Use in Effect
const program = pipe(
  cacheServiceTag,
  Effect.flatMap((cache) =>
    Effect.promise(() => cache.get<User>('user:123'))
  ),
);

// Run
Effect.runPromise(
  Effect.provide(program, cacheLayer)
);
```

## Complete Example

```typescript
import { Module, Controller, BaseController, Service, BaseService, Get, Post, Delete, Param, Body, HttpException, type } from '@onebun/core';
import { CacheModule, CacheService, CacheType } from '@onebun/cache';

// Types
interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

// Service
@Service()
export class ProductService extends BaseService {
  private products = new Map<string, Product>();

  constructor(private cacheService: CacheService) {
    super();
    // Seed some data
    this.products.set('1', { id: '1', name: 'Widget', price: 9.99, stock: 100 });
    this.products.set('2', { id: '2', name: 'Gadget', price: 19.99, stock: 50 });
  }

  async findById(id: string): Promise<Product | null> {
    const cacheKey = `product:${id}`;

    // Check cache
    const cached = await this.cacheService.get<Product>(cacheKey);
    if (cached) {
      this.logger.debug('Product cache hit', { id });
      return cached;
    }

    // Fetch from "database"
    const product = this.products.get(id) || null;

    // Cache result
    if (product) {
      await this.cacheService.set(cacheKey, product, { ttl: 60_000 }); // 1 minute
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
    await this.cacheService.set(cacheKey, products, { ttl: 30_000 }); // 30 seconds

    return products;
  }

  async updateStock(id: string, quantity: number): Promise<Product | null> {
    const product = this.products.get(id);
    if (!product) return null;

    product.stock += quantity;
    this.products.set(id, product);

    // Invalidate caches
    await Promise.all([
      this.cacheService.delete(`product:${id}`),
      this.cacheService.delete('products:all'),
    ]);

    return product;
  }
}

// Controller
@Controller('/products')
export class ProductController extends BaseController {
  constructor(private productService: ProductService) {
    super();
  }

  @Get('/')
  async findAll() {
    return await this.productService.findAll();
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
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
  ) {
    const product = await this.productService.updateStock(id, body.quantity);

    if (!product) {
      throw new HttpException(404, 'Product not found');
    }

    return product;
  }
}

// Module
@Module({
  imports: [
    CacheModule.forRoot({
      type: CacheType.MEMORY,
      cacheOptions: {
        defaultTtl: 300000,
        maxSize: 1000,
      },
    }),
  ],
  controllers: [ProductController],
  providers: [ProductService],
})
export class ProductModule {}
```

## Advanced Patterns

<llm-only>

### Cache Failover (Redis → In-Memory)

The **boot-time** half of this is built in and needs no wrapper: a configured backend that never
becomes usable fails `app.start()`, `allowDegradedStart: true` (or
`CACHE_ALLOW_DEGRADED_START=true`) turns that into a `WARN` plus a process-local in-memory cache,
and `getBackendStatus()` reports which backend is actually serving. See
[Accepting a degraded cache](#accepting-a-degraded-cache) and
[Which backend is actually serving](#which-backend-is-actually-serving).

What is genuinely not provided is **runtime** failover: once the application is up, a Redis that
dies makes cache operations throw and nothing switches backends. A wrapper service can do that:

```typescript
import {
  Service,
  BaseService,
  type OnModuleInit,
} from '@onebun/core';
import {
  createInMemoryCache,
  createRedisCache,
  type CacheSetOptions,
  type InMemoryCache,
  type RedisCache,
} from '@onebun/cache';

const CONNECT_DEADLINE_MS = 5000;
const RETRY_INTERVAL_MS = 30000;

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * Not optional. The driver connects with `reconnect: true`, so `connect()` against an unreachable
 * host never rejects — it retries forever. A bare `await connect()` hangs the boot instead of
 * throwing, and the `catch` below never runs. This is the same bound `CacheService` applies to its
 * own connect.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
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
}

@Service()
export class ResilientCacheService extends BaseService implements OnModuleInit {
  private primaryCache: RedisCache | null = null;
  private readonly fallbackCache: InMemoryCache;
  private usingFallback = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    // Always have an in-memory fallback ready
    this.fallbackCache = createInMemoryCache({
      defaultTtl: 300000,
      maxSize: 10000,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connectPrimary();
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.usingFallback || !this.primaryCache) {
      return await this.fallbackCache.get<T>(key);
    }

    try {
      return await this.primaryCache.get<T>(key);
    } catch {
      this.logger.warn('Redis get failed, falling back to memory', { key });
      this.switchToFallback();

      return await this.fallbackCache.get<T>(key);
    }
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    // Always set in fallback for immediate availability
    await this.fallbackCache.set(key, value, options);

    if (!this.usingFallback && this.primaryCache) {
      try {
        await this.primaryCache.set(key, value, options);
      } catch {
        this.logger.warn('Redis set failed, using memory only', { key });
        this.switchToFallback();
      }
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.fallbackCache.delete(key);

    if (!this.usingFallback && this.primaryCache) {
      try {
        return await this.primaryCache.delete(key);
      } catch {
        this.switchToFallback();
      }
    }

    return true;
  }

  private async connectPrimary(): Promise<void> {
    const cache = createRedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      defaultTtl: 300000,
    });

    try {
      await withDeadline(cache.connect(), CONNECT_DEADLINE_MS);
      this.primaryCache = cache;
      this.usingFallback = false;
      this.logger.info('Redis cache connected (primary)');
    } catch (error) {
      // The abandoned client keeps retrying for the life of the process unless it is closed.
      await cache.close().catch(() => undefined);
      this.primaryCache = null;
      this.usingFallback = true;
      this.logger.warn('Redis unavailable, using in-memory fallback', { error: String(error) });
      this.scheduleRetry();
    }
  }

  private switchToFallback(): void {
    if (!this.usingFallback) {
      this.usingFallback = true;
      this.logger.warn('Switched to in-memory cache fallback');
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectPrimary();
    }, RETRY_INTERVAL_MS);
  }
}
```

**Important considerations:**
- Every `connect()` must be bounded, including the retry — without `withDeadline` an unreachable Redis hangs `app.start()` instead of failing over, because the driver retries forever rather than rejecting
- A connect that timed out must be `close()`d — the abandoned client keeps reconnecting for the life of the process otherwise
- This pattern provides availability over consistency — the in-memory cache is local to each process instance
- When running multiple service instances, in-memory fallback means each instance has its own cache (no sharing)
- After Redis recovery, the in-memory cache data is NOT synchronized back to Redis
- Consider using a health check to detect Redis availability and alert operations teams

</llm-only>

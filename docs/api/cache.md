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

### Basic Setup

```typescript
import { Module } from '@onebun/core';
import { CacheModule, CacheType } from '@onebun/cache';
import { UserController } from './user.controller';
import { UserService } from './user.service';

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
export class UserModule {}
```

### Redis Configuration

```typescript
CacheModule.forRoot({
  type: CacheType.REDIS,
  cacheOptions: {
    defaultTtl: 300000,  // TTL in milliseconds
  },
  redisOptions: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    database: 0,
    connectTimeout: 5000,     // Connection timeout in ms
    keyPrefix: 'myapp:cache:', // Key prefix for all cache keys
  },
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
`CacheModule` must always be imported — it registers `CacheService` in the DI container. The difference is only whether you use `.forRoot(options)` (explicit config) or plain `CacheModule` (env-only config).
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

### Redis Error Handling

If Redis connection fails during auto-initialization, CacheService **automatically falls back to in-memory cache** and logs a warning:

```typescript
// If CACHE_TYPE=redis but Redis is unreachable:
// WARN: Failed to auto-initialize cache from environment
// INFO: In-memory cache initialized (fallback)
```

<llm-only>

**Technical details for AI agents:**
- `CacheService` auto-initializes in the constructor via `autoInitialize()` (called as `this.initPromise = this.autoInitialize()`)
- `createCacheEnvSchema(prefix)` creates env schema with configurable prefix (default: `CACHE`)
- Auto-init flow: check `CacheModule.forRoot()` options → load env vars → merge (module > env > defaults) → create cache instance
- If Redis init fails, catches error and falls back to `createInMemoryCache()` — the service always initializes
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

```typescript
async get<T>(key: string): Promise<T | null>
```

```typescript
const user = await this.cacheService.get<User>('user:123');

if (user) {
  // Cache hit
  return user;
}

// Cache miss
```

#### set()

Store value in cache.

```typescript
async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>
```

```typescript
// With default TTL
await this.cacheService.set('user:123', user);

// With custom TTL (in seconds)
await this.cacheService.set('user:123', user, { ttl: 600 });

// No expiration
await this.cacheService.set('user:123', user, { ttl: 0 });
```

#### delete()

Remove value from cache.

```typescript
async delete(key: string): Promise<boolean>
```

```typescript
const deleted = await this.cacheService.delete('user:123');
```

#### has()

Check if key exists.

```typescript
async has(key: string): Promise<boolean>
```

```typescript
if (await this.cacheService.has('user:123')) {
  // Key exists
}
```

#### clear()

Clear all cache entries.

```typescript
async clear(): Promise<void>
```

```typescript
await this.cacheService.clear();
```

#### `getMany<T>()`

Get multiple values at once.

```typescript
async getMany<T>(keys: string[]): Promise<Map<string, T | null>>
```

```typescript
const results = await this.cacheService.getMany<User>([
  'user:1',
  'user:2',
  'user:3',
]);

for (const [key, user] of results) {
  if (user) {
    console.log(key, user.name);
  }
}
```

#### setMany()

Set multiple values at once.

```typescript
async setMany<T>(entries: Map<string, T>, options?: CacheSetOptions): Promise<void>
```

```typescript
const users = new Map([
  ['user:1', user1],
  ['user:2', user2],
]);

await this.cacheService.setMany(users, { ttl: 300 });
```

#### deleteMany()

Delete multiple keys.

```typescript
async deleteMany(keys: string[]): Promise<number>
```

```typescript
const deletedCount = await this.cacheService.deleteMany([
  'user:1',
  'user:2',
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
      await this.cacheService.set(cacheKey, user, { ttl: 300 });
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
    await this.cacheService.deleteMany([
      `user:${id}`,
      `user:${id}:posts`,
      `user:${id}:settings`,
      'users:list',
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

    const entries = new Map(
      users.map(user => [`user:${user.id}`, user])
    );

    await this.cacheService.setMany(entries, { ttl: 3600 });

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
      await this.cacheService.set(cacheKey, flags, { ttl: 3600 }); // 1 hour
    }

    return flags;
  }
}
```

## Cache Types

### CacheSetOptions

```typescript
interface CacheSetOptions {
  /** Time-to-live in seconds. 0 for no expiration */
  ttl?: number;
}
```

### CacheStats

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  size: number;
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
import { Module, Controller, BaseController, Service, BaseService, Get, Post, Delete, Param, Body } from '@onebun/core';
import { CacheModule, CacheService, CacheType } from '@onebun/cache';
import { type } from 'arktype';

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
      await this.cacheService.set(cacheKey, product, { ttl: 60 });
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
    await this.cacheService.set(cacheKey, products, { ttl: 30 });

    return products;
  }

  async updateStock(id: string, quantity: number): Promise<Product | null> {
    const product = this.products.get(id);
    if (!product) return null;

    product.stock += quantity;
    this.products.set(id, product);

    // Invalidate caches
    await this.cacheService.deleteMany([
      `product:${id}`,
      'products:all',
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
  async findAll(): Promise<Response> {
    const products = await this.productService.findAll();
    return this.success(products);
  }

  @Get('/:id')
  async findOne(@Param('id') id: string): Promise<Response> {
    const product = await this.productService.findById(id);

    if (!product) {
      return this.error('Product not found', 404, 404);
    }

    return this.success(product);
  }

  @Post('/:id/stock')
  async updateStock(
    @Param('id') id: string,
    @Body() body: { quantity: number },
  ): Promise<Response> {
    const product = await this.productService.updateStock(id, body.quantity);

    if (!product) {
      return this.error('Product not found', 404, 404);
    }

    return this.success(product);
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

OneBun does not have built-in automatic failover between cache backends at runtime. However, you can implement a wrapper service that catches Redis errors and falls back to an in-memory cache:

```typescript
import { Service, BaseService } from '@onebun/core';
import {
  CacheService,
  createInMemoryCache,
  createRedisCache,
  type InMemoryCache,
  type RedisCache,
  type CacheSetOptions,
} from '@onebun/cache';

@Service()
export class ResilientCacheService extends BaseService {
  private primaryCache: RedisCache | null = null;
  private fallbackCache: InMemoryCache;
  private usingFallback = false;

  constructor() {
    super();
    // Always have an in-memory fallback ready
    this.fallbackCache = createInMemoryCache({
      defaultTtl: 300000,
      maxSize: 10000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      this.primaryCache = createRedisCache({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        defaultTtl: 300000,
      });
      await this.primaryCache.connect();
      this.logger.info('Redis cache connected (primary)');
    } catch (error) {
      this.logger.warn('Redis unavailable, using in-memory fallback', error);
      this.usingFallback = true;
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.usingFallback || !this.primaryCache) {
      return this.fallbackCache.get<T>(key);
    }

    try {
      return await this.primaryCache.get<T>(key);
    } catch (error) {
      this.logger.warn('Redis get failed, falling back to memory', { key });
      this.switchToFallback();
      return this.fallbackCache.get<T>(key);
    }
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    // Always set in fallback for immediate availability
    await this.fallbackCache.set(key, value, options);

    if (!this.usingFallback && this.primaryCache) {
      try {
        await this.primaryCache.set(key, value, options);
      } catch (error) {
        this.logger.warn('Redis set failed, using memory only', { key });
        this.switchToFallback();
      }
    }
  }

  async delete(key: string): Promise<boolean> {
    this.fallbackCache.delete(key);

    if (!this.usingFallback && this.primaryCache) {
      try {
        return await this.primaryCache.delete(key);
      } catch {
        this.switchToFallback();
      }
    }

    return true;
  }

  private switchToFallback(): void {
    if (!this.usingFallback) {
      this.usingFallback = true;
      this.logger.warn('Switched to in-memory cache fallback');

      // Try to reconnect periodically
      setTimeout(() => this.tryReconnect(), 30000);
    }
  }

  private async tryReconnect(): Promise<void> {
    try {
      this.primaryCache = createRedisCache({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        defaultTtl: 300000,
      });
      await this.primaryCache.connect();
      this.usingFallback = false;
      this.logger.info('Redis cache reconnected');
    } catch {
      this.logger.warn('Redis reconnection failed, retrying in 30s');
      setTimeout(() => this.tryReconnect(), 30000);
    }
  }
}
```

**Important considerations:**
- This pattern provides availability over consistency — the in-memory cache is local to each process instance
- When running multiple service instances, in-memory fallback means each instance has its own cache (no sharing)
- After Redis recovery, the in-memory cache data is NOT synchronized back to Redis
- Consider using a health check to detect Redis availability and alert operations teams

</llm-only>

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
import { CacheModule } from '@onebun/cache';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    CacheModule.register({
      type: 'memory',  // 'memory' or 'redis'
      ttl: 300,        // Default TTL in seconds
    }),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
```

### Redis Configuration

```typescript
CacheModule.register({
  type: 'redis',
  ttl: 300,
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: 0,
  },
})
```

### Memory Configuration

```typescript
CacheModule.register({
  type: 'memory',
  ttl: 300,
  memory: {
    maxSize: 1000,        // Maximum items
    cleanupInterval: 60,  // Cleanup every 60 seconds
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

#### get<T>()

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

#### getMany<T>()

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

## Effect.js Integration

For Effect.js-based usage:

```typescript
import { makeCacheService, cacheServiceTag } from '@onebun/cache';
import { Effect, pipe } from 'effect';

// Create service
const cacheLayer = makeCacheService({
  type: 'memory',
  ttl: 300,
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
import { CacheModule, CacheService } from '@onebun/cache';
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
    CacheModule.register({
      type: 'memory',
      ttl: 300,
      memory: {
        maxSize: 1000,
      },
    }),
  ],
  controllers: [ProductController],
  providers: [ProductService],
})
export class ProductModule {}
```

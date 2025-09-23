# @onebun/cache

Caching module for OneBun framework with support for in-memory and Redis-based storage.

## Features

- **Universal Interface**: Single interface for both in-memory and Redis cache implementations
- **TTL Support**: Flexible time-to-live (TTL) management for cached items
- **Type Safety**: Full TypeScript support with strict typing
- **Effect Integration**: Seamless integration with Effect.js for dependency injection
- **Auto Cleanup**: Automatic cleanup of expired items in memory cache

## Installation

```bash
bun add @onebun/cache
```

## Usage

### Basic Usage

```typescript
import { createInMemoryCache } from '@onebun/cache';

// Create in-memory cache
const cache = createInMemoryCache();

// Set a value
await cache.set('key', 'value', { ttl: 300000 }); // 5 minutes

// Get a value
const value = await cache.get('key');

// Delete a value
await cache.delete('key');

// Clear all cache
await cache.clear();
```

### With Effect.js

```typescript
import { Effect, Layer, pipe } from 'effect';
import { Cache, createInMemoryCache, CacheService } from '@onebun/cache';

// Create cache layer
const cacheLayer = Layer.succeed(CacheService, createInMemoryCache());

// Use in your service
class MyService extends Effect.Service<MyService>()('MyService', {
  dependencies: [CacheService.Default],
  effect: pipe(
    CacheService,
    Effect.andThen((cache) =>
      pipe(
        cache.set('user:123', userData, { ttl: 3600000 }),
        Effect.andThen(() => cache.get('user:123'))
      )
    )
  )
}) {}
```

## Cache Options

```typescript
interface CacheOptions {
  /**
   * Default TTL for cache entries in milliseconds
   * @default undefined (no expiration)
   */
  defaultTtl?: number;

  /**
   * Maximum number of entries in cache (for memory cache only)
   * @default undefined (unlimited)
   */
  maxSize?: number;

  /**
   * Cleanup interval for expired entries in milliseconds (for memory cache only)
   * @default 60000 (1 minute)
   */
  cleanupInterval?: number;
}
```

## API Reference

### CacheService Interface

```typescript
interface CacheService {
  /**
   * Get a value from cache
   */
  get<T>(key: string): Effect.Effect<T | undefined>;

  /**
   * Set a value in cache
   */
  set<T>(key: string, value: T, options?: CacheSetOptions): Effect.Effect<void>;

  /**
   * Delete a value from cache
   */
  delete(key: string): Effect.Effect<boolean>;

  /**
   * Clear all values from cache
   */
  clear(): Effect.Effect<void>;

  /**
   * Check if key exists in cache
   */
  has(key: string): Effect.Effect<boolean>;

  /**
   * Get multiple values from cache
   */
  mget<T>(keys: string[]): Effect.Effect<(T | undefined)[]>;

  /**
   * Set multiple values in cache
   */
  mset<T>(entries: Array<{ key: string; value: T; options?: CacheSetOptions }>): Effect.Effect<void>;
}
```

### CacheSetOptions

```typescript
interface CacheSetOptions {
  /**
   * Time to live in milliseconds
   * @default uses default TTL from cache options
   */
  ttl?: number;
}
```

## Implementations

### In-Memory Cache

```typescript
import { createInMemoryCache } from '@onebun/cache';

const cache = createInMemoryCache({
  defaultTtl: 300000, // 5 minutes
  maxSize: 1000,      // Max 1000 entries
  cleanupInterval: 60000 // Cleanup every minute
});
```

### Redis Cache (planned)

```typescript
// Future implementation
import { createRedisCache } from '@onebun/cache';

const cache = createRedisCache({
  host: 'localhost',
  port: 6379,
  defaultTtl: 300000
});
```

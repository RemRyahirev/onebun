# @onebun/cache

Caching module for OneBun framework with support for in-memory and Redis-based storage.

## Features

- **In-memory caching** with automatic cleanup
- **Redis caching** for distributed systems
- **Easy module setup** with environment variable configuration
- **TTL (Time To Live)** support
- **Cache size limits** with automatic eviction (in-memory)
- **Batch operations** (mget, mset)
- **Cache statistics** (hits, misses, hit rate)
- **Effect.js integration** for functional programming
- **Type-safe API**
- **Promise-based interface**

## Installation

```bash
bun add @onebun/cache

# Dependencies:
# - @onebun/envs (for configuration management)
# - Bun v1.2.9+ (for native RedisClient support)
```

## Quick Start

### Using Cache Module (Recommended)

The easiest way to use cache is with the `createCacheModule` function:

```typescript
import { createCacheModule, CacheType } from '@onebun/cache';

// In-memory cache (default)
const cacheLayer = createCacheModule();

// Redis cache
const cacheLayer = createCacheModule({
  type: CacheType.REDIS,
  redisOptions: {
    host: 'localhost',
    port: 6379,
  },
});

// With environment variables
// Set CACHE_TYPE=redis, CACHE_REDIS_HOST=localhost, etc.
const cacheLayer = createCacheModule(); // Will use env vars
```

### Environment Variables

The cache module uses `@onebun/envs` for robust, type-safe configuration with automatic validation:

```bash
# Cache type (validated: 'memory' or 'redis')
CACHE_TYPE=redis

# Common options (with min value validation)
CACHE_DEFAULT_TTL=60000           # Min: 0
CACHE_MAX_SIZE=1000                # Min: 0
CACHE_CLEANUP_INTERVAL=30000       # Min: 0

# Redis options (with validation)
CACHE_REDIS_HOST=localhost
CACHE_REDIS_PORT=6379              # Validated: 1-65535
CACHE_REDIS_PASSWORD=secret        # Sensitive - masked in logs
CACHE_REDIS_DATABASE=0             # Min: 0
CACHE_REDIS_CONNECT_TIMEOUT=5000   # Min: 0
CACHE_REDIS_KEY_PREFIX=myapp:cache:
```

**Features:**
- ✅ Type-safe parsing and validation
- ✅ Automatic type conversion (string → number)
- ✅ Sensitive value handling (passwords)
- ✅ Port range validation (1-65535)
- ✅ Enum validation for `CACHE_TYPE`

Custom prefix:

```typescript
// Use MY_CACHE_* instead of CACHE_*
const cacheLayer = createCacheModule({ envPrefix: 'MY_CACHE' });
```

## Usage Examples

### Basic In-Memory Cache

```typescript
import { createInMemoryCache } from '@onebun/cache';

const cache = createInMemoryCache({
  defaultTtl: 60000, // 1 minute
  maxSize: 1000, // maximum 1000 entries
  cleanupInterval: 30000, // cleanup every 30 seconds
});

// Set value
await cache.set('user:123', { name: 'John', email: 'john@example.com' });

// Get value
const user = await cache.get('user:123');

// Delete value
await cache.delete('user:123');

// Clear all
await cache.clear();
```

### Redis Cache

Redis cache uses Bun's built-in native `RedisClient` (available since Bun v1.2.9). 

Read more: [Bun Redis Client Documentation](https://bun.com/docs/api/redis)

```typescript
import { createRedisCache } from '@onebun/cache';

const cache = createRedisCache({
  host: 'localhost',
  port: 6379,
  password: 'secret',
  database: 0,
  keyPrefix: 'myapp:',
  defaultTtl: 60000,
});

// Connect to Redis (required before use)
await cache.connect();

// Use same API as in-memory cache
await cache.set('user:123', { name: 'John' });
const user = await cache.get('user:123');

// Close connection when done
await cache.close();
```

**Features:**
- ✅ Native Bun implementation (no external dependencies)
- ✅ RESP3 protocol support
- ✅ Automatic connection management with auto-reconnect
- ✅ Auto-pipelining for better performance
- ✅ TLS support
- ✅ Fully typed responses

### TTL Examples

```typescript
// Set with default TTL
await cache.set('key1', 'value1');

// Set with custom TTL (5 seconds)
await cache.set('key2', 'value2', { ttl: 5000 });

// Set without expiration
await cache.set('key3', 'value3', { ttl: 0 });
```

### Batch Operations

```typescript
// Get multiple values
const values = await cache.mget(['key1', 'key2', 'key3']);

// Set multiple values
await cache.mset([
  { key: 'key1', value: 'value1' },
  { key: 'key2', value: 'value2', options: { ttl: 10000 } },
]);
```

### Statistics

```typescript
const stats = await cache.getStats();
console.log(stats);
// { hits: 10, misses: 2, entries: 5, hitRate: 0.833 }
```

### Effect.js Integration

```typescript
import { Effect, pipe } from 'effect';
import { createCacheModule, cacheServiceTag, CacheType } from '@onebun/cache';

// Create cache layer
const cacheLayer = createCacheModule({ type: CacheType.MEMORY });

// Use in Effect program
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
```

### Async Module Creation

For Redis, you can ensure connection is established before use:

```typescript
import { createCacheModuleAsync, CacheType } from '@onebun/cache';

const cacheLayer = await createCacheModuleAsync({
  type: CacheType.REDIS,
  redisOptions: {
    host: 'localhost',
    port: 6379,
  },
});

// Redis is now connected and ready to use
```

## API Reference

### CacheService Interface

All cache implementations follow the `CacheService` interface:

```typescript
interface CacheService {
  // Get value by key
  get<T>(key: string): Promise<T | undefined>;
  
  // Set value with optional TTL
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  
  // Delete value by key
  delete(key: string): Promise<boolean>;
  
  // Check if key exists
  has(key: string): Promise<boolean>;
  
  // Clear all cache entries
  clear(): Promise<void>;
  
  // Get multiple values
  mget<T>(keys: string[]): Promise<(T | undefined)[]>;
  
  // Set multiple values
  mset<T>(entries: Array<{
    key: string;
    value: T;
    options?: CacheSetOptions;
  }>): Promise<void>;
  
  // Get cache statistics
  getStats(): Promise<CacheStats>;
  
  // Close connection and cleanup
  close(): Promise<void>;
}
```

### Configuration Options

#### CacheModuleOptions

```typescript
interface CacheModuleOptions {
  // Type of cache (memory or redis)
  type?: CacheType;
  
  // Common cache options
  cacheOptions?: CacheOptions;
  
  // Redis-specific options
  redisOptions?: RedisCacheOptions;
  
  // Environment variable prefix (default: 'CACHE')
  envPrefix?: string;
}
```

#### CacheOptions

```typescript
interface CacheOptions {
  // Default TTL in milliseconds (0 = no expiration)
  defaultTtl?: number;
  
  // Maximum number of entries (in-memory only)
  maxSize?: number;
  
  // Cleanup interval in milliseconds (in-memory only)
  cleanupInterval?: number;
}
```

#### RedisCacheOptions

```typescript
interface RedisCacheOptions extends CacheOptions {
  // Redis host (default: 'localhost')
  host?: string;
  
  // Redis port (default: 6379)
  port?: number;
  
  // Redis password
  password?: string;
  
  // Redis database number (default: 0)
  database?: number;
  
  // Connection timeout in milliseconds (default: 5000)
  connectTimeout?: number;
  
  // Key prefix for all cache keys (default: 'onebun:cache:')
  keyPrefix?: string;
}
```

#### CacheSetOptions

```typescript
interface CacheSetOptions {
  // Time to live in milliseconds
  ttl?: number;
}
```

## Best Practices

1. **Use cache module** for easy setup with environment variable support
2. **Set appropriate TTLs** to prevent stale data
3. **Use key prefixes** to organize cache entries and avoid conflicts
4. **Monitor statistics** to optimize cache hit rates
5. **Handle cache misses** gracefully in your application
6. **Close connections** when shutting down (especially for Redis)
7. **Use Bun v1.2.9+** for Redis support (built-in native client)

## Requirements

- **Bun**: v1.2.9 or higher (for Redis support)
- **Effect**: v3.13.10 or higher

## Implementation Details

### Redis Client Types

This package includes minimal type definitions for Bun's `RedisClient` (in `bun-redis-types.ts`) until official types are available in `bun-types`. These types provide:

- Type safety for Redis operations
- IntelliSense support in IDEs  
- Compatibility with TypeScript strict mode

The types will be automatically replaced once official types are published in future versions of `bun-types`.

### Auto-Pipelining

Bun's native `RedisClient` includes automatic command pipelining for improved performance. Multiple commands sent in succession are automatically batched and sent together, reducing network round trips.

### Connection Management

The Redis client handles:
- Automatic reconnection with exponential backoff
- Connection pooling
- TLS/SSL support
- RESP3 protocol for better type handling

For more details, see the [official Bun Redis documentation](https://bun.com/docs/api/redis).

## License

MIT
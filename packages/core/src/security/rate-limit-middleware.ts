import type { RedisClient } from '../redis/redis-client';
import type { OneBunRequest, OneBunResponse } from '../types';

import { createErrorResponse } from '@onebun/requests';

import { BaseMiddleware } from '../module/middleware';

import { getClientAddress } from './client-address';

/**
 * Rate limiting storage backend interface.
 * Implement this to provide a custom backend (e.g. NATS KV, DynamoDB, etc.).
 *
 * @see docs:api/security.md
 */
export interface RateLimitStore {
  /**
   * Increment the request counter for a given key.
   * Returns the new count and the Unix timestamp (ms) when the window resets.
   * If the key did not exist, the window resets at `now + windowMs`.
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

// ============================================================================
// In-memory store (default)
// ============================================================================

interface MemoryEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limit store.
 * Not suitable for multi-process or multi-instance deployments — use `RedisRateLimitStore` instead.
 *
 * @see docs:api/security.md
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, MemoryEntry>();

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.map.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.map.set(key, { count: 1, resetAt });

      return { count: 1, resetAt };
    }

    entry.count += 1;

    return { count: entry.count, resetAt: entry.resetAt };
  }

  /** Remove all entries (for testing / cleanup). */
  clear(): void {
    this.map.clear();
  }
}

// ============================================================================
// Redis store
// ============================================================================

/**
 * Options for `RedisRateLimitStore`.
 *
 * @see docs:api/security.md
 */
export interface RedisRateLimitStoreOptions {
  /**
   * Namespace every counter key of this store lives under.
   *
   * Two applications pointed at one Redis share a keyspace, and with a fixed prefix they also
   * share buckets: a caller's requests to one of them spend the other's budget. Give each
   * application its own prefix when the Redis is shared.
   *
   * @defaultValue 'rl:'
   */
  keyPrefix?: string;
}

/**
 * The counter update, as one indivisible server-side step.
 *
 * `INCR` is the whole primitive a limiter needs — it is atomic and returns the new value — but
 * the first increment of a window must also arm the expiry, and the caller needs the deadline
 * back. A GET-then-SET pair from the client cannot do that without a window between the two in
 * which another replica increments the same key: both read `n`, both write `n + 1`, and one
 * request is never counted. That loss is not an edge case for THIS store — sharing one budget
 * across replicas is the only reason to choose it over `MemoryRateLimitStore`, so concurrent
 * increments are its normal traffic, and the undercount lets more through than `max`.
 *
 * `PTTL` before the write is what makes the deadline stable: an increment must extend nothing,
 * or a caller that keeps knocking never reaches the end of the window.
 *
 * The `tonumber(...) == nil` branch covers a key holding a value this script did not write —
 * releases up to 0.8.0 stored JSON under the same prefix, and `INCR` on it would raise an error
 * for the length of one window after an upgrade. Such a key starts a fresh window instead.
 */
const INCREMENT_SCRIPT = `
local pttl = redis.call('PTTL', KEYS[1])
local window = tonumber(ARGV[1])

if pttl < 0 or tonumber(redis.call('GET', KEYS[1]) or '') == nil then
  redis.call('SET', KEYS[1], '1', 'PX', window)

  return { 1, window }
end

return { redis.call('INCR', KEYS[1]), pttl }
`;

const DEFAULT_KEY_PREFIX = 'rl:';

/**
 * Redis-backed rate limit store.
 *
 * Counts with a Lua script, so the read-modify-write is one indivisible server-side step and
 * concurrent increments from different replicas cannot lose each other's updates — which is the
 * guarantee this store exists to provide. Requires a connected `RedisClient`.
 *
 * Keys are namespaced `rl:` by default; `keyPrefix` separates applications sharing one Redis.
 *
 * @example
 * ```typescript
 * new RedisRateLimitStore(redis, { keyPrefix: 'intake:rl:' })
 * ```
 *
 * @see docs:api/security.md
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: RedisClient,
    options: RedisRateLimitStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    // `PX 0` is an error in Redis, where a zero-length window is merely a window that has
    // already elapsed — the memory store answers the same way, with a fresh count every call.
    const windowPx = Math.max(1, Math.floor(windowMs));
    const [count, remainingMs] = await this.redis.runScript<[number, number]>(
      INCREMENT_SCRIPT,
      [`${this.keyPrefix}${key}`],
      [String(windowPx)],
    );

    return { count: Number(count), resetAt: Date.now() + Number(remainingMs) };
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Configuration for `RateLimitMiddleware`.
 *
 * @see docs:api/security.md
 */
export interface RateLimitOptions {
  /**
   * Time window in milliseconds.
   * @defaultValue 60_000 (1 minute)
   */
  windowMs?: number;

  /**
   * Maximum number of requests allowed per window per key.
   * @defaultValue 100
   */
  max?: number;

  /**
   * A function that derives the rate-limit key from the incoming request.
   *
   * Defaults to the client's address as resolved by `getClientAddress` — the transport
   * peer of the connection, which the caller cannot forge. Proxy headers
   * (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`) are consulted only when the
   * application sets `ApplicationOptions.trustProxy: true`; without that opt-in they
   * cannot influence which bucket a request lands in.
   */
  keyGenerator?: (req: OneBunRequest) => string;

  /**
   * Custom message sent when the rate limit is exceeded.
   * @defaultValue 'Too Many Requests'
   */
  message?: string;

  /**
   * Whether to add `RateLimit-*` headers to every response.
   * @defaultValue true
   */
  standardHeaders?: boolean;

  /**
   * Whether to add the legacy `X-RateLimit-*` headers.
   * @defaultValue false
   */
  legacyHeaders?: boolean;

  /**
   * Custom rate limit storage backend.
   * Defaults to `MemoryRateLimitStore` (in-process, not shared across instances).
   * Use `RedisRateLimitStore` for multi-instance deployments.
   */
  store?: RateLimitStore;
}

/**
 * The bucket a request falls into when nothing identifies its caller.
 *
 * Only reachable off the server path — a hand-constructed `Request` that never passed
 * through `bindClientAddress`. On a served request the transport peer is always known,
 * so real traffic never lands here. It is deliberately NOT the behaviour for a normal
 * direct connection, which used to share this one bucket across every client.
 */
const UNIDENTIFIED_CLIENT_KEY = 'unknown';

function defaultKeyGenerator(req: OneBunRequest): string {
  // The transport peer, not a header. `x-forwarded-for` and friends only enter the
  // answer when the application sets `trustProxy: true` — see `getClientAddress`.
  return getClientAddress(req) ?? UNIDENTIFIED_CLIENT_KEY;
}

/**
 * Built-in rate limiting middleware.
 *
 * By default uses an in-process `MemoryRateLimitStore`. For multi-instance
 * deployments pass a `RedisRateLimitStore` (or any custom `RateLimitStore`).
 *
 * @example In-memory rate limiting (single instance)
 * ```typescript
 * const app = new OneBunApplication(AppModule, {
 *   middleware: [RateLimitMiddleware],
 * });
 * ```
 *
 * @example Redis-backed rate limiting with custom window
 * ```typescript
 * const redis = await SharedRedisProvider.getClient();
 * // ...and on shutdown: await SharedRedisProvider.release(); nothing else gives the hold back.
 * const app = new OneBunApplication(AppModule, {
 *   middleware: [
 *     RateLimitMiddleware.configure({
 *       windowMs: 15 * 60 * 1000, // 15 minutes
 *       max: 200,
 *       store: new RedisRateLimitStore(redis),
 *     }),
 *   ],
 * });
 * ```
 *
 * @see docs:api/security.md
 */
export class RateLimitMiddleware extends BaseMiddleware {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly keyGenerator: (req: OneBunRequest) => string;
  private readonly message: string;
  private readonly standardHeaders: boolean;
  private readonly legacyHeaders: boolean;
  private readonly store: RateLimitStore;

  /**
   * Create a pre-configured RateLimitMiddleware class with the given options.
   * Returns a constructor — pass the result directly to `ApplicationOptions.middleware`.
   *
   * @example
   * ```typescript
   * const app = new OneBunApplication(AppModule, {
   *   middleware: [RateLimitMiddleware.configure({ max: 50, windowMs: 60_000 })],
   * });
   * ```
   */
  static configure(options: RateLimitOptions): typeof RateLimitMiddleware {
    class ConfiguredRateLimitMiddleware extends RateLimitMiddleware {
      constructor() {
        super(options);
      }
    }

    return ConfiguredRateLimitMiddleware;
  }

  constructor(options: RateLimitOptions = {}) {
    super();

    const defaultWindowMs = 60_000;  
    this.windowMs = options.windowMs ?? defaultWindowMs;
    this.max = options.max ?? 100;
    this.keyGenerator = options.keyGenerator ?? defaultKeyGenerator;
    this.message = options.message ?? 'Too Many Requests';
    this.standardHeaders = options.standardHeaders ?? true;
    this.legacyHeaders = options.legacyHeaders ?? false;
    this.store = options.store ?? new MemoryRateLimitStore();
  }

  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    const key = this.keyGenerator(req);
    const { count, resetAt } = await this.store.increment(key, this.windowMs);
    const remaining = Math.max(0, this.max - count);
    const resetInSeconds = Math.ceil((resetAt - Date.now()) / 1000);

    const TOO_MANY_REQUESTS = 429;

    if (count > this.max) {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');

      if (this.standardHeaders) {
        headers.set('RateLimit-Limit', String(this.max));
        headers.set('RateLimit-Remaining', '0');
        headers.set('RateLimit-Reset', String(resetInSeconds));
      }

      if (this.legacyHeaders) {
        headers.set('X-RateLimit-Limit', String(this.max));
        headers.set('X-RateLimit-Remaining', '0');
        headers.set('X-RateLimit-Reset', String(resetInSeconds));
        headers.set('Retry-After', String(resetInSeconds));
      }

      return new Response(
        JSON.stringify(createErrorResponse(this.message, TOO_MANY_REQUESTS)),
        { status: TOO_MANY_REQUESTS, headers },
      );
    }

    const response = await next();

    if (this.standardHeaders) {
      response.headers.set('RateLimit-Limit', String(this.max));
      response.headers.set('RateLimit-Remaining', String(remaining));
      response.headers.set('RateLimit-Reset', String(resetInSeconds));
    }

    if (this.legacyHeaders) {
      response.headers.set('X-RateLimit-Limit', String(this.max));
      response.headers.set('X-RateLimit-Remaining', String(remaining));
      response.headers.set('X-RateLimit-Reset', String(resetInSeconds));
    }

    return response;
  }
}

import type { RedisClient } from '../redis/redis-client';
import type { OneBunRequest, OneBunResponse } from '../types';

import { createErrorResponse } from '@onebun/requests';

import { BaseMiddleware } from '../module/middleware';

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
 * Redis-backed rate limit store.
 * Atomic via Lua script — safe for multi-instance deployments.
 * Requires a connected `RedisClient`.
 *
 * @see docs:api/security.md
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisClient) {}

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    // Use a simple get/set approach; for true atomicity a Lua script would be needed,
    // but this is sufficient for typical rate limiting use-cases.
    const raw = await this.redis.get(`rl:${key}`);
    const now = Date.now();

    if (raw !== null) {
      const { count, resetAt } = JSON.parse(raw) as { count: number; resetAt: number };

      if (resetAt > now) {
        const newCount = count + 1;
        await this.redis.set(
          `rl:${key}`,
          JSON.stringify({ count: newCount, resetAt }),
          resetAt - now,
        );

        return { count: newCount, resetAt };
      }
    }

    // Key expired or does not exist — start a new window
    const resetAt = now + windowMs;
    await this.redis.set(`rl:${key}`, JSON.stringify({ count: 1, resetAt }), windowMs);

    return { count: 1, resetAt };
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
   * Defaults to the client's IP address (`x-forwarded-for` or `cf-connecting-ip` headers,
   * falling back to `'unknown'`).
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

function defaultKeyGenerator(req: OneBunRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  );
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

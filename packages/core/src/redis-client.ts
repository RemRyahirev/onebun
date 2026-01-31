/**
 * Redis Client Wrapper
 *
 * Unified Redis client for use across OneBun packages (cache, websocket, etc.)
 * Uses Bun's built-in RedisClient (Bun v1.2.9+).
 */

// Type for Bun's RedisClient - will be available at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunRedisClient = any;

/**
 * Options for Redis client
 */
export interface RedisClientOptions {
  /** Redis connection URL (redis://host:port or rediss://host:port for TLS) */
  url: string;
  /** Key prefix for all operations */
  keyPrefix?: string;
  /** Enable automatic reconnection */
  reconnect?: boolean;
  /** Enable TLS */
  tls?: boolean;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Command timeout in milliseconds */
  commandTimeout?: number;
}

/**
 * Subscription handler type
 */
type SubscriptionHandler = (message: string, channel: string) => void;

/**
 * Redis client wrapper with unified API
 */
export class RedisClient {
  private client: BunRedisClient | null = null;
  private subscriptions = new Map<string, SubscriptionHandler[]>();
  private subscriberClient: BunRedisClient | null = null;
  private readonly options: RedisClientOptions;
  private connected = false;

  constructor(options: RedisClientOptions) {
    this.options = {
      keyPrefix: '',
      reconnect: true,
      ...options,
    };
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    try {
      // Get Bun's RedisClient constructor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
      const BunGlobal = (globalThis as any).Bun;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
      const BunDirect = typeof Bun !== 'undefined' ? (Bun as any) : null;
      
      // Try different access methods for RedisClient constructor
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const BunRedisClient = BunGlobal?.RedisClient 
        || BunDirect?.RedisClient 
        || BunGlobal?.Redis;

      if (!BunRedisClient) {
        throw new Error('Bun.RedisClient is not available. Make sure you are using Bun runtime v1.2.9+');
      }

      // Create client with URL and options
      this.client = new BunRedisClient(this.options.url, {
        autoReconnect: this.options.reconnect ?? true,
        connectionTimeout: this.options.connectTimeout,
        enableAutoPipelining: true,
        tls: this.options.tls,
      });

      // Connect to Redis server
      if (this.client.connect) {
        await this.client.connect();
      }
      
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to Redis: ${error}`);
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.subscriberClient) {
      // Unsubscribe from all channels
      for (const channel of this.subscriptions.keys()) {
        try {
          await this.subscriberClient.unsubscribe(channel);
        } catch {
          // Ignore errors during cleanup
        }
      }
      this.subscriptions.clear();
      this.subscriberClient = null;
    }

    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // Ignore errors during cleanup
      }
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Get prefixed key
   */
  private prefixKey(key: string): string {
    return this.options.keyPrefix ? `${this.options.keyPrefix}${key}` : key;
  }

  /**
   * Ensure client is connected
   */
  private ensureConnected(): BunRedisClient {
    if (!this.client || !this.connected) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    return this.client;
  }

  // ============================================================================
  // Basic Operations
  // ============================================================================

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    const client = this.ensureConnected();
    const result = await client.get(this.prefixKey(key));

    return result ?? null;
  }

  /**
   * Set a value with optional TTL
   */
  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const client = this.ensureConnected();
    const prefixedKey = this.prefixKey(key);

    if (ttlMs !== undefined && ttlMs > 0) {
      // Use raw SET command with PX option for atomic set with TTL
      await client.send('SET', [prefixedKey, value, 'PX', String(ttlMs)]);
    } else {
      await client.set(prefixedKey, value);
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<void> {
    const client = this.ensureConnected();
    await client.del(this.prefixKey(key));
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const client = this.ensureConnected();
    const result = await client.exists(this.prefixKey(key));

    return result > 0;
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const client = this.ensureConnected();
    const prefixedPattern = this.prefixKey(pattern);
    const result = await client.keys(prefixedPattern);
    
    // Remove prefix from results
    const prefix = this.options.keyPrefix || '';

    return result.map((k: string) => k.startsWith(prefix) ? k.substring(prefix.length) : k);
  }

  /**
   * Set TTL on existing key
   */
  async expire(key: string, ttlMs: number): Promise<boolean> {
    const client = this.ensureConnected();
    const result = await client.pexpire(this.prefixKey(key), ttlMs);

    return result === 1;
  }

  /**
   * Get TTL of a key in milliseconds
   */
  async ttl(key: string): Promise<number> {
    const client = this.ensureConnected();
    const result = await client.pttl(this.prefixKey(key));

    return result;
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Get multiple values
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) {
      return [];
    }

    const client = this.ensureConnected();
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    const results = await client.mget(...prefixedKeys);

    return results.map((r: string | null) => r ?? null);
  }

  /**
   * Set multiple values with optional TTL
   */
  async mset(entries: Array<{ key: string; value: string; ttlMs?: number }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const client = this.ensureConnected();

    // Group entries by TTL
    const noTtl: [string, string][] = [];
    const withTtl: Array<{ key: string; value: string; ttlMs: number }> = [];

    for (const entry of entries) {
      if (entry.ttlMs !== undefined && entry.ttlMs > 0) {
        withTtl.push({ key: this.prefixKey(entry.key), value: entry.value, ttlMs: entry.ttlMs });
      } else {
        noTtl.push([this.prefixKey(entry.key), entry.value]);
      }
    }

    // Set entries without TTL using MSET
    if (noTtl.length > 0) {
      const flat = noTtl.flat();
      await client.mset(...flat);
    }

    // Set entries with TTL individually using raw SET command
    for (const entry of withTtl) {
      await client.send('SET', [entry.key, entry.value, 'PX', String(entry.ttlMs)]);
    }
  }

  // ============================================================================
  // Hash Operations
  // ============================================================================

  /**
   * Set a hash field
   */
  async hset(key: string, field: string, value: string): Promise<void> {
    const client = this.ensureConnected();
    await client.hset(this.prefixKey(key), field, value);
  }

  /**
   * Get a hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    const client = this.ensureConnected();
    const result = await client.hget(this.prefixKey(key), field);

    return result ?? null;
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const client = this.ensureConnected();
    const result = await client.hgetall(this.prefixKey(key));

    return result || {};
  }

  /**
   * Delete a hash field
   */
  async hdel(key: string, field: string): Promise<void> {
    const client = this.ensureConnected();
    await client.hdel(this.prefixKey(key), field);
  }

  /**
   * Set multiple hash fields
   */
  async hmset(key: string, data: Record<string, string>): Promise<void> {
    const client = this.ensureConnected();
    const entries = Object.entries(data).flat();
    if (entries.length > 0) {
      await client.hset(this.prefixKey(key), ...entries);
    }
  }

  // ============================================================================
  // Set Operations
  // ============================================================================

  /**
   * Add members to a set
   */
  async sadd(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) {
      return;
    }

    const client = this.ensureConnected();
    await client.sadd(this.prefixKey(key), ...members);
  }

  /**
   * Remove members from a set
   */
  async srem(key: string, ...members: string[]): Promise<void> {
    if (members.length === 0) {
      return;
    }

    const client = this.ensureConnected();
    await client.srem(this.prefixKey(key), ...members);
  }

  /**
   * Get all members of a set
   */
  async smembers(key: string): Promise<string[]> {
    const client = this.ensureConnected();
    const result = await client.smembers(this.prefixKey(key));

    return result || [];
  }

  /**
   * Check if member exists in set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const client = this.ensureConnected();
    const result = await client.sismember(this.prefixKey(key), member);

    return result === 1;
  }

  /**
   * Get set size
   */
  async scard(key: string): Promise<number> {
    const client = this.ensureConnected();
    const result = await client.scard(this.prefixKey(key));

    return result || 0;
  }

  // ============================================================================
  // Pub/Sub Operations
  // ============================================================================

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: string): Promise<void> {
    const client = this.ensureConnected();
    await client.publish(this.prefixKey(channel), message);
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, handler: SubscriptionHandler): Promise<void> {
    const prefixedChannel = this.prefixKey(channel);

    // Track handler
    const handlers = this.subscriptions.get(prefixedChannel) || [];
    handlers.push(handler);
    this.subscriptions.set(prefixedChannel, handlers);

    // Create subscriber client if needed
    if (!this.subscriberClient) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
      const BunGlobal = (globalThis as any).Bun;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
      const BunDirect = typeof Bun !== 'undefined' ? (Bun as any) : null;
      
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const BunRedisClient = BunGlobal?.RedisClient 
        || BunDirect?.RedisClient 
        || BunGlobal?.Redis;

      if (!BunRedisClient) {
        throw new Error('Bun.RedisClient is not available');
      }

      this.subscriberClient = new BunRedisClient(this.options.url, {
        autoReconnect: this.options.reconnect ?? true,
        connectionTimeout: this.options.connectTimeout,
        tls: this.options.tls,
      });

      // Connect subscriber client
      if (this.subscriberClient.connect) {
        await this.subscriberClient.connect();
      }
    }

    // Subscribe using Bun's subscribe method
    await this.subscriberClient.subscribe(prefixedChannel, (message: string) => {
      const channelHandlers = this.subscriptions.get(prefixedChannel);
      if (channelHandlers) {
        for (const h of channelHandlers) {
          try {
            h(message, channel);
          } catch {
            // Ignore handler errors
          }
        }
      }
    });
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string): Promise<void> {
    const prefixedChannel = this.prefixKey(channel);
    this.subscriptions.delete(prefixedChannel);

    if (this.subscriberClient) {
      try {
        await this.subscriberClient.unsubscribe(prefixedChannel);
      } catch {
        // Ignore errors
      }
    }
  }

  // ============================================================================
  // Raw Client Access
  // ============================================================================

  /**
   * Get the underlying Bun Redis client
   */
  getClient(): BunRedisClient | null {
    return this.client;
  }

  /**
   * Execute a raw command
   */
  async raw<T = unknown>(command: string, ...args: string[]): Promise<T> {
    const client = this.ensureConnected();

    return await client[command](...args);
  }
}

/**
 * Create a new Redis client
 */
export function createRedisClient(options: RedisClientOptions): RedisClient {
  return new RedisClient(options);
}

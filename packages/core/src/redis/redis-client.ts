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
   * The namespace every key of this client lives under.
   *
   * This client IS the namespace: `prefixKey()` applies it on every read and write, and `keys()`
   * both prefixes the pattern and strips the prefix off the results. An owner that needs to reason
   * about its own keyspace — to scope a bulk delete, say — has to be able to ask what that
   * namespace is, and an empty answer means "the whole database", which is rarely what the caller
   * wants and never what they want to delete.
   */
  get keyPrefix(): string {
    return this.options.keyPrefix ?? '';
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
    if (!this.client) {
      return false;
    }

    // Delegate to the driver's live flag rather than trusting our own. `connected` was set
    // once in connect() and cleared only by disconnect(), so it kept reporting `true` after
    // the server went away — measured: the server was stopped, `isConnected()` still said
    // true, and the driver threw `Connection has failed` on the next command. Bun flips its
    // own flag correctly, including back to true when auto-reconnect succeeds.
    const driverConnected = (this.client as unknown as { connected?: boolean }).connected;

    return this.connected && (driverConnected ?? true);
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
   * Execute a raw command.
   *
   * Dispatched through the driver's `send(command, args)`, which is how Bun's client takes an
   * arbitrary command. This used to index the driver by the command name instead, so every
   * uppercase name rejected with "is not a function", and the whole Redis queue adapter, which
   * reached Redis only through here, could not write a single message.
   *
   * The key is NOT prefixed: a raw command may take keys in any position, or none, so the caller
   * gives fully-qualified names. Prefer the typed methods below where one exists.
   */
  async raw<T = unknown>(command: string, ...args: string[]): Promise<T> {
    const client = this.ensureConnected();

    return await client.send(command, args) as T;
  }

  // ============================================================================
  // List and Sorted-Set Operations
  // ============================================================================

  /**
   * Append values to a list. Returns the list's new length.
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    const client = this.ensureConnected();

    return Number(await client.send('RPUSH', [this.prefixKey(key), ...values]));
  }

  /**
   * Remove and return the head of a list, or `null` when it is empty.
   */
  async lpop(key: string): Promise<string | null> {
    const client = this.ensureConnected();
    const result = await client.send('LPOP', [this.prefixKey(key)]);

    return (result as string | null) ?? null;
  }

  /**
   * Add a member to a sorted set with the given score.
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    const client = this.ensureConnected();

    return Number(await client.send('ZADD', [this.prefixKey(key), String(score), member]));
  }

  /**
   * Remove a member from a sorted set. Returns how many members were removed.
   */
  async zrem(key: string, member: string): Promise<number> {
    const client = this.ensureConnected();

    return Number(await client.send('ZREM', [this.prefixKey(key), member]));
  }

  /**
   * Prepend values to a list. Returns the list's new length.
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const client = this.ensureConnected();

    return Number(await client.send('LPUSH', [this.prefixKey(key), ...values]));
  }

  /**
   * Members of a sorted set whose score falls in `[min, max]`, lowest score first.
   *
   * `limit` maps to Redis's `LIMIT offset count`.
   */
  async zrangebyscore(key: string, min: string, max: string, limit?: number): Promise<string[]> {
    const client = this.ensureConnected();
    const args = [this.prefixKey(key), min, max];

    if (limit !== undefined) {
      args.push('LIMIT', '0', String(limit));
    }

    const result = await client.send('ZRANGEBYSCORE', args);

    return Array.isArray(result) ? result as string[] : [];
  }

  /**
   * Pop up to `count` lowest-scored members.
   *
   * Returns `{ member, score }` pairs rather than the wire shape. RESP2 answers with a flat
   * `[member, score, member, score, …]` list and RESP3 with nested `[member, score]` pairs, so a
   * caller that indexes the raw result gets an array where it expected a string on one protocol
   * and not the other — and finds out at run time, inside whatever it does with the value.
   */
  async zpopmin(key: string, count: number): Promise<Array<{ member: string; score: number }>> {
    const client = this.ensureConnected();
    const result = await client.send('ZPOPMIN', [this.prefixKey(key), String(count)]);

    if (!Array.isArray(result) || result.length === 0) {
      return [];
    }

    // Nested: [[member, score], …]
    if (Array.isArray(result[0])) {
      return (result as unknown[][])
        .filter((pair) => pair.length >= 2)
        .map((pair) => ({ member: String(pair[0]), score: Number(pair[1]) }));
    }

    // Flat: [member, score, …]
    const pairs: Array<{ member: string; score: number }> = [];
    for (let i = 0; i + 1 < result.length; i += 2) {
      pairs.push({ member: String(result[i]), score: Number(result[i + 1]) });
    }

    return pairs;
  }
}

/**
 * Create a new Redis client
 */
export function createRedisClient(options: RedisClientOptions): RedisClient {
  return new RedisClient(options);
}

/**
 * Minimal type definitions for Bun's RedisClient
 * These types will be used until official types are available in bun-types
 * 
 * @see https://bun.com/docs/api/redis
 */

/**
 * Redis client options
 */
export interface RedisClientOptions {
  /**
   * Connection timeout in milliseconds
   */
  connectionTimeout?: number;

  /**
   * Whether to automatically reconnect on disconnection
   */
  autoReconnect?: boolean;

  /**
   * Whether to automatically pipeline commands
   */
  enableAutoPipelining?: boolean;

  /**
   * TLS configuration
   */
  tls?: boolean | {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

/**
 * Minimal RedisClient interface for type checking
 */
export interface RedisClient {
  /**
   * Connect to Redis server
   */
  connect(): Promise<void>;

  /**
   * Get a value by key
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a key-value pair
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Delete one or more keys
   */
  del(...keys: string[]): Promise<number>;

  /**
   * Check if key(s) exist
   */
  exists(...keys: string[]): Promise<number | boolean>;

  /**
   * Set key expiration in seconds
   */
  expire(key: string, seconds: number): Promise<number>;

  /**
   * Send raw Redis command
   */
  send(command: string, args: string[]): Promise<unknown>;

  /**
   * Close connection
   */
  close(): void;

  /**
   * Check if connected
   */
  connected: boolean;

  /**
   * Amount of buffered data in bytes
   */
  bufferedAmount: number;
}

/**
 * Type guard to check if RedisClient is available in current Bun version
 */
export function hasRedisClient(): boolean {
  try {
     
    const bun = require('bun');

    return 'RedisClient' in bun;
  } catch {
    return false;
  }
}

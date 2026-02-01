import type { Type } from 'arktype';
import type { Effect, Layer } from 'effect';

import type { Logger } from '@onebun/logger';

/**
 * Base interface for all OneBun services
 */
export interface ServiceInterface {
  readonly [key: string]: unknown;
}

/**
 * Module provider config
 */
export interface ModuleProviders {
  /**
   * Services to provide
   */
  providers?: ServiceInterface[];

  /**
   * Controllers to include
   */
  controllers?: Function[];

  /**
   * Modules to import
   */
  imports?: ModuleInstance[];

  /**
   * Services to export to parent modules
   */
  exports?: Function[];
}

/**
 * Module instance interface
 */
export interface ModuleInstance {
  /**
   * Setup the module
   */
  setup(): Effect.Effect<unknown, never, void>;

  /**
   * Get the Layer for this module
   */
  getLayer(): Layer.Layer<never, never, unknown>;

  /**
   * Get controllers
   */
  getControllers(): Function[];

  /**
   * Get controller instance
   */
  getControllerInstance?(controllerClass: Function): unknown;
}

/**
 * Typed environment schema interface
 */
export interface TypedEnvSchema {
  [key: string]: unknown;
}

/**
 * Application options
 */
export interface ApplicationOptions {
  /**
   * Application name (used for metrics and tracing labels)
   */
  name?: string;

  /**
   * Port to listen on
   * @defaultValue 3000
   */
  port?: number;

  /**
   * Host to listen on
   * @defaultValue "0.0.0.0"
   */
  host?: string;

  /**
   * Base path prefix for all routes
   * @example '/api/v1'
   */
  basePath?: string;

  /**
   * Route prefix to prepend to all routes (typically the service name)
   * @example 'users' will prefix all routes with '/users'
   */
  routePrefix?: string;

  /**
   * Enable development mode
   * @defaultValue false
   */
  development?: boolean;

  /**
   * Logger layer to use
   * If not provided, a default logger will be created
   */
  loggerLayer?: Layer.Layer<Logger>;

  /**
   * Environment configuration schema
   * If provided, the environment will be automatically initialized and made available
   */
  envSchema?: TypedEnvSchema;

  /**
   * Environment loading options
   */
  envOptions?: {
    envFilePath?: string;
    loadDotEnv?: boolean;
    envOverridesDotEnv?: boolean;
    strict?: boolean;
    defaultArraySeparator?: string;
    /** Override values that take precedence over both process.env and .env file */
    valueOverrides?: Record<string, string | number | boolean>;
  };

  /**
   * Metrics configuration
   */
  metrics?: {
    /**
     * Enable/disable metrics collection
     * @defaultValue true
     */
    enabled?: boolean;

    /**
     * HTTP path for exposing metrics endpoint
     * @defaultValue '/metrics'
     */
    path?: string;

    /**
     * Default labels to add to all metrics
     */
    defaultLabels?: Record<string, string>;

    /**
     * Enable automatic HTTP metrics collection
     * @defaultValue true
     */
    collectHttpMetrics?: boolean;

    /**
     * Enable automatic system metrics collection
     * @defaultValue true
     */
    collectSystemMetrics?: boolean;

    /**
     * Enable GC metrics collection
     * @defaultValue true
     */
    collectGcMetrics?: boolean;

    /**
     * Collection interval for system metrics in milliseconds
     * @defaultValue 5000
     */
    systemMetricsInterval?: number;

    /**
     * Custom prefix for all metrics
     * @defaultValue 'onebun_'
     */
    prefix?: string;

    /**
     * Buckets for HTTP request duration histogram
     */
    httpDurationBuckets?: number[];
  };

  /**
   * Tracing configuration
   */
  tracing?: {
    /**
     * Enable/disable tracing
     * @defaultValue true
     */
    enabled?: boolean;

    /**
     * Service name for tracing
     * @defaultValue 'onebun-service'
     */
    serviceName?: string;

    /**
     * Service version
     * @defaultValue '1.0.0'
     */
    serviceVersion?: string;

    /**
     * Sampling rate (0.0 to 1.0)
     * @defaultValue 1.0
     */
    samplingRate?: number;

    /**
     * Enable automatic HTTP request tracing
     * @defaultValue true
     */
    traceHttpRequests?: boolean;

    /**
     * Enable automatic database query tracing
     * @defaultValue true
     */
    traceDatabaseQueries?: boolean;

    /**
     * Custom attributes to add to all spans
     */
    defaultAttributes?: Record<string, string | number | boolean>;

    /**
     * Export traces to external system
     */
    exportOptions?: {
      /**
       * Export endpoint URL
       */
      endpoint?: string;

      /**
       * Export headers
       */
      headers?: Record<string, string>;

      /**
       * Export timeout in milliseconds
       * @defaultValue 10000
       */
      timeout?: number;

      /**
       * Batch size for exporting
       * @defaultValue 100
       */
      batchSize?: number;

      /**
       * Batch timeout in milliseconds
       * @defaultValue 5000
       */
      batchTimeout?: number;
    };
  };

  /**
   * WebSocket configuration
   */
  websocket?: WebSocketApplicationOptions;

  /**
   * Queue configuration
   */
  queue?: QueueApplicationOptions;

  /**
   * Enable graceful shutdown on SIGTERM/SIGINT
   * When enabled, the application will cleanly shutdown on process signals,
   * including closing shared Redis connections.
   * Set to false to disable automatic signal handling.
   * @defaultValue true
   */
  gracefulShutdown?: boolean;
}

/**
 * Queue adapter type for application configuration
 */
export type QueueAdapterType = 'memory' | 'redis';

/**
 * Queue configuration for OneBunApplication
 */
export interface QueueApplicationOptions {
  /** Enable/disable queue (default: auto - enabled if handlers exist) */
  enabled?: boolean;
  /** Adapter type or custom adapter instance */
  adapter?: QueueAdapterType;
  /** Redis-specific options (only used when adapter is 'redis') */
  redis?: {
    /** Use shared Redis provider instead of dedicated connection */
    useSharedProvider?: boolean;
    /** Redis connection URL (required if not using shared provider) */
    url?: string;
    /** Key prefix for Redis keys */
    prefix?: string;
  };
}

/**
 * WebSocket storage type
 */
export type WsStorageType = 'memory' | 'redis';

/**
 * WebSocket storage options
 */
export interface WsStorageOptions {
  /** Storage type */
  type: WsStorageType;
  /** Redis-specific options */
  redis?: {
    /** Redis connection URL */
    url: string;
    /** Key prefix for Redis keys */
    prefix?: string;
  };
}

/**
 * WebSocket configuration for OneBunApplication
 */
export interface WebSocketApplicationOptions {
  /** Enable/disable WebSocket (default: auto - enabled if gateways exist) */
  enabled?: boolean;
  /** Storage options */
  storage?: WsStorageOptions;
  /** Ping interval in milliseconds for heartbeat (socket.io) */
  pingInterval?: number;
  /** Ping timeout in milliseconds (socket.io) */
  pingTimeout?: number;
  /** Maximum payload size in bytes */
  maxPayload?: number;
}

/**
 * HTTP method types
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
  ALL = 'ALL',
}

/**
 * Parameter type for route parameters
 */
export enum ParamType {
  PATH = 'path',
  QUERY = 'query',
  BODY = 'body',
  HEADER = 'header',
  REQUEST = 'request',
  RESPONSE = 'response',
}

/**
 * Parameter metadata
 */
export interface ParamMetadata {
  type: ParamType;
  name: string;
  index: number;
  isRequired?: boolean;
  /**
   * ArkType schema for validation
   */
  schema?: Type<unknown>;
}

/**
 * Response schema metadata for validation
 */
export interface ResponseSchemaMetadata {
  statusCode: number;
  schema?: Type<unknown>;
  description?: string;
}

/**
 * Route metadata
 */
export interface RouteMetadata {
  path: string;
  method: HttpMethod;
  handler: string;
  params?: ParamMetadata[];
  middleware?: Function[];
  /**
   * Response schemas for validation
   * Key is HTTP status code (e.g., 200, 201, 404)
   */
  responseSchemas?: ResponseSchemaMetadata[];
}

/**
 * Controller metadata
 */
export interface ControllerMetadata {
  path: string;
  routes: RouteMetadata[];
}

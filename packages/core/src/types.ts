import type { Type } from 'arktype';
import type { Effect, Layer } from 'effect';

import type { Logger, LoggerOptions } from '@onebun/logger';

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

  /**
   * Call onApplicationInit lifecycle hook for all services and controllers
   */
  callOnApplicationInit?(): Promise<void>;

  /**
   * Call beforeApplicationDestroy lifecycle hook for all services and controllers
   */
  callBeforeApplicationDestroy?(signal?: string): Promise<void>;

  /**
   * Call onModuleDestroy lifecycle hook for controllers first, then services
   */
  callOnModuleDestroy?(): Promise<void>;

  /**
   * Call onApplicationDestroy lifecycle hook for all services and controllers
   */
  callOnApplicationDestroy?(signal?: string): Promise<void>;

  /**
   * Get service instance by class
   */
  getServiceByClass?<T>(serviceClass: new (...args: unknown[]) => T): T | undefined;
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
   * Logger configuration options.
   * Provides a declarative way to configure logging.
   * 
   * Priority: loggerLayer > loggerOptions > LOG_LEVEL/LOG_FORMAT env > NODE_ENV defaults
   * 
   * @example
   * ```typescript
   * const app = new OneBunApplication(AppModule, {
   *   loggerOptions: {
   *     minLevel: 'info',
   *     format: 'json',
   *     defaultContext: { service: 'user-service' },
   *   },
   * });
   * ```
   */
  loggerOptions?: LoggerOptions;

  /**
   * Logger layer to use (advanced).
   * If provided, takes precedence over loggerOptions.
   * Use loggerOptions for simpler configuration.
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
   * Documentation configuration (OpenAPI/Swagger)
   */
  docs?: DocsApplicationOptions;

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
 * Socket.IO-specific options (optional; when enabled, Socket.IO runs on its own path)
 */
export interface WebSocketSocketIOOptions {
  /** Enable Socket.IO protocol (default: false) */
  enabled?: boolean;
  /** Path for Socket.IO connections (default: '/socket.io') */
  path?: string;
  /** Ping interval in milliseconds (default: 25000) */
  pingInterval?: number;
  /** Ping timeout in milliseconds (default: 20000) */
  pingTimeout?: number;
}

/**
 * WebSocket configuration for OneBunApplication
 */
export interface WebSocketApplicationOptions {
  /** Enable/disable WebSocket (default: auto - enabled if gateways exist) */
  enabled?: boolean;
  /** Socket.IO options; when enabled, Socket.IO is served on socketio.path */
  socketio?: WebSocketSocketIOOptions;
  /** Storage options */
  storage?: WsStorageOptions;
  /** Maximum payload size in bytes */
  maxPayload?: number;
}

/**
 * Documentation configuration for OneBunApplication
 * Enables automatic OpenAPI spec generation and Swagger UI
 */
export interface DocsApplicationOptions {
  /**
   * Enable/disable documentation endpoints
   * @defaultValue true
   */
  enabled?: boolean;

  /**
   * Path for Swagger UI
   * @defaultValue '/docs'
   */
  path?: string;

  /**
   * Path for OpenAPI JSON specification
   * @defaultValue '/openapi.json'
   */
  jsonPath?: string;

  /**
   * API title for OpenAPI spec
   * @defaultValue Application name or 'OneBun API'
   */
  title?: string;

  /**
   * API version for OpenAPI spec
   * @defaultValue '1.0.0'
   */
  version?: string;

  /**
   * API description for OpenAPI spec
   */
  description?: string;

  /**
   * Contact information
   */
  contact?: {
    name?: string;
    email?: string;
    url?: string;
  };

  /**
   * License information
   */
  license?: {
    name: string;
    url?: string;
  };

  /**
   * External documentation link
   */
  externalDocs?: {
    description?: string;
    url: string;
  };

  /**
   * Server URLs for OpenAPI spec
   */
  servers?: Array<{
    url: string;
    description?: string;
  }>;
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
 * Options for parameter decorators (@Query, @Header, @Body, etc.)
 */
export interface ParamDecoratorOptions {
  /**
   * Whether the parameter is required
   * - @Param: always true (OpenAPI spec requirement)
   * - @Query, @Header: false by default
   * - @Body: determined from schema (accepts undefined = optional)
   */
  required?: boolean;
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

// ============================================================================
// SSE (Server-Sent Events) Types
// ============================================================================

/**
 * SSE event structure
 *
 * Represents a single Server-Sent Event that can be sent to the client.
 *
 * @example
 * ```typescript
 * // Simple event with data
 * yield { data: { message: 'Hello' } };
 *
 * // Named event with ID
 * yield { event: 'update', data: { count: 42 }, id: '123' };
 *
 * // Event with retry interval
 * yield { event: 'status', data: { online: true }, retry: 5000 };
 * ```
 */
export interface SseEvent {
  /** Event name (optional, defaults to 'message') */
  event?: string;
  /** Event data (will be JSON serialized) */
  data: unknown;
  /** Event ID for reconnection (Last-Event-ID header) */
  id?: string;
  /** Reconnection interval in milliseconds */
  retry?: number;
}

/**
 * SSE decorator options
 *
 * @example
 * ```typescript
 * @Sse({ heartbeat: 15000 })  // Send heartbeat every 15 seconds
 * async *events(): SseGenerator {
 *   // ...
 * }
 * ```
 */
export interface SseOptions {
  /**
   * Heartbeat interval in milliseconds.
   * When set, the server will send a comment (": heartbeat\n\n")
   * at this interval to keep the connection alive.
   */
  heartbeat?: number;
}

/**
 * SSE generator type
 *
 * An async generator that yields SSE events or raw data.
 * When raw data is yielded, it will be wrapped in a default event.
 *
 * @example
 * ```typescript
 * @Get('/events')
 * @Sse()
 * async *events(): SseGenerator {
 *   yield { event: 'start', data: { timestamp: Date.now() } };
 *
 *   for (let i = 0; i < 10; i++) {
 *     await Bun.sleep(1000);
 *     yield { event: 'tick', data: { count: i } };
 *   }
 *
 *   yield { event: 'end', data: { total: 10 } };
 * }
 * ```
 */
export type SseGenerator = AsyncGenerator<SseEvent | unknown, void, unknown>;

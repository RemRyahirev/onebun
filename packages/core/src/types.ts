import { Effect, Layer } from 'effect';

import { type Logger } from '@onebun/logger';

/**
 * Base interface for all OneBun services
 */
export interface Service {
  readonly [key: string]: unknown;
}

/**
 * Module provider config
 */
export interface ModuleProviders {
  /**
   * Services to provide
   */
  providers?: Service[];

  /**
   * Controllers to include
   */
  controllers?: Function[];

  /**
   * Modules to import
   */
  imports?: Module[];

  /**
   * Services to export to parent modules
   */
  exports?: Function[];
}

/**
 * Module interface
 */
export interface Module {
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
  ALL = 'ALL'
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
  RESPONSE = 'response'
}

/**
 * Parameter metadata
 */
export interface ParamMetadata {
  type: ParamType;
  name: string;
  index: number;
  isRequired?: boolean;
  validator?: (value: unknown) => boolean | Promise<boolean>;
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
}

/**
 * Controller metadata
 */
export interface ControllerMetadata {
  path: string;
  routes: RouteMetadata[];
}

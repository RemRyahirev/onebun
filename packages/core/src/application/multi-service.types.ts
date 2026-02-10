import type { ApplicationOptions } from '../types';

import type { EnvLoadOptions, EnvSchema } from '@onebun/envs';

/**
 * ENV override value: either a literal value or a reference to another variable
 */
export type EnvOverrideValue =
  | { value: string | number | boolean }
  | { fromEnv: string };

/**
 * Map of ENV variable names to override values
 */
export type EnvOverrides = Record<string, EnvOverrideValue>;

/**
 * Metrics options extracted from ApplicationOptions
 */
export type MetricsOptions = NonNullable<ApplicationOptions['metrics']>;

/**
 * Tracing options extracted from ApplicationOptions
 */
export type TracingOptions = NonNullable<ApplicationOptions['tracing']>;

/**
 * Base options shared between service config and application options.
 * Derived from ApplicationOptions to avoid code duplication.
 * Any new shared options should be added to ApplicationOptions first.
 */
export interface BaseServiceOptions
  extends Pick<ApplicationOptions, 'host' | 'basePath' | 'metrics' | 'tracing' | 'middleware'> {
  /**
   * Add service name as prefix to all routes.
   * When true, the service name will be used as routePrefix.
   * @defaultValue false
   */
  routePrefix?: boolean;

  /**
   * Override ENV values for this service.
   * Can specify literal values or references to other ENV variables.
   *
   * @example
   * ```typescript
   * envOverrides: {
   *   DB_NAME: { value: 'users_db' },
   *   DB_HOST: { fromEnv: 'USERS_DB_HOST' },
   * }
   * ```
   */
  envOverrides?: EnvOverrides;

  /**
   * Extend ENV schema with service-specific variables
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  envSchemaExtend?: EnvSchema<any>;

  /**
   * Logger configuration overrides.
   * minLevel can be one of: 'fatal', 'error', 'warning', 'info', 'debug', 'trace'
   */
  logger?: Partial<{
    minLevel: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace';
  }>;
}

/**
 * Configuration for a single service (extends base options)
 */
export interface ServiceConfig extends BaseServiceOptions {
  /**
   * Root module class for this service
   */
  module: new (...args: unknown[]) => object;

  /**
   * Port to listen on for this service
   */
  port: number;
}

/**
 * Map of service names to their configurations
 */
export type ServicesMap = Record<string, ServiceConfig>;

/**
 * Application options for multi-service setup.
 * Derived from BaseServiceOptions plus specific fields for the application.
 */
export interface MultiServiceApplicationOptions<TServices extends ServicesMap = ServicesMap>
  extends Omit<BaseServiceOptions, 'envSchemaExtend'> {
  /**
   * Map of services to run. Keys are unique service names.
   */
  services: TServices;

  /**
   * Base ENV schema shared by all services
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  envSchema?: EnvSchema<any>;

  /**
   * Options for loading ENV variables
   */
  envOptions?: EnvLoadOptions;

  /**
   * List of service names to start. If provided, only these services will be started.
   * Can be overridden by ONEBUN_SERVICES environment variable.
   */
  enabledServices?: (keyof TServices)[];

  /**
   * List of service names to exclude from starting.
   * Can be overridden by ONEBUN_EXCLUDE_SERVICES environment variable.
   */
  excludedServices?: (keyof TServices)[];

  /**
   * Explicit URLs for services not running in this process.
   * Used by getServiceUrl() when a service is not started locally.
   * @example
   * ```typescript
   * externalServiceUrls: {
   *   payments: 'http://payments-service:3003',
   * }
   * ```
   */
  externalServiceUrls?: Partial<Record<keyof TServices, string>>;
}

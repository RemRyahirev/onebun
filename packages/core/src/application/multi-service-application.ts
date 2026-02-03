import { Effect } from 'effect';

import type {
  BaseServiceOptions,
  MultiServiceApplicationOptions,
  ServicesMap,
} from './multi-service.types';

import { type EnvSchema, TypedEnv } from '@onebun/envs';
import {
  createSyncLogger,
  type Logger,
  LoggerService,
  makeLogger,
  type SyncLogger,
} from '@onebun/logger';

import { resolveEnvOverrides } from '../service-client/env-resolver';

import { OneBunApplication } from './application';

/**
 * ENV schema for service filtering
 */
const filterEnvSchema = {
  ONEBUN_SERVICES: {
    type: 'array' as const,
    separator: ',',
    required: false,
    default: [] as string[],
  },
  ONEBUN_EXCLUDE_SERVICES: {
    type: 'array' as const,
    separator: ',',
    required: false,
    default: [] as string[],
  },
};

/**
 * Type for the filter configuration values
 */
interface FilterConfigValues {
  ONEBUN_SERVICES: string[];
  ONEBUN_EXCLUDE_SERVICES: string[];
}

/**
 * Multi-service application that manages multiple OneBunApplication instances.
 * Each service runs on its own port with isolated configuration.
 *
 * @example
 * ```typescript
 * const app = new MultiServiceApplication({
 *   services: {
 *     users: { module: UsersModule, port: 3001 },
 *     orders: { module: OrdersModule, port: 3002 },
 *   },
 *   envSchema: baseEnvSchema,
 *   logger: { level: 'info' },
 * });
 *
 * await app.start();
 * ```
 */
export class MultiServiceApplication<TServices extends ServicesMap = ServicesMap> {
  private applications: Map<string, OneBunApplication> = new Map();
  private filterConfigValues: FilterConfigValues | null = null;
  private logger: SyncLogger;
  private isStarted = false;

  constructor(private options: MultiServiceApplicationOptions<TServices>) {
    // Initialize logger
    const loggerLayer = makeLogger();
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (logger: Logger) =>
          logger.child({ className: 'MultiServiceApplication' }),
        ),
        loggerLayer,
      ),
    ) as Logger;
    this.logger = createSyncLogger(effectLogger);
  }

  /**
   * Initialize filter configuration from ENV variables
   */
  private async initFilterConfig(): Promise<void> {
    const uniqueKey = `multi-service-filter-${Date.now()}`;
    const config = await TypedEnv.createAsync(
      filterEnvSchema,
      { strict: false },
      uniqueKey,
    );
    this.filterConfigValues = config.values as FilterConfigValues;
  }

  /**
   * Check if a service should be started based on options and ENV filters
   */
  private shouldStartService(name: string): boolean {
    // Priority: options > ENV

    // Check excludedServices from options
    if (this.options.excludedServices?.includes(name as keyof TServices)) {
      return false;
    }

    // Check enabledServices from options (if set, only these services start)
    if (this.options.enabledServices) {
      return this.options.enabledServices.includes(name as keyof TServices);
    }

    // Check ENV filters
    const excludeFromEnv = this.filterConfigValues?.ONEBUN_EXCLUDE_SERVICES || [];
    if (excludeFromEnv.includes(name)) {
      return false;
    }

    const enableFromEnv = this.filterConfigValues?.ONEBUN_SERVICES || [];
    if (enableFromEnv.length > 0) {
      return enableFromEnv.includes(name);
    }

    // Default: start all services
    return true;
  }

  /**
   * Merge app-level options with service-level options.
   * Service-level options take precedence.
   */
  private mergeOptions(
    appOptions: Omit<BaseServiceOptions, 'envSchemaExtend'>,
    serviceOptions: BaseServiceOptions,
  ): BaseServiceOptions {
    return {
      host: serviceOptions.host ?? appOptions.host,
      basePath: serviceOptions.basePath ?? appOptions.basePath,
      routePrefix: serviceOptions.routePrefix ?? appOptions.routePrefix,
      envOverrides: { ...appOptions.envOverrides, ...serviceOptions.envOverrides },
      envSchemaExtend: serviceOptions.envSchemaExtend,
      logger: { ...appOptions.logger, ...serviceOptions.logger },
      metrics: { ...appOptions.metrics, ...serviceOptions.metrics },
      tracing: { ...appOptions.tracing, ...serviceOptions.tracing },
    };
  }

  /**
   * Start all (or filtered) services
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('MultiServiceApplication is already started');

      return;
    }

    await this.initFilterConfig();

    const startPromises: Promise<void>[] = [];
    const serviceNames = Object.keys(this.options.services);
    const skippedServices: string[] = [];

    for (const name of serviceNames) {
      if (!this.shouldStartService(name)) {
        skippedServices.push(name);
        continue;
      }

      const serviceConfig = this.options.services[name];
      const mergedOptions = this.mergeOptions(this.options, serviceConfig);

      // Resolve envOverrides (handles both literal values and fromEnv references)
      const resolvedOverrides = await resolveEnvOverrides(
        mergedOptions.envOverrides || {},
        this.options.envOptions,
      );

      // Merge env schemas
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mergedEnvSchema: EnvSchema<any> | undefined;
      if (this.options.envSchema || mergedOptions.envSchemaExtend) {
        mergedEnvSchema = {
          ...this.options.envSchema,
          ...mergedOptions.envSchemaExtend,
        };
      }

      // Create OneBunApplication for this service
      const app = new OneBunApplication(serviceConfig.module, {
        name,
        port: serviceConfig.port,
        host: mergedOptions.host || '0.0.0.0',
        basePath: mergedOptions.basePath,
        // When routePrefix is true, use service name as prefix
        routePrefix: mergedOptions.routePrefix ? name : undefined,
        envSchema: mergedEnvSchema,
        envOptions: {
          ...this.options.envOptions,
          valueOverrides: resolvedOverrides,
        },
        // Logger configuration - use minLevel if provided
        loggerLayer: mergedOptions.logger?.minLevel
          ? makeLogger({ minLevel: this.getLogLevel(mergedOptions.logger.minLevel) })
          : undefined,
        metrics: {
          ...mergedOptions.metrics,
          defaultLabels: {
            service: name,
            ...mergedOptions.metrics?.defaultLabels,
          },
        },
        tracing: {
          ...mergedOptions.tracing,
          serviceName: name,
        },
      });

      this.applications.set(name, app);

      const startPromise = app.start().then(() => {
        this.logger.info(`Service "${name}" started on port ${serviceConfig.port}`);
      });

      startPromises.push(startPromise);
    }

    if (skippedServices.length > 0) {
      this.logger.info(`Skipped services (filtered out): ${skippedServices.join(', ')}`);
    }

    await Promise.all(startPromises);

    this.isStarted = true;
    this.logger.info(
      `MultiServiceApplication started: ${this.applications.size} of ${serviceNames.length} services running`,
    );
  }

  /**
   * Get URL for a service.
   * Returns local URL if service is running in this process,
   * otherwise looks in externalServiceUrls option.
   *
   * @param name - Service name
   * @returns Service URL
   * @throws Error if service is not available and no external URL is configured
   */
  getServiceUrl(name: keyof TServices): string {
    const app = this.applications.get(name as string);
    if (app) {
      return app.getHttpUrl();
    }

    // Service not running locally - check externalServiceUrls
    const externalUrl = this.options.externalServiceUrls?.[name];
    if (externalUrl) {
      return externalUrl;
    }

    throw new Error(
      `Service "${String(name)}" not available. ` +
      'Either start it or provide URL in externalServiceUrls option.',
    );
  }

  /**
   * Get OneBunApplication instance for a service
   *
   * @param name - Service name
   * @returns OneBunApplication instance or undefined if not running
   */
  getService(name: keyof TServices): OneBunApplication | undefined {
    return this.applications.get(name as string);
  }

  /**
   * Get all running service names
   */
  getRunningServices(): string[] {
    return Array.from(this.applications.keys());
  }

  /**
   * Check if a specific service is running
   */
  isServiceRunning(name: keyof TServices): boolean {
    return this.applications.has(name as string);
  }

  /**
   * Stop all services
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      this.logger.warn('MultiServiceApplication is not started');

      return;
    }

    for (const [name, app] of this.applications) {
      app.stop();
      this.logger.info(`Service "${name}" stopped`);
    }

    this.applications.clear();
    this.isStarted = false;
    this.logger.info('MultiServiceApplication stopped');
  }

  /**
   * Get the logger instance
   */
  getLogger(): SyncLogger {
    return this.logger;
  }

  /**
   * Convert log level string to numeric LogLevel value.
   * LogLevel values: Fatal=60, Error=50, Warning=40, Info=30, Debug=20, Trace=10
   */
  private getLogLevel(level: string): number {
    /* eslint-disable @typescript-eslint/no-magic-numbers */
    const LOG_LEVEL_INFO = 30;
    const levelMap: Record<string, number> = {
      fatal: 60,
      error: 50,
      warning: 40,
      info: LOG_LEVEL_INFO,
      debug: 20,
      trace: 10,
    };

    return levelMap[level.toLowerCase()] ?? LOG_LEVEL_INFO;
    /* eslint-enable @typescript-eslint/no-magic-numbers */
  }
}

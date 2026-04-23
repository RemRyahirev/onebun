import type { OneBunApplication } from './application';
import type {
  BaseServiceOptions,
  MultiServiceApplicationOptions,
  ServicesMap,
} from './multi-service.types';

import { type EnvSchema, TypedEnv } from '@onebun/envs';
import { parseLogLevel, type SyncLogger } from '@onebun/logger';

import { resolveEnvOverrides } from '../service-client/env-resolver';


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
 * Multi-service orchestrator that manages multiple OneBunApplication instances.
 * This is an internal class owned by OneBunApplication in multi-service mode.
 *
 * @internal
 */
export class MultiServiceOrchestrator<TServices extends ServicesMap = ServicesMap> {
  private applications: Map<string, OneBunApplication> = new Map();
  private filterConfigValues: FilterConfigValues | null = null;
  private isStarted = false;

  constructor(
    private options: MultiServiceApplicationOptions<TServices>,
    private logger: SyncLogger,
  ) {}

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
      middleware: serviceOptions.middleware ?? appOptions.middleware,
      metrics: { ...appOptions.metrics, ...serviceOptions.metrics },
      tracing: { ...appOptions.tracing, ...serviceOptions.tracing },
    };
  }

  /**
   * Start all (or filtered) services
   */
  async startAll(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('Multi-service application is already started');

      return;
    }

    // Lazy import to break circular dependency (orchestrator uses type-only import of OneBunApplication)
     
    const { OneBunApplication: appClass } = require('./application') as {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      OneBunApplication: typeof OneBunApplication;
    };

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
      const app = new appClass(serviceConfig.module, {
        name,
        port: serviceConfig.port,
        host: mergedOptions.host || '0.0.0.0',
        basePath: mergedOptions.basePath,
        // When routePrefix is true, use service name as prefix
        routePrefix: mergedOptions.routePrefix ? name : undefined,
        middleware: mergedOptions.middleware,
        envSchema: mergedEnvSchema,
        envOptions: {
          ...this.options.envOptions,
          valueOverrides: resolvedOverrides,
        },
        // Logger configuration - use loggerOptions if minLevel provided
        loggerOptions: mergedOptions.logger?.minLevel
          ? { minLevel: parseLogLevel(mergedOptions.logger.minLevel) }
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
        queue: this.options.queue,
        static: mergedOptions.static ?? serviceConfig.static,
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
      `Multi-service application started: ${this.applications.size} of ${serviceNames.length} services running`,
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
  getServiceUrl(name: string): string {
    const app = this.applications.get(name);
    if (app) {
      return app.getHttpUrl();
    }

    // Service not running locally - check externalServiceUrls
    const externalUrl = this.options.externalServiceUrls?.[name];
    if (externalUrl) {
      return externalUrl;
    }

    throw new Error(
      `Service "${name}" not available. ` +
      'Either start it or provide URL in externalServiceUrls option.',
    );
  }

  /**
   * Get OneBunApplication instance for a service
   *
   * @param name - Service name
   * @returns OneBunApplication instance or undefined if not running
   */
  getApplication(name: string): OneBunApplication | undefined {
    return this.applications.get(name);
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
  isServiceRunning(name: string): boolean {
    return this.applications.has(name);
  }

  /**
   * Stop all services
   */
  async stopAll(): Promise<void> {
    if (!this.isStarted) {
      this.logger.warn('Multi-service application is not started');

      return;
    }

    for (const [name, app] of this.applications) {
      await app.stop();
      this.logger.info(`Service "${name}" stopped`);
    }

    this.applications.clear();
    this.isStarted = false;
    this.logger.info('Multi-service application stopped');
  }
}

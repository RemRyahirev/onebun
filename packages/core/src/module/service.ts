import {
  Context,
  Effect,
  Layer,
} from 'effect';

import type { IConfig, OneBunAppConfig } from './config.interface';

import type { SyncLogger } from '@onebun/logger';

/**
 * Metadata storage for services
 */
const META_SERVICES = new Map<
  Function,
  { tag: Context.Tag<unknown, unknown>; impl: new () => unknown }
>();

/**
 * Service decorator
 * Registers the class as a service with an optional Effect Context tag.
 * Services extending BaseService will have logger and config available
 * immediately after super() in the constructor (via ambient init context),
 * as well as through the initializeService fallback method.
 * 
 * @param tag - Optional Effect Context tag for the service
 */
export function Service<T>(tag?: Context.Tag<T, T>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <C extends new (...args: any[]) => any>(target: C): C => {
    // If no tag is provided, create one using the class name
    const serviceTag = tag || Context.GenericTag<InstanceType<C>>(target.name);

    // Store metadata
    META_SERVICES.set(target, {
      tag: serviceTag as Context.Tag<unknown, unknown>,
      impl: target as new () => unknown,
    });

    return target;
  };
}

/**
 * Get service metadata by class
 */
export function getServiceMetadata(
  serviceClass: Function,
): { tag: Context.Tag<unknown, unknown>; impl: new () => unknown } | undefined {
  return META_SERVICES.get(serviceClass);
}

/**
 * Get the service tag for a service class
 */
export function getServiceTag<T>(serviceClass: new (...args: unknown[]) => T): Context.Tag<T, T> {
  const metadata = getServiceMetadata(serviceClass);
  if (!metadata) {
    throw new Error(`Service ${serviceClass.name} does not have @Service decorator`);
  }

  return metadata.tag as Context.Tag<T, T>;
}

/**
 * Base service class that provides utility methods for working with Effect.
 *
 * Services extending BaseService have `this.config` and `this.logger` available
 * immediately after `super()` in the constructor when created through the framework DI.
 * The framework sets an ambient init context before calling the constructor, and
 * BaseService reads from it in `super()`.
 *
 * @example
 * ```typescript
 * @Service()
 * class MyService extends BaseService {
 *   private readonly baseUrl: string;
 *
 *   constructor(private dep: SomeDep) {
 *     super();
 *     // this.config and this.logger are available here!
 *     this.baseUrl = this.config.get('api.baseUrl');
 *   }
 * }
 * ```
 */
export class BaseService {
  // Logger instance with service class name as context
  protected logger!: SyncLogger;
  // Configuration instance for accessing environment variables
  protected config!: IConfig<OneBunAppConfig>;
  // Flag to track initialization status
  private _initialized = false;

  /**
   * Ambient init context set by the framework before service construction.
   * This allows BaseService constructor to pick up logger and config
   * so they are available immediately after super() in subclass constructors.
   * @internal
   */
  private static _initContext: { logger: SyncLogger; config: IConfig<OneBunAppConfig> } | null =
    null;

  /**
   * Set the ambient init context before constructing a service.
   * Called by the framework (OneBunModule) before `new ServiceClass(...)`.
   * @internal
   */
  static setInitContext(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    BaseService._initContext = { logger, config };
  }

  /**
   * Clear the ambient init context after service construction.
   * Called by the framework (OneBunModule) after `new ServiceClass(...)`.
   * @internal
   */
  static clearInitContext(): void {
    BaseService._initContext = null;
  }

  constructor() {
    // Pick up logger and config from ambient init context if available.
    // This makes this.config and this.logger available immediately after super()
    // in subclass constructors.
    if (BaseService._initContext) {
      const { logger, config } = BaseService._initContext;
      const className = this.constructor.name;
      this.logger = logger.child({ className });
      this.config = config;
      this._initialized = true;
    }
  }

  /**
   * Initialize service with logger and config (called by the framework).
   * This is a fallback for services not constructed through the DI system
   * (e.g., in tests or when created manually). If the service was already
   * initialized via the constructor init context, this is a no-op.
   * @internal
   */
  initializeService(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    if (this._initialized) {
      return; // Already initialized (via constructor or previous call)
    }

    const className = this.constructor.name;

    if (logger) {
      // Use provided logger and create a child with the service class name
      this.logger = logger.child({ className });
    } else {
      throw new Error(
        `Logger is required for service ${className}. Make sure OneBunApplication is configured correctly.`,
      );
    }

    // Set configuration instance
    this.config = config;
    this._initialized = true;

    this.logger.debug(`Service ${className} initialized`);
  }

  /**
   * Check if service is initialized
   * @internal
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Run an effect with error handling
   * @param effect - The effect to run
   * @returns A promise that resolves to the effect's result or rejects with an error
   */
  protected async runEffect<A>(effect: Effect.Effect<never, never, A>): Promise<A> {
    try {
      // Use type assertion to work around type compatibility issue
      return await Effect.runPromise(effect as Effect.Effect<never, never, never>);
    } catch (error) {
      throw this.formatError(error);
    }
  }

  /**
   * Format an error for consistent error handling
   * @param error - The error to format
   * @returns A formatted error
   */
  protected formatError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}

/**
 * Create a layer for a service
 * @param serviceClass - The service class
 * @param logger - The logger to inject into the service
 * @param config - The configuration to inject into the service
 * @returns A layer for the service
 */
export function createServiceLayer<T>(
  serviceClass: new (...args: unknown[]) => T,
  logger?: SyncLogger,
  config?: IConfig<OneBunAppConfig>,
): Layer.Layer<never, never, unknown> {
  const metadata = getServiceMetadata(serviceClass);
  if (!metadata) {
    throw new Error(`Service ${serviceClass.name} does not have @Service decorator`);
  }

  // Create a service instance with logger and config
  const serviceConstructor = metadata.impl as new (...args: unknown[]) => unknown;
  const serviceInstance = new serviceConstructor(logger, config);

  // Return a layer that provides the service
  return Layer.succeed(metadata.tag, serviceInstance);
}

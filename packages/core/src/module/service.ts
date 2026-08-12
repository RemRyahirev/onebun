import { trace } from '@opentelemetry/api';
import {
  Context,
  Effect,
  Layer,
} from 'effect';

import type { IConfig, OneBunAppConfig } from './config.interface';
// Type-only: `module.ts` imports this file at runtime, so a value import would be circular.
import type { GlobalScope } from './module';
import type { Span } from '@opentelemetry/api';

import type { SyncLogger } from '@onebun/logger';

import { getRegistrationOptions } from './registration';

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
 * @see docs:api/services.md
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
 * @see docs:api/services.md
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getServiceTag<T>(serviceClass: new (...args: any[]) => T): Context.Tag<T, T> {
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
 * @see docs:api/services.md
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
  private static _initContext: {
    logger: SyncLogger;
    config: IConfig<OneBunAppConfig>;
    scope?: GlobalScope;
    owner?: Function;
  } | null = null;

  /**
   * The owning application's DI scope, when the service was built by one.
   * Carries dynamic-module options captured per application rather than per process.
   * @internal
   */
  private _scope?: GlobalScope;

  /**
   * The module class that built this service.
   *
   * For a service provided by a named registration this is the minted registration class,
   * which is what lets the service read ITS OWN configuration rather than the class-static
   * slot every registration in the process shares.
   * @internal
   */
  private _owner?: Function;

  /**
   * Set the ambient init context before constructing a service.
   * Called by the framework (OneBunModule) before `new ServiceClass(...)`.
   * @internal
   */
  static setInitContext(
    logger: SyncLogger,
    config: IConfig<OneBunAppConfig>,
    scope?: GlobalScope,
    owner?: Function,
  ): void {
    BaseService._initContext = {
      logger, config, scope, owner,
    };
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
      const {
        logger, config, scope, owner,
      } = BaseService._initContext;
      const className = this.constructor.name;
      this.logger = logger.child({ className });
      this.config = config;
      this._scope = scope;
      this._owner = owner;
      this._initialized = true;
    }
  }

  /**
   * The owning application's DI scope, or `undefined` outside an application.
   *
   * The one supported way for a service to read the options its application imported a
   * dynamic module with — `Module.getOptions()` reads a slot the whole process shares.
   * @internal
   */
  protected get moduleScope(): GlobalScope | undefined {
    return this._scope;
  }

  /**
   * The options of the registration that provides this service, when there is one.
   *
   * Falls back to `undefined` outside a registration — a service built by `createTestService`
   * or by a plain `new`, where the caller supplies configuration directly.
   * @internal
   */
  protected registrationOptions<T>(): T | undefined {
    return this._owner ? getRegistrationOptions<T>(this._owner) : undefined;
  }

  /**
   * Initialize service with logger and config (called by the framework).
   * This is a fallback for services not constructed through the DI system
   * (e.g., in tests or when created manually). If the service was already
   * initialized via the constructor init context, this is a no-op.
   * @internal
   */
  initializeService(
    logger: SyncLogger,
    config: IConfig<OneBunAppConfig>,
    scope?: GlobalScope,
  ): void {
    // Assigned before the early return: a service built through DI is already initialized by
    // the constructor path above, so anything set after this guard would never reach it.
    this._scope ??= scope;

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
   * Get the currently active OpenTelemetry span.
   * Returns undefined when no span is active (e.g. outside of @Traced context).
   *
   * The returned Span has a fully synchronous API:
   * - `span.setAttribute(key, value)`
   * - `span.setAttributes({ key: value })`
   * - `span.addEvent(name, attributes?)`
   * - `span.recordException(error)`
   * - `span.setStatus({ code, message })`
   */
  protected get span(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * Get the global MetricsService instance.
   * Returns undefined when metrics are not enabled.
   *
   * Usage:
   * - `this.metrics?.createCounter({ name, help })`
   * - `this.metrics?.createHistogram({ name, help, buckets })`
   * - `this.metrics?.getMetric<Counter>(name)`
   */
  protected get metrics(): import('@onebun/metrics').MetricsService | undefined {
    if (typeof globalThis !== 'undefined') {
      return (globalThis as Record<string, unknown>).__onebunMetricsService as
        import('@onebun/metrics').MetricsService | undefined;
    }

    return undefined;
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
 * @see docs:api/services.md
 */
export function createServiceLayer<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClass: new (...args: any[]) => T,
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

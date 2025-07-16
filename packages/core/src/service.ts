import {
  Context,
  Effect,
  Layer,
} from 'effect';

import type { SyncLogger } from '@onebun/logger';

/**
 * Metadata storage for services
 */
const META_SERVICES = new Map<Function, { tag: Context.Tag<unknown, unknown>; impl: new () => unknown }>();

/**
 * Service decorator
 * @param options - Options for the service
 */
export function Service<T>(tag?: Context.Tag<T, T>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function<C extends new (...args: any[]) => any>(target: C): C {
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
 * Base service class that provides utility methods for working with Effect
 */
export class BaseService {
  // Logger instance with service class name as context
  protected logger: SyncLogger;
  // Configuration instance for accessing environment variables
  protected config: unknown;

  constructor(...args: unknown[]) {
    // Extract logger and config from arguments
    // Module passes: [service1, service2, ..., logger, config] - same as controller
    let logger: SyncLogger | undefined;
    let config: unknown;
    
    if (args.length >= 2) {
      // Last argument is config, second to last is logger
      config = args[args.length - 1];
      const potentialLogger = args[args.length - 2];
      if (potentialLogger && typeof potentialLogger === 'object' && 'info' in potentialLogger) {
        logger = potentialLogger as SyncLogger;
      }
    } else if (args.length === 1) {
      // Only config provided
      config = args[0];
    }

    // Initialize logger with service class name as context
    const className = this.constructor.name;

    if (logger) {
      // Use provided logger and create a child with the service class name
      this.logger = logger.child({ className });
    } else {
      // This should never happen since OneBunApplication always provides a logger
      throw new Error(`Logger is required for service ${className}. Make sure OneBunApplication is configured correctly.`);
    }

    // Set configuration instance
    this.config = config;

    this.logger.debug(`Service ${className} initialized`);
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
  config?: unknown,
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

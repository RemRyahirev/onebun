import { Context, Effect, Layer } from 'effect';
import { SyncLogger } from '@onebun/logger';

/**
 * Metadata storage for services
 */
const META_SERVICES = new Map<Function, { tag: Context.Tag<any, any>, impl: new () => any }>();

/**
 * Service decorator
 * @param options Options for the service
 */
export function Service<T>(tag?: Context.Tag<T, T>) {
  return function<C extends new (...args: any[]) => any>(target: C): C {
    // If no tag is provided, create one using the class name
    const serviceTag = tag || Context.GenericTag<InstanceType<C>>(target.name);

    // Store metadata
    META_SERVICES.set(target, {
      tag: serviceTag,
      impl: target
    });

    return target;
  };
}

/**
 * Get service metadata
 */
export function getServiceMetadata(target: Function): { tag: Context.Tag<any, any>, impl: new () => any } | undefined {
  return META_SERVICES.get(target);
}

/**
 * Get service tag
 * @param serviceClass The service class
 * @returns The service tag
 */
export function getServiceTag<T>(serviceClass: new (...args: any[]) => T): Context.Tag<T, T> {
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

  constructor(logger?: SyncLogger) {
    // Initialize logger with service class name as context
    const className = this.constructor.name;

    if (logger) {
      // Use provided logger and create a child with the service class name
      this.logger = logger.child({ className });
    } else {
      // This should never happen since OneBunApplication always provides a logger
      throw new Error(`Logger is required for service ${className}. Make sure OneBunApplication is configured correctly.`);
    }
  }

  /**
   * Run an effect with error handling
   * @param effect The effect to run
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
   * @param error The error to format
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
 * @param serviceClass The service class
 * @param logger The logger to inject into the service
 * @returns A layer for the service
 */
export function createServiceLayer<T>(serviceClass: new (...args: any[]) => T, logger?: SyncLogger): Layer.Layer<never, never, any> {
  const metadata = getServiceMetadata(serviceClass);
  if (!metadata) {
    throw new Error(`Service ${serviceClass.name} does not have @Service decorator`);
  }

  // Create a service instance with logger
  const ServiceConstructor = metadata.impl as new (logger?: SyncLogger) => any;
  const serviceInstance = new ServiceConstructor(logger);

  // Return a layer that provides the service
  return Layer.succeed(metadata.tag, serviceInstance);
}

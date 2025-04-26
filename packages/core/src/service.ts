import { Context, Effect, Layer } from 'effect';

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
 * @returns A layer for the service
 */
export function createServiceLayer<T>(serviceClass: new () => T): Layer.Layer<never, never, any> {
  const metadata = getServiceMetadata(serviceClass);
  if (!metadata) {
    throw new Error(`Service ${serviceClass.name} does not have @Service decorator`);
  }

  return Layer.succeed(metadata.tag, new metadata.impl());
}

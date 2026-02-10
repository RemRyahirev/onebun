/**
 * Lifecycle hooks interfaces for services and controllers.
 * Implement these interfaces to hook into the application lifecycle.
 *
 * @example
 * ```typescript
 * import { Service, BaseService, OnModuleInit, OnModuleDestroy } from '@onebun/core';
 *
 * @Service()
 * export class DatabaseService extends BaseService implements OnModuleInit, OnModuleDestroy {
 *   async onModuleInit() {
 *     await this.pool.connect();
 *     this.logger.info('Database connected');
 *   }
 *
 *   async onModuleDestroy() {
 *     await this.pool.end();
 *     this.logger.info('Database disconnected');
 *   }
 * }
 * ```
 */

/**
 * Interface for hook called after module initialization.
 * Called after the service/controller is instantiated and dependencies are injected.
 */
export interface OnModuleInit {
  /**
   * Called after the module has been initialized.
   * Can be async - the framework will await completion.
   */
  onModuleInit(): Promise<void> | void;
}

/**
 * Interface for hook called after application initialization.
 * Called after all modules are initialized and before the HTTP server starts.
 */
export interface OnApplicationInit {
  /**
   * Called after the application has been initialized.
   * Can be async - the framework will await completion.
   */
  onApplicationInit(): Promise<void> | void;
}

/**
 * Interface for hook called when module is being destroyed.
 * Called during application shutdown, after HTTP server stops.
 */
export interface OnModuleDestroy {
  /**
   * Called when the module is being destroyed.
   * Can be async - the framework will await completion.
   */
  onModuleDestroy(): Promise<void> | void;
}

/**
 * Interface for hook called before application shutdown begins.
 * Called at the very start of the shutdown process.
 */
export interface BeforeApplicationDestroy {
  /**
   * Called before the application shutdown process begins.
   * Can be async - the framework will await completion.
   * @param signal - The signal that triggered the shutdown (e.g., 'SIGTERM', 'SIGINT')
   */
  beforeApplicationDestroy(signal?: string): Promise<void> | void;
}

/**
 * Interface for hook called after application shutdown completes.
 * Called at the very end of the shutdown process.
 */
export interface OnApplicationDestroy {
  /**
   * Called after the application shutdown process completes.
   * Can be async - the framework will await completion.
   * @param signal - The signal that triggered the shutdown (e.g., 'SIGTERM', 'SIGINT')
   */
  onApplicationDestroy(signal?: string): Promise<void> | void;
}

/**
 * Interface for modules that configure middleware.
 * Re-exported from types for convenience. Use the canonical import from types.ts.
 */

// =============================================================================
// Helper functions for checking if an object implements lifecycle hooks
// =============================================================================

/**
 * Check if an object has an onModuleInit method
 */
export function hasOnModuleInit(obj: unknown): obj is OnModuleInit {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onModuleInit' in obj &&
    typeof (obj as OnModuleInit).onModuleInit === 'function'
  );
}

/**
 * Check if an object has an onApplicationInit method
 */
export function hasOnApplicationInit(obj: unknown): obj is OnApplicationInit {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onApplicationInit' in obj &&
    typeof (obj as OnApplicationInit).onApplicationInit === 'function'
  );
}

/**
 * Check if an object has an onModuleDestroy method
 */
export function hasOnModuleDestroy(obj: unknown): obj is OnModuleDestroy {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onModuleDestroy' in obj &&
    typeof (obj as OnModuleDestroy).onModuleDestroy === 'function'
  );
}

/**
 * Check if an object has a beforeApplicationDestroy method
 */
export function hasBeforeApplicationDestroy(obj: unknown): obj is BeforeApplicationDestroy {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'beforeApplicationDestroy' in obj &&
    typeof (obj as BeforeApplicationDestroy).beforeApplicationDestroy === 'function'
  );
}

/**
 * Check if an object has an onApplicationDestroy method
 */
export function hasOnApplicationDestroy(obj: unknown): obj is OnApplicationDestroy {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onApplicationDestroy' in obj &&
    typeof (obj as OnApplicationDestroy).onApplicationDestroy === 'function'
  );
}

/**
 * Check if a class (constructor) has a configureMiddleware method on its prototype.
 * Used to detect modules that implement OnModuleConfigure.
 */
export function hasConfigureMiddleware(cls: Function): boolean {
  return typeof cls.prototype?.configureMiddleware === 'function';
}

// =============================================================================
// Helper functions to call lifecycle hooks safely
// =============================================================================

/**
 * Call onModuleInit on an object if it implements the hook
 */
export async function callOnModuleInit(obj: unknown): Promise<void> {
  if (hasOnModuleInit(obj)) {
    await obj.onModuleInit();
  }
}

/**
 * Call onApplicationInit on an object if it implements the hook
 */
export async function callOnApplicationInit(obj: unknown): Promise<void> {
  if (hasOnApplicationInit(obj)) {
    await obj.onApplicationInit();
  }
}

/**
 * Call onModuleDestroy on an object if it implements the hook
 */
export async function callOnModuleDestroy(obj: unknown): Promise<void> {
  if (hasOnModuleDestroy(obj)) {
    await obj.onModuleDestroy();
  }
}

/**
 * Call beforeApplicationDestroy on an object if it implements the hook
 */
export async function callBeforeApplicationDestroy(obj: unknown, signal?: string): Promise<void> {
  if (hasBeforeApplicationDestroy(obj)) {
    await obj.beforeApplicationDestroy(signal);
  }
}

/**
 * Call onApplicationDestroy on an object if it implements the hook
 */
export async function callOnApplicationDestroy(obj: unknown, signal?: string): Promise<void> {
  if (hasOnApplicationDestroy(obj)) {
    await obj.onApplicationDestroy(signal);
  }
}

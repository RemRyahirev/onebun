import type { DeepPaths, DeepValue } from '@onebun/envs';

/**
 * Empty interface for module augmentation.
 * Users extend this to provide typed config access.
 * 
 * @example
 * declare module '@onebun/core' {
 *   interface OneBunAppConfig {
 *     server: { port: number; host: string };
 *   }
 * }
 */
 
export interface OneBunAppConfig {}

/**
 * Generic typed configuration interface.
 * Provides type-safe access to configuration values.
 */
export interface IConfig<T = OneBunAppConfig> {
  /** Get configuration value by dot-notation path with full type inference */
  get<P extends DeepPaths<T>>(path: P): DeepValue<T, P>;
  /** Fallback for dynamic paths */
  get(path: string): unknown;
  /** Get all configuration values */
  readonly values: T;
  /** Get safe configuration for logging (sensitive data masked) */
  getSafeConfig(): T;
  /** Check if configuration is initialized */
  readonly isInitialized: boolean;
  /** Initialize configuration (async) */
  initialize(): Promise<void>;
}

/**
 * Config stub that throws on any access.
 * Used when envSchema is not provided.
 */
export class NotInitializedConfig implements IConfig<never> {
  get(_path: string): never {
    throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
  }
  
  get values(): never {
    throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
  }
  
  getSafeConfig(): never {
    throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
  }
  
  get isInitialized(): boolean {
    return false;
  }
  
  async initialize(): Promise<void> {
    throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
  }
}

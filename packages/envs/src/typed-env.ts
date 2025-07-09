import { Effect } from 'effect';

import { EnvLoader } from './loader';
import { EnvParser } from './parser';
import {
  EnvSchema,
  EnvValidationError,
  EnvLoadError,
  EnvVariableConfig,
} from './types';

/**
 * Utility types for automatic type inference
 */
type DeepValue<T, Path extends string> = Path extends keyof T
  ? T[Path]
  : Path extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? T[K] extends object
        ? DeepValue<T[K], Rest>
        : never
      : never
    : any; // Fallback to any for complex paths

type DeepPaths<T> = T extends object
  ? {
    [K in keyof T]: K extends string
      ? T[K] extends object
        ? K | `${K}.${DeepPaths<T[K]>}`
        : K
      : never;
  }[keyof T]
  : never;

/**
 * Sensitive value wrapper that sanitizes toString() output
 */
class SensitiveValue<T> {
  constructor(private readonly _value: T) {}

  get value(): T {
    return this._value;
  }

  toString(): string {
    return '***';
  }

  toJSON(): string {
    return '***';
  }

  valueOf(): T {
    return this._value;
  }

  [Symbol.toPrimitive](hint: string): string | number | T {
    if (hint === 'string') {
      return '***';
    }
    if (hint === 'number' && typeof this._value === 'number') {
      return this._value;
    }

    return this._value;
  }
}

/**
 * Configuration proxy that intercepts access and provides type safety
 */
class ConfigProxy<T> {
  private _isInitialized = false;
  private _values: T | null = null;
  private _sensitiveFields: Set<string> = new Set();

  constructor(
    private readonly _schema: EnvSchema<T>,
    private readonly _options: any = {},
  ) {
    this.extractSensitiveFields(this._schema, '');
  }

  private extractSensitiveFields(schema: any, prefix = ''): void {
    for (const [key, config] of Object.entries(schema)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      
      if (this.isEnvVariableConfig(config)) {
        if ((config as EnvVariableConfig).sensitive) {
          this._sensitiveFields.add(fullPath);
        }
      } else {
        this.extractSensitiveFields(config, fullPath);
      }
    }
  }

  private isEnvVariableConfig(config: any): boolean {
    return config && typeof config === 'object' && 'type' in config;
  }

  private async ensureInitialized(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    const rawVariables = await Effect.runPromise(EnvLoader.load(this._options));
    this._values = this.parseNestedSchema(this._schema, rawVariables, '') as T;
    this._isInitialized = true;
  }

  private parseNestedSchema(schema: any, rawVariables: Record<string, string>, prefix: string): any {
    const result: any = {};

    for (const [key, config] of Object.entries(schema)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      
      if (this.isEnvVariableConfig(config)) {
        const envConfig = config as EnvVariableConfig;
        const envVar = envConfig.env || this.pathToEnvVar(fullPath);
        const rawValue = rawVariables[envVar];
        
        try {
          const parsed = Effect.runSync(
            EnvParser.parse(envVar, rawValue, envConfig, this._options),
          );
          result[key] = parsed;
        } catch (error) {
          if (error instanceof EnvValidationError) {
            throw error;
          }
          throw new EnvValidationError(envVar, rawValue, String(error));
        }
      } else {
        result[key] = this.parseNestedSchema(config, rawVariables, fullPath);
      }
    }

    return result;
  }

  private pathToEnvVar(path: string): string {
    return path.toUpperCase().replace(/\./g, '_');
  }

  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  /**
   * Synchronous get method with automatic type inference and sensitive data handling
   */
  get<P extends DeepPaths<T>>(path: P): DeepValue<T, P>;
  get<P extends keyof T>(path: P): T[P];
  get(path: string): any;
  get(path: string): any {
    if (!this._isInitialized || !this._values) {
      throw new Error('Configuration not initialized. Call TypedEnv.create() or ensure initialization is complete.');
    }

    const value = this.getValueByPath(this._values, path);
    
    // Wrap sensitive values
    if (this._sensitiveFields.has(path)) {
      return new SensitiveValue(value);
    }
    
    return value;
  }

  /**
   * Get the entire configuration object
   */
  get values(): T {
    if (!this._isInitialized || !this._values) {
      throw new Error('Configuration not initialized. Call TypedEnv.create() or ensure initialization is complete.');
    }

    return this._values;
  }

  /**
   * Initialize the configuration (async)
   */
  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  /**
   * Check if configuration is initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get safe configuration for logging (sensitive data masked)
   */
  getSafeConfig(): T {
    if (!this._isInitialized || !this._values) {
      throw new Error('Configuration not initialized.');
    }
    
    return this.applySensitiveMask(this._values, '') as T;
  }

  private applySensitiveMask(obj: any, prefix = ''): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => 
        typeof item === 'object' ? this.applySensitiveMask(item, prefix) : item,
      );
    }
    
    if (typeof obj === 'object') {
      const result: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        
        if (this._sensitiveFields.has(fullPath)) {
          result[key] = '***';
        } else if (value && typeof value === 'object') {
          result[key] = this.applySensitiveMask(value, fullPath);
        } else {
          result[key] = value;
        }
      }
      
      return result;
    }
    
    return obj;
  }
}

/**
 * Static factory for creating typed environment configurations
 */
export class TypedEnv {
  private static instances = new Map<string, ConfigProxy<any>>();

  /**
   * Create or get existing typed environment configuration
   */
  static create<T>(
    schema: EnvSchema<T>,
    options: any = {},
    key = 'default',
  ): ConfigProxy<T> {
    if (!TypedEnv.instances.has(key)) {
      const proxy = new ConfigProxy(schema, options);
      TypedEnv.instances.set(key, proxy);
      
      // Auto-initialize
      proxy.initialize();
    }
    
    return TypedEnv.instances.get(key) as ConfigProxy<T>;
  }

  /**
   * Create typed environment configuration with immediate initialization
   */
  static async createAsync<T>(
    schema: EnvSchema<T>,
    options: any = {},
    key = 'default',
  ): Promise<ConfigProxy<T>> {
    const proxy = TypedEnv.create(schema, options, key);
    await proxy.initialize();

    return proxy;
  }

  /**
   * Clear all instances (useful for testing)
   */
  static clear(): void {
    TypedEnv.instances.clear();
  }
}

// Export type helpers for external use
export type { DeepPaths, DeepValue, SensitiveValue };
export { ConfigProxy }; 
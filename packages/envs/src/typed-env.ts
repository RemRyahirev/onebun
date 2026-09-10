import { Effect } from 'effect';

import { EnvLoader } from './loader';
import { isEnvVariableConfig, parseSchema } from './schema-parser';
import {
  type EnvLoadOptions,
  type EnvSchema,
  type EnvVariableConfig,
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
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any; // Fallback to any for complex paths

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
    private readonly _options: EnvLoadOptions = {},
  ) {
    this.extractSensitiveFields(this._schema, '');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractSensitiveFields(schema: any, prefix = ''): void {
    for (const [key, config] of Object.entries(schema)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      if (isEnvVariableConfig(config)) {
        if ((config as EnvVariableConfig).sensitive) {
          this._sensitiveFields.add(fullPath);
        }
      } else {
        this.extractSensitiveFields(config, fullPath);
      }
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    const rawVariables = await Effect.runPromise(EnvLoader.load(this._options));
    this._values = parseSchema(this._schema, rawVariables, '', this._options) as T;
    this._isInitialized = true;
  }

  /**
   * Initialize configuration synchronously from pre-loaded raw variables.
   * Used by getConfig() to avoid async overhead.
   */
  initializeSync(rawVariables: Record<string, string>): void {
    if (this._isInitialized) {
      return;
    }

    this._values = parseSchema(this._schema, rawVariables, '', this._options) as T;
    this._isInitialized = true;
  }

  private getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: Record<string, unknown> | unknown = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key as keyof typeof current];
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(path: string): any;
  get(path: string): unknown {
    if (!this._isInitialized || !this._values) {
      throw new Error(
        'Configuration not initialized. Call TypedEnv.create() or ensure initialization is complete.',
      );
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
      throw new Error(
        'Configuration not initialized. Call TypedEnv.create() or ensure initialization is complete.',
      );
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

  private applySensitiveMask<U = unknown>(obj: U, prefix = ''): U {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) =>
        typeof item === 'object' ? this.applySensitiveMask<U>(item, prefix) : item,
      ) as U;
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;

        if (this._sensitiveFields.has(fullPath)) {
          result[key] = '***';
        } else if (value && typeof value === 'object') {
          result[key] = this.applySensitiveMask<U>(value, fullPath);
        } else {
          result[key] = value;
        }
      }

      return result as U;
    }

    return obj;
  }
}

/**
 * Deterministic fingerprint of a plain value: same content, same string, regardless of key order.
 *
 * `EnvLoadOptions` and `EnvSchema` are data, so JSON is enough. Anything JSON drops (a function,
 * a symbol) fingerprints as `undefined` — two schemas that differ only there compare equal, which
 * costs a shared proxy in a case the schema types do not allow anyway.
 */
function fingerprint(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }

  if (Array.isArray(value)) {
    return `[${value.map(fingerprint).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${fingerprint(v)}`).join(',')}}`;
}

/**
 * Start loading a freshly created proxy without leaving the rejection to float.
 *
 * The caller of `create()` gets no handle on this promise, so a schema that fails validation would
 * otherwise surface as an unhandled rejection in whatever code happens to be running. Nothing is
 * lost by swallowing it here: `initialize()` retries after a failure, and everyone who needs the
 * error awaits it — `createAsync()` and `OneBunApplication.start()` — while everyone else meets
 * "Configuration not initialized" on first access.
 */
function autoInitialize<T>(proxy: ConfigProxy<T>): void {
  void proxy.initialize().catch(() => undefined);
}

/**
 * Static factory for creating typed environment configurations
 *
 * @see docs:api/envs.md
 */
export class TypedEnv {
  /**
   * Default path: the schema object identifies the configuration, and the options that shape the
   * load (`valueOverrides` above all) split it further. Two different schemas are two different
   * configurations, so they get two proxies — the process is not a single global slot.
   *
   * A `WeakMap` so a schema that goes out of scope takes its proxy with it.
   */
  private static schemaInstances = new WeakMap<object, Map<string, ConfigProxy<unknown>>>();

  /**
   * Explicit-key path: the caller named the slot, so the name is the identity. The schema is kept
   * alongside to catch a name reused for a different configuration.
   */
  private static namedInstances = new Map<string, { schemaFingerprint: string; proxy: ConfigProxy<unknown> }>();

  /**
   * Create or get existing typed environment configuration.
   *
   * Without `key`, instances are cached per (schema, options) pair. With `key`, the key alone
   * identifies the instance — reusing one key for a structurally different schema throws instead
   * of handing back the other schema's configuration.
   */
  static create<T>(
    schema: EnvSchema<T>,
    options: EnvLoadOptions = {},
    key?: string,
  ): ConfigProxy<T> {
    if (key !== undefined) {
      return TypedEnv.createNamed(schema, options, key);
    }

    const optionsFingerprint = fingerprint(options);
    let byOptions = TypedEnv.schemaInstances.get(schema as object);

    if (!byOptions) {
      byOptions = new Map<string, ConfigProxy<unknown>>();
      TypedEnv.schemaInstances.set(schema as object, byOptions);
    }

    const cached = byOptions.get(optionsFingerprint);
    if (cached) {
      return cached as ConfigProxy<T>;
    }

    const proxy = new ConfigProxy(schema, options);
    byOptions.set(optionsFingerprint, proxy as ConfigProxy<unknown>);

    autoInitialize(proxy);

    return proxy;
  }

  private static createNamed<T>(
    schema: EnvSchema<T>,
    options: EnvLoadOptions,
    key: string,
  ): ConfigProxy<T> {
    const schemaFingerprint = fingerprint(schema);
    const cached = TypedEnv.namedInstances.get(key);

    if (cached) {
      if (cached.schemaFingerprint !== schemaFingerprint) {
        throw new Error(
          `TypedEnv key '${key}' is already bound to a different schema. `
          + 'One key is one configuration: pass a distinct key, or omit it and let the schema identify '
          + 'the instance.',
        );
      }

      return cached.proxy as ConfigProxy<T>;
    }

    const proxy = new ConfigProxy(schema, options);
    TypedEnv.namedInstances.set(key, { schemaFingerprint, proxy: proxy as ConfigProxy<unknown> });

    autoInitialize(proxy);

    return proxy;
  }

  /**
   * Create typed environment configuration with immediate initialization
   */
  static async createAsync<T>(
    schema: EnvSchema<T>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any = {},
    key?: string,
  ): Promise<ConfigProxy<T>> {
    const proxy = TypedEnv.create(schema, options, key);
    await proxy.initialize();

    return proxy;
  }

  /**
   * Clear all instances (useful for testing)
   */
  static clear(): void {
    TypedEnv.namedInstances.clear();
    TypedEnv.schemaInstances = new WeakMap<object, Map<string, ConfigProxy<unknown>>>();
  }
}

// Export type helpers for external use
export type { DeepPaths, DeepValue, SensitiveValue };
export { ConfigProxy };

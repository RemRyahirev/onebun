import type { Effect } from 'effect';

/**
 * Environment variable value types
 */
export type EnvValueType = 'string' | 'number' | 'boolean' | 'array';

/**
 * Configuration for environment variable
 */
export interface EnvVariableConfig<T = unknown> {
  /** Environment variable name (if different from schema key) */
  env?: string;
  /** Variable description */
  description?: string;
  /** Variable type */
  type: EnvValueType;
  /** Default value */
  default?: T;
  /** Required field - will throw error if not provided */
  required?: boolean;
  /** Sensitive field - will be masked in logs */
  sensitive?: boolean;
  /** Validation function */
  validate?: (value: T) => Effect.Effect<T, EnvValidationError>;
  /** Separator for arrays (default: ',') */
  separator?: string;
}

/**
 * Environment variables schema supporting nested objects
 *
 * @see docs:api/envs.md
 */
export type EnvSchema<T> = {
  [K in keyof T]: T[K] extends string | number | boolean | string[] | number[] | boolean[]
    ? EnvVariableConfig<T[K]>
    : T[K] extends Record<string, unknown>
      ? EnvSchema<T[K]>
      : EnvVariableConfig<T[K]>;
};

/**
 * Describe a rejected value for an error message.
 *
 * The value is never rendered. An environment variable may hold a secret, and the framework
 * logs its own startup failures before user code gets control — there is nothing to suppress
 * at that point, so the only safe rule is to never echo the value at all, with no flag to
 * remember. Only the shape survives: the kind, plus the length where that is what tells an
 * operator about a stray quote, a trailing space or an accidentally blank value.
 */
function describeValue(value: unknown): string {
  if (value === undefined) {
    return 'not set';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value === '' ? 'an empty string' : `a string of length ${value.length}`;
  }
  if (Array.isArray(value)) {
    return `an array of length ${value.length}`;
  }
  if (typeof value === 'object') {
    return 'an object';
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return 'a number';
  }
  if (typeof value === 'boolean') {
    return 'a boolean';
  }

  return `a ${typeof value}`;
}

/**
 * Environment variable validation error.
 *
 * The rejected value is described, never stored: `value` holds a redacted description such as
 * `a string of length 21`, so serializing the error — message, stack or own properties — cannot
 * leak a secret. This is the single choke point every construction site funnels through.
 *
 * @see docs:api/envs.md
 */
export class EnvValidationError extends Error {
  /** Environment variable name */
  public readonly variable: string;

  /** Redacted description of the rejected value, e.g. `a string of length 21` */
  public readonly value: string;

  /** Why the value was rejected */
  public readonly reason: string;

  constructor(variable: string, rejectedValue: unknown, reason: string) {
    const described = describeValue(rejectedValue);

    super(`Environment variable validation failed for "${variable}": ${reason}. Got: ${described}`);

    this.variable = variable;
    this.value = described;
    this.reason = reason;
    this.name = 'EnvValidationError';
  }
}

/**
 * Environment variable loading error
 */
export class EnvLoadError extends Error {
  constructor(
    public readonly variable: string,
    public readonly reason: string,
  ) {
    super(`Failed to load environment variable "${variable}": ${reason}`);
    this.name = 'EnvLoadError';
  }
}

/**
 * Environment loading options
 */
export interface EnvLoadOptions {
  /** Path to .env file (default: '.env') */
  envFilePath?: string;
  /** Whether to load .env file (default: true) */
  loadDotEnv?: boolean;
  /** Environment variables override .env file (default: true) */
  envOverridesDotEnv?: boolean;
  /** Strict mode - only load variables defined in schema (default: false) */
  strict?: boolean;
  /** Default separator for arrays (default: ',') */
  defaultArraySeparator?: string;
  /**
   * Override values that take precedence over both process.env and .env file.
   * Useful for multi-service setups where each service needs different values.
   */
  valueOverrides?: Record<string, string | number | boolean>;
}

/**
 * Infer config type from EnvSchema.
 * Recursively extracts value types from EnvVariableConfig at any depth.
 * 
 * @example
 * const schema = {
 *   server: {
 *     port: Env.number({ default: 3000 }),
 *     host: Env.string({ default: '0.0.0.0' }),
 *   },
 *   database: {
 *     connection: {
 *       host: Env.string({ default: 'localhost' }),
 *       ssl: { enabled: Env.boolean({ default: true }) },
 *     },
 *   },
 * };
 * type Config = InferConfigType<typeof schema>;
 * // { server: { port: number; host: string }; database: { connection: { host: string; ssl: { enabled: boolean } } } }
 *
 * @see docs:api/envs.md
 */
export type InferConfigType<S> = {
  [K in keyof S]: S[K] extends EnvVariableConfig<infer T>
    ? T
    : S[K] extends Record<string, unknown>
      ? InferConfigType<S[K]>
      : never;
};

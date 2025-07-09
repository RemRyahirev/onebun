import { Effect } from 'effect';

/**
 * Environment variable value types
 */
export type EnvValueType = 'string' | 'number' | 'boolean' | 'array';

/**
 * Configuration for environment variable
 */
export interface EnvVariableConfig<T = any> {
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
 */
export type EnvSchema<T> = {
  [K in keyof T]: T[K] extends string | number | boolean | string[] | number[] | boolean[]
    ? EnvVariableConfig<T[K]>
    : T[K] extends Record<string, any>
      ? EnvSchema<T[K]>
      : EnvVariableConfig<T[K]>;
};

/**
 * Environment variable validation error
 */
export class EnvValidationError extends Error {
  constructor(
    public readonly variable: string,
    public readonly value: any,
    public readonly reason: string,
  ) {
    super(`Environment variable validation failed for "${variable}": ${reason}. Got: ${value}`);
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
}

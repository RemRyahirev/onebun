import { type } from 'arktype';

import type { Type } from 'arktype';

/**
 * Create a schema for a string parameter
 */
export function stringSchema(): Type<string> {
  return type('string');
}

/**
 * Create a schema for a number parameter
 */
export function numberSchema(): Type<number> {
  return type('number');
}

/**
 * Create a schema for a boolean parameter
 */
export function booleanSchema(): Type<boolean> {
  return type('boolean');
}

/**
 * Create a schema for an optional parameter
 */
export function optionalSchema<T>(schema: Type<T>): Type<T | undefined> {
  return schema.or(type('undefined')) as unknown as Type<T | undefined>;
}

/**
 * Create a schema for an array
 */
export function arraySchema<T>(itemSchema: Type<T>): Type<T[]> {
  return itemSchema.array() as Type<T[]>;
}

/**
 * Re-export type from arktype for convenience
 */
export { type };

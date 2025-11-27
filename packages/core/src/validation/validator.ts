import { type } from 'arktype';

import type { ValidationResult } from './types';
import type { Type } from 'arktype';

/**
 * Validate data against an arktype schema
 */
export function validate<T = unknown>(
  schema: Type<T>,
  data: unknown,
): ValidationResult<T> {
  const result = schema(data);

  if (result instanceof type.errors) {
    return {
      success: false,
      errors: [result.summary],
    };
  }

  return {
    success: true,
    data: result as T,
  };
}

/**
 * Validate data and throw error if validation fails
 */
export function validateOrThrow<T = unknown>(schema: Type<T>, data: unknown): T {
  const result = validate(schema, data);

  if (!result.success) {
    const error = new Error(`Validation failed: ${result.errors?.join(', ')}`);
    (error as Error & { validationErrors: string[] }).validationErrors =
      result.errors || [];
    throw error;
  }

  return result.data as T;
}

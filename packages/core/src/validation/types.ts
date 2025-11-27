import type { Type } from 'arktype';

/**
 * ArkType schema for validation
 */
export type ValidationSchema = Type;

/**
 * Validation result
 */
export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

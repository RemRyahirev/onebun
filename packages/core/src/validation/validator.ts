import type { ValidationResult } from './types';
import type { Type } from 'arktype';

import {
  arkErrorsSummary,
  DuplicateArkTypeError,
  isArkErrors,
  isUnrecognisedArkResult,
  reportDuplicateArkTypeCopies,
} from './arktype-interop';

/**
 * Validate data against an arktype schema.
 *
 * Failure detection is copy-independent (see {@link isArkErrors}): a schema built by a second
 * physical copy of `arktype` still reports its failures correctly.
 *
 * @throws {DuplicateArkTypeError} when the schema returns an ArkType internal this version cannot
 * identify as a failure — that value is never passed through as validated data.
 *
 * @see docs:api/validation.md
 */
export function validate<T = unknown>(
  schema: Type<T>,
  data: unknown,
): ValidationResult<T> {
  const result = schema(data);

  if (isArkErrors(result)) {
    return {
      success: false,
      errors: [arkErrorsSummary(result)],
    };
  }

  if (isUnrecognisedArkResult(result)) {
    reportDuplicateArkTypeCopies();
    throw new DuplicateArkTypeError();
  }

  return {
    success: true,
    data: result as T,
  };
}

/**
 * Validate data and throw error if validation fails
 *
 * @see docs:api/validation.md
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

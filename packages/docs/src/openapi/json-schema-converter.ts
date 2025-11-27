import type { Type } from 'arktype';

import { getJsonSchema } from '@onebun/core';

/**
 * Convert arktype schema to OpenAPI JSON Schema
 */
export function arktypeToJsonSchema(schema: Type<unknown>): Record<string, unknown> {
  return getJsonSchema(schema);
}

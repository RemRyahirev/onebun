import type { Type } from 'arktype';

/**
 * Convert arktype schema to JSON Schema
 * This is used for generating OpenAPI/Swagger documentation
 */
export function toJsonSchema(schema: Type): Record<string, unknown> {
  // Use arktype's built-in toJsonSchema method
  const jsonSchema = schema.toJsonSchema();

  return jsonSchema as Record<string, unknown>;
}

/**
 * Get JSON Schema for a schema (with fallback for unsupported types)
 */
export function getJsonSchema(
  schema: Type,
  options?: {
    fallback?: (ctx: { base: Record<string, unknown> }) => Record<string, unknown>;
  },
): Record<string, unknown> {
  try {
    return toJsonSchema(schema);
  } catch {
    // If schema doesn't support JSON Schema conversion, use fallback
    if (options?.fallback) {
      return options.fallback({ base: { type: 'object' } });
    }

    // Default fallback: return a generic object schema
    return {
      type: 'object',
      description: 'Schema validation is available but JSON Schema is not generated',
    };
  }
}

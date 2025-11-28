import type { EnvOverrides, EnvOverrideValue } from './multi-service.types';

import {
  type EnvLoadOptions,
  type EnvSchema,
  TypedEnv,
} from '@onebun/envs';

/**
 * Build schema for reading referenced ENV variables.
 * Extracts all `fromEnv` references and creates a schema to read them.
 */
function buildReferencedEnvSchema(
  overrides: EnvOverrides,
): EnvSchema<Record<string, string>> {
  const schema: EnvSchema<Record<string, string>> = {};

  for (const override of Object.values(overrides)) {
    if ('fromEnv' in override) {
      schema[override.fromEnv] = {
        type: 'string',
        required: false,
      };
    }
  }

  return schema;
}

/**
 * Type guard to check if override has fromEnv
 */
function isFromEnvOverride(
  override: EnvOverrideValue,
): override is { fromEnv: string } {
  return 'fromEnv' in override;
}

/**
 * Type guard to check if override has literal value
 */
function isValueOverride(
  override: EnvOverrideValue,
): override is { value: string | number | boolean } {
  return 'value' in override;
}

/**
 * Resolve EnvOverrides to final values.
 * Uses \@onebun/envs to read referenced variables.
 *
 * @param overrides - Map of ENV variable names to override values
 * @param baseEnvOptions - Options for loading ENV variables (used when reading fromEnv references)
 * @returns Resolved map of ENV variable names to their final string/number/boolean values
 *
 * @example
 * ```typescript
 * const overrides = {
 *   DB_NAME: { value: 'users_db' },
 *   DB_HOST: { fromEnv: 'USERS_DB_HOST' },
 * };
 *
 * const resolved = await resolveEnvOverrides(overrides);
 * // { DB_NAME: 'users_db', DB_HOST: 'localhost' } (assuming USERS_DB_HOST=localhost)
 * ```
 */
export async function resolveEnvOverrides(
  overrides: EnvOverrides,
  baseEnvOptions?: EnvLoadOptions,
): Promise<Record<string, string | number | boolean>> {
  const resolved: Record<string, string | number | boolean> = {};

  // Build schema for all fromEnv references
  const referencedSchema = buildReferencedEnvSchema(overrides);

  // Read referenced variables using TypedEnv (only if there are any fromEnv references)
  let referencedValues: Record<string, string | undefined> = {};
  if (Object.keys(referencedSchema).length > 0) {
    // Generate unique key to avoid conflicts with other TypedEnv instances
    // eslint-disable-next-line no-magic-numbers -- Base 36 for alphanumeric random string
    const uniqueKey = `env-resolver-refs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const envConfig = await TypedEnv.createAsync(
      referencedSchema,
      baseEnvOptions,
      uniqueKey,
    );
    referencedValues = envConfig.values as Record<string, string | undefined>;
  }

  // Resolve each override
  for (const [key, override] of Object.entries(overrides)) {
    if (isFromEnvOverride(override)) {
      const refValue = referencedValues[override.fromEnv];
      if (refValue !== undefined) {
        resolved[key] = refValue;
      }
      // If referenced variable is not set, we skip it (don't add to resolved)
    } else if (isValueOverride(override)) {
      resolved[key] = override.value;
    }
  }

  return resolved;
}

/**
 * Synchronously resolve EnvOverrides that only contain literal values.
 * Throws if any fromEnv references are found.
 *
 * @param overrides - Map of ENV variable names to override values (must be literal values only)
 * @returns Resolved map of ENV variable names to their final values
 */
export function resolveEnvOverridesSync(
  overrides: EnvOverrides,
): Record<string, string | number | boolean> {
  const resolved: Record<string, string | number | boolean> = {};

  for (const [key, override] of Object.entries(overrides)) {
    if (isFromEnvOverride(override)) {
      throw new Error(
        'Cannot resolve fromEnv reference synchronously. ' +
        `Use resolveEnvOverrides() instead for key "${key}" with fromEnv: "${override.fromEnv}"`,
      );
    } else if (isValueOverride(override)) {
      resolved[key] = override.value;
    }
  }

  return resolved;
}

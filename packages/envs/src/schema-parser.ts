import { Effect } from 'effect';

import { EnvParser } from './parser';
import {
  type EnvLoadOptions,
  type EnvVariableConfig,
  EnvValidationError,
} from './types';

/**
 * Check if a config entry is a leaf EnvVariableConfig (has a 'type' property)
 */
export function isEnvVariableConfig(config: unknown): boolean {
  return Boolean(config) && typeof config === 'object' && 'type' in config!;
}

/**
 * Convert a dot-notation path to an environment variable name.
 * e.g. "server.port" -> "SERVER_PORT"
 */
export function pathToEnvVar(path: string): string {
  return path.toUpperCase().replace(/\./g, '_');
}

/**
 * Recursively parse a nested env schema against raw environment variables.
 * Returns a plain object with parsed and validated values.
 */
export function parseSchema(
  schema: Record<string, unknown>,
  rawVariables: Record<string, string>,
  prefix: string,
  options: EnvLoadOptions = {},
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {};

  for (const [key, config] of Object.entries(schema)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (isEnvVariableConfig(config)) {
      const envConfig = config as EnvVariableConfig;
      const envVar = envConfig.env || pathToEnvVar(fullPath);
      const rawValue = rawVariables[envVar];

      try {
        const parsed = Effect.runSync(
          EnvParser.parse(
            envVar,
            rawValue,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            envConfig as any,
            options,
          ),
        );
        result[key] = parsed;
      } catch (error) {
        if (error instanceof EnvValidationError) {
          throw error;
        }
        throw new EnvValidationError(envVar, rawValue, String(error));
      }
    } else {
      result[key] = parseSchema(config as Record<string, unknown>, rawVariables, fullPath, options);
    }
  }

  return result;
}

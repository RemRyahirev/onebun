import {
  Cause,
  Effect,
  Exit,
} from 'effect';

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

      // runSyncExit rather than runSync: runSync throws a FiberFailure, which is not an
      // EnvValidationError, so the old catch re-wrapped it and produced the whole message twice.
      const exit = Effect.runSyncExit(
        EnvParser.parse(
          envVar,
          rawValue,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          envConfig as any,
          options,
        ),
      );

      if (Exit.isSuccess(exit)) {
        result[key] = exit.value;
      } else {
        // squash covers both channels: a validation failure and a defect thrown by user code.
        const failure = Cause.squash(exit.cause);

        if (failure instanceof EnvValidationError) {
          throw failure;
        }

        throw new EnvValidationError(
          envVar,
          rawValue,
          failure instanceof Error ? failure.message : String(failure),
        );
      }
    } else {
      result[key] = parseSchema(config as Record<string, unknown>, rawVariables, fullPath, options);
    }
  }

  return result;
}

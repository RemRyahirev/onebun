import { Effect } from 'effect';

import {
  type EnvLoadOptions,
  EnvValidationError,
  type EnvValueType,
  type EnvVariableConfig,
} from './types';

/**
 * Environment variable parser
 */
export class EnvParser {
  /**
   * Parse string value according to configuration
   */
  static parse<T>(
    variable: string,
    value: string | undefined,
    config: EnvVariableConfig<T>,
    options: EnvLoadOptions = {},
  ): Effect.Effect<T, EnvValidationError> {
    const resolveValue = Effect.suspend((): Effect.Effect<unknown, EnvValidationError> => {
      // `VAR=` means "not configured", exactly like an unset variable: a compose file with a
      // blank value, a ConfigMap key with no value, a CI variable that was never populated.
      // Whitespace is not empty — `VAR=" "` is something an operator typed on purpose.
      if (value === undefined || value === '') {
        if (config.default !== undefined) {
          return Effect.succeed(config.default);
        }
        if (config.required) {
          // Name which of the two happened: an operator whose compose file blanked a value
          // cannot tell that apart from a variable nobody ever declared.
          return Effect.fail(
            new EnvValidationError(
              variable,
              value,
              value === undefined
                ? 'Required variable is not set'
                : 'Required variable is set to an empty string',
            ),
          );
        }

        return Effect.succeed(EnvParser.getDefaultForTypeSync(config.type));
      }

      return Effect.succeed(value);
    });

    const parseValue = (resolvedValue: unknown) => {
      if (typeof resolvedValue === 'string') {
        const separator = config.separator || options.defaultArraySeparator || ',';

        return EnvParser.parseByType(variable, resolvedValue, config.type, separator);
      }

      return Effect.succeed(resolvedValue);
    };

    const validateParsed = (parsed: unknown) =>
      EnvParser.validateValue(variable, parsed as T, config);

    return resolveValue.pipe(Effect.flatMap(parseValue), Effect.flatMap(validateParsed));
  }

  /**
   * Parse value by type
   */
  private static parseByType(
    variable: string,
    value: string,
    type: EnvValueType,
    separator = ',',
  ): Effect.Effect<unknown, EnvValidationError> {
    return Effect.try({
      try() {
        switch (type) {
          case 'string':
            return value;

          case 'number': {
            // A blank value never reaches here (parse() treats it as "not configured"), but a
            // whitespace-only one does — and Number('  ') is 0, which would be a silent lie.
            if (value.trim() === '') {
              throw new Error('Value is not a valid number');
            }

            const num = Number(value);
            if (isNaN(num)) {
              throw new Error('Value is not a valid number');
            }

            return num;
          }

          case 'boolean': {
            const lower = value.toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(lower)) {
              return true;
            }
            if (['false', '0', 'no', 'off'].includes(lower)) {
              return false;
            }
            throw new Error('Value is not a valid boolean');
          }

          case 'array': {
            if (value.trim() === '') {
              return [];
            }

            return value.split(separator).map((item) => item.trim());
          }

          default:
            throw new Error(`Unknown type: ${type}`);
        }
      },
      catch: (error) =>
        new EnvValidationError(
          variable,
          value,
          error instanceof Error ? error.message : String(error),
        ),
    });
  }

  /**
   * Validate value
   */
  private static validateValue<T>(
    variable: string,
    value: T,
    config: EnvVariableConfig<T>,
  ): Effect.Effect<T, EnvValidationError> {
    if (config.validate) {
      return config.validate(value);
    }

    return Effect.succeed(value);
  }

  /**
   * Get default value for type (sync)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static getDefaultForTypeSync(type: EnvValueType): any {
    switch (type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      default:
        throw new EnvValidationError('unknown', undefined, `Unknown type: ${type}`);
    }
  }
}

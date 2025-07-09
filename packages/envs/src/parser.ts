import { Effect } from 'effect';

import {
  EnvValidationError,
  EnvValueType,
  EnvVariableConfig,
  EnvLoadOptions,
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
    const resolveValue = Effect.sync(() => {
      // If value is not set
      if (value === undefined) {
        if (config.default !== undefined) {
          return config.default;
        }
        if (config.required) {
          throw new EnvValidationError(variable, value, 'Required variable is not set');
        }

        return EnvParser.getDefaultForTypeSync(config.type);
      }

      return value;
    });

    const parseValue = (resolvedValue: any) => {
      if (typeof resolvedValue === 'string') {
        const separator = config.separator || options.defaultArraySeparator || ',';

        return EnvParser.parseByType(variable, resolvedValue, config.type, separator);
      }

      return Effect.succeed(resolvedValue);
    };

    const validateParsed = (parsed: any) => EnvParser.validateValue(variable, parsed as T, config);

    return resolveValue.pipe(
      Effect.flatMap(parseValue),
      Effect.flatMap(validateParsed),
    );
  }

  /**
   * Parse value by type
   */
  private static parseByType(
    variable: string,
    value: string,
    type: EnvValueType,
    separator = ',',
  ): Effect.Effect<any, EnvValidationError> {
    return Effect.try({
      try() {
        switch (type) {
          case 'string':
            return value;
          
          case 'number': {
            const num = Number(value);
            if (isNaN(num)) {
              throw new Error(`"${value}" is not a valid number`);
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
            throw new Error(`"${value}" is not a valid boolean`);
          }
          
          case 'array': {
            if (value.trim() === '') {
              return [];
            }

            return value.split(separator).map(item => item.trim());
          }
          
          default:
            throw new Error(`Unknown type: ${type}`);
        }
      },
      catch: (error) =>
        new EnvValidationError(variable, value, error instanceof Error ? error.message : String(error)),
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

  /**
   * Get default value for type
   */
  private static getDefaultForType(type: EnvValueType): Effect.Effect<any, EnvValidationError> {
    switch (type) {
      case 'string':
        return Effect.succeed('');
      case 'number':
        return Effect.succeed(0);
      case 'boolean':
        return Effect.succeed(false);
      case 'array':
        return Effect.succeed([]);
      default:
        return Effect.fail(new EnvValidationError('unknown', undefined, `Unknown type: ${type}`));
    }
  }
} 
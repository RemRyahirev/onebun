import { Effect } from 'effect';

import { EnvVariableConfig, EnvValidationError } from './types';

/**
 * Helpers for creating environment variable configurations
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Env = {
  /**
   * Create configuration for string variable
   */
  string(options: {
    env?: string;
    description?: string;
    default?: string;
    required?: boolean;
    sensitive?: boolean;
    separator?: string;
    validate?: (value: string) => Effect.Effect<string, EnvValidationError>;
  } = {}): EnvVariableConfig<string> {
    return {
      type: 'string',
      separator: ',',
      ...options,
    };
  },

  /**
   * Create configuration for number variable
   */
  number(options: {
    env?: string;
    description?: string;
    default?: number;
    required?: boolean;
    sensitive?: boolean;
    min?: number;
    max?: number;
    validate?: (value: number) => Effect.Effect<number, EnvValidationError>;
  } = {}): EnvVariableConfig<number> {
    let validator = options.validate;

    // Add range validation if specified
    if (options.min !== undefined || options.max !== undefined) {
      const rangeValidator = (value: number) => {
        if (options.min !== undefined && value < options.min) {
          return Effect.fail(new EnvValidationError('', value, `Value must be >= ${options.min}`));
        }
        if (options.max !== undefined && value > options.max) {
          return Effect.fail(new EnvValidationError('', value, `Value must be <= ${options.max}`));
        }

        return Effect.succeed(value);
      };

      if (validator) {
        const originalValidator = validator;
        validator = (value: number) => 
          rangeValidator(value).pipe(
            Effect.flatMap(originalValidator),
          );
      } else {
        validator = rangeValidator;
      }
    }

    return {
      type: 'number',
      description: options.description,
      default: options.default,
      required: options.required,
      sensitive: options.sensitive,
      env: options.env,
      validate: validator,
    };
  },

  /**
    * Create configuration for boolean variable
    */
  boolean(options: {
    env?: string;
    description?: string;
    default?: boolean;
    required?: boolean;
    sensitive?: boolean;
    validate?: (value: boolean) => Effect.Effect<boolean, EnvValidationError>;
  } = {}): EnvVariableConfig<boolean> {
    return {
      type: 'boolean',
      ...options,
    };
  },

  /**
    * Create configuration for string array variable
    */
  array(options: {
    env?: string;
    description?: string;
    default?: string[];
    required?: boolean;
    sensitive?: boolean;
    separator?: string;
    minLength?: number;
    maxLength?: number;
    validate?: (value: string[]) => Effect.Effect<string[], EnvValidationError>;
  } = {}): EnvVariableConfig<string[]> {
    let validator = options.validate;

    // Add length validation if specified
    if (options.minLength !== undefined || options.maxLength !== undefined) {
      const lengthValidator = (value: string[]) => {
        if (options.minLength !== undefined && value.length < options.minLength) {
          return Effect.fail(new EnvValidationError('', value, `Array must have at least ${options.minLength} items`));
        }
        if (options.maxLength !== undefined && value.length > options.maxLength) {
          return Effect.fail(new EnvValidationError('', value, `Array must have at most ${options.maxLength} items`));
        }

        return Effect.succeed(value);
      };

      if (validator) {
        const originalValidator = validator;
        validator = (value: string[]) => 
          lengthValidator(value).pipe(
            Effect.flatMap(originalValidator),
          );
      } else {
        validator = lengthValidator;
      }
    }

    return {
      type: 'array',
      description: options.description,
      default: options.default,
      required: options.required,
      sensitive: options.sensitive,
      env: options.env,
      separator: options.separator || ',',
      validate: validator,
    };
  },

  /**
    * Create validator for string with regular expression
    */
  regex(pattern: RegExp, errorMessage?: string): (value: string) => Effect.Effect<string, EnvValidationError> {
    return (value: string) => {
      if (!pattern.test(value)) {
        return Effect.fail(new EnvValidationError('', value, errorMessage || `Value must match pattern ${pattern}`));
      }

      return Effect.succeed(value);
    };
  },

  /**
    * Create validator for string from allowed values list
    */
  oneOf<T extends string>(
    allowedValues: readonly T[], 
    errorMessage?: string,
  ): (value: string) => Effect.Effect<T, EnvValidationError> {
    return (value: string) => {
      if (!allowedValues.includes(value as T)) {
        return Effect.fail(new EnvValidationError(
          '', 
          value, 
          errorMessage || `Value must be one of: ${allowedValues.join(', ')}`,
        ));
      }

      return Effect.succeed(value as T);
    };
  },

  /**
    * Create validator for URL
    */
  url(errorMessage?: string): (value: string) => Effect.Effect<string, EnvValidationError> {
    return (value: string) => {
      try {
        const url = new URL(value);
        
        // Reject potentially dangerous schemes
        const dangerousSchemes = ['javascript', 'data', 'vbscript'];
        if (dangerousSchemes.includes(url.protocol.slice(0, -1))) {
          throw new Error('Dangerous URL scheme');
        }

        return Effect.succeed(value);
      } catch {
        return Effect.fail(new EnvValidationError(
          '', 
          value, 
          errorMessage || 'Value must be a valid URL',
        ));
      }
    };
  },

  /**
    * Create validator for email
    */
  email(errorMessage?: string): (value: string) => Effect.Effect<string, EnvValidationError> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return (value: string) => {
      if (!emailRegex.test(value)) {
        return Effect.fail(new EnvValidationError(
          '', 
          value, 
          errorMessage || 'Value must be a valid email address',
        ));
      }

      return Effect.succeed(value);
    };
  },

  /**
    * Create validator for port number
    */
  port(errorMessage?: string): (value: number) => Effect.Effect<number, EnvValidationError> {
    return (value: number) => {
      // eslint-disable-next-line no-magic-numbers
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        return Effect.fail(new EnvValidationError(
          '', 
          value, 
          errorMessage || 'Port must be an integer between 1 and 65535',
        ));
      }

      return Effect.succeed(value);
    };
  },
}; 

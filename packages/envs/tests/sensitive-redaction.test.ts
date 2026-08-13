/**
 * A rejected environment value is never echoed back.
 *
 * `EnvValidationError` is the single choke point: it stores and prints a description of the
 * offending value ("a string of length 21"), never the value itself. That holds for every
 * construction site — the type parser, the built-in validators, the schema re-wrap — so a
 * `sensitive: true` secret cannot reach a log through the framework's own startup error.
 *
 * @source docs:api/envs.md#rejected-values-are-never-echoed
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import { getConfig, clearGetConfigCache } from '../src/get-config';
import { Env } from '../src/helpers';
import { parseSchema } from '../src/schema-parser';
import { type EnvSchema, EnvValidationError } from '../src/types';

const SECRET = 'super-secret-p@ssw0rd';

/**
 * Everything a structured logger can reach on an error instance: the message, the stack
 * (which embeds the message) and every own property, enumerable or not.
 */
function serializableSurface(error: Error): string {
  return [
    error.message,
    String(error),
    error.stack ?? '',
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
    Bun.inspect(error),
  ].join('\n');
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('EnvValidationError never retains the rejected value', () => {
  it('describes a string by its length instead of printing it', () => {
    const error = new EnvValidationError('DATABASE_PASSWORD', SECRET, 'Value is not a valid number');

    expect(occurrences(error.message, SECRET)).toBe(0);
    expect(error.value).toBe(`a string of length ${SECRET.length}`);
    expect(error.message).toBe(
      'Environment variable validation failed for "DATABASE_PASSWORD":'
      + ` Value is not a valid number. Got: a string of length ${SECRET.length}`,
    );
  });

  it('leaks nothing through any serialization a logger might use', () => {
    const error = new EnvValidationError('DATABASE_PASSWORD', SECRET, 'Value is not a valid number');

    expect(occurrences(serializableSurface(error), SECRET)).toBe(0);
  });

  it('describes the other value shapes without their content', () => {
    expect(new EnvValidationError('V', undefined, 'r').value).toBe('not set');
    expect(new EnvValidationError('V', null, 'r').value).toBe('null');
    expect(new EnvValidationError('V', '', 'r').value).toBe('an empty string');
    expect(new EnvValidationError('V', 65535, 'r').value).toBe('a number');
    expect(new EnvValidationError('V', true, 'r').value).toBe('a boolean');
    expect(new EnvValidationError('V', ['a', 'b'], 'r').value).toBe('an array of length 2');
    expect(new EnvValidationError('V', { k: 'v' }, 'r').value).toBe('an object');
  });

  it('does not leak a secret carried inside an object or an array', () => {
    const fromArray = new EnvValidationError('V', [SECRET], 'r');
    const fromObject = new EnvValidationError('V', { password: SECRET }, 'r');

    expect(occurrences(serializableSurface(fromArray), SECRET)).toBe(0);
    expect(occurrences(serializableSurface(fromObject), SECRET)).toBe(0);
  });

  it('stays actionable: the variable name and the reason survive', () => {
    const error = new EnvValidationError('DATABASE_PASSWORD', SECRET, 'Value is not a valid number');

    expect(error.message).toContain('DATABASE_PASSWORD');
    expect(error.message).toContain('is not a valid number');
    expect(error.variable).toBe('DATABASE_PASSWORD');
    expect(error.reason).toBe('Value is not a valid number');
  });
});

describe('the type parser reports the reason without the value', () => {
  it('rejects a non-numeric secret without quoting it', () => {
    const schema = {
      database: {
        password: Env.number({ required: true, sensitive: true, env: 'DATABASE_PASSWORD' }),
      },
    };

    let thrown: Error | undefined;
    try {
      parseSchema(schema, { DATABASE_PASSWORD: SECRET }, '');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect(occurrences(serializableSurface(thrown!), SECRET)).toBe(0);
    expect(thrown!.message).toContain('DATABASE_PASSWORD');
    expect(thrown!.message).toContain('is not a valid number');
  });

  it('rejects a non-boolean secret without quoting it', () => {
    const schema = {
      feature: {
        flag: Env.boolean({ required: true, sensitive: true, env: 'FEATURE_FLAG' }),
      },
    };

    let thrown: Error | undefined;
    try {
      parseSchema(schema, { FEATURE_FLAG: SECRET }, '');
    } catch (error) {
      thrown = error as Error;
    }

    expect(occurrences(serializableSurface(thrown!), SECRET)).toBe(0);
    expect(thrown!.message).toContain('is not a valid boolean');
  });

  it('does not duplicate the failure into a second wrapped error', () => {
    const schema = {
      database: {
        password: Env.number({ required: true, sensitive: true, env: 'DATABASE_PASSWORD' }),
      },
    };

    let thrown: Error | undefined;
    try {
      parseSchema(schema, { DATABASE_PASSWORD: SECRET }, '');
    } catch (error) {
      thrown = error as Error;
    }

    // One error, one message — not an EnvValidationError wrapping a FiberFailure
    // wrapping another EnvValidationError.
    expect(occurrences(thrown!.message, 'Environment variable validation failed')).toBe(1);
    expect(thrown!.message).not.toContain('FiberFailure');
  });
});

describe('the built-in validators redact through the same choke point', () => {
  const cases: { name: string; schema: Record<string, unknown>; raw: Record<string, string> }[] = [
    {
      name: 'oneOf',
      schema: { mode: Env.string({ env: 'MODE', sensitive: true, validate: Env.oneOf(['a', 'b']) }) },
      raw: { MODE: SECRET },
    },
    {
      name: 'url',
      schema: { endpoint: Env.string({ env: 'ENDPOINT', sensitive: true, validate: Env.url() }) },
      raw: { ENDPOINT: SECRET },
    },
    {
      name: 'email',
      schema: { contact: Env.string({ env: 'CONTACT', sensitive: true, validate: Env.email() }) },
      raw: { CONTACT: SECRET },
    },
    {
      name: 'regex',
      schema: { token: Env.string({ env: 'TOKEN', sensitive: true, validate: Env.regex(/^\d+$/) }) },
      raw: { TOKEN: SECRET },
    },
  ];

  for (const { name, schema, raw } of cases) {
    it(`${name}: rejects without echoing the value`, () => {
      let thrown: Error | undefined;
      try {
        parseSchema(schema, raw, '');
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(EnvValidationError);
      expect(occurrences(serializableSurface(thrown!), SECRET)).toBe(0);
    });
  }

  it('port: rejects an out-of-range number without printing it', () => {
    const schema = { port: Env.number({ env: 'PORT_UNDER_TEST', validate: Env.port() }) };

    let thrown: Error | undefined;
    try {
      parseSchema(schema, { PORT_UNDER_TEST: '99999' }, '');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect(occurrences(serializableSurface(thrown!), '99999')).toBe(0);
    expect(thrown!.message).toContain('Port must be an integer between 1 and 65535');
  });
});

describe('the full config path used at startup', () => {
  it('fails without the secret reaching the error the application logs', () => {
    clearGetConfigCache();

    const envSchema: EnvSchema<{ database: { password: number } }> = {
      database: {
        password: Env.number({ required: true, sensitive: true, env: 'DATABASE_PASSWORD' }),
      },
    };

    let thrown: Error | undefined;
    try {
      getConfig(envSchema, {
        loadDotEnv: false,
        valueOverrides: { DATABASE_PASSWORD: SECRET },
      });
    } catch (error) {
      thrown = error as Error;
    }

    clearGetConfigCache();

    expect(thrown).toBeInstanceOf(EnvValidationError);
    // This is verbatim what `OneBunApplication` hands to `logger.error('Failed to start application:', …)`.
    expect(occurrences(serializableSurface(thrown!), SECRET)).toBe(0);
    expect(thrown!.message).toContain('DATABASE_PASSWORD');
  });
});

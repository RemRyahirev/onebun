/**
 * Empty-value semantics: `VAR=` means "not configured".
 *
 * An empty environment variable must take the declared `default` and must NOT satisfy
 * `required: true` — the shape produced by a docker-compose `env_file` with a blank value,
 * a ConfigMap key with no value, or a CI variable that was defined but never populated.
 *
 * @source docs:api/envs.md#empty-values
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';
import {
  Cause,
  Effect,
  Exit,
} from 'effect';

import { EnvParser } from '../src/parser';
import {
  EnvValidationError,
  type EnvValueType,
  type EnvVariableConfig,
} from '../src/types';

type Attempt =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };

/**
 * Run a parse and surface the real error, whether it arrived as a failure or as a defect.
 */
function attempt(
  variable: string,
  raw: string | undefined,
  config: EnvVariableConfig<unknown>,
): Attempt {
  const exit = Effect.runSyncExit(EnvParser.parse(variable, raw, config));

  if (Exit.isSuccess(exit)) {
    return { ok: true, value: exit.value };
  }

  return { ok: false, error: Cause.squash(exit.cause) };
}

const DEFAULTS: Record<EnvValueType, unknown> = {
  string: 'localhost',
  number: 5432,
  boolean: true,
  array: ['a'],
};

const ZEROES: Record<EnvValueType, unknown> = {
  string: '',
  number: 0,
  boolean: false,
  array: [],
};

const TYPES: EnvValueType[] = ['string', 'number', 'boolean', 'array'];

describe('empty environment variables mean "not configured"', () => {
  // `''` and `undefined` must behave identically — that is the whole point of the item.
  const notConfigured: { label: string; raw: string | undefined }[] = [
    { label: 'empty (VAR=)', raw: '' },
    { label: 'unset', raw: undefined },
  ];

  for (const { label, raw } of notConfigured) {
    describe(label, () => {
      for (const type of TYPES) {
        it(`${type}: the declared default applies`, () => {
          const result = attempt('DB_VAR', raw, { type, default: DEFAULTS[type] });

          expect(result.ok).toBe(true);
          expect((result as { value: unknown }).value).toEqual(DEFAULTS[type]);
        });

        it(`${type}: required: true is NOT satisfied`, () => {
          const result = attempt('DB_VAR', raw, { type, required: true });

          expect(result.ok).toBe(false);
          expect((result as { error: unknown }).error).toBeInstanceOf(EnvValidationError);
        });

        it(`${type}: a default outranks required: true`, () => {
          const result = attempt('DB_VAR', raw, { type, required: true, default: DEFAULTS[type] });

          expect(result.ok).toBe(true);
          expect((result as { value: unknown }).value).toEqual(DEFAULTS[type]);
        });

        it(`${type}: with neither default nor required, the type's zero value is used`, () => {
          const result = attempt('DB_VAR', raw, { type });

          expect(result.ok).toBe(true);
          expect((result as { value: unknown }).value).toEqual(ZEROES[type]);
        });
      }
    });
  }

  describe('whitespace-only values are real values, not "not configured"', () => {
    it('string: keeps the whitespace instead of taking the default', () => {
      const result = attempt('DB_VAR', '   ', { type: 'string', default: 'localhost' });

      expect(result.ok).toBe(true);
      expect((result as { value: unknown }).value).toBe('   ');
    });

    it('number: is rejected instead of taking the default', () => {
      const result = attempt('DB_VAR', '   ', { type: 'number', default: 5432 });

      expect(result.ok).toBe(false);
      expect((result as { error: Error }).error.message).toContain('is not a valid number');
    });

    it('boolean: is rejected instead of taking the default', () => {
      const result = attempt('DB_VAR', '   ', { type: 'boolean', default: true });

      expect(result.ok).toBe(false);
      expect((result as { error: Error }).error.message).toContain('is not a valid boolean');
    });

    it('array: collapses to an empty array, as it always has', () => {
      const result = attempt('DB_VAR', '   ', { type: 'array', default: ['a'] });

      expect(result.ok).toBe(true);
      expect((result as { value: unknown }).value).toEqual([]);
    });
  });
});

describe('the required-variable error distinguishes empty from unset', () => {
  it('names the variable and says it is not set', () => {
    const result = attempt('DB_HOST', undefined, { type: 'string', required: true });

    expect(result.ok).toBe(false);
    expect((result as { error: Error }).error.message).toBe(
      'Environment variable validation failed for "DB_HOST": Required variable is not set. Got: not set',
    );
  });

  it('names the variable and says it is set to an empty string', () => {
    const result = attempt('DB_HOST', '', { type: 'string', required: true });

    expect(result.ok).toBe(false);
    expect((result as { error: Error }).error.message).toBe(
      'Environment variable validation failed for "DB_HOST": Required variable is set to an empty string.'
      + ' Got: an empty string',
    );
  });

  it('reports the same distinction for a number variable', () => {
    const unset = attempt('DB_PORT', undefined, { type: 'number', required: true });
    const blanked = attempt('DB_PORT', '', { type: 'number', required: true });

    expect((unset as { error: Error }).error.message).toContain('Required variable is not set');
    expect((blanked as { error: Error }).error.message).toContain(
      'Required variable is set to an empty string',
    );
  });
});

import { type } from 'arktype';
import {
  describe,
  test,
  expect,
  afterEach,
} from 'bun:test';

import {
  arkErrorsSummary,
  arkKindOf,
  detectArkTypeRegistries,
  DuplicateArkTypeError,
  duplicateArkTypeMessage,
  hasDuplicateArkTypeCopies,
  isArkErrors,
  isUnrecognisedArkResult,
  reportDuplicateArkTypeCopies,
  resetDuplicateArkTypeDiagnostic,
} from './arktype-interop';

const ARK_KIND_KEY = ' arkKind';

/**
 * Faithful stand-in for an `ArkErrors` bag produced by a SECOND physical copy of arktype:
 * an Array subclass carrying the same ` arkKind: 'errors'` brand, `summary`, `byPath` and `count`
 * that `@ark/schema` puts on its own class — but a different class object, so it is NOT
 * `instanceof` core's `type.errors`. Verified against a real second arktype 2.2.0 install.
 */
class ForeignArkErrors extends Array<{ path: string[]; data: unknown; message: string }> {
  get summary(): string {
    return this.map((issue) => issue.message).join('\n');
  }
}

function makeForeignArkErrors(message: string, options?: { branded?: boolean }): unknown {
  const errors = new ForeignArkErrors();
  errors.push({ path: ['age'], data: 'thirty', message });

  Object.assign(errors, {
    byPath: { age: errors[0] },
    count: 1,
  });

  if (options?.branded !== false) {
    Object.assign(errors, { [ARK_KIND_KEY]: 'errors' });
  }

  return errors;
}

describe('ArkType interop (duplicate-copy safety)', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).$ark2;
    resetDuplicateArkTypeDiagnostic();
  });

  describe('arkKindOf', () => {
    test('should read the brand off core\'s own ArkErrors', () => {
      const errors = type('string')(123);
      expect(arkKindOf(errors)).toBe('errors');
    });

    test('should read the brand off a Type root', () => {
      expect(arkKindOf(type('string'))).toBe('root');
    });

    test('should return undefined for plain data', () => {
      expect(arkKindOf({ name: 'John' })).toBeUndefined();
      expect(arkKindOf('John')).toBeUndefined();
      expect(arkKindOf(null)).toBeUndefined();
      expect(arkKindOf(undefined)).toBeUndefined();
    });
  });

  describe('isArkErrors', () => {
    test('should recognise ArkErrors from core\'s own copy', () => {
      expect(isArkErrors(type('string')(123))).toBe(true);
    });

    test('should recognise ArkErrors from a foreign copy that is not instanceof type.errors', () => {
      const foreign = makeForeignArkErrors('age must be a number (was a string)');

      expect(foreign instanceof type.errors).toBe(false);
      expect(isArkErrors(foreign)).toBe(true);
    });

    test('should not treat valid data as errors', () => {
      expect(isArkErrors({ name: 'John', age: 30 })).toBe(false);
      expect(isArkErrors([1, 2, 3])).toBe(false);
      expect(isArkErrors('John')).toBe(false);
    });
  });

  describe('isUnrecognisedArkResult', () => {
    test('should flag an unbranded ArkErrors bag', () => {
      const unbranded = makeForeignArkErrors('boom', { branded: false });

      expect(isArkErrors(unbranded)).toBe(false);
      expect(isUnrecognisedArkResult(unbranded)).toBe(true);
    });

    test('should flag a single leaked ArkError', () => {
      const leaked = { [ARK_KIND_KEY]: 'error', message: 'boom' };

      expect(isUnrecognisedArkResult(leaked)).toBe(true);
    });

    test('should not flag plain data', () => {
      expect(isUnrecognisedArkResult({ name: 'John' })).toBe(false);
      expect(isUnrecognisedArkResult([1, 2, 3])).toBe(false);
      expect(isUnrecognisedArkResult(['a'])).toBe(false);
    });

    test('should not flag a Type root, which is legitimate data for type("unknown")', () => {
      expect(isUnrecognisedArkResult(type('string'))).toBe(false);
    });
  });

  describe('arkErrorsSummary', () => {
    test('should read the summary of core\'s own ArkErrors', () => {
      expect(arkErrorsSummary(type('string')(123))).toContain('must be a string');
    });

    test('should read the summary of a foreign ArkErrors', () => {
      const foreign = makeForeignArkErrors('age must be a number (was a string)');
      expect(arkErrorsSummary(foreign)).toBe('age must be a number (was a string)');
    });
  });

  describe('duplicate copy detection', () => {
    test('should see exactly one registry in a healthy single-copy install', () => {
      expect(detectArkTypeRegistries()).toEqual(['$ark']);
      expect(hasDuplicateArkTypeCopies()).toBe(false);
    });

    test('should see a second registry when a second copy claims $ark2', () => {
      // Exactly what @ark/schema does: `while (name in globalThis) name = `$ark${suffix++}``
      (globalThis as unknown as Record<string, unknown>).$ark2 = { version: '0.56.0' };

      expect(detectArkTypeRegistries()).toEqual(['$ark', '$ark2']);
      expect(hasDuplicateArkTypeCopies()).toBe(true);
    });
  });

  describe('startup diagnostic', () => {
    test('should stay silent when a single copy is installed', () => {
      const seen: string[] = [];
      expect(reportDuplicateArkTypeCopies((message) => seen.push(message))).toBe(false);
      expect(seen).toEqual([]);
    });

    test('should emit exactly ONE diagnostic naming the duplicate-arktype cause', () => {
      (globalThis as unknown as Record<string, unknown>).$ark2 = { version: '0.56.0' };

      const seen: string[] = [];
      const sink = (message: string): number => seen.push(message);

      expect(reportDuplicateArkTypeCopies(sink)).toBe(true);
      expect(reportDuplicateArkTypeCopies(sink)).toBe(false);
      expect(reportDuplicateArkTypeCopies(sink)).toBe(false);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('Duplicate arktype installation detected');
      expect(seen[0]).toContain('$ark, $ark2');
      expect(seen[0]).toContain('resolutions');
    });
  });

  describe('DuplicateArkTypeError', () => {
    test('should name the duplicate-arktype cause and the remedy', () => {
      const error = new DuplicateArkTypeError(['$ark', '$ark2']);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('DuplicateArkTypeError');
      expect(error.registries).toEqual(['$ark', '$ark2']);
      expect(error.message).toContain('Duplicate arktype installation detected');
      expect(error.message).toContain('More than one physical copy of `arktype` is loaded');
      expect(error.message).toContain('Deduplicate arktype to a single copy');
      expect(error.message).toContain('Detected ArkType registries: $ark, $ark2.');
    });

    test('should share its wording with the startup diagnostic', () => {
      expect(new DuplicateArkTypeError(['$ark']).message).toBe(duplicateArkTypeMessage(['$ark']));
    });
  });
});

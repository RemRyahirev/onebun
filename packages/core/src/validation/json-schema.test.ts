import { type } from 'arktype';
import {
  describe,
  test,
  expect,
} from 'bun:test';

import {
  toJsonSchema,
  getJsonSchema,
  JSON_SCHEMA_PARTIAL,
  type JsonSchemaPartialMarker,
} from './json-schema';

/**
 * Every case below uses a real ArkType failure. The previous versions of the two
 * error-path tests monkey-patched `toJsonSchema` to throw a plain `Error`, which exercised
 * the catch block against a shape ArkType never produces — and so could not have noticed
 * that the thrown error carries no partially-built schema.
 */
const unrepresentable = {
  /** `Date` has no JSON Schema representation — the common case, not an exotic one. */
  date: type({ when: 'Date', name: 'string' }),
  /** `.narrow()` adds a predicate ArkType cannot express. */
  predicate: type({ name: 'string' }).narrow(() => true),
  /** `.pipe()` makes it a morph. */
  morph: type('string').pipe((s: string) => s.length),
  /** Two distinct codes in one schema. */
  mixed: type({ when: 'Date', tag: 'string' }).narrow(() => true),
};

function markerOf(schema: Record<string, unknown>): JsonSchemaPartialMarker | undefined {
  return schema[JSON_SCHEMA_PARTIAL] as JsonSchemaPartialMarker | undefined;
}

describe('JSON Schema Converter', () => {
  describe('toJsonSchema', () => {
    test('should convert simple string schema to JSON Schema', () => {
      const jsonSchema = toJsonSchema(type('string'));

      expect(jsonSchema.type).toBe('string');
    });

    test('should convert object schema to JSON Schema', () => {
      const jsonSchema = toJsonSchema(type({ name: 'string', age: 'number' }));

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
    });

    test('throws, rather than degrading, when the type is unrepresentable', () => {
      // The passthrough keeps ArkType's contract: the caller decides.
      expect(() => toJsonSchema(unrepresentable.date)).toThrow();
      expect(() => toJsonSchema(unrepresentable.predicate)).toThrow();
      expect(() => toJsonSchema(unrepresentable.morph)).toThrow();
    });

    test("forwards ArkType's options, which is what makes a lenient conversion reachable", () => {
      // The whole point of the option passthrough: this used to require bypassing the
      // package and calling the method on the Type instance.
      const jsonSchema = toJsonSchema(unrepresentable.date, {
        fallback: { date: (ctx) => ctx.base },
      });

      expect((jsonSchema.properties as Record<string, unknown>).name).toEqual({ type: 'string' });
    });
  });

  describe('getJsonSchema', () => {
    test('returns the schema unmarked when the conversion is complete', () => {
      const jsonSchema = getJsonSchema(type({ name: 'string', age: 'number' }));

      expect(jsonSchema.type).toBe('object');
      expect(markerOf(jsonSchema)).toBeUndefined();
      expect(JSON_SCHEMA_PARTIAL in jsonSchema).toBe(false);
    });

    test('keeps everything ArkType could convert instead of returning a bare stub', () => {
      // The defect: `{ when: 'Date', name: 'string' }` used to collapse to
      // `{ type: 'object', description: '…' }`, losing `name` entirely.
      const jsonSchema = getJsonSchema(unrepresentable.date);

      expect(jsonSchema.type).toBe('object');

      const properties = jsonSchema.properties as Record<string, unknown>;

      expect(properties.name).toEqual({ type: 'string' });
      expect(properties.when).toBeDefined();
      expect(jsonSchema.required).toEqual(['name', 'when']);
    });

    test('marks a partial conversion with the ArkType code responsible', () => {
      expect(markerOf(getJsonSchema(unrepresentable.date))?.codes).toEqual(['date']);
      expect(markerOf(getJsonSchema(unrepresentable.predicate))?.codes).toEqual(['predicate']);
      expect(markerOf(getJsonSchema(unrepresentable.morph))?.codes).toEqual(['morph']);
    });

    test('reports every distinct code, sorted and deduplicated', () => {
      const codes = markerOf(getJsonSchema(unrepresentable.mixed))?.codes;

      expect(codes).toEqual(['date', 'predicate']);
    });

    test('the marker is machine-readable, not a description a caller must string-match', () => {
      const jsonSchema = getJsonSchema(unrepresentable.date);

      expect(typeof jsonSchema[JSON_SCHEMA_PARTIAL]).toBe('object');
      expect(jsonSchema.description).toBeUndefined();
    });

    test("a caller's per-code fallback wins and suppresses the marker for that code", () => {
      const jsonSchema = getJsonSchema(unrepresentable.date, {
        fallback: { date: () => ({ type: 'string', format: 'date-time' }) },
      });

      const properties = jsonSchema.properties as Record<string, unknown>;

      expect(properties.when).toEqual({ type: 'string', format: 'date-time' });
      expect(markerOf(jsonSchema)).toBeUndefined();
    });

    test("a caller's fallback receives ArkType's real context, not a synthetic one", () => {
      // The old implementation always passed the literal `{ base: { type: 'object' } }`, so
      // a fallback could not preserve anything ArkType had already built.
      const seen: Array<Record<string, unknown>> = [];
      getJsonSchema(unrepresentable.mixed, {
        fallback: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          default(ctx: any) {
            seen.push({ code: ctx.code, hasBase: ctx.base !== undefined });

            return ctx.base;
          },
        },
      });

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(entry => entry.hasBase === true)).toBe(true);
      expect(seen.map(entry => entry.code)).toContain('date');
    });

    test('falls back to a marked stub when the conversion fails outright', () => {
      // A caller fallback that throws is the reachable way here: the per-code mechanism
      // cannot repair it, so the outer catch runs.
      const jsonSchema = getJsonSchema(unrepresentable.date, {
        fallback: {
          date() {
            throw new Error('fallback is buggy');
          },
        },
      });

      expect(jsonSchema.type).toBe('object');
      expect(markerOf(jsonSchema)?.codes.length).toBe(1);
    });

    test('should work with array schema', () => {
      const jsonSchema = getJsonSchema(type('string[]'));

      expect(jsonSchema.type).toBe('array');
      expect(markerOf(jsonSchema)).toBeUndefined();
    });
  });
});

import type { Type } from 'arktype';

/** ArkType's own `toJsonSchema` options, without depending on its internal type names. */
type ArkJsonSchemaOptions = Parameters<Type['toJsonSchema']>[0];

/**
 * Marks a schema that ArkType could not convert completely.
 *
 * A partial conversion is still a structurally valid JSON Schema, so nothing downstream can
 * tell it from a schema for a genuinely unconstrained value. This key is the difference —
 * machine-readable on purpose, because the previous marker was a free-text `description`
 * that callers had to string-match.
 *
 * @see docs:api/validation.md
 */
export const JSON_SCHEMA_PARTIAL = 'x-onebun-partial';

/**
 * The reason codes ArkType reported for the parts it could not represent.
 *
 * @see docs:api/validation.md
 */
export interface JsonSchemaPartialMarker {
  /** ArkType `ToJsonSchemaError` codes, e.g. `date`, `morph`, `predicate`. */
  codes: string[];
}

/**
 * Convert an ArkType schema to JSON Schema, forwarding ArkType's own options.
 *
 * A thin passthrough: it THROWS `ToJsonSchemaError` exactly as ArkType does when the type
 * contains something JSON Schema cannot express. Use it when you want to decide for
 * yourself; use `getJsonSchema` when you want a best-effort conversion.
 *
 * `options` is ArkType's own option bag — `fallback`, `dialect` and `target`. None of them
 * were reachable before, so a caller who wanted a lenient conversion had to bypass this
 * package and call the method on the `Type` instance.
 *
 * @see docs:api/validation.md
 */
export function toJsonSchema(
  schema: Type,
  options?: ArkJsonSchemaOptions,
): Record<string, unknown> {
  const jsonSchema = options === undefined
    ? schema.toJsonSchema()
    : schema.toJsonSchema(options);

  return jsonSchema as Record<string, unknown>;
}

/**
 * Convert an ArkType schema to JSON Schema, degrading rather than failing.
 *
 * ArkType refuses to convert a type containing anything JSON Schema cannot express — a
 * `Date`, a `.narrow()` predicate, a `.pipe()` morph, eleven codes in all. `Date` alone makes
 * this the common case rather than an edge one.
 *
 * Instead of catching that failure, this passes a fallback INTO the conversion, so ArkType
 * keeps everything it did manage to build and replaces only the unrepresentable node with an
 * empty schema. `{ when: 'Date', name: 'string' }` therefore yields
 * `{ type: 'object', properties: { name: { type: 'string' }, when: {} }, required: [...] }`
 * where it previously yielded `{ type: 'object' }` and nothing else.
 *
 * That distinction cannot be recovered after the fact: the thrown `ToJsonSchemaError` carries
 * the code but NOT the partially built schema, so a caught error can only produce a stub.
 *
 * A conversion that degraded carries {@link JSON_SCHEMA_PARTIAL} listing the ArkType codes
 * responsible, so a caller can detect it without string-matching a description. Nothing else
 * about the schema changes, and a schema that converts cleanly carries no marker at all.
 *
 * @param schema - The ArkType schema to convert.
 * @param options - `fallback` overrides the degradation per ArkType code and suppresses the
 *   marker for the codes it handles — it receives ArkType's real context, with the partially
 *   built schema in `base`. Other ArkType options are forwarded untouched.
 * @returns The JSON Schema, marked when it is partial.
 *
 * @see docs:api/validation.md
 */
export function getJsonSchema(
  schema: Type,
  options?: ArkJsonSchemaOptions,
): Record<string, unknown> {
  const degradedCodes: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userFallback = (options as any)?.fallback;
  const userFallbackObject = typeof userFallback === 'object' && userFallback !== null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? userFallback as Record<string, any>
    : undefined;
  // A caller's own catch-all, which must not be clobbered by the one added below.
  const userDefault = userFallbackObject?.default;

  try {
    const converted = toJsonSchema(schema, {
      ...options,
      fallback: {
        // A caller's own fallback wins per code and is left to report for itself; this only
        // covers what they did not handle.
        ...(userFallbackObject ?? {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        default(ctx: any): unknown {
          // Both caller shapes take precedence: an object with its own `default`, or a
          // universal function. Either way the caller has handled it and owns the reporting.
          if (typeof userDefault === 'function') {
            return userDefault(ctx);
          }
          if (typeof userFallback === 'function') {
            return userFallback(ctx);
          }

          degradedCodes.push(String(ctx?.code ?? 'unknown'));

          return ctx?.base;
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (degradedCodes.length === 0) {
      return converted;
    }

    const marker: JsonSchemaPartialMarker = { codes: [...new Set(degradedCodes)].sort() };

    return { ...converted, [JSON_SCHEMA_PARTIAL]: marker };
  } catch (error) {
    // Reached only when the conversion fails for a reason the fallback cannot repair — a
    // caller's own fallback throwing, or an ArkType failure outside the per-code mechanism.
    // Binding the error is the point: the previous bare `catch` discarded the one value that
    // said what was unrepresentable.
    const code = (error as { code?: unknown } | null)?.code;

    return {
      type: 'object',
      [JSON_SCHEMA_PARTIAL]: {
        codes: [code === undefined ? 'unknown' : String(code)],
      } satisfies JsonSchemaPartialMarker,
    };
  }
}

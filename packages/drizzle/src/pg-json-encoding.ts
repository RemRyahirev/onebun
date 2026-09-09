import {
  is,
  Param,
  Placeholder,
  sql,
  SQL,
} from 'drizzle-orm';
import { BunSQLPreparedQuery } from 'drizzle-orm/bun-sql';
import {
  PgArray,
  PgJson,
  PgJsonb,
} from 'drizzle-orm/pg-core';

/**
 * Stop `json`/`jsonb` values being stored as JSON *strings* on the Bun SQL PostgreSQL path.
 *
 * ## The defect
 *
 * drizzle-orm's `PgJsonb.mapToDriverValue` returns `JSON.stringify(value)`, and Bun's `SQL`
 * JSON-encodes any parameter whose inferred PostgreSQL type is `json`/`jsonb`. The two compose
 * into a double encode: every value written through `DrizzleService` lands as a jsonb string.
 * Measured against `postgres:16-alpine`, writing `['x','y']`:
 *
 * ```
 * jsonb_typeof(data) -> 'string'
 * data::text         -> "[\\"x\\",\\"y\\"]"
 * jsonb_array_length -> ERROR: cannot get array length of a scalar
 * data @> '{"a":1}'  -> no match
 * ```
 *
 * It is invisible to the application that wrote it, which is what let it ship: the read path
 * decodes twice — Bun turns the jsonb string into a JS string, drizzle's `mapFromDriverValue`
 * `JSON.parse`s that back into the value — so a round trip through the ORM looks correct while
 * every SQL-level operator, every other service and every report sees a string.
 *
 * ## Why a cast, and why `::text::jsonb`
 *
 * Measured, not assumed: binding a pre-stringified value as `$1::jsonb` is a **no-op** — still
 * `jsonb_typeof='string'`. Only `$1::text::jsonb` works, because it forces Bun to infer the
 * parameter as text and bind it verbatim rather than JSON-encoding it a second time.
 *
 * An identity `mapToDriverValue` (hand Bun the raw value and let it encode) was the obvious
 * alternative and is wrong: a scalar number or boolean then fails with
 * `column "data" is of type jsonb but expression is of type integer`.
 *
 * ## What this patches, and the price
 *
 * Two drizzle-orm internals, neither covered by its semver contract:
 *
 * 1. `PgJsonb`/`PgJson`/`PgArray.prototype.mapToDriverValue` — the column encoders.
 * 2. `BunSQLPreparedQuery.prototype.execute`/`.all` — the `sql.placeholder()` path.
 *
 * `packages/drizzle/tests/drizzle-orm-shape.test.ts` pins every structural assumption to the
 * installed version and fails naming this file. That is the mitigation; review discipline is not.
 *
 * Idempotent, and called from the PostgreSQL branch of `DrizzleService.initialize()` before the
 * driver is constructed.
 *
 * @see docs:api/drizzle.md
 */

/**
 * Depth of `PgArray.mapToDriverValue` currently on the stack.
 *
 * `jsonb[]` is already correct today and must stay byte-identical: `makePgArray` builds the array
 * literal by string-concatenating `baseColumn.mapToDriverValue(v)`, so an `SQL` chunk there would
 * render `{[object Object]}` and the insert would fail. Inside an array the encoder therefore
 * keeps returning a plain string.
 *
 * Safe as module state only because `makePgArray` calls the base encoder synchronously — there is
 * no `await` between the increment and the decrement, so on a single-threaded runtime no second
 * encode can observe it.
 */
let arrayDepth = 0;

/**
 * Set while a prepared statement's `execute`/`all` is filling its placeholders.
 *
 * The placeholder path cannot take an `SQL` chunk. `fillPlaceholders` pushes whatever the encoder
 * returns straight into the params array — the `is(mappedValue, SQL)` unwrap exists only in
 * `buildQueryFromSourceParams`, never there — so returning an `SQL` would store the serialized
 * internals of a drizzle object. Under this flag the encoder returns the plain string instead, and
 * the cast is added to the query text by {@link rewritePlaceholderCasts}.
 *
 * **Process-global, and safe only because the window contains no `await`.** Verified against the
 * installed drizzle: `execute` is `async` but its first action is `tracer.startActiveSpan(...)`
 * with nothing awaited before it; `all` is not async at all; `startActiveSpan` invokes its
 * callback synchronously (`if (!otel) return fn()`, and `otel` is never assigned); and
 * `fillPlaceholders` is the first statement of that callback. So every encoder call this flag
 * governs happens inside one synchronous invocation and no second `execute` can interleave.
 *
 * This is why the wrapper captures the delegated promise INSIDE the try and awaits it after the
 * `finally`. Writing the natural `return await original.call(...)` inside the try would hold the
 * flag across the whole database round trip, and any non-placeholder json write starting in that
 * window would be encoded as a bare string with no cast — silently re-corrupted.
 */
let placeholderMode = false;

/** Set once the prototypes are patched, so a second `initialize()` does not stack wrappers. */
let applied = false;

/**
 * The instances whose `queryString` has already had its casts inserted.
 *
 * One prepared statement is executed many times; the rewrite is value-independent and idempotent,
 * so it runs once. Without this, re-executing would append `::text::jsonb::text::jsonb`.
 */
const rewritten = new WeakSet<object>();

/**
 * Test seam: how many prepared statements have had their query text rewritten.
 *
 * @internal
 */
let rewriteCount = 0;

/** The private shape of a `BunSQLPreparedQuery`, reached structurally rather than through `any`. */
interface PreparedQueryInternals {
  queryString: string;
  params: unknown[];
}

/** A prepared-statement method that takes placeholder values and returns rows. */
type PreparedMethod = (this: unknown, placeholderValues?: Record<string, unknown>) => unknown;

/**
 * Is `placeholderMode` currently set?
 *
 * Exists so the flag's window can be asserted rather than reasoned about. Deliberately not
 * re-exported from the package index.
 *
 * @internal
 */
export function readPlaceholderMode(): boolean {
  return placeholderMode;
}

/**
 * How many prepared statements have been rewritten since the patch was installed.
 *
 * @internal
 */
export function readRewriteCount(): number {
  return rewriteCount;
}

/**
 * The cast a json-family column needs, or `undefined` for anything else.
 *
 * `jsonb('a').array()` encodes through `PgArray`, not `PgJsonb`, so an array column answers
 * `undefined` here and keeps the array path untouched.
 */
function jsonCastFor(encoder: unknown): string | undefined {
  if (is(encoder, PgJsonb)) {
    return '::text::jsonb';
  }

  if (is(encoder, PgJson)) {
    return '::text::json';
  }

  return undefined;
}

/**
 * Insert `::text::jsonb` after every `$N` whose parameter is a json placeholder.
 *
 * `PgDialect.escapeParam` is `` `$${num + 1}` ``, so the parameter at index `i` is `$(i+1)` —
 * that 1-based numbering is what makes an index-driven rewrite sound. The lookahead stops `$1`
 * matching inside `$10`.
 */
function rewritePlaceholderCasts(prepared: PreparedQueryInternals): void {
  let queryString = prepared.queryString;

  prepared.params.forEach((param, index) => {
    if (!is(param, Param) || !is(param.value, Placeholder)) {
      return;
    }

    const cast = jsonCastFor(param.encoder);
    if (cast === undefined) {
      return;
    }

    const token = `$${index + 1}`;
    queryString = queryString.replace(
      new RegExp(`\\$${index + 1}(?![0-9])`, 'g'),
      `${token}${cast}`,
    );
  });

  prepared.queryString = queryString;
  rewriteCount += 1;
}

/**
 * Wrap `execute`/`all` so the encoder returns a plain string and the query text carries the cast.
 */
function wrapPreparedMethod(original: PreparedMethod): PreparedMethod {
  return function wrapped(this: unknown, placeholderValues?: Record<string, unknown>): unknown {
    const prepared = this as PreparedQueryInternals;
    const instance = this as object;

    if (!rewritten.has(instance)) {
      rewritten.add(instance);
      rewritePlaceholderCasts(prepared);
    }

    // Captured inside the try, awaited by the caller — see `placeholderMode`. The flag must not
    // survive past the synchronous part of the call.
    let result: unknown;
    placeholderMode = true;
    try {
      result = original.call(this, placeholderValues);
    } finally {
      placeholderMode = false;
    }

    return result;
  };
}

/**
 * Install the encoders. Idempotent.
 *
 * @internal
 * @see docs:api/drizzle.md
 */
export function applyBunSqlJsonEncodingFix(): void {
  if (applied) {
    return;
  }
  applied = true;

  const originalArrayEncoder = PgArray.prototype.mapToDriverValue;

  PgArray.prototype.mapToDriverValue = function arrayWithDepth(this: unknown, value: unknown): unknown {
    arrayDepth += 1;
    try {
      return originalArrayEncoder.call(this, value as never);
    } finally {
      arrayDepth -= 1;
    }
  } as typeof PgArray.prototype.mapToDriverValue;

  for (const [columnClass, cast] of [
    [PgJsonb, '::text::jsonb'],
    [PgJson, '::text::json'],
  ] as const) {
    columnClass.prototype.mapToDriverValue = function encodeJson(this: unknown, value: unknown): unknown {
      // Inside `jsonb[]`, or filling a prepared statement's placeholders: a plain string, because
      // neither caller can take an `SQL` chunk. `null` stays `null` so the placeholder path binds
      // SQL NULL — `fillPlaceholders` has no null guard of its own, unlike the value path.
      if (arrayDepth > 0 || placeholderMode) {
        return value === null ? null : JSON.stringify(value);
      }

      return sql`${JSON.stringify(value)}${sql.raw(cast)}`;
    } as typeof columnClass.prototype.mapToDriverValue;

    // Identity: Bun has already decoded the column. Re-parsing a string here is what would
    // corrupt a legitimately stored jsonb string scalar whose content happens to be valid JSON.
    columnClass.prototype.mapFromDriverValue = function decodeJson(this: unknown, value: unknown): unknown {
      return value;
    } as typeof columnClass.prototype.mapFromDriverValue;
  }

  const preparedPrototype = BunSQLPreparedQuery.prototype as unknown as Record<string, PreparedMethod>;

  for (const method of ['execute', 'all'] as const) {
    preparedPrototype[method] = wrapPreparedMethod(preparedPrototype[method]);
  }
}

/**
 * Undo the patch. Test-only — nothing in the framework un-patches.
 *
 * @internal
 */
export function resetBunSqlJsonEncodingFixForTests(): void {
  applied = false;
  arrayDepth = 0;
  placeholderMode = false;
  rewriteCount = 0;
}

/** Re-exported for the shape guard, so its assertions name the same symbols this file patches. */
export { SQL };

/**
 * A JSON value in raw SQL on PostgreSQL, without column metadata.
 *
 * ## Why a helper
 *
 * The json/jsonb fix in `pg-json-encoding.ts` lives in the column encoders, so a value
 * interpolated straight into ``sql`...` `` never reaches it. Measured against `postgres:16` through
 * `DrizzleService`, every obvious raw form is wrong for some shape:
 *
 * - `${value}` — drizzle expands an array into `($1, $2)`: `['x','y']` fails with `type record`,
 *   `[]` is a syntax error, and a ONE-element array renders as `($1)` and silently binds its
 *   element (`['x']` is stored as the jsonb string `"x"`, `[null]` as SQL NULL). A number fails
 *   with `type integer`, a boolean with `cannot cast type boolean`, and `null` is SQL NULL.
 * - `${JSON.stringify(value)}::jsonb` — Bun JSON-encodes a parameter it infers as jsonb, so the
 *   pre-stringified text is encoded a second time: every value is stored as a jsonb string.
 * - `${JSON.stringify(value)}::text::jsonb` — correct for every shape. It forces Bun to infer the
 *   parameter as text and bind it verbatim, and the server parses it. That is what these render.
 *
 * ## Placeholders
 *
 * `sql.placeholder()` is accepted: it becomes a `Param` whose encoder is the same serializer, and
 * drizzle's `fillPlaceholders` calls that encoder with the value handed to `execute()`. The encoder
 * is a plain object, not a json column, so the prepared-statement rewrite in
 * `pg-json-encoding.ts` leaves it alone and the cast is never doubled.
 */

import {
  is,
  isSQLWrapper,
  Param,
  Placeholder,
  sql,
  SQL,
} from 'drizzle-orm';

/** The cast that makes Bun bind a JSON text parameter verbatim for a `jsonb` target. */
export const JSONB_TEXT_CAST = '::text::jsonb';

/** The same for a `json` target. */
export const JSON_TEXT_CAST = '::text::json';

/** One of the two casts above. */
export type JsonTextCast = typeof JSONB_TEXT_CAST | typeof JSON_TEXT_CAST;

/** The public helpers, named in every error so a stack trace is not needed to find the call. */
type JsonHelperName = 'jsonbParam' | 'jsonParam';

/**
 * Render `text` followed by the cast: `$n::text::jsonb`.
 *
 * The one place the SQL shape is built. The json/jsonb column encoders and
 * {@link jsonbParam}/{@link jsonParam} both go through it, so the value path of a column write and
 * the helper cannot drift apart, and a change in Bun's binding is fixed here once.
 *
 * @internal
 * @see docs:api/drizzle.md
 */
export function castJsonText<T = unknown>(text: string | Param, cast: JsonTextCast): SQL<T> {
  return sql<T>`${text}${sql.raw(cast)}`;
}

/** What a drizzle object is called in the error, so the message says what went wrong. */
function drizzleKind(value: unknown): string {
  if (is(value, SQL)) {
    return 'an SQL fragment';
  }
  if (is(value, Param)) {
    return 'a Param';
  }
  if (is(value, Placeholder)) {
    return 'a placeholder';
  }

  return 'an SQL expression (a column, table, subquery or other SQLWrapper)';
}

/** How an unserializable value is named in the error. */
function describeUnserializable(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'function') {
    return 'a function';
  }
  if (typeof value === 'symbol') {
    return 'a symbol';
  }

  return `a value of type ${typeof value}`;
}

/**
 * `JSON.stringify(value)`, or a `TypeError` naming the helper. A drizzle object is refused as the
 * value and at any depth inside it.
 *
 * Runs both when the helper is called and, for a placeholder, when the prepared statement executes
 * — so a bad value handed to `execute()` fails the same way a bad literal does.
 */
function toJsonText(value: unknown, helper: JsonHelperName): string {
  if (isSQLWrapper(value)) {
    // A drizzle object serializes to its internals — a placeholder to `{"name":"p"}` — and would
    // be stored as that, silently. Refuse it instead.
    throw new TypeError(
      `${helper}() takes a JSON value to bind, and was given ${drizzleKind(value)}. ` +
      'Interpolate SQL into the sql`` template directly; for a prepared statement pass ' +
      `sql.placeholder('name') to ${helper}() and the value to execute().`,
    );
  }

  // The same refusal at any depth: `{ kind: sql.placeholder('k') }` would otherwise bind
  // `{"kind":{"name":"k"}}` and match nothing, silently. Drizzle objects have no `toJSON`, so the
  // replacer sees them as they are.
  let nestedRefusal: TypeError | undefined;
  const refuseNestedDrizzle = (key: string, nested: unknown): unknown => {
    if (typeof nested === 'object' && nested !== null && isSQLWrapper(nested)) {
      nestedRefusal = new TypeError(
        `${helper}() takes a JSON value to bind, and was given ${drizzleKind(nested)} inside it, at key ` +
        `${JSON.stringify(key)}. A placeholder must be the whole value: pass sql.placeholder('name') to ` +
        `${helper}() and the complete value to execute(). Interpolate SQL into the sql\`\` template directly.`,
      );
      throw nestedRefusal;
    }

    return nested;
  };

  let text: string | undefined;
  try {
    text = JSON.stringify(value, refuseNestedDrizzle) as string | undefined;
  } catch (error) {
    if (error === nestedRefusal) {
      throw error;
    }
    // BigInt and circular structures: the engine's own TypeError, with the helper named.
    if (error instanceof TypeError) {
      throw new TypeError(`${helper}() cannot serialize the value as JSON: ${error.message}`, { cause: error });
    }
    throw error;
  }

  if (text === undefined) {
    throw new TypeError(
      `${helper}() cannot bind ${describeUnserializable(value)}: it has no JSON representation ` +
      '(JSON.stringify returned undefined). Pass null for JSON null, or write NULL in the SQL for SQL NULL.',
    );
  }

  return text;
}

/** The shared body of both helpers. */
function jsonValue(value: unknown, helper: JsonHelperName, cast: JsonTextCast): SQL {
  if (is(value, Placeholder)) {
    const encoder = { mapToDriverValue: (raw: unknown): string => toJsonText(raw, helper) };

    return castJsonText(new Param<unknown, string>(value, encoder), cast);
  }

  return castJsonText(toJsonText(value, helper), cast);
}

/**
 * A JSON value for raw SQL on PostgreSQL, typed `jsonb`: renders `$n::text::jsonb` with
 * `JSON.stringify(value)` bound as ONE text parameter.
 *
 * Correct for every shape — objects, arrays (including `[]` and one-element arrays), strings,
 * numbers, booleans and `null`, which is JSON `null`, not SQL NULL. Works in any expression:
 * `@>`, `jsonb_set`, `jsonb_build_object`, `INSERT`/`UPDATE` values. Needs no column metadata and
 * does not depend on `DrizzleService`.
 *
 * Pass `sql.placeholder('name')` to bind the value at `execute()` time instead; the same
 * serialization and the same checks then run on that value.
 *
 * ORM column writes do not need it: `db.insert(table).values({ data })` already goes through the
 * column encoder.
 *
 * @param value - a JSON-serializable value, or `sql.placeholder('name')`
 * @returns an `SQL<T>` fragment to interpolate into ``sql`...` ``
 * @throws TypeError naming `jsonbParam` for `undefined`, a function, a symbol, a drizzle
 * SQL/Param/Placeholder/SQLWrapper (as the value or nested anywhere inside it), a BigInt, a
 * circular structure, or anything else whose `JSON.stringify` is `undefined` — also when such a
 * value reaches a placeholder at `execute()`
 *
 * @example
 * ```typescript
 * await db.execute(sql`
 *   UPDATE events SET payload = jsonb_set(payload, '{tags}', ${jsonbParam(['a', 'b'])})
 *   WHERE payload @> ${jsonbParam({ kind: 'signup' })}
 * `);
 * ```
 *
 * @see docs:api/drizzle.md
 */
export function jsonbParam<T = unknown>(value: Placeholder): SQL<T>;
export function jsonbParam<T>(value: T): SQL<T>;
export function jsonbParam(value: unknown): SQL {
  return jsonValue(value, 'jsonbParam', JSONB_TEXT_CAST);
}

/**
 * The `json` twin of {@link jsonbParam}: renders `$n::text::json`.
 *
 * Use it where the target is `json`, not `jsonb`: a `json` column, `json_typeof`,
 * `json_build_object`. A `jsonb` value lands in a `json` column through the assignment cast, but
 * `json` functions do not accept it (`function json_typeof(jsonb) does not exist`) — and `jsonb`
 * operators such as `@>` do not accept `json`.
 *
 * @param value - a JSON-serializable value, or `sql.placeholder('name')`
 * @returns an `SQL<T>` fragment to interpolate into ``sql`...` ``
 * @throws TypeError naming `jsonParam`, for the same inputs as {@link jsonbParam}
 *
 * @see docs:api/drizzle.md
 */
export function jsonParam<T = unknown>(value: Placeholder): SQL<T>;
export function jsonParam<T>(value: T): SQL<T>;
export function jsonParam(value: unknown): SQL {
  return jsonValue(value, 'jsonParam', JSON_TEXT_CAST);
}

/**
 * `jsonbParam()` / `jsonParam()` without a database.
 *
 * These pin the SQL that gets rendered and the parameters that get bound. What the server stores
 * for them — `jsonb_typeof`, the operators, the raw forms they replace — is measured in
 * `pg-json-integration.test.ts`, against a real PostgreSQL.
 */

import {
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  fillPlaceholders,
  is,
  Param,
  Placeholder,
  sql,
  SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  jsonb,
  PgDialect,
  pgTable,
  serial,
} from 'drizzle-orm/pg-core';

import * as root from '../src';
import { jsonbParam, jsonParam } from '../src/pg';
import { applyBunSqlJsonEncodingFix } from '../src/pg-json-encoding';

const table = pgTable('t', {
  id: serial('id').primaryKey(),
  data: jsonb('data'),
});

const dialect = new PgDialect();

/** Every shape the helper must bind as one JSON text parameter. */
const MATRIX: unknown[] = [
  { a: 1 },
  ['x', 'y'],
  ['x'],
  [],
  {},
  'hello',
  '{"a":1}',
  42,
  1.5,
  true,
  false,
  null,
];

function label(value: unknown): string {
  return JSON.stringify(value);
}

function render(fragment: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment);

  return { sql: query.sql, params: query.params };
}

/** A stub Bun SQL client that records what it was asked to run and returns no rows. */
function stubClient(): {
  client: unknown;
  calls: Array<{ query: string; params: unknown[] }>;
} {
  const calls: Array<{ query: string; params: unknown[] }> = [];

  const client = {
    unsafe(query: string, params: unknown[]) {
      calls.push({ query, params });

      const thenable = Promise.resolve([] as unknown[]) as Promise<unknown[]> & {
        values(): Promise<unknown[]>;
      };
      thenable.values = () => Promise.resolve([]);

      return thenable;
    },
  };

  return { client, calls };
}

beforeAll(() => {
  // Needed only by the column-equivalence cases; the helpers themselves do not depend on it.
  applyBunSqlJsonEncodingFix();
});

describe('where the helpers are exported', () => {
  it('comes from @onebun/drizzle/pg only, not from the dialect-neutral root', () => {
    expect(typeof jsonbParam).toBe('function');
    expect(typeof jsonParam).toBe('function');
    // The SQL they render is PostgreSQL's; on the root they would sit next to the SQLite API.
    expect('jsonbParam' in root).toBe(false);
    expect('jsonParam' in root).toBe(false);
  });
});

describe('rendering', () => {
  for (const value of MATRIX) {
    it(`binds ${label(value)} as ONE text parameter cast ::text::jsonb`, () => {
      expect(render(sql`SELECT ${jsonbParam(value)}`)).toEqual({
        sql: 'SELECT $1::text::jsonb',
        params: [JSON.stringify(value)],
      });
    });

    it(`binds ${label(value)} as ONE text parameter cast ::text::json with jsonParam`, () => {
      expect(render(sql`SELECT ${jsonParam(value)}`)).toEqual({
        sql: 'SELECT $1::text::json',
        params: [JSON.stringify(value)],
      });
    });
  }

  it('binds null as the JSON text null, not as SQL NULL', () => {
    // The column path binds SQL NULL for null; this is a value, and `null` is a JSON value.
    expect(render(sql`${jsonbParam(null)}`).params).toEqual(['null']);
  });

  it('numbers its parameter by position inside a larger statement', () => {
    const query = render(sql`
      UPDATE t SET data = jsonb_set(data, '{tags}', ${jsonbParam(['a'])})
      WHERE data @> ${jsonbParam({ kind: 'signup' })} AND id = ${7}
    `);

    expect(query.sql).toContain('jsonb_set(data, \'{tags}\', $1::text::jsonb)');
    expect(query.sql).toContain('data @> $2::text::jsonb AND id = $3');
    expect(query.params).toEqual(['["a"]', '{"kind":"signup"}', 7]);
  });

  it('inlines as an escaped string literal when the params are inlined', () => {
    const fragment = sql`SELECT ${jsonbParam({ s: 'it\'s' })}`.inlineParams();

    expect(render(fragment)).toEqual({ sql: 'SELECT \'{"s":"it\'\'s"}\'::text::jsonb', params: [] });
  });

  it('follows JSON.stringify rules, as the docs say: Date, nested undefined, NaN', () => {
    expect(render(sql`${jsonbParam(new Date(0))}`).params).toEqual(['"1970-01-01T00:00:00.000Z"']);
    expect(render(sql`${jsonbParam({ a: undefined, b: Number.NaN })}`).params).toEqual(['{"b":null}']);
  });

  it('keeps quotes, backslashes and non-ASCII text verbatim in the bound parameter', () => {
    const value = { q: 'he said "hi" and a backslash \\', s: 'it\'s', u: 'Привет, 世界 🌍\u2028' };

    expect(render(sql`${jsonbParam(value)}`).params).toEqual([JSON.stringify(value)]);
  });
});

describe('the same SQL as the column encoder', () => {
  for (const value of MATRIX) {
    it(`renders ${label(value)} exactly as the jsonb column encoder does`, () => {
      // The encoder output itself: both go through one builder, so both render the same.
      expect(render(sql`SELECT ${jsonbParam(value)}`))
        .toEqual(render(sql`SELECT ${table.data.mapToDriverValue(value)}`));
    });
  }

  for (const value of MATRIX.filter(item => item !== null)) {
    it(`renders ${label(value)} exactly as a column-encoded Param does`, () => {
      expect(render(sql`SELECT ${jsonbParam(value)}`))
        .toEqual(render(sql`SELECT ${new Param(value, table.data)}`));
    });
  }

  it('differs from a column-encoded Param for null, on purpose', () => {
    // drizzle skips the encoder for a null Param and binds SQL NULL — the column semantics, which
    // the ORM path keeps. The helper is handed a value, and binds JSON null.
    expect(render(sql`SELECT ${new Param(null, table.data)}`)).toEqual({ sql: 'SELECT $1', params: [null] });
    expect(render(sql`SELECT ${jsonbParam(null)}`)).toEqual({ sql: 'SELECT $1::text::jsonb', params: ['null'] });
  });
});

describe('what the helpers refuse', () => {
  const refused: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['an SQL fragment', sql`1`],
    ['a Param', new Param(1)],
    ['a column', table.data],
    ['a BigInt', 10n],
  ];

  for (const [name, value] of refused) {
    it(`throws a TypeError naming jsonbParam for ${name}`, () => {
      expect(() => jsonbParam(value)).toThrow(TypeError);
      expect(() => jsonbParam(value)).toThrow(/jsonbParam\(\)/);
    });

    it(`throws a TypeError naming jsonParam for ${name}`, () => {
      expect(() => jsonParam(value)).toThrow(TypeError);
      expect(() => jsonParam(value)).toThrow(/jsonParam\(\)/);
    });
  }

  it('says why for a value with no JSON representation', () => {
    expect(() => jsonbParam(undefined)).toThrow(/cannot bind undefined: it has no JSON representation/);
    expect(() => jsonbParam(() => 1)).toThrow(/cannot bind a function/);
    expect(() => jsonbParam(Symbol('s'))).toThrow(/cannot bind a symbol/);
  });

  it('says what it was given for a drizzle object', () => {
    expect(() => jsonbParam(sql`1`)).toThrow(/was given an SQL fragment/);
    expect(() => jsonbParam(new Param(1))).toThrow(/was given a Param/);
    expect(() => jsonbParam(table.data)).toThrow(/was given an SQL expression/);
  });

  it('refuses a drizzle object nested at any depth, naming the key', () => {
    // Serialized, these bind {"kind":{"name":"k"}} and the SQL chunk internals: a prepared
    // `@>` built from them matches nothing, silently.
    expect(() => jsonbParam({ kind: sql.placeholder('k') }))
      .toThrow(/^jsonbParam\(\) takes a JSON value to bind, and was given a placeholder inside it, at key "kind"/);
    expect(() => jsonParam({ a: [sql`1`] })).toThrow(/^jsonParam\(\) .* was given an SQL fragment inside it, at key "0"/);
    expect(() => jsonbParam({ a: { b: { c: table.data } } })).toThrow(/was given an SQL expression .* at key "c"/);
    expect(() => jsonbParam([new Param(1)])).toThrow(TypeError);
    expect(() => jsonbParam({ kind: sql.placeholder('k') })).toThrow(/A placeholder must be the whole value/);
  });

  it('still serializes a nested value that only looks like a drizzle object', () => {
    // Only a getSQL() function makes an SQLWrapper; data with such a key is plain JSON.
    const value = { getSQL: 'not a function', nested: { name: 'p' } };

    expect(render(sql`${jsonbParam(value)}`).params).toEqual([JSON.stringify(value)]);
  });

  it('keeps the engine error as the cause of a serialization failure', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    let caught: unknown;
    try {
      jsonbParam(circular);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toMatch(/^jsonbParam\(\) cannot serialize the value as JSON: /);
    expect((caught as Error).cause).toBeInstanceOf(TypeError);
  });

  it('lets an error thrown by a toJSON() through unchanged', () => {
    class Boom extends Error {}
    const value = {
      toJSON(): never {
        throw new Boom('no');
      },
    };

    expect(() => jsonbParam(value)).toThrow(Boom);
  });

  it('does not refuse a placeholder', () => {
    expect(() => jsonbParam(sql.placeholder('p'))).not.toThrow();
    expect(() => jsonParam(sql.placeholder('p'))).not.toThrow();
  });
});

describe('sql.placeholder()', () => {
  it('renders one placeholder parameter followed by the cast', () => {
    const query = render(sql`SELECT ${jsonbParam(sql.placeholder('p'))}`);

    expect(query.sql).toBe('SELECT $1::text::jsonb');
    expect(query.params).toHaveLength(1);
    // A Param wrapping the placeholder, so drizzle encodes the execute() value through it.
    expect(is(query.params[0], Param)).toBe(true);
    expect(is((query.params[0] as Param).value, Placeholder)).toBe(true);
  });

  for (const value of MATRIX) {
    it(`encodes ${label(value)} at execute time exactly as the value path does`, () => {
      const { params } = render(sql`SELECT ${jsonbParam(sql.placeholder('p'))}`);

      // null included: the value path binds JSON null, so the placeholder path does too.
      expect(fillPlaceholders(params, { p: value })).toEqual([JSON.stringify(value)]);
    });
  }

  it('refuses a bad value handed to execute(), naming the helper', () => {
    const { params } = render(sql`SELECT ${jsonParam(sql.placeholder('p'))}`);

    expect(() => fillPlaceholders(params, { p: undefined })).toThrow(/jsonParam\(\) cannot bind undefined/);
    expect(() => fillPlaceholders(params, { p: sql`1` })).toThrow(/jsonParam\(\) takes a JSON value/);
    expect(() => fillPlaceholders(params, { p: sql.placeholder('q') })).toThrow(/was given a placeholder/);
    expect(() => fillPlaceholders(params, { p: { kind: sql.placeholder('q') } }))
      .toThrow(/jsonParam\(\) .* was given a placeholder inside it, at key "kind"/);
  });

  it('is not cast a second time by the prepared-statement rewrite', async () => {
    // `pg-json-encoding.ts` rewrites `$n` for placeholders whose encoder is a json COLUMN. The
    // helper's encoder is a plain object, so its `$n` already carries the one cast it needs.
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    const prepared = db.insert(table)
      .values({ data: jsonbParam(sql.placeholder('v')) })
      .prepare('ins_helper_placeholder');

    for (const value of [{ a: 1 }, ['x'], null, 42]) {
      await prepared.execute({ v: value });
    }

    for (const call of calls) {
      expect(call.query.match(/::text::jsonb/g)).toHaveLength(1);
      expect(call.query).toContain('$1::text::jsonb');
    }
    expect(calls.map(call => call.params)).toEqual([['{"a":1}'], ['["x"]'], ['null'], ['42']]);
  });

  it('rejects the execute() promise for a bad value, and the next execute still works', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    const prepared = db.select({ id: table.id })
      .from(table)
      .where(sql`${table.data} @> ${jsonbParam(sql.placeholder('q'))}`)
      .prepare('sel_helper_bad_value');

    await expect(prepared.execute({ q: undefined })).rejects.toThrow(/jsonbParam\(\) cannot bind undefined/);

    await prepared.execute({ q: { kind: 'signup' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(['{"kind":"signup"}']);
  });
});

describe('through db.execute()', () => {
  it('sends the helper exactly as rendered', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    await db.execute(sql`INSERT INTO t (data) VALUES (${jsonbParam(['x'])})`);

    expect(calls[0]).toEqual({ query: 'INSERT INTO t (data) VALUES ($1::text::jsonb)', params: ['["x"]'] });
  });
});

describe('typing', () => {
  it('types the fragment by the value, and a placeholder as unknown unless told', () => {
    const typed: SQL<{ a: number }> = jsonbParam({ a: 1 });
    const fromPlaceholder: SQL<unknown> = jsonbParam(sql.placeholder('p'));
    const explicit: SQL<string[]> = jsonParam<string[]>(sql.placeholder('p'));

    expect([typed, fromPlaceholder, explicit].every(fragment => is(fragment, SQL))).toBe(true);
  });
});

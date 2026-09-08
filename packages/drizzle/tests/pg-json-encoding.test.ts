/**
 * The json/jsonb encoding fix, without a database.
 *
 * Every value written to a pg `json`/`jsonb` column through `DrizzleService` used to be stored as
 * a jsonb STRING: drizzle's encoder returns `JSON.stringify(value)` and Bun's `SQL` then
 * JSON-encodes any parameter whose inferred type is json/jsonb. The corruption is invisible to
 * the application that wrote it — the read path decodes twice — and visible to every SQL operator.
 *
 * These cases pin the rendered SQL and the bound parameters. The round trip against a real server
 * is `pg-json-integration.test.ts`; the assumptions about drizzle-orm's internals are
 * `drizzle-orm-shape.test.ts`.
 */

import { SQL as BunSQL } from 'bun';
import {
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  eq,
  is,
  sql,
  SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  integer,
  json,
  jsonb,
  PgDialect,
  pgTable,
  serial,
} from 'drizzle-orm/pg-core';
import { text as sqliteText, sqliteTable } from 'drizzle-orm/sqlite-core';

import {
  applyBunSqlJsonEncodingFix,
  readPlaceholderMode,
  readRewriteCount,
} from '../src/pg-json-encoding';

const table = pgTable('t', {
  id: serial('id').primaryKey(),
  data: jsonb('data'),
  doc: json('doc'),
  tags: jsonb('tags').array(),
  n: integer('n'),
});

const dialect = new PgDialect();

/** The SQL and params drizzle would send for a query builder. */
function rendered(builder: { getSQL(): SQL }): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(builder.getSQL());

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
  applyBunSqlJsonEncodingFix();
  // Idempotent: a second application must not stack wrappers, or the array-depth counter and the
  // placeholder flag would be incremented twice per call and the casts doubled.
  applyBunSqlJsonEncodingFix();
});

describe('column encoders', () => {
  it('renders jsonb as $n::text::jsonb with the value bound as a plain string', () => {
    // `$1::jsonb` alone is a measured no-op — still `jsonb_typeof='string'`. The double cast is
    // what forces Bun to infer the parameter as text and bind it verbatim.
    const { sql: text, params } = rendered({
      getSQL: () => sql`insert into t (data) values (${table.data.mapToDriverValue(['x', 'y'])})`,
    });

    expect(text).toContain('$1::text::jsonb');
    expect(params).toEqual(['["x","y"]']);
  });

  it('renders json as $n::text::json', () => {
    const { sql: text, params } = rendered({
      getSQL: () => sql`insert into t (doc) values (${table.doc.mapToDriverValue({ a: 1 })})`,
    });

    expect(text).toContain('$1::text::json');
    expect(params).toEqual(['{"a":1}']);
  });

  it('encodes every payload shape as JSON, including scalars', () => {
    // An identity encoder was the obvious alternative and fails here: a scalar number binds as
    // an integer and Postgres rejects it with "column is of type jsonb but expression is of
    // type integer".
    const encoded = [{ a: 1 }, ['x'], 'hello', 42, true].map(
      value => rendered({ getSQL: () => sql`${table.data.mapToDriverValue(value)}` }).params[0],
    );

    expect(encoded).toEqual(['{"a":1}', '["x"]', '"hello"', '42', 'true']);
  });

  it('reads back whatever the driver produced, without re-parsing it', () => {
    // Bun has already decoded the column. Re-parsing here is what would corrupt a legitimately
    // stored jsonb string scalar whose content happens to be valid JSON.
    expect(table.data.mapFromDriverValue('hello')).toBe('hello');
    expect(table.data.mapFromDriverValue('{"a":1}')).toBe('{"a":1}');
    expect(table.data.mapFromDriverValue({ a: 1 })).toEqual({ a: 1 });
    expect(table.data.mapFromDriverValue(null)).toBeNull();
  });

  it('keeps jsonb[] byte-identical, because an SQL chunk there would render {[object Object]}', () => {
    // `makePgArray` string-concatenates the base encoder's result, so inside an array the
    // encoder must keep returning a plain string.
    const encoded = table.tags.mapToDriverValue([{ a: 1 }, ['x']]);

    expect(typeof encoded).toBe('string');
    expect(is(encoded, SQL)).toBe(false);
    expect(encoded).toBe('{"{\\"a\\":1}","[\\"x\\"]"}');
  });

  it('balances the array-depth guard when the base encoder throws', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => table.tags.mapToDriverValue([circular])).toThrow();

    // Still outside an array: the very next encode must produce the cast again, which it cannot
    // if the depth counter leaked.
    expect(is(table.data.mapToDriverValue({ a: 1 }), SQL)).toBe(true);
  });

  it('leaves the SQLite json-mode text column untouched', () => {
    const sqliteTbl = sqliteTable('s', { payload: sqliteText('payload', { mode: 'json' }) });

    expect(sqliteTbl.payload.mapToDriverValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('sql.placeholder() on a json column', () => {
  it('rewrites $n in the prepared query and binds a plain string, on insert', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('ins');
    await prepared.execute({ d: { a: 1 } });

    expect(calls[0].query).toContain('::text::jsonb');
    // Not an SQL object: `fillPlaceholders` has no unwrap, so an SQL chunk here would store the
    // serialized internals of a drizzle object.
    expect(typeof calls[0].params[0]).toBe('string');
    expect(is(calls[0].params[0], SQL)).toBe(false);
    expect(calls[0].params[0]).toBe('{"a":1}');
  });

  it('does the same on update', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    const prepared = db.update(table)
      .set({ data: sql.placeholder('d') })
      .where(eq(table.id, 1))
      .prepare('upd');
    await prepared.execute({ d: ['x'] });

    expect(calls[0].query).toContain('::text::jsonb');
    expect(calls[0].params[0]).toBe('["x"]');
  });

  it('uses ::text::json for a json column', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    await db.insert(table).values({ doc: sql.placeholder('d') }).prepare('j').execute({ d: 1 });

    expect(calls[0].query).toContain('::text::json');
    expect(calls[0].query).not.toContain('::text::jsonb');
  });

  it('binds every payload shape as JSON, and null as SQL NULL', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });
    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('shapes');

    for (const value of [{ a: 1 }, ['x'], 'hello', 42, true, null]) {
      await prepared.execute({ d: value });
    }

    // `null` stays null rather than becoming the JSON text 'null': `fillPlaceholders` has no null
    // guard of its own, unlike the value path, so the encoder has to supply it.
    expect(calls.map(call => call.params[0]))
      .toEqual(['{"a":1}', '["x"]', '"hello"', '42', 'true', null]);
  });

  it('rewrites the query text once, however many times the statement runs', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });
    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('amortized');

    const before = readRewriteCount();
    for (let i = 0; i < 100; i++) {
      await prepared.execute({ d: { i } });
    }

    // No `::text::jsonb::text::jsonb` accumulation, and no per-call rescan.
    for (const call of calls) {
      expect(call.query.match(/::text::jsonb/g)).toHaveLength(1);
    }
    expect(readRewriteCount() - before).toBe(1);
  });

  it('does not cast a $n that is not a json placeholder', async () => {
    const { client, calls } = stubClient();
    const db = drizzle({ client: client as never });

    await db.insert(table)
      .values({ n: sql.placeholder('n'), data: sql.placeholder('d') })
      .prepare('mixed')
      .execute({ n: 7, d: { a: 1 } });

    // Param order follows the TABLE's column order, not the object literal's — `data` is declared
    // before `n`, so the json value is $1 and the integer is $2. That is exactly why the rewrite
    // is driven by the params array index rather than by anything about the call site.
    expect(calls[0].query.match(/::text::jsonb/g)).toHaveLength(1);
    expect(calls[0].params).toEqual(['{"a":1}', 7]);
    expect(calls[0].query).toContain('$1::text::jsonb');
    expect(calls[0].query).not.toContain('$2::text');
  });
});

describe('the placeholderMode window', () => {
  it('is clear before the call, and clear again the moment execute() returns', async () => {
    const { client } = stubClient();
    const db = drizzle({ client: client as never });
    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('w1');

    expect(readPlaceholderMode()).toBe(false);

    const pending = prepared.execute({ d: { a: 1 } });

    // Synchronously after execute() returns and BEFORE the promise is awaited. This is the
    // assertion that fails if the wrapper is written as `return await original.call(...)` inside
    // the flag's try — which is exactly what `return-await: always` pushes an implementer toward.
    expect(readPlaceholderMode()).toBe(false);

    await pending;

    expect(readPlaceholderMode()).toBe(false);
  });

  it('is cleared when the placeholder is missing and execute rejects', async () => {
    const { client } = stubClient();
    const db = drizzle({ client: client as never });
    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('w2');

    await expect(prepared.execute({})).rejects.toThrow(/No value for placeholder "d" was provided/);
    expect(readPlaceholderMode()).toBe(false);
  });

  it('is cleared when the client itself rejects', async () => {
    const client = {
      unsafe() {
        const thenable = Promise.reject(new Error('connection lost')) as Promise<unknown[]> & {
          values(): Promise<unknown[]>;
        };
        thenable.values = () => Promise.reject(new Error('connection lost'));

        return thenable;
      },
    };
    const db = drizzle({ client: client as never });
    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('w3');

    // drizzle wraps the driver's error, so the assertion is that it rejects at all — what
    // matters here is the flag, not the wording.
    await expect(prepared.execute({ d: { a: 1 } })).rejects.toThrow();
    expect(readPlaceholderMode()).toBe(false);
  });

  it('is not held across the database round trip', async () => {
    // A never-settling client, so the round trip is still open when the assertion runs. A
    // concurrent NON-placeholder json write must still get its cast; if the flag were held it
    // would be encoded as a bare string and silently re-corrupted.
    const client = {
      unsafe() {
        const thenable = new Promise<unknown[]>(() => undefined) as Promise<unknown[]> & {
          values(): Promise<unknown[]>;
        };
        thenable.values = () => new Promise<unknown[]>(() => undefined);

        return thenable;
      },
    };
    const db = drizzle({ client: client as never });
    const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare('w4');

    void prepared.execute({ d: { a: 1 } });

    expect(readPlaceholderMode()).toBe(false);
    expect(is(table.data.mapToDriverValue({ a: 1 }), SQL)).toBe(true);
  });
});

describe('the Bun contract this fix exists for', () => {
  it('is documented by the driver, not assumed', () => {
    // Kept here so the reason for the double cast is stated where the fix is, not only in a
    // commit message. The measurement itself needs a server and lives in the integration file.
    expect(typeof BunSQL).toBe('function');
  });
});

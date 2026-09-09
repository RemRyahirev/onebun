/**
 * json/jsonb round trip against a real PostgreSQL.
 *
 * The unit file pins the SQL that gets rendered. This one is the only place that can answer the
 * question the defect was actually about: what is on disk. Every claim in
 * `packages/drizzle/src/pg-json-encoding.ts` about Bun's binding behaviour is measured here, not
 * assumed — including the two that made the obvious fixes wrong (`$1::jsonb` is a no-op, and an
 * identity encoder fails on a scalar).
 */

import { SQL as BunSQL } from 'bun';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  json,
  jsonb,
  pgTable,
  serial,
} from 'drizzle-orm/pg-core';

import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

import { createPostgresContainer, type TestContainer } from '@onebun/core/testing';

import { applyBunSqlJsonEncodingFix } from '../src/pg-json-encoding';

const CONTAINER_BOOT_MS = 120_000;
const CASE_TIMEOUT_MS = 30_000;

const table = pgTable('payloads', {
  id: serial('id').primaryKey(),
  data: jsonb('data'),
  doc: json('doc'),
  tags: jsonb('tags').array(),
});

let postgres: TestContainer;
let client: BunSQL;
let db: BunSQLDatabase;

/** `jsonb_typeof` and the raw text of the newest row, straight from the server. */
async function stored(id: number): Promise<{ ty: string | null; raw: string | null }> {
  const rows = await client`
    SELECT jsonb_typeof(data) AS ty, data::text AS raw FROM payloads WHERE id = ${id}
  ` as Array<{ ty: string | null; raw: string | null }>;

  return rows[0];
}

/** Insert through the ORM and report what the server holds. */
async function writeAndRead(value: unknown): Promise<{ ty: string | null; raw: string | null }> {
  const inserted = await db.insert(table).values({ data: value }).returning({ id: table.id });

  return await stored(inserted[0].id);
}

beforeAll(async () => {
  applyBunSqlJsonEncodingFix();
  postgres = await createPostgresContainer();
  client = new BunSQL(postgres.url);
  db = drizzle({ client });
}, CONTAINER_BOOT_MS);

afterAll(async () => {
  await client?.close();
  await postgres?.stop();
}, CONTAINER_BOOT_MS);

beforeEach(async () => {
  await client`DROP TABLE IF EXISTS payloads`;
  await client`
    CREATE TABLE payloads (
      id serial PRIMARY KEY,
      data jsonb,
      doc json,
      tags jsonb[]
    )
  `;
});

describe('the Bun binding contract this fix is built on', () => {
  it('JSON-encodes a pre-stringified param again unless it is forced through text', async () => {
    // The three measurements the fix rests on. If any of them changes, the cast is either
    // unnecessary or insufficient, and this is where that shows up.
    await client.unsafe(
      'INSERT INTO payloads (id, data) VALUES (1, $1)',
      [JSON.stringify(['x', 'y'])],
    );
    await client.unsafe(
      'INSERT INTO payloads (id, data) VALUES (2, $1::jsonb)',
      [JSON.stringify(['x', 'y'])],
    );
    await client.unsafe(
      'INSERT INTO payloads (id, data) VALUES (3, $1::text::jsonb)',
      [JSON.stringify(['x', 'y'])],
    );

    expect([
      (await stored(1)).ty,
      // `::jsonb` alone is a no-op — this is why the obvious one-cast fix does not work.
      (await stored(2)).ty,
      (await stored(3)).ty,
    ]).toEqual(['string', 'string', 'array']);
  }, CASE_TIMEOUT_MS);

  it('rejects a raw scalar bound straight at a jsonb column', async () => {
    // Why an identity `mapToDriverValue` is not the fix either.
    //
    // Wrapped in an async IIFE deliberately. A Bun `SQL` query object is LAZY — it starts when it
    // is awaited — and handing one straight to `expect(...).rejects` never starts it. The test
    // then hangs forever, and bun's per-case timeout does not interrupt it, so the whole file
    // stalls with no output. Awaiting inside a real promise is what makes it run.
    await expect((async () => {
      await client.unsafe('INSERT INTO payloads (data) VALUES ($1)', [42]);
    })()).rejects.toThrow(/jsonb|integer/);
  }, CASE_TIMEOUT_MS);
});

describe('what ends up on disk', () => {
  it('stores an array as jsonb array, not as a string', async () => {
    const row = await writeAndRead(['x', 'y']);

    expect(row.ty).toBe('array');
    expect(JSON.parse(row.raw!)).toEqual(['x', 'y']);
  }, CASE_TIMEOUT_MS);

  it('stores an object as jsonb object, matchable by containment', async () => {
    const inserted = await db.insert(table)
      .values({ data: { a: 1, b: [2, 3] } })
      .returning({ id: table.id });

    const matches = await client`
      SELECT count(*)::int AS n FROM payloads WHERE data @> '{"a":1}'
    ` as Array<{ n: number }>;

    expect((await stored(inserted[0].id)).ty).toBe('object');
    // `@>` matched nothing at all before the fix, on every row ever written.
    expect(matches[0].n).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('lets jsonb_array_length work, which it could not on a double-encoded row', async () => {
    const inserted = await db.insert(table).values({ data: [1, 2] }).returning({ id: table.id });

    const lengths = await client`
      SELECT jsonb_array_length(data) AS n FROM payloads WHERE id = ${inserted[0].id}
    ` as Array<{ n: number }>;

    expect(lengths[0].n).toBe(2);
  }, CASE_TIMEOUT_MS);

  it('keeps every scalar shape distinguishable', async () => {
    const shapes = await Promise.all(
      ['hello', 42, true, [], {}].map(async value => (await writeAndRead(value)).ty),
    );

    expect(shapes).toEqual(['string', 'number', 'boolean', 'array', 'object']);
  }, CASE_TIMEOUT_MS);

  it('round-trips embedded quotes and backslashes without escaping them twice', async () => {
    const payload = { note: 'she said "hi"\\there', path: 'C:\\temp' };
    const inserted = await db.insert(table).values({ data: payload }).returning({ id: table.id });

    const read = await db.select().from(table).where(eq(table.id, inserted[0].id));

    expect((await stored(inserted[0].id)).ty).toBe('object');
    expect(read[0].data).toEqual(payload);
  }, CASE_TIMEOUT_MS);

  it('writes an explicit null as SQL NULL, not as the JSON text null', async () => {
    const inserted = await db.insert(table).values({ data: null }).returning({ id: table.id });

    const nulls = await client`
      SELECT (data IS NULL) AS is_null FROM payloads WHERE id = ${inserted[0].id}
    ` as Array<{ is_null: boolean }>;

    expect(nulls[0].is_null).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('treats a json column the same way', async () => {
    const inserted = await db.insert(table)
      .values({ doc: { a: 1 } })
      .returning({ id: table.id });

    const rows = await client`
      SELECT json_typeof(doc) AS ty FROM payloads WHERE id = ${inserted[0].id}
    ` as Array<{ ty: string }>;

    expect(rows[0].ty).toBe('object');
  }, CASE_TIMEOUT_MS);

  it('round-trips jsonb[], which was already correct and must stay so', async () => {
    const inserted = await db.insert(table)
      .values({ tags: [{ a: 1 }, ['x']] })
      .returning({ id: table.id });

    const read = await db.select().from(table).where(eq(table.id, inserted[0].id));

    expect(read[0].tags).toEqual([{ a: 1 }, ['x']]);
  }, CASE_TIMEOUT_MS);

  it('applies to UPDATE .set() as well as INSERT', async () => {
    const inserted = await db.insert(table).values({ data: { v: 1 } }).returning({ id: table.id });

    await db.update(table).set({ data: { v: 2 } }).where(eq(table.id, inserted[0].id));

    const row = await stored(inserted[0].id);

    expect(row.ty).toBe('object');
    expect(JSON.parse(row.raw!)).toEqual({ v: 2 });
  }, CASE_TIMEOUT_MS);

  it('applies inside a transaction', async () => {
    const id = await db.transaction(async (tx) => {
      const inserted = await tx.insert(table)
        .values({ data: { inside: true } })
        .returning({ id: table.id });

      return inserted[0].id;
    });

    expect((await stored(id)).ty).toBe('object');
  }, CASE_TIMEOUT_MS);
});

describe('sql.placeholder() through .prepare()', () => {
  it('stores the same thing as the identical non-placeholder write, for every shape', async () => {
    const prepared = db.insert(table)
      .values({ data: sql.placeholder('d') })
      .returning({ id: table.id })
      .prepare('ins_placeholder');

    for (const value of [{ a: 1 }, ['x', 'y'], 'hello', 42, true]) {
      const viaPlaceholder = await prepared.execute({ d: value });
      const direct = await writeAndRead(value);

      expect(
        (await stored(viaPlaceholder[0].id)).ty,
        `placeholder and value paths disagree for ${JSON.stringify(value)}`,
      ).toBe(direct.ty);
    }
  }, CASE_TIMEOUT_MS);

  it('binds null as SQL NULL on the placeholder path too', async () => {
    // `fillPlaceholders` has no null guard, unlike the value path, so this is the branch that
    // would otherwise store the JSON text `null`.
    const prepared = db.insert(table)
      .values({ data: sql.placeholder('d') })
      .returning({ id: table.id })
      .prepare('ins_null');

    const inserted = await prepared.execute({ d: null });
    const nulls = await client`
      SELECT (data IS NULL) AS is_null FROM payloads WHERE id = ${inserted[0].id}
    ` as Array<{ is_null: boolean }>;

    expect(nulls[0].is_null).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('never stores the internals of a drizzle SQL object', async () => {
    // What the unpatched placeholder path did: `fillPlaceholders` pushes the encoder's result
    // straight into the params array, so an SQL chunk was serialized and stored whole.
    const prepared = db.insert(table)
      .values({ data: sql.placeholder('d') })
      .returning({ id: table.id })
      .prepare('ins_no_sql_internals');

    await prepared.execute({ d: { a: 1 } });

    const rows = await client`SELECT data::text AS raw FROM payloads` as Array<{ raw: string }>;

    for (const row of rows) {
      expect(row.raw).not.toMatch(/"queryChunks"|"decoder"|"shouldInlineParams"/);
    }
  }, CASE_TIMEOUT_MS);

  it('works on update, and twice from one prepared statement', async () => {
    const seed = await db.insert(table).values({ data: { v: 0 } }).returning({ id: table.id });

    const prepared = db.update(table)
      .set({ data: sql.placeholder('d') })
      .where(eq(table.id, seed[0].id))
      .prepare('upd_placeholder');

    await prepared.execute({ d: { v: 1 } });
    const first = await stored(seed[0].id);

    await prepared.execute({ d: ['second'] });
    const second = await stored(seed[0].id);

    // Two executions of ONE prepared instance: the cast must not accumulate and the second value
    // must not inherit the first's shape.
    expect([first.ty, second.ty]).toEqual(['object', 'array']);
    expect(JSON.parse(second.raw!)).toEqual(['second']);
  }, CASE_TIMEOUT_MS);
});

describe('repairing rows written before the fix', () => {
  it('converts a double-encoded row and leaves a legitimate string scalar alone', async () => {
    // A legacy row, written the way the broken encoder wrote them.
    await client.unsafe(
      'INSERT INTO payloads (id, data) VALUES (1, $1)',
      [JSON.stringify({ a: 1 })],
    );
    // And a row whose value genuinely IS the string "hello" — the repair must not touch it.
    await client.unsafe('INSERT INTO payloads (id, data) VALUES (2, $1::text::jsonb)', ['"hello"']);

    await client.unsafe(`
      UPDATE payloads SET data = (data #>> '{}')::jsonb
      WHERE jsonb_typeof(data) = 'string' AND (data #>> '{}') ~ '^\\s*[\\[{]'
    `);

    expect([(await stored(1)).ty, (await stored(2)).ty]).toEqual(['object', 'string']);
    expect((await stored(2)).raw).toBe('"hello"');
  }, CASE_TIMEOUT_MS);

  it('shows why the guard is not optional', async () => {
    // Without the `~ '^\\s*[\\[{]'` half, the same UPDATE tries to parse every string scalar and
    // fails on the first one that is not JSON — taking the whole repair with it.
    await client.unsafe('INSERT INTO payloads (id, data) VALUES (1, $1::text::jsonb)', ['"hello"']);

    // Async IIFE for the same reason as above: a bare Bun query handed to `.rejects` never runs.
    await expect((async () => {
      await client.unsafe(`
        UPDATE payloads SET data = (data #>> '{}')::jsonb WHERE jsonb_typeof(data) = 'string'
      `);
    })()).rejects.toThrow(/invalid input syntax for type json/);
  }, CASE_TIMEOUT_MS);
});

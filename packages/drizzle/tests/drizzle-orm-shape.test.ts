/**
 * Shape guard for the drizzle-orm internals `packages/drizzle/src/pg-json-encoding.ts` patches.
 *
 * That file reaches past drizzle's public surface into two places its semver contract says
 * nothing about: the `PgJsonb`/`PgJson`/`PgArray` column encoders, and
 * `BunSQLPreparedQuery.prototype.execute`/`.all` together with the `$N` numbering, the
 * synchronous reach to `fillPlaceholders`, and that function's lack of an `SQL` unwrap and of a
 * null guard.
 *
 * `packages/drizzle/package.json` declares `^0.44.7` — a caret — so a minor bump can land without
 * a code change and quietly break any of it. The mitigation is this file rather than review
 * discipline: every assertion fails loudly and names the file to fix.
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';
import {
  fillPlaceholders,
  Param,
  Placeholder,
  sql,
} from 'drizzle-orm';
import { BunSQLPreparedQuery, drizzle } from 'drizzle-orm/bun-sql';
import {
  jsonb,
  PgArray,
  PgDialect,
  PgJson,
  PgJsonb,
  pgTable,
  serial,
} from 'drizzle-orm/pg-core';


const FIX = 'packages/drizzle/src/pg-json-encoding.ts';

/** The installed drizzle-orm manifest. `drizzle-orm/package.json` ships no type declaration. */
 
const drizzlePackage = require('drizzle-orm/package.json') as { version: string };

const table = pgTable('t', {
  id: serial('id').primaryKey(),
  data: jsonb('data'),
});

/** Both prepared-statement entry points the patch wraps, reached without indexing by name. */
interface PreparedLike {
  execute(values: Record<string, unknown>): unknown;
  all(values: Record<string, unknown>): unknown;
}

/** A stub Bun SQL client: records nothing, resolves to no rows. */
function stubClient(): unknown {
  return {
    unsafe() {
      const thenable = Promise.resolve([] as unknown[]) as Promise<unknown[]> & {
        values(): Promise<unknown[]>;
      };
      thenable.values = () => Promise.resolve([]);

      return thenable;
    },
  };
}

describe('drizzle-orm shape assumptions', () => {
  it('is the version the patch was written against', () => {
    expect(
      drizzlePackage.version,
      `${FIX} patches drizzle-orm internals that are not covered by its semver contract. Re-verify `
      + 'every assumption in this file against the new version before changing this expectation.',
    ).toBe('0.44.7');
  });

  it('still owns the column encoders the patch replaces', () => {
    const owns = (target: object, name: string): boolean =>
      Object.prototype.hasOwnProperty.call(target, name);

    expect(owns(PgJsonb.prototype, 'mapToDriverValue'), `${FIX} replaces PgJsonb.mapToDriverValue`)
      .toBe(true);
    expect(owns(PgJsonb.prototype, 'mapFromDriverValue'), `${FIX} replaces PgJsonb.mapFromDriverValue`)
      .toBe(true);
    expect(owns(PgJson.prototype, 'mapToDriverValue'), `${FIX} replaces PgJson.mapToDriverValue`)
      .toBe(true);
    expect(owns(PgArray.prototype, 'mapToDriverValue'), `${FIX} wraps PgArray.mapToDriverValue`)
      .toBe(true);
  });

  it('still exposes execute and all on BunSQLPreparedQuery', () => {
    const names = Object.getOwnPropertyNames(BunSQLPreparedQuery.prototype);

    expect(names, `${FIX} wraps BunSQLPreparedQuery.prototype.execute`).toContain('execute');
    expect(names, `${FIX} wraps BunSQLPreparedQuery.prototype.all`).toContain('all');
  });

  it('still numbers parameters 1-based, which is what makes the $N rewrite sound', () => {
    expect(
      new PgDialect().escapeParam(0),
      `${FIX} rewrites the token at params index i as $(i+1); that mapping comes from escapeParam`,
    ).toBe('$1');
  });

  it('still returns the encoder result from fillPlaceholders verbatim, with no SQL unwrap', () => {
    // The unwrap exists in `buildQueryFromSourceParams` and NOT here, which is the whole reason
    // the encoder must return a plain string under `placeholderMode` instead of an SQL chunk.
    const sentinel = { notAString: true };
    const encoder = { mapToDriverValue: () => sentinel };

    const filled = fillPlaceholders(
      [new Param(new Placeholder('d'), encoder as never)],
      { d: { a: 1 } },
    );

    expect(
      filled[0],
      `${FIX} relies on fillPlaceholders NOT unwrapping an SQL result. If it now unwraps, the `
      + 'placeholderMode flag is unnecessary and the encoder can return an SQL chunk again.',
    ).toBe(sentinel);
  });

  it('still calls the encoder for null, with no null guard of its own', () => {
    // The value path short-circuits null before the encoder; this one does not. That asymmetry is
    // why the encoder returns null for null under the flag, so SQL NULL is bound rather than the
    // JSON text 'null'.
    const seen: unknown[] = [];
    const encoder = {
      mapToDriverValue(value: unknown) {
        seen.push(value);

        return value; 
      }, 
    };

    fillPlaceholders([new Param(new Placeholder('d'), encoder as never)], { d: null });

    expect(
      seen,
      `${FIX} handles null inside the encoder because fillPlaceholders has no null guard. If it `
      + 'has gained one, the null branch in the encoder is now dead.',
    ).toEqual([null]);
  });

  it('still fills placeholders synchronously, which is the placeholderMode window', () => {
    // The flag is process-global and is only safe because the window between setting and
    // clearing it contains no await: `execute` is async but nothing precedes the
    // `tracer.startActiveSpan` call, `startActiveSpan` invokes its callback synchronously, and
    // `fillPlaceholders` is the first statement of that callback.
    const runs: Array<[string, (prepared: PreparedLike) => unknown]> = [
      ['execute', prepared => prepared.execute({ d: { a: 1 } })],
      ['all', prepared => prepared.all({ d: { a: 1 } })],
    ];

    for (const [name, run] of runs) {
      // Captured unbound on purpose: it is put back on the prototype in the `finally`, and the
      // counting replacement calls it with an explicit `this`.
      // eslint-disable-next-line jest/unbound-method
      const original = PgJsonb.prototype.mapToDriverValue;
      let calls = 0;

      PgJsonb.prototype.mapToDriverValue = function counted(this: unknown, value: unknown): unknown {
        calls += 1;

        return original.call(this as never, value as never);
      } as typeof PgJsonb.prototype.mapToDriverValue;

      try {
        const db = drizzle({ client: stubClient() as never });
        const prepared = db.insert(table).values({ data: sql.placeholder('d') }).prepare(name);

        const pending = run(prepared as unknown as PreparedLike);

        expect(
          calls,
          `${FIX} sets a process-global placeholderMode flag around ${name}() and clears it `
          + 'before awaiting. That is safe only while fillPlaceholders runs synchronously, with no '
          + 'await before it. It no longer does, so the flag can now leak across a round trip and '
          + 'silently re-corrupt a concurrent non-placeholder json write.',
        ).toBe(1);

        void Promise.resolve(pending).catch(() => undefined);
      } finally {
        PgJsonb.prototype.mapToDriverValue = original;
      }
    }
  });
});

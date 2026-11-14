/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  describe,
  test,
  expect,
} from 'bun:test';

import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { pgTable, text as pgText } from '../src/pg';
import {
  getTableName,
  getPrimaryKeyColumn,
  isSQLiteTable,
  isPgTable,
} from '../src/schema-utils';
import { sqliteTable, text as sqliteText } from '../src/sqlite';

// Helpers to create mock table objects that exercise schema-utils code paths
// (schema-utils reads from ._/. directly, not drizzle Symbols)
function makeMockTableWithUnderscoreName(name: string, dialect?: string): PgTable<any> {
  return { _: { name, dialect } } as unknown as PgTable<any>;
}

function makeMockTableNoName(): PgTable<any> {
  return {} as unknown as PgTable<any>;
}

describe('getTableName', () => {
  test('should throw when the value is not a drizzle table', () => {
    expect(() => getTableName(makeMockTableNoName())).toThrow('Unable to extract table name from Drizzle table schema');
    expect(() => getTableName(makeMockTableWithUnderscoreName('users'))).toThrow(
      'Unable to extract table name from Drizzle table schema',
    );
  });
});

describe('getPrimaryKeyColumn', () => {
  test('should return column name when column has primary=true', () => {
    const table = {
      id: { primary: true, name: 'id' },
      title: { primary: false, name: 'title' },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBe('id');
  });

  test('should use key name when column.name is absent', () => {
    const table = {
      userId: { primary: true },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBe('userId');
  });

  test('should skip function-valued properties', () => {
    const table = {
      something: () => 'fn',
      id: { primary: true, name: 'id' },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBe('id');
  });

  test('should skip the _ property and still find PK', () => {
    const table = {
      _: { name: 'test_table' },
      id: { primary: true, name: 'id' },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBe('id');
  });

  test('should fall back to tableDef.columns when no direct PK found', () => {
    // No direct columns with primary=true, but _.columns has primary info
    const table = {
      _: {
        name: 'orders',
        columns: {
          order_id: { primaryKey: true },
          amount: {},
        },
      },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBe('order_id');
  });

  test('should detect primary via column.primary in tableDef.columns fallback', () => {
    const table = {
      _: {
        name: 'items',
        columns: {
          item_id: { primary: true },
        },
      },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBe('item_id');
  });

  test('should return null when no primary key found anywhere', () => {
    const table = {
      _: {
        name: 'no_pk',
        columns: {
          name: {},
          email: {},
        },
      },
    } as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBeNull();
  });

  test('should return null when table has no column-like properties and no _.columns', () => {
    const table = {} as unknown as SQLiteTable<any>;
    expect(getPrimaryKeyColumn(table)).toBeNull();
  });
});

describe('isSQLiteTable', () => {
  test('should return true when _.dialect is "sqlite"', () => {
    const table = makeMockTableWithUnderscoreName('users', 'sqlite') as unknown as SQLiteTable<any>;
    expect(isSQLiteTable(table)).toBe(true);
  });

  test('should return false when _.dialect is "pg"', () => {
    const table = makeMockTableWithUnderscoreName('users', 'pg') as unknown as SQLiteTable<any>;
    expect(isSQLiteTable(table)).toBe(false);
  });

  test('should return false when _.dialect is missing', () => {
    const table = makeMockTableWithUnderscoreName('users') as unknown as SQLiteTable<any>;
    expect(isSQLiteTable(table)).toBe(false);
  });

  test('should return false when _ is missing entirely', () => {
    const table = makeMockTableNoName() as unknown as SQLiteTable<any>;
    expect(isSQLiteTable(table)).toBe(false);
  });
});

describe('isPgTable', () => {
  test('should return true when _.dialect is "pg"', () => {
    const table = makeMockTableWithUnderscoreName('users', 'pg');
    expect(isPgTable(table)).toBe(true);
  });

  test('should return false when _.dialect is "sqlite"', () => {
    const table = makeMockTableWithUnderscoreName('users', 'sqlite');
    expect(isPgTable(table)).toBe(false);
  });

  test('should return true when _.dialect is missing (defaults to pg)', () => {
    const table = makeMockTableWithUnderscoreName('users');
    expect(isPgTable(table)).toBe(true);
  });

  test('should return true when _ is missing entirely (defaults to pg)', () => {
    const table = makeMockTableNoName();
    expect(isPgTable(table)).toBe(true);
  });
});

describe('schema utilities on real drizzle-orm tables', () => {
  const pgUsers = pgTable('users', { id: pgText('id').primaryKey() });
  const sqliteUsers = sqliteTable('accounts', { id: sqliteText('id').primaryKey() });

  test('getTableName returns the SQL name of a real pgTable', () => {
    expect(getTableName(pgUsers)).toBe('users');
  });

  test('getTableName returns the SQL name of a real sqliteTable', () => {
    expect(getTableName(sqliteUsers)).toBe('accounts');
  });

  test('getTableName ignores a column keyed "_"', () => {
    const odd = pgTable('odd', { _: pgText('_name_col') });
    expect(getTableName(odd)).toBe('odd');
    const oddSqlite = sqliteTable('odd_sqlite', { _: sqliteText('_name_col') });
    expect(getTableName(oddSqlite)).toBe('odd_sqlite');
  });

  test('getTableName ignores a column keyed "name"', () => {
    const named = pgTable('named', { name: pgText('full_name') });
    expect(getTableName(named)).toBe('named');
    const namedSqlite = sqliteTable('named_sqlite', { name: sqliteText('full_name') });
    expect(getTableName(namedSqlite)).toBe('named_sqlite');
  });

  test('getPrimaryKeyColumn finds the key of real tables, including a column keyed "_"', () => {
    expect(getPrimaryKeyColumn(pgUsers)).toBe('id');
    expect(getPrimaryKeyColumn(sqliteUsers)).toBe('id');
    const odd = pgTable('odd_pk', { _: pgText('_pk').primaryKey(), other: pgText('other') });
    expect(getPrimaryKeyColumn(odd)).toBe('_pk');
  });

  test('isPgTable / isSQLiteTable tell real tables apart', () => {
    expect(isPgTable(pgUsers)).toBe(true);
    expect(isSQLiteTable(pgUsers)).toBe(false);
    expect(isPgTable(sqliteUsers)).toBe(false);
    expect(isSQLiteTable(sqliteUsers)).toBe(true);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  describe,
  test,
  expect,
} from 'bun:test';

import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  getTableName,
  getPrimaryKeyColumn,
  isSQLiteTable,
  isPgTable,
} from '../src/schema-utils';

// Helpers to create mock table objects that exercise schema-utils code paths
// (schema-utils reads from ._/. directly, not drizzle Symbols)
function makeMockTableWithUnderscoreName(name: string, dialect?: string): PgTable<any> {
  return { _: { name, dialect } } as unknown as PgTable<any>;
}

function makeMockTableWithDirectName(name: string): PgTable<any> {
  return { name } as unknown as PgTable<any>;
}

function makeMockTableNoName(): PgTable<any> {
  return {} as unknown as PgTable<any>;
}

describe('getTableName', () => {
  test('should return name from _.name property', () => {
    const table = makeMockTableWithUnderscoreName('users');
    expect(getTableName(table)).toBe('users');
  });

  test('should return name from direct .name property when _.name is absent', () => {
    const table = makeMockTableWithDirectName('products');
    expect(getTableName(table)).toBe('products');
  });

  test('should throw when neither _.name nor .name is available', () => {
    const table = makeMockTableNoName();
    expect(() => getTableName(table)).toThrow('Unable to extract table name from Drizzle table schema');
  });

  test('should throw when _.name is not a string', () => {
    const table = { _: { name: 42 } } as unknown as PgTable<any>;
    expect(() => getTableName(table)).toThrow('Unable to extract table name from Drizzle table schema');
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

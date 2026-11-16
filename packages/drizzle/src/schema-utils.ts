/* eslint-disable 
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/no-unused-vars */
// Drizzle ORM uses complex conditional types that require `any` for table type parameters
// Unused type parameters in conditional types are used for type inference only

/**
 * Schema utilities for Drizzle ORM
 * Provides helper functions to extract types and metadata from Drizzle table schemas
 */

import {
  type Column,
  getTableColumns,
  getTableName as drizzleGetTableName,
  is,
  Table,
} from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * Extract Select type from a Drizzle table schema
 * @example
 * ```typescript
 * const users = pgTable('users', { ... });
 * type User = SelectType<typeof users>;
 * ```
 */
export type SelectType<TTable extends PgTable<any> | SQLiteTable<any>> =
  TTable extends PgTable<infer T>
    ? TTable['_']['inferSelect']
    : TTable extends SQLiteTable<infer T>
      ? TTable['_']['inferSelect']
      : never;

/**
 * Extract Insert type from a Drizzle table schema
 * @example
 * ```typescript
 * const users = pgTable('users', { ... });
 * type InsertUser = InsertType<typeof users>;
 * ```
 */
export type InsertType<TTable extends PgTable<any> | SQLiteTable<any>> =
  TTable extends PgTable<infer T>
    ? TTable['_']['inferInsert']
    : TTable extends SQLiteTable<infer T>
      ? TTable['_']['inferInsert']
      : never;

/**
 * Get table name from a Drizzle table schema
 * @param table - Drizzle table schema
 * @returns Table name as string
 * @throws Error when the value is not a drizzle table
 * @example
 * ```typescript
 * const users = pgTable('users', { ... });
 * const tableName = getTableName(users); // 'users'
 * ```
 */
export function getTableName<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): string {
  if (!is(table, Table)) {
    throw new Error('Unable to extract table name from Drizzle table schema');
  }

  return drizzleGetTableName(table);
}

/**
 * Find the primary-key column object of a table.
 *
 * Internal: not part of the package's public API. The returned object is the column itself,
 * ready to be passed to drizzle operators such as `eq()`, so the caller never has to know
 * whether the table's property key or the SQL column name is used. Resolution goes through the
 * table's own columns, never through an index by the SQL name.
 *
 * @param table - Drizzle table schema
 * @returns The primary-key column object, or null if the table has no primary key
 */
export function findPrimaryKeyColumn<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): Column | null {
  if (is(table, Table)) {
    for (const column of Object.values<Column>(getTableColumns(table))) {
      if (column.primary) {
        return column;
      }
    }

    return null;
  }

  // Plain objects shaped like a table: columns sit directly on the object
  const tableObj = table as any;
  for (const key in tableObj) {
    const column = tableObj[key];
    if (key !== '_' && typeof column === 'object' && column && column.primary === true) {
      return column as Column;
    }
  }

  const columns = tableObj._?.columns as Record<string, any> | undefined;
  if (columns) {
    for (const column of Object.values(columns)) {
      if (column?.primary === true || column?.primaryKey === true) {
        return column as Column;
      }
    }
  }

  return null;
}

/**
 * Get the SQL column name of the primary key of a Drizzle table schema.
 *
 * The result is the name of the column in the database (`text('user_id')` gives `'user_id'`),
 * not the property key it is declared under in the table object (`userId`). It is therefore not
 * a key of the table object: to address the column on the table, use the column object itself.
 *
 * @param table - Drizzle table schema
 * @returns Primary key SQL column name, or null if no primary key found
 * @example
 * ```typescript
 * const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   name: text('name'),
 * });
 * const pkColumn = getPrimaryKeyColumn(users); // 'id'
 * ```
 */
export function getPrimaryKeyColumn<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): string | null {
  const tableObj = table as any;

  // Real drizzle tables: read the columns through drizzle's own accessor
  if (is(table, Table)) {
    for (const [key, column] of Object.entries<Column>(getTableColumns(table))) {
      if (column.primary) {
        return column.name || key;
      }
    }

    return null;
  }

  // Plain objects shaped like a table: columns sit directly on the object
  
  // Iterate through table properties to find columns
  for (const key in tableObj) {
    // Skip internal properties
    if (key === '_' || typeof tableObj[key] === 'function') {
      continue;
    }
    
    const column = tableObj[key];
    // Check if this is a column object (has primary property)
    if (column && typeof column === 'object' && 'primary' in column) {
      // Check if this column is marked as primary key
      if (column.primary === true) {
        // Get column name - it's stored in column.name
        const columnName = column.name || key;

        return columnName;
      }
    }
  }
  
  // Fallback: try to access through tableDef.columns if it exists
  const tableDef = tableObj._;
  if (tableDef && tableDef.columns) {
    const columns = tableDef.columns as Record<string, any>;
    for (const [columnName, column] of Object.entries(columns)) {
      const columnDef = column as any;
      if (columnDef?.primary === true || columnDef?.primaryKey === true) {
        return columnName;
      }
    }
  }

  return null;
}

/**
 * Type guard to check if a table is a PostgreSQL table
 */
export function isPgTable(
  table: PgTable<any> | SQLiteTable<any>,
): table is PgTable<any> {
  if (is(table, PgTable)) {
    return true;
  }
  if (is(table, SQLiteTable)) {
    return false;
  }
  // Plain objects shaped like a table
  const tableDef = (table as any)._;

  return tableDef?.dialect === 'pg' || !tableDef?.dialect;
}

/**
 * Type guard to check if a table is a SQLite table
 */
export function isSQLiteTable(
  table: PgTable<any> | SQLiteTable<any>,
): table is SQLiteTable<any> {
  if (is(table, SQLiteTable)) {
    return true;
  }
  if (is(table, PgTable)) {
    return false;
  }
  const tableDef = (table as any)._;

  return tableDef?.dialect === 'sqlite';
}

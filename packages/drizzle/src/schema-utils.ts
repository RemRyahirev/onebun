/**
 * Schema utilities for Drizzle ORM
 * Provides helper functions to extract types and metadata from Drizzle table schemas
 */

import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

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
 * @example
 * ```typescript
 * const users = pgTable('users', { ... });
 * const tableName = getTableName(users); // 'users'
 * ```
 */
export function getTableName<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): string {
  // Try to get table name from drizzle internal structure
  // Drizzle stores table name in the table object
  const tableDef = (table as any)._;
  if (tableDef && typeof tableDef.name === 'string') {
    return tableDef.name;
  }
  
  // Alternative: try to get from table directly
  const tableName = (table as any).name;
  if (typeof tableName === 'string') {
    return tableName;
  }
  
  throw new Error('Unable to extract table name from Drizzle table schema');
}

/**
 * Get primary key column name from a Drizzle table schema
 * @param table - Drizzle table schema
 * @returns Primary key column name, or null if no primary key found
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
  // Drizzle stores columns directly on the table object (not in tableDef.columns)
  // Check each property on the table to find the primary key column
  const tableObj = table as any;
  
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
  // Check if table has PostgreSQL-specific properties
  const tableDef = (table as any)._;

  return tableDef?.dialect === 'pg' || !tableDef?.dialect;
}

/**
 * Type guard to check if a table is a SQLite table
 */
export function isSQLiteTable(
  table: PgTable<any> | SQLiteTable<any>,
): table is SQLiteTable<any> {
  const tableDef = (table as any)._;

  return tableDef?.dialect === 'sqlite';
}

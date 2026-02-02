/**
 * SQLite schema builders re-exported from drizzle-orm/sqlite-core
 *
 * Usage:
 * ```typescript
 * import { sqliteTable, text, integer, real, blob } from '@onebun/drizzle/sqlite';
 * ```
 */

// Table and view builders
export {
  sqliteTable,
  sqliteView,
} from 'drizzle-orm/sqlite-core';

// Column types
export {
  blob,
  customType,
  integer,
  numeric,
  real,
  text,
} from 'drizzle-orm/sqlite-core';

// Constraints and indexes
export {
  check,
  foreignKey,
  index,
  primaryKey,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Types for type inference
export type {
  SQLiteTable,
  SQLiteColumn,
  SQLiteTableWithColumns,
} from 'drizzle-orm/sqlite-core';

/**
 * \@onebun/drizzle
 *
 * Drizzle ORM module for OneBun framework with support for SQLite and PostgreSQL
 */

// Types and interfaces
export type {
  DatabaseConnectionOptions,
  DatabaseInstance,
  DatabaseTypeLiteral,
  DatabaseInstanceForType,
  InferDbTypeFromTable,
  DatabaseType as DatabaseTypeEnum,
  DrizzleModuleOptions,
  IRepository,
  MigrationOptions,
  PostgreSQLConnectionOptions,
  SQLiteConnectionOptions,
} from './types';

export { DatabaseType } from './types';

// Module and service
export { DrizzleModule } from './drizzle.module';
export { DrizzleService } from './drizzle.service';

// Repository
export { BaseRepository, type QueryBuilder } from './repository';

// Entity decorator
export { Entity, getEntityMetadata } from './entity.decorator';

// Schema utilities
export {
  getTableName,
  getPrimaryKeyColumn,
  isPgTable,
  isSQLiteTable,
} from './schema-utils';

export type {
  SelectType,
  InsertType,
} from './schema-utils';

// Migration utilities
export { generateMigrations, pushSchema } from './migrations';

// Validation utilities
export * from './validation';

// ============================================================================
// Re-exports from drizzle-orm (common utilities for all dialects)
// ============================================================================

// Query operators - comparison
export {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  between,
  notBetween,
} from 'drizzle-orm';

// Query operators - logical
export {
  and,
  or,
  not,
} from 'drizzle-orm';

// Query operators - pattern matching
export {
  like,
  ilike,
  notLike,
  notIlike,
} from 'drizzle-orm';

// Query operators - array
export {
  inArray,
  notInArray,
} from 'drizzle-orm';

// Query operators - null
export {
  isNull,
  isNotNull,
} from 'drizzle-orm';

// SQL template and raw
export {
  sql,
} from 'drizzle-orm';

// Aggregates
export {
  count,
  sum,
  avg,
  min,
  max,
} from 'drizzle-orm';

// Ordering
export {
  asc,
  desc,
} from 'drizzle-orm';

// Relations
export {
  relations,
} from 'drizzle-orm';

// ============================================================================
// Re-exports from drizzle-kit (config helper)
// ============================================================================

export { defineConfig } from 'drizzle-kit';

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

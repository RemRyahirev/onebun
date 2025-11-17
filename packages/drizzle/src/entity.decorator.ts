/**
 * Entity decorator for Drizzle repositories
 * Automatically initializes BaseRepository with the provided table schema
 * 
 * @param table - Drizzle table schema (pgTable or sqliteTable)
 * @example
 * ```typescript
 * import { Entity } from '@onebun/drizzle';
 * import { users } from '../schema/users';
 * 
 * @Entity(users)
 * export class UserRepository extends BaseRepository<typeof users> {
 *   // Business logic methods here
 * }
 * ```
 */
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { DatabaseType } from './types';
import type { InferDbTypeFromTable } from './types';

import type { BaseRepository } from './repository';
import type { DrizzleService } from './drizzle.service';

// Metadata storage for entity decorators
const ENTITY_METADATA = new Map<Function, PgTable<any> | SQLiteTable<any>>();

export function Entity<TTable extends PgTable<any> | SQLiteTable<any>>(table: TTable) {
  type TDbType = InferDbTypeFromTable<TTable>;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends new (...args: any[]) => BaseRepository<TTable>>(target: T) => {
    // Store table schema in metadata
    ENTITY_METADATA.set(target, table);
    
    // Create wrapped class that automatically initializes with table schema
    // The wrapped class only requires DrizzleService as constructor argument
    class WrappedRepository extends target {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-useless-constructor
      constructor(...args: any[]) {
        // First argument should be DrizzleService with correct type (inferred from table)
        const drizzleService = args[0] as DrizzleService<TDbType>;
        // Pass drizzleService and table to parent constructor
        super(drizzleService, table);
      }
    }
    
    // Copy static properties
    Object.setPrototypeOf(WrappedRepository, target);
    Object.defineProperty(WrappedRepository, 'name', {
      value: target.name,
      configurable: true,
    });
    
    // Return wrapped class - TypeScript will infer the correct constructor signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return WrappedRepository as any as new (drizzleService: DrizzleService<TDbType>) => InstanceType<T>;
  };
}

/**
 * Get entity metadata (table schema) for a repository class
 */
export function getEntityMetadata(target: Function): PgTable<any> | SQLiteTable<any> | undefined {
  return ENTITY_METADATA.get(target);
}


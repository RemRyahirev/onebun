import type { DrizzleModuleOptions } from './types';

import { Module } from '@onebun/core';


import { DrizzleService } from './drizzle.service';

// Symbol to store module options
const DRIZZLE_MODULE_OPTIONS = Symbol('DRIZZLE_MODULE_OPTIONS');

/**
 * Drizzle module that can be imported in other modules
 * Provides DrizzleService that can be injected into controllers and services
 * 
 * Uses Bun.SQL for PostgreSQL (built-in Bun adapter) and bun:sqlite for SQLite.
 * No external database drivers required - uses native Bun capabilities.
 * 
 * Configuration is loaded from environment variables by default,
 * but can be overridden with module options.
 * 
 * Environment variables:
 * - DB_TYPE: 'sqlite' or 'postgresql' (default: 'sqlite')
 * - DB_URL: Database connection URL (default: ':memory:' for SQLite)
 * - DB_SCHEMA_PATH: Path to schema files (optional)
 * - DB_MIGRATIONS_FOLDER: Path to migrations folder (default: './drizzle')
 * - DB_AUTO_MIGRATE: Whether to run migrations on startup (default: false)
 * - DB_LOG_QUERIES: Whether to log SQL queries (default: false)
 * 
 * @example Basic usage with environment variables
 * ```typescript
 * import { Module } from '@onebun/core';
 * import { DrizzleModule } from '@onebun/drizzle';
 * 
 * @Module({
 *   imports: [DrizzleModule],
 *   controllers: [MyController],
 * })
 * export class AppModule {}
 * ```
 * 
 * @example With module options (overrides environment variables)
 * ```typescript
 * import { Module } from '@onebun/core';
 * import { DrizzleModule, DatabaseType } from '@onebun/drizzle';
 * 
 * @Module({
 *   imports: [
 *     DrizzleModule.forRoot({
 *       connection: {
 *         type: DatabaseType.POSTGRESQL,
 *         options: {
 *           url: 'postgresql://user:password@localhost:5432/mydb',
 *         },
 *       },
 *       autoMigrate: true,
 *       migrationsFolder: './migrations',
 *     }),
 *   ],
 *   controllers: [MyController],
 * })
 * export class AppModule {}
 * ```
 * 
 * Then inject DrizzleService in your controller:
 * ```typescript
 * import { Controller, Get } from '@onebun/core';
 * import { DrizzleService } from '@onebun/drizzle';
 * 
 * @Controller('/api')
 * export class MyController {
 *   constructor(private drizzleService: DrizzleService) {}
 *   
 *   @Get('/users')
 *   async getUsers() {
 *     const db = this.drizzleService.getDatabase();
 *     const users = await db.select().from(usersTable);
 *     return { users };
 *   }
 * }
 * ```
 */
@Module({
  providers: [DrizzleService],
  exports: [DrizzleService],
})
export class DrizzleModule {
  /**
   * Configure drizzle module with custom options
   * Options will override environment variables
   * 
   * @param options - Drizzle module configuration options
   * @returns Module class with configuration
   * 
   * @example
   * ```typescript
   * DrizzleModule.forRoot({
   *   connection: {
   *     type: DatabaseType.SQLITE,
   *     options: {
   *       url: './data.db',
   *     },
   *   },
   *   autoMigrate: true,
   * })
   * ```
   */
  static forRoot(options: DrizzleModuleOptions): typeof DrizzleModule {
    // Store options in a static property that DrizzleService can access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (DrizzleModule as any)[DRIZZLE_MODULE_OPTIONS] = options;

    return DrizzleModule;
  }

  /**
   * Get module options (used internally by DrizzleService)
   * @internal
   */
  static getOptions(): DrizzleModuleOptions | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (DrizzleModule as any)[DRIZZLE_MODULE_OPTIONS];
  }

  /**
   * Clear module options (useful for testing)
   * @internal
   */
  static clearOptions(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (DrizzleModule as any)[DRIZZLE_MODULE_OPTIONS] = undefined;
  }
}

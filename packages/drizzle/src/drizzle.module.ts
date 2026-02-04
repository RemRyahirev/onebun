import type { DrizzleModuleOptions } from './types';

import {
  Global,
  Module,
  removeFromGlobalModules,
} from '@onebun/core';


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
 * By default, DrizzleModule is global - DrizzleService is available in all modules
 * without explicit import. Use `isGlobal: false` to disable this behavior.
 * 
 * Configuration is loaded from environment variables by default,
 * but can be overridden with module options.
 * 
 * Environment variables:
 * - DB_TYPE: 'sqlite' or 'postgresql' (default: 'sqlite')
 * - DB_URL: Database connection URL (default: ':memory:' for SQLite)
 * - DB_SCHEMA_PATH: Path to schema files (optional)
 * - DB_MIGRATIONS_FOLDER: Path to migrations folder (default: './drizzle')
 * - DB_AUTO_MIGRATE: Whether to run migrations on startup (default: true)
 * - DB_LOG_QUERIES: Whether to log SQL queries (default: false)
 * 
 * @example Basic usage with environment variables (global by default)
 * ```typescript
 * import { Module } from '@onebun/core';
 * import { DrizzleModule } from '@onebun/drizzle';
 * 
 * @Module({
 *   imports: [DrizzleModule],
 *   controllers: [MyController],
 * })
 * export class AppModule {}
 * 
 * // DrizzleService is automatically available in all submodules
 * @Module({
 *   controllers: [UserController],
 *   providers: [UserService], // UserService can inject DrizzleService
 * })
 * export class UserModule {}
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
 * @example Non-global mode (for multi-database scenarios)
 * ```typescript
 * // Each import creates a new DrizzleService instance
 * DrizzleModule.forRoot({
 *   connection: { ... },
 *   isGlobal: false,
 * })
 * 
 * // Submodules must explicitly import DrizzleModule.forFeature()
 * @Module({
 *   imports: [DrizzleModule.forFeature()],
 *   providers: [UserService],
 * })
 * export class UserModule {}
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
@Global()
@Module({
  providers: [DrizzleService],
  exports: [DrizzleService],
})
export class DrizzleModule {
  /**
   * Configure drizzle module with custom options
   * Options will override environment variables
   * 
   * By default, isGlobal is true - DrizzleService is available in all modules.
   * Set isGlobal: false for multi-database scenarios where each import
   * should create a new DrizzleService instance.
   * 
   * @param options - Drizzle module configuration options
   * @returns Module class with configuration
   * 
   * @example Global mode (default)
   * ```typescript
   * DrizzleModule.forRoot({
   *   connection: {
   *     type: DatabaseType.SQLITE,
   *     options: { url: './data.db' },
   *   },
   *   autoMigrate: true,
   * })
   * ```
   * 
   * @example Non-global mode (for multiple databases)
   * ```typescript
   * DrizzleModule.forRoot({
   *   connection: {
   *     type: DatabaseType.POSTGRESQL,
   *     options: { ... },
   *   },
   *   isGlobal: false, // Each import creates new instance
   * })
   * ```
   */
  static forRoot(options: DrizzleModuleOptions): typeof DrizzleModule {
    // Store options in a static property that DrizzleService can access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (DrizzleModule as any)[DRIZZLE_MODULE_OPTIONS] = options;

    // If isGlobal is explicitly set to false, remove from global modules registry
    // This allows creating separate DrizzleService instances for multi-DB scenarios
    if (options.isGlobal === false) {
      removeFromGlobalModules(DrizzleModule);
    }

    return DrizzleModule;
  }

  /**
   * Import DrizzleModule into a feature module
   * 
   * Use this method when DrizzleModule is not global (isGlobal: false)
   * and you need to explicitly import DrizzleService in a submodule.
   * 
   * When DrizzleModule is global (default), you don't need to use forFeature() -
   * DrizzleService is automatically available in all modules.
   * 
   * @returns Module class that exports DrizzleService
   * 
   * @example
   * ```typescript
   * // In root module: non-global DrizzleModule
   * @Module({
   *   imports: [
   *     DrizzleModule.forRoot({
   *       connection: { ... },
   *       isGlobal: false,
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * 
   * // In feature module: explicitly import DrizzleService
   * @Module({
   *   imports: [DrizzleModule.forFeature()],
   *   providers: [UserService],
   * })
   * export class UserModule {}
   * ```
   */
  static forFeature(): typeof DrizzleModule {
    // Simply return the module class - it already exports DrizzleService
    // The module system will handle service instance resolution
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

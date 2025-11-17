/**
 * Application module for integration tests
 * Demonstrates usage of Drizzle ORM with schema-first approach
 */
import { Module } from '@onebun/core';

import { DrizzleModule, DatabaseType } from '../../src/index';

import { UserController } from './controllers/user.controller';
import { UserRepository } from './repositories/user.repository';
import { UserService } from './services/user.service';

/**
 * Application module with Drizzle ORM integration
 * Uses schema-first approach where pgTable/sqliteTable is the single source of truth
 */
@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: {
          url: process.env.DB_URL || ':memory:',
        },
      },
      autoMigrate: false, // Set to true to auto-run migrations on startup
      migrationsFolder: './drizzle',
    }),
  ],
  controllers: [UserController],
  providers: [UserRepository, UserService],
})
export class AppModule {}

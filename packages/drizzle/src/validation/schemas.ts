import {
  createInsertSchema as drizzleCreateInsertSchema,
  createSelectSchema as drizzleCreateSelectSchema,
  createUpdateSchema as drizzleCreateUpdateSchema,
} from 'drizzle-arktype';

import type { Type } from 'arktype';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * Create an arktype schema for validating data selected from a Drizzle table
 * Use this for validating API responses
 *
 * @param table - Drizzle table schema (pgTable or sqliteTable)
 * @returns ArkType schema for select operations
 *
 * @example
 * ```typescript
 * import { users } from './schema/users';
 * import { createSelectSchema } from '@onebun/drizzle/validation';
 *
 * const userSelectSchema = createSelectSchema(users);
 *
 * @Get('/users')
 * @ApiResponse(200, { schema: userSelectSchema.array() })
 * async getUsers(): Promise<User[]> {
 *   const users = await this.repository.findAll();
 *   return users; // Validated against userSelectSchema
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSelectSchema<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): Type<typeof table.$inferSelect> {
  return drizzleCreateSelectSchema(table) as Type<typeof table.$inferSelect>;
}

/**
 * Create an arktype schema for validating data to be inserted into a Drizzle table
 * Use this for validating API request bodies for create operations
 *
 * @param table - Drizzle table schema (pgTable or sqliteTable)
 * @returns ArkType schema for insert operations
 *
 * @example
 * ```typescript
 * import { users } from './schema/users';
 * import { createInsertSchema } from '@onebun/drizzle/validation';
 *
 * const userInsertSchema = createInsertSchema(users);
 *
 * @Post('/users')
 * async createUser(
 *   @Body(userInsertSchema) userData: Infer<typeof userInsertSchema>
 * ): Promise<Response> {
 *   const user = await this.repository.create(userData);
 *   return this.success({ user });
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInsertSchema<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): Type<typeof table.$inferInsert> {
  return drizzleCreateInsertSchema(table) as Type<typeof table.$inferInsert>;
}

/**
 * Create an arktype schema for validating data to be updated in a Drizzle table
 * Use this for validating API request bodies for update operations
 *
 * @param table - Drizzle table schema (pgTable or sqliteTable)
 * @returns ArkType schema for update operations (all fields optional except generated ones)
 *
 * @example
 * ```typescript
 * import { users } from './schema/users';
 * import { createUpdateSchema } from '@onebun/drizzle/validation';
 *
 * const userUpdateSchema = createUpdateSchema(users);
 *
 * @Put('/users/:id')
 * async updateUser(
 *   @Param('id') id: string,
 *   @Body(userUpdateSchema) userData: Partial<Infer<typeof userUpdateSchema>>
 * ): Promise<Response> {
 *   const user = await this.repository.update(id, userData);
 *   return this.success({ user });
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createUpdateSchema<TTable extends PgTable<any> | SQLiteTable<any>>(
  table: TTable,
): Type<Partial<typeof table.$inferInsert>> {
  return drizzleCreateUpdateSchema(table) as Type<Partial<typeof table.$inferInsert>>;
}

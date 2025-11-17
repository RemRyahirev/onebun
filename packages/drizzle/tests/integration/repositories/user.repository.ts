/**
 * User repository for integration tests
 * Extends BaseRepository with business logic methods
 */
import {
  eq,
  between
} from 'drizzle-orm';

import { BaseRepository } from '../../../src/repository';
import { Entity } from '../../../src/entity.decorator';
import { users, type User } from '../schema/users';

/**
 * User repository - extends BaseRepository with business logic methods
 * BaseRepository provides all CRUD operations (findAll, findById, create, update, delete, count)
 * This class adds only business-specific methods
 *
 * @Entity decorator automatically initializes the repository with the users table schema.
 * Database type is automatically inferred from the table schema (SQLite in this case).
 *
 * You can also use BaseRepository without decorator - just pass DrizzleService and table:
 * ```typescript
 * export class UserRepository extends BaseRepository<typeof users> {
 *   constructor(drizzleService: DrizzleService) {
 *     super(drizzleService, users);
 *   }
 * }
 * ```
 * The DrizzleService type will be automatically inferred from the table schema.
 */
@Entity(users)
export class UserRepository extends BaseRepository<typeof users> {
  /**
   * Business logic: Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const results = await this.db
      .select()
      .from(this.table)
      .where(eq(this.table.email, email));

    return results[0] || null;
  }

  /**
   * Business logic: Find users by age range
   */
  async findByAgeRange(minAge: number, maxAge: number): Promise<User[]> {
    const results = await this.db
      .select()
      .from(this.table)
      .where(between(this.table.age, minAge, maxAge));

    return results;
  }
}

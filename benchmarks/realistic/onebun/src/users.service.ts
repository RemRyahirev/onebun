import { BaseService, Service } from '@onebun/core';
import { DrizzleService, eq } from '@onebun/drizzle';

import { users } from './schema';

import type { CreateUserBody } from './schemas';

@Service()
export class UsersService extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findById(id: number) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user ?? null;
  }

  async create(data: CreateUserBody) {
    const [created] = await this.db
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return created;
  }
}

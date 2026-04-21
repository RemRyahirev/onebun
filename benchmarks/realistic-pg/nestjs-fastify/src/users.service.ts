import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { users } from './schema';

@Injectable()
export class UsersService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: any,
  ) {}

  async findById(id: number) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user ?? null;
  }

  async create(data: { name: string; email: string }) {
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

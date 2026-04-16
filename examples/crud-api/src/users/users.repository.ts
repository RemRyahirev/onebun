import type {
  User,
  CreateUserDto,
  UpdateUserDto,
} from './schemas/user.schema';

import { Service, BaseService } from '@onebun/core';

/**
 * User repository - handles data storage
 * In production, this would use a database
 */
@Service()
export class UserRepository extends BaseService {
  private users = new Map<string, User>();

  /**
   * Find all users with pagination
   */
  async findAll(options?: {
    page?: number;
    limit?: number;
  }): Promise<{ users: User[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const offset = (page - 1) * limit;

    const allUsers = Array.from(this.users.values());
    const users = allUsers.slice(offset, offset + limit);

    return {
      users,
      total: allUsers.length,
    };
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }

    return null;
  }

  /**
   * Create new user
   */
  async create(data: CreateUserDto): Promise<User> {
    const now = new Date().toISOString();
    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email,
      age: data.age,
      role: data.role || 'user',
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    this.logger.debug('User created in repository', { userId: user.id });

    return user;
  }

  /**
   * Update user
   */
  async update(id: string, data: UpdateUserDto): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) {
      return null;
    }

    const updatedUser: User = {
      ...user,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    this.users.set(id, updatedUser);
    this.logger.debug('User updated in repository', { userId: id });

    return updatedUser;
  }

  /**
   * Delete user
   */
  async delete(id: string): Promise<boolean> {
    const deleted = this.users.delete(id);
    if (deleted) {
      this.logger.debug('User deleted from repository', { userId: id });
    }

    return deleted;
  }
}

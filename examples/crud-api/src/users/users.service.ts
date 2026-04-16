import type {
  User,
  CreateUserDto,
  UpdateUserDto,
  UserListResponse,
} from './schemas/user.schema';

import {
  Service,
  BaseService,
  NotFoundError,
} from '@onebun/core';
import { Span } from '@onebun/trace';

import { UserRepository } from './users.repository';

/**
 * User service - business logic layer
 */
@Service()
export class UserService extends BaseService {
  constructor(private userRepository: UserRepository) {
    super();
  }

  /**
   * Get all users with pagination
   */
  @Span('user-find-all')
  async findAll(page = 1, limit = 10): Promise<UserListResponse> {
    this.logger.info('Finding all users', { page, limit });

    const { users, total } = await this.userRepository.findAll({ page, limit });

    return {
      users,
      total,
      page,
      limit,
    };
  }

  /**
   * Get user by ID
   */
  @Span('user-find-by-id')
  async findById(id: string): Promise<User> {
    this.logger.info('Finding user by ID', { id });

    const user = await this.userRepository.findById(id);

    if (!user) {
      this.logger.warn('User not found', { id });
      throw new NotFoundError('User', id);
    }

    return user;
  }

  /**
   * Create new user
   */
  @Span('user-create')
  async create(data: CreateUserDto): Promise<User> {
    this.logger.info('Creating user', { email: data.email });

    // Check for duplicate email
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) {
      this.logger.warn('Duplicate email', { email: data.email });
      throw new Error('Email already exists');
    }

    const user = await this.userRepository.create(data);
    this.logger.info('User created', { userId: user.id, email: user.email });

    return user;
  }

  /**
   * Update user
   */
  @Span('user-update')
  async update(id: string, data: UpdateUserDto): Promise<User> {
    this.logger.info('Updating user', { id, fields: Object.keys(data) });

    // Check if user exists
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('User', id);
    }

    // Check email uniqueness if email is being changed
    if (data.email && data.email !== existing.email) {
      const emailUser = await this.userRepository.findByEmail(data.email);
      if (emailUser) {
        throw new Error('Email already exists');
      }
    }

    const user = await this.userRepository.update(id, data);
    if (!user) {
      throw new NotFoundError('User', id);
    }

    this.logger.info('User updated', { userId: id });

    return user;
  }

  /**
   * Delete user
   */
  @Span('user-delete')
  async delete(id: string): Promise<void> {
    this.logger.info('Deleting user', { id });

    const deleted = await this.userRepository.delete(id);

    if (!deleted) {
      throw new NotFoundError('User', id);
    }

    this.logger.info('User deleted', { userId: id });
  }
}

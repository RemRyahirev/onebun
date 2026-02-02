---
description: Complete CRUD API example with database, validation, error handling. REST endpoints, repository pattern.
---

# CRUD API Example

A complete CRUD API with validation, error handling, and best practices.

## Project Structure

```
crud-api/
├── src/
│   ├── index.ts
│   ├── app.module.ts
│   ├── config.ts
│   └── users/
│       ├── users.module.ts
│       ├── users.controller.ts
│       ├── users.service.ts
│       ├── users.repository.ts
│       └── schemas/
│           └── user.schema.ts
├── .env
├── package.json
└── tsconfig.json
```

## src/config.ts

```typescript
import { Env } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
  app: {
    name: Env.string({ default: 'crud-api' }),
  },
};
```

## src/users/schemas/user.schema.ts

```typescript
import { type } from 'arktype';

/**
 * User entity schema
 */
export const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
  role: '"admin" | "user" | "guest"',
  createdAt: 'string',
  updatedAt: 'string',
});

export type User = typeof userSchema.infer;

/**
 * Create user DTO schema
 */
export const createUserSchema = type({
  name: 'string >= 2',
  email: 'string.email',
  'age?': 'number > 0',
  'role?': '"admin" | "user" | "guest"',
});

export type CreateUserDto = typeof createUserSchema.infer;

/**
 * Update user DTO schema (partial of CreateUserDto)
 */
export const updateUserSchema = createUserSchema.partial();

export type UpdateUserDto = typeof updateUserSchema.infer;

/**
 * User list response schema
 */
export const userListSchema = type({
  users: userSchema.array(),
  total: 'number',
  page: 'number',
  limit: 'number',
});

export type UserListResponse = typeof userListSchema.infer;
```

## src/users/users.repository.ts

```typescript
import { Service, BaseService } from '@onebun/core';
import type { User, CreateUserDto, UpdateUserDto } from './schemas/user.schema';

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
```

## src/users/users.service.ts

```typescript
import { Service, BaseService, Span, NotFoundError } from '@onebun/core';
import { UserRepository } from './users.repository';
import type {
  User,
  CreateUserDto,
  UpdateUserDto,
  UserListResponse,
} from './schemas/user.schema';

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
```

## src/users/users.controller.ts

```typescript
import {
  Controller,
  BaseController,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpStatusCode,
  ApiResponse,
} from '@onebun/core';

import { UserService } from './users.service';
import {
  createUserSchema,
  updateUserSchema,
  userSchema,
  userListSchema,
  type CreateUserDto,
  type UpdateUserDto,
} from './schemas/user.schema';

@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  /**
   * GET /api/users
   * List all users with pagination
   */
  @Get('/')
  @ApiResponse(200, { schema: userListSchema, description: 'List of users' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<Response> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    // Validate pagination params
    if (pageNum < 1) {
      return this.error('Page must be >= 1', HttpStatusCode.BAD_REQUEST, HttpStatusCode.BAD_REQUEST);
    }
    if (limitNum < 1 || limitNum > 100) {
      return this.error('Limit must be between 1 and 100', HttpStatusCode.BAD_REQUEST, HttpStatusCode.BAD_REQUEST);
    }

    const result = await this.userService.findAll(pageNum, limitNum);
    return this.success(result);
  }

  /**
   * GET /api/users/:id
   * Get user by ID
   */
  @Get('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User found' })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<Response> {
    try {
      const user = await this.userService.findById(id);
      return this.success(user);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return this.error('User not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
      }
      throw error;
    }
  }

  /**
   * POST /api/users
   * Create new user
   */
  @Post('/')
  @ApiResponse(201, { schema: userSchema, description: 'User created' })
  @ApiResponse(400, { description: 'Validation error' })
  @ApiResponse(409, { description: 'Email already exists' })
  async create(
    @Body(createUserSchema) body: CreateUserDto,
  ): Promise<Response> {
    try {
      const user = await this.userService.create(body);
      return this.success(user, HttpStatusCode.CREATED);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return this.error('Email already exists', HttpStatusCode.CONFLICT, HttpStatusCode.CONFLICT);
      }
      throw error;
    }
  }

  /**
   * PUT /api/users/:id
   * Update user
   */
  @Put('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User updated' })
  @ApiResponse(400, { description: 'Validation error' })
  @ApiResponse(404, { description: 'User not found' })
  @ApiResponse(409, { description: 'Email already exists' })
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: UpdateUserDto,
  ): Promise<Response> {
    try {
      const user = await this.userService.update(id, body);
      return this.success(user);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return this.error('User not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
        }
        if (error.message.includes('already exists')) {
          return this.error('Email already exists', HttpStatusCode.CONFLICT, HttpStatusCode.CONFLICT);
        }
      }
      throw error;
    }
  }

  /**
   * DELETE /api/users/:id
   * Delete user
   */
  @Delete('/:id')
  @ApiResponse(200, { description: 'User deleted' })
  @ApiResponse(404, { description: 'User not found' })
  async delete(@Param('id') id: string): Promise<Response> {
    try {
      await this.userService.delete(id);
      return this.success({ deleted: true, id });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return this.error('User not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
      }
      throw error;
    }
  }
}
```

## src/users/users.module.ts

```typescript
import { Module } from '@onebun/core';

import { UserController } from './users.controller';
import { UserService } from './users.service';
import { UserRepository } from './users.repository';

@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}
```

## src/app.module.ts

```typescript
import { Module } from '@onebun/core';
import { UserModule } from './users/users.module';

@Module({
  imports: [UserModule],
})
export class AppModule {}
```

## src/index.ts

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true, serviceName: 'crud-api' },
});

app.start().then(() => {
  const logger = app.getLogger();
  logger.info('CRUD API started on http://localhost:3000');
});
```

## API Testing

```bash
# Create user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com", "age": 30}'

# List users
curl http://localhost:3000/api/users
curl http://localhost:3000/api/users?page=1&limit=5

# Get user by ID
curl http://localhost:3000/api/users/{id}

# Update user
curl -X PUT http://localhost:3000/api/users/{id} \
  -H "Content-Type: application/json" \
  -d '{"name": "John Smith"}'

# Delete user
curl -X DELETE http://localhost:3000/api/users/{id}
```

## Key Patterns

1. **Layered Architecture**: Controller → Service → Repository
2. **Validation Schemas**: Separate schemas for create/update DTOs
3. **Error Handling**: Typed errors with appropriate HTTP status codes
4. **Tracing**: `@Span()` decorator for automatic tracing
5. **Logging**: Structured logs at each layer
6. **Module Export**: Export `UserService` for use in other modules

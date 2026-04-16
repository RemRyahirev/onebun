---
description: Complete CRUD API example with database, validation, error handling. REST endpoints, repository pattern.
---

# CRUD API Example

A complete CRUD API with validation, error handling, and layered architecture (Controller → Service → Repository).

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
├── package.json
└── tsconfig.json
```

## Configuration

Typed config pattern with `InferConfigType` and module augmentation — enables `this.config.get()` in any service/controller:

```typescript
// src/config.ts
import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
  app: {
    name: Env.string({ default: 'crud-api' }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

// This enables typed access to this.config.get() everywhere
declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}
```

## Validation with ArkType

Schemas for entity, create DTO, update DTO and response:

```typescript
// src/users/schemas/user.schema.ts
import { type } from '@onebun/core';

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

export const createUserSchema = type({
  'name': 'string >= 2',
  'email': 'string.email',
  'age?': 'number > 0',
  'role?': '"admin" | "user" | "guest"',
});

export type CreateUserDto = typeof createUserSchema.infer;

// Partial schema for updates
export const updateUserSchema = createUserSchema.partial();
export type UpdateUserDto = typeof updateUserSchema.infer;

export const userListSchema = type({
  users: userSchema.array(),
  total: 'number',
  page: 'number',
  limit: 'number',
});

export type UserListResponse = typeof userListSchema.infer;
```

## Service Layer

Business logic with `@Span` for tracing, `NotFoundError` for typed errors, and structured logging:

```typescript
// src/users/users.service.ts (excerpt — create method)
@Service()
export class UserService extends BaseService {
  constructor(private userRepository: UserRepository) {
    super();
  }

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

  // ... findAll, findById, update, delete — same pattern
}
```

## Controller

`@Body(schema)` for automatic validation, `@ApiResponse` for OpenAPI, `HttpException` for HTTP errors:

```typescript
// src/users/users.controller.ts (excerpt)
@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  @ApiResponse(200, { schema: userListSchema, description: 'List of users' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    if (pageNum < 1) {
      throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Page must be >= 1');
    }
    if (limitNum < 1 || limitNum > 100) {
      throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Limit must be between 1 and 100');
    }

    return await this.userService.findAll(pageNum, limitNum);
  }

  @Post('/')
  @ApiResponse(201, { schema: userSchema, description: 'User created' })
  @ApiResponse(400, { description: 'Validation error' })
  @ApiResponse(409, { description: 'Email already exists' })
  async create(@Body(createUserSchema) body: CreateUserDto) {
    try {
      const user = await this.userService.create(body);
      return this.success(user, HttpStatusCode.CREATED);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new HttpException(HttpStatusCode.CONFLICT, 'Email already exists');
      }
      throw error;
    }
  }

  // ... findOne, update, delete — same pattern
}
```

## Modules and Entry Point

```typescript
// src/users/users.module.ts
@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}

// src/app.module.ts
@Module({
  imports: [UserModule],
})
export class AppModule {}

// src/index.ts
const app = new OneBunApplication(AppModule, {
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true, serviceName: 'crud-api' },
});

app.start().then(() => {
  const logger = app.getLogger();
  logger.info(`CRUD API started on ${app.getHttpUrl()}`);
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

---

> Full source code: [examples/crud-api](https://github.com/RemRyahirev/onebun/tree/master/examples/crud-api)

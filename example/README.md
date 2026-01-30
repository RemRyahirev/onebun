# OneBun Framework Example

This example demonstrates the OneBun framework with integrated packages:

- `@onebun/core` - Application framework with decorators and dependency injection
- `@onebun/envs` - Environment variables management
- `@onebun/logger` - Structured logging with context
- `@onebun/metrics` - Prometheus-compatible metrics
- `@onebun/trace` - Distributed tracing
- `@onebun/requests` - HTTP client with dual API support

## Dual API Support

OneBun provides both **Promise** and **Effect** APIs to accommodate different development preferences:

### Promise API (Default - Recommended for most use cases)

```typescript
// Simple and familiar async/await syntax
@Service()
export class UserService extends BaseService {
  private client = createHttpClient({ baseUrl: 'https://api.example.com' });

  async getUsers(): Promise<User[]> {
    try {
      const response = await this.client.get<User[]>('/users');
      return response.success ? response.result : [];
    } catch (error) {
      this.logger.error('Failed to fetch users', error);
      return [];
    }
  }

  async createUser(userData: CreateUserRequest): Promise<User> {
    const response = await this.client.post<User>('/users', userData);
    if (response.success) {
      return response.result;
    }
    throw new Error(`Failed to create user: ${response.error}`);
  }
}
```

### Effect API (Advanced - For functional programming and complex workflows)

```typescript
import { Effect, pipe } from 'effect';

@Service()
export class UserService extends BaseService {
  private client = createHttpClient({ baseUrl: 'https://api.example.com' });

  getUsersEffect(): Effect.Effect<User[]> {
    return pipe(
      this.client.getEffect<User[]>('/users'),
      Effect.map(response => response.success ? response.result : []),
      Effect.catchAll(error => {
        return pipe(
          Effect.sync(() => this.logger.error('Failed to fetch users', error)),
          Effect.map(() => [])
        );
      })
    );
  }

  createUserEffect(userData: CreateUserRequest): Effect.Effect<User, RequestError> {
    return pipe(
      this.client.postEffect<User>('/users', userData),
      Effect.flatMap(response => 
        response.success 
          ? Effect.succeed(response.result)
          : Effect.fail(new RequestError(`Failed to create user: ${response.error}`))
      )
    );
  }
}
```

### Mixed Usage

You can mix both APIs in the same application:

```typescript
@Controller('users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  // Using Promise API for simple operations
  @Get()
  async getUsers(): Promise<Response> {
    try {
      const users = await this.userService.getUsers();
      return this.success(users);
    } catch (error) {
      return this.error(error.message, 500);
    }
  }

  // Using Effect API for complex operations with composition
  @Post()
  async createUser(@Body() userData: CreateUserRequest): Promise<Response> {
    const result = await Effect.runPromise(
      pipe(
        this.userService.createUserEffect(userData),
        Effect.tap(user => 
          Effect.sync(() => this.logger.info(`Created user: ${user.id}`))
        ),
        Effect.catchAll(error => {
          this.logger.error('User creation failed', error);
          return Effect.succeed(null);
        })
      )
    );

    return result 
      ? this.success(result, 201)
      : this.error('Failed to create user', 400);
  }
}
```

## When to Use Each API

### Use Promise API when:
- ✅ Building simple CRUD operations
- ✅ Working with teams familiar with async/await
- ✅ Migrating existing codebases
- ✅ You want minimal learning curve
- ✅ Error handling can be managed with try/catch

### Use Effect API when:
- ✅ Building complex workflows with multiple dependencies
- ✅ You need advanced error handling and recovery strategies
- ✅ Working with functional programming patterns
- ✅ You want composable and testable code
- ✅ Managing complex async operations with retries, timeouts, etc.

## Running the Example

```bash
# Install dependencies
bun install

# Start the application
bun run dev

# Test endpoints
curl http://localhost:3000/api/users
curl http://localhost:3000/api/effect/users  # Effect API version
```

## Available Endpoints

### Promise API Endpoints
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `GET /api/users/:id/posts` - Get user posts
- `POST /api/posts` - Create a new post
- `GET /api/demo/error-handling` - Error handling demo
- `GET /api/demo/authentication` - Auth methods demo
- `GET /api/demo/retries` - Retry functionality demo

### Effect API Endpoints
- `GET /api/effect/users` - Get all users (Effect API)
- `GET /api/effect/demo/error-handling` - Error handling demo (Effect API)

Both endpoints return the same data but demonstrate different programming paradigms and error handling approaches.

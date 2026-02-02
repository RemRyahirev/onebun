---
description: "BaseService class, @Service decorator, dependency injection patterns, service lifecycle, Effect.js integration."
---

# Services API

Package: `@onebun/core`

## BaseService

Base class for all application services. Provides logger and configuration access.

### Class Definition

```typescript
export class BaseService {
  protected logger: SyncLogger;
  protected config: unknown;

  constructor(...args: unknown[]);

  /** Run an effect with error handling */
  protected async runEffect<A>(effect: Effect.Effect<never, never, A>): Promise<A>;

  /** Format an error for consistent handling */
  protected formatError(error: unknown): Error;
}
```

## Creating a Service

### Basic Service

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class CounterService extends BaseService {
  private count = 0;

  increment(): number {
    this.count++;
    this.logger.debug('Counter incremented', { count: this.count });
    return this.count;
  }

  decrement(): number {
    this.count--;
    return this.count;
  }

  getValue(): number {
    return this.count;
  }
}
```

### Service with Dependencies

```typescript
import { Service, BaseService } from '@onebun/core';
import { CacheService } from '@onebun/cache';

@Service()
export class UserService extends BaseService {
  // Dependencies are auto-injected via constructor
  constructor(
    private cacheService: CacheService,
    private repository: UserRepository,
  ) {
    super();  // Must call super()
  }

  async findById(id: string): Promise<User | null> {
    // Check cache first
    const cacheKey = `user:${id}`;
    const cached = await this.cacheService.get<User>(cacheKey);

    if (cached) {
      this.logger.debug('User found in cache', { id });
      return cached;
    }

    // Fetch from database
    const user = await this.repository.findById(id);

    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300 });
    }

    return user;
  }
}
```

## Service Registration

Services must be:
1. Decorated with `@Service()`
2. Listed in module's `providers` array

```typescript
import { Module } from '@onebun/core';
import { CacheModule } from '@onebun/cache';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';

@Module({
  imports: [CacheModule],  // Makes CacheService available
  providers: [
    UserService,
    UserRepository,  // Also a service
  ],
  exports: [UserService],  // Export for use in other modules
})
export class UserModule {}
```

## Accessing Logger

```typescript
@Service()
export class EmailService extends BaseService {
  async send(to: string, subject: string, body: string): Promise<boolean> {
    this.logger.info('Sending email', { to, subject });

    try {
      // Send email logic
      await this.smtp.send({ to, subject, body });
      this.logger.info('Email sent successfully', { to });
      return true;
    } catch (error) {
      this.logger.error('Failed to send email', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
```

### Log Levels

```typescript
this.logger.trace('Very detailed info');  // Level 0
this.logger.debug('Debug information');   // Level 1
this.logger.info('General information');  // Level 2
this.logger.warn('Warning message');      // Level 3
this.logger.error('Error occurred');      // Level 4
this.logger.fatal('Fatal error');         // Level 5
```

### Logging with Context

```typescript
// Additional context as object
this.logger.info('User action', {
  userId: user.id,
  action: 'login',
  ip: request.ip,
});

// Error logging
this.logger.error('Operation failed', new Error('Something went wrong'));

// Multiple arguments
this.logger.debug('Processing', data, { step: 1 }, 'extra info');
```

## Accessing Configuration

```typescript
@Service()
export class DatabaseService extends BaseService {
  private connectionUrl: string;
  private maxConnections: number;

  constructor() {
    super();

    // Access after initialization
    // Note: config is available after module setup
  }

  async connect(): Promise<void> {
    // Access config
    const config = this.config as any;
    const url = config.get('database.url');
    const maxConn = config.get('database.maxConnections');

    this.logger.info('Connecting to database', { maxConnections: maxConn });
    // ...
  }
}
```

## Service with Tracing

Use `@Span()` decorator to create trace spans:

```typescript
import { Service, BaseService, Span } from '@onebun/core';

@Service()
export class OrderService extends BaseService {
  @Span('create-order')
  async createOrder(data: CreateOrderDto): Promise<Order> {
    this.logger.info('Creating order', { customerId: data.customerId });

    // All code inside is traced
    const order = await this.repository.create(data);
    await this.notificationService.notify(data.customerId, order.id);

    return order;
  }

  @Span('process-payment')
  async processPayment(orderId: string, amount: number): Promise<PaymentResult> {
    // Traced operation
    return this.paymentGateway.charge(orderId, amount);
  }

  @Span()  // Uses method name as span name
  async validateOrder(order: Order): Promise<boolean> {
    // Span name: "validateOrder"
    return this.validator.validate(order);
  }
}
```

## Using Effect.js in Services

### Bridge: Effect to Promise

```typescript
import { Service, BaseService, Effect } from '@onebun/core';
import { pipe } from 'effect';

@Service()
export class DataService extends BaseService {
  // Internal Effect-based implementation
  private fetchDataEffect(id: string): Effect.Effect<Data, FetchError, never> {
    return pipe(
      Effect.tryPromise({
        try: () => fetch(`/api/data/${id}`).then(r => r.json()),
        catch: (e) => new FetchError(String(e)),
      }),
      Effect.tap((data) =>
        Effect.sync(() => this.logger.debug('Data fetched', { id }))
      ),
    );
  }

  // Public Promise-based API
  async fetchData(id: string): Promise<Data> {
    const effect = pipe(
      this.fetchDataEffect(id),
      Effect.retry({ times: 3, delay: '1 second' }),
    );

    return this.runEffect(effect);
  }
}
```

### runEffect Helper

The `runEffect` method handles Effect execution:

```typescript
protected async runEffect<A>(effect: Effect.Effect<never, never, A>): Promise<A> {
  try {
    return await Effect.runPromise(effect);
  } catch (error) {
    throw this.formatError(error);
  }
}
```

## Repository Pattern

Services often work with repositories:

```typescript
// user.repository.ts
import { Service, BaseService } from '@onebun/core';
import { DrizzleService } from '@onebun/drizzle';
import { users } from './schema';
import { eq } from 'drizzle-orm';

@Service()
export class UserRepository extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.db.query(
      db => db.select().from(users).where(eq(users.id, id)).limit(1)
    );
    return result[0] || null;
  }

  async findAll(options?: { limit?: number; offset?: number }): Promise<User[]> {
    return this.db.query(
      db => db.select().from(users)
        .limit(options?.limit || 100)
        .offset(options?.offset || 0)
    );
  }

  async create(data: InsertUser): Promise<User> {
    const result = await this.db.query(
      db => db.insert(users).values(data).returning()
    );
    return result[0];
  }

  async update(id: string, data: Partial<InsertUser>): Promise<User | null> {
    const result = await this.db.query(
      db => db.update(users).set(data).where(eq(users.id, id)).returning()
    );
    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query(
      db => db.delete(users).where(eq(users.id, id)).returning()
    );
    return result.length > 0;
  }
}

// user.service.ts
@Service()
export class UserService extends BaseService {
  constructor(
    private repository: UserRepository,
    private cacheService: CacheService,
    private eventService: EventService,
  ) {
    super();
  }

  async createUser(data: CreateUserDto): Promise<User> {
    // Business logic
    const existingUser = await this.repository.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictError('Email already exists');
    }

    // Create user
    const user = await this.repository.create({
      ...data,
      password: await hash(data.password),
    });

    // Side effects
    await this.eventService.emit('user.created', { userId: user.id });

    this.logger.info('User created', { userId: user.id });
    return user;
  }
}
```

## Service Tags (Advanced)

For advanced Effect.js usage, you can create custom tags:

```typescript
import { Service, BaseService } from '@onebun/core';
import { Context } from 'effect';

// Create custom tag
export const UserServiceTag = Context.GenericTag<UserService>('UserService');

@Service(UserServiceTag)
export class UserService extends BaseService {
  // Service with explicit tag
}

// Use in Effect-based code
const program = pipe(
  UserServiceTag,
  Effect.flatMap((userService) => Effect.promise(() => userService.findAll())),
);
```

## Complete Service Example

```typescript
import { Service, BaseService, Span } from '@onebun/core';
import { CacheService } from '@onebun/cache';
import { type } from 'arktype';

// Types
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

interface CreateUserDto {
  name: string;
  email: string;
  password: string;
}

interface UpdateUserDto {
  name?: string;
  email?: string;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

@Service()
export class UserService extends BaseService {
  private users = new Map<string, User>();

  constructor(private cacheService: CacheService) {
    super();
    this.logger.info('UserService initialized');
  }

  @Span('user-find-all')
  async findAll(options?: { page?: number; limit?: number }): Promise<PaginatedResult<User>> {
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const offset = (page - 1) * limit;

    this.logger.debug('Finding all users', { page, limit });

    const allUsers = Array.from(this.users.values());
    const items = allUsers.slice(offset, offset + limit);

    return {
      items,
      total: allUsers.length,
      page,
      limit,
    };
  }

  @Span('user-find-by-id')
  async findById(id: string): Promise<User | null> {
    // Check cache
    const cacheKey = `user:${id}`;
    const cached = await this.cacheService.get<User>(cacheKey);

    if (cached) {
      this.logger.trace('User cache hit', { id });
      return cached;
    }

    this.logger.trace('User cache miss', { id });
    const user = this.users.get(id) || null;

    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300 });
    }

    return user;
  }

  @Span('user-create')
  async create(data: CreateUserDto): Promise<User> {
    // Check for duplicate email
    const existingUser = await this.findByEmail(data.email);
    if (existingUser) {
      this.logger.warn('Duplicate email attempt', { email: data.email });
      throw new Error('Email already exists');
    }

    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email,
      createdAt: new Date(),
    };

    this.users.set(user.id, user);
    this.logger.info('User created', { userId: user.id, email: user.email });

    return user;
  }

  @Span('user-update')
  async update(id: string, data: UpdateUserDto): Promise<User | null> {
    const user = this.users.get(id);

    if (!user) {
      this.logger.warn('User not found for update', { id });
      return null;
    }

    const updatedUser = { ...user, ...data };
    this.users.set(id, updatedUser);

    // Invalidate cache
    await this.cacheService.delete(`user:${id}`);

    this.logger.info('User updated', { userId: id, fields: Object.keys(data) });
    return updatedUser;
  }

  @Span('user-delete')
  async delete(id: string): Promise<boolean> {
    const deleted = this.users.delete(id);

    if (deleted) {
      await this.cacheService.delete(`user:${id}`);
      this.logger.info('User deleted', { userId: id });
    }

    return deleted;
  }

  private async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }
}
```

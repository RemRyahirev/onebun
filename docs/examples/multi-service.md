---
description: Running multiple microservices from single process. MultiServiceApplication, shared config, service communication.
---

# Multi-Service Application Example

Running multiple microservices from a single process with shared configuration.

## Project Structure

```
multi-service/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── shared/
│   │   └── database.module.ts
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   └── users.service.ts
│   └── orders/
│       ├── orders.module.ts
│       ├── orders.controller.ts
│       └── orders.service.ts
├── .env
├── package.json
└── tsconfig.json
```

## src/config.ts

```typescript
import { Env } from '@onebun/core';

export const envSchema = {
  // Shared configuration
  app: {
    name: Env.string({ default: 'multi-service' }),
    environment: Env.string({ default: 'development' }),
  },

  // Users service
  users: {
    port: Env.number({ default: 3001, env: 'USERS_PORT' }),
    database: {
      url: Env.string({ env: 'USERS_DATABASE_URL', sensitive: true }),
    },
  },

  // Orders service
  orders: {
    port: Env.number({ default: 3002, env: 'ORDERS_PORT' }),
    database: {
      url: Env.string({ env: 'ORDERS_DATABASE_URL', sensitive: true }),
    },
  },

  // Shared Redis
  redis: {
    host: Env.string({ default: 'localhost' }),
    port: Env.number({ default: 6379 }),
  },
};
```

## src/users/users.service.ts

```typescript
import { Service, BaseService, Span } from '@onebun/core';

interface User {
  id: string;
  name: string;
  email: string;
}

@Service()
export class UserService extends BaseService {
  private users = new Map<string, User>();

  constructor() {
    super();
    // Seed some data
    this.users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com' });
    this.users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com' });
  }

  @Span('user-find-all')
  async findAll(): Promise<User[]> {
    this.logger.info('Finding all users');
    return Array.from(this.users.values());
  }

  @Span('user-find-by-id')
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  @Span('user-create')
  async create(data: Omit<User, 'id'>): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      ...data,
    };
    this.users.set(user.id, user);
    this.logger.info('User created', { userId: user.id });
    return user;
  }
}
```

## src/users/users.controller.ts

```typescript
import { Controller, BaseController, Get, Post, Param, Body } from '@onebun/core';
import { type } from 'arktype';
import { UserService } from './users.service';

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
});

@Controller('/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  async findAll(): Promise<Response> {
    const users = await this.userService.findAll();
    return this.success(users);
  }

  @Get('/:id')
  async findOne(@Param('id') id: string): Promise<Response> {
    const user = await this.userService.findById(id);
    if (!user) {
      return this.error('User not found', 404, 404);
    }
    return this.success(user);
  }

  @Post('/')
  async create(
    @Body(createUserSchema) body: typeof createUserSchema.infer,
  ): Promise<Response> {
    const user = await this.userService.create(body);
    return this.success(user, 201);
  }
}
```

## src/users/users.module.ts

```typescript
import { Module } from '@onebun/core';
import { UserController } from './users.controller';
import { UserService } from './users.service';

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

## src/orders/orders.service.ts

```typescript
import { Service, BaseService, Span, createHttpClient, isErrorResponse } from '@onebun/core';

interface Order {
  id: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

@Service()
export class OrderService extends BaseService {
  private orders = new Map<string, Order>();

  // HTTP client for calling Users service
  private usersClient = createHttpClient({
    baseUrl: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  });

  @Span('order-find-all')
  async findAll(): Promise<Order[]> {
    return Array.from(this.orders.values());
  }

  @Span('order-find-by-user')
  async findByUserId(userId: string): Promise<Order[]> {
    return Array.from(this.orders.values()).filter(
      (order) => order.userId === userId
    );
  }

  @Span('order-create')
  async create(data: {
    userId: string;
    items: Array<{ productId: string; quantity: number; price: number }>;
  }): Promise<Order> {
    // Verify user exists by calling Users service
    const userResponse = await this.usersClient.get<User>(`/users/${data.userId}`);

    if (isErrorResponse(userResponse)) {
      this.logger.warn('User not found', { userId: data.userId });
      throw new Error('User not found');
    }

    const user = userResponse.result;
    this.logger.info('User verified', { userId: user.id, name: user.name });

    // Calculate total
    const total = data.items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );

    const order: Order = {
      id: crypto.randomUUID(),
      userId: data.userId,
      items: data.items.map(({ productId, quantity }) => ({ productId, quantity })),
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.orders.set(order.id, order);
    this.logger.info('Order created', {
      orderId: order.id,
      userId: data.userId,
      total,
    });

    return order;
  }

  @Span('order-update-status')
  async updateStatus(
    orderId: string,
    status: 'pending' | 'completed' | 'cancelled',
  ): Promise<Order | null> {
    const order = this.orders.get(orderId);
    if (!order) {
      return null;
    }

    order.status = status;
    this.orders.set(orderId, order);

    this.logger.info('Order status updated', { orderId, status });
    return order;
  }
}
```

## src/orders/orders.controller.ts

```typescript
import { Controller, BaseController, Get, Post, Put, Param, Body, Query } from '@onebun/core';
import { type } from 'arktype';
import { OrderService } from './orders.service';

const createOrderSchema = type({
  userId: 'string',
  items: type({
    productId: 'string',
    quantity: 'number > 0',
    price: 'number > 0',
  }).array().configure({ minLength: 1 }),
});

const updateStatusSchema = type({
  status: '"pending" | "completed" | "cancelled"',
});

@Controller('/orders')
export class OrderController extends BaseController {
  constructor(private orderService: OrderService) {
    super();
  }

  @Get('/')
  async findAll(@Query('userId') userId?: string): Promise<Response> {
    if (userId) {
      const orders = await this.orderService.findByUserId(userId);
      return this.success(orders);
    }
    const orders = await this.orderService.findAll();
    return this.success(orders);
  }

  @Post('/')
  async create(
    @Body(createOrderSchema) body: typeof createOrderSchema.infer,
  ): Promise<Response> {
    try {
      const order = await this.orderService.create(body);
      return this.success(order, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'User not found') {
        return this.error('User not found', 404, 404);
      }
      throw error;
    }
  }

  @Put('/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body(updateStatusSchema) body: typeof updateStatusSchema.infer,
  ): Promise<Response> {
    const order = await this.orderService.updateStatus(id, body.status);
    if (!order) {
      return this.error('Order not found', 404, 404);
    }
    return this.success(order);
  }
}
```

## src/orders/orders.module.ts

```typescript
import { Module } from '@onebun/core';
import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';

@Module({
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
```

## src/index.ts

```typescript
import { MultiServiceApplication } from '@onebun/core';
import { UserModule } from './users/users.module';
import { OrderModule } from './orders/orders.module';
import { envSchema } from './config';

const app = new MultiServiceApplication({
  services: {
    users: {
      module: UserModule,
      port: 3001,
      routePrefix: true, // Uses 'users' as route prefix
    },
    orders: {
      module: OrderModule,
      port: 3002,
      routePrefix: true, // Uses 'orders' as route prefix
      // Orders service can have different env overrides
      envOverrides: {
        // Use different database for orders
        'database.url': { fromEnv: 'ORDERS_DATABASE_URL' },
      },
    },
  },
  envSchema,
  envOptions: {
    loadDotEnv: true,
  },
  metrics: {
    enabled: true,
    prefix: 'multiservice_',
  },
  tracing: {
    enabled: true,
    serviceName: 'multi-service-app',
  },
  // Optional: only start specific services
  // enabledServices: ['users'],
  // excludedServices: ['orders'],
});

app.start().then(() => {
  const logger = app.getLogger();
  logger.info('Multi-service application started');
  logger.info('Running services:', app.getRunningServices());
  logger.info('Users service: http://localhost:3001');
  logger.info('Orders service: http://localhost:3002');
}).catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
```

## .env

```bash
# App
APP_NAME=multi-service
NODE_ENV=development

# Users Service
USERS_PORT=3001
USERS_DATABASE_URL=postgres://localhost:5432/users_db

# Orders Service
ORDERS_PORT=3002
ORDERS_DATABASE_URL=postgres://localhost:5432/orders_db

# Users service URL (for Orders to call)
USERS_SERVICE_URL=http://localhost:3001

# Shared Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Testing the Services

```bash
# Users Service (port 3001)
# List users
curl http://localhost:3001/users/users

# Get user
curl http://localhost:3001/users/users/1

# Create user
curl -X POST http://localhost:3001/users/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Charlie", "email": "charlie@example.com"}'

# Orders Service (port 3002)
# List orders
curl http://localhost:3002/orders/orders

# Create order (verifies user exists via Users service)
curl -X POST http://localhost:3002/orders/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "1",
    "items": [
      {"productId": "prod-1", "quantity": 2, "price": 29.99},
      {"productId": "prod-2", "quantity": 1, "price": 49.99}
    ]
  }'

# Get user's orders
curl http://localhost:3002/orders/orders?userId=1

# Update order status
curl -X PUT http://localhost:3002/orders/orders/{orderId}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

## Key Patterns

1. **MultiServiceApplication**: Run multiple services in one process
2. **Service Isolation**: Each service has its own module, port, and route prefix
3. **Environment Overrides**: Per-service environment variable customization
4. **Inter-service Communication**: Use `createHttpClient` to call other services
5. **Shared Configuration**: Common settings via `envSchema`
6. **Trace Propagation**: Traces automatically flow between services
7. **Metrics Aggregation**: All services expose metrics on their respective ports

## Production: Service Selection via Environment

`MultiServiceApplication` has built-in support for selecting which services to run via environment variables. No need for separate entry files — use the same code everywhere.

### Built-in Options

```typescript
interface MultiServiceApplicationOptions {
  // List of service names to start (if set, only these services run)
  enabledServices?: string[];
  
  // List of service names to exclude from starting
  excludedServices?: string[];
  
  // URLs for services running in other processes (for inter-service calls)
  externalServiceUrls?: Record<string, string>;
}
```

### Environment Variables

- `ONEBUN_SERVICES` — comma-separated list of services to start (overrides `enabledServices`)
- `ONEBUN_EXCLUDE_SERVICES` — comma-separated list of services to exclude (overrides `excludedServices`)

### Single Entry Point for All Deployments

```typescript
// src/index.ts - same file for dev and production
import { MultiServiceApplication } from '@onebun/core';
import { UserModule } from './users/users.module';
import { OrderModule } from './orders/orders.module';
import { envSchema } from './config';

const app = new MultiServiceApplication({
  services: {
    users: { module: UserModule, port: 3001, routePrefix: true },
    orders: { module: OrderModule, port: 3002, routePrefix: true },
  },
  envSchema,
  
  // URLs for services when they run in separate processes
  // Used by getServiceUrl() for inter-service communication
  externalServiceUrls: {
    users: process.env.USERS_SERVICE_URL,
    orders: process.env.ORDERS_SERVICE_URL,
  },
});

app.start();
```

### Deployment Examples

```bash
# Development: run all services in one process
bun run src/index.ts

# Production: run only users service
ONEBUN_SERVICES=users bun run src/index.ts

# Production: run only orders service  
ONEBUN_SERVICES=orders bun run src/index.ts

# Run all except orders
ONEBUN_EXCLUDE_SERVICES=orders bun run src/index.ts

# Multiple services
ONEBUN_SERVICES=users,orders bun run src/index.ts
```

### Kubernetes Deployment

```yaml
# users-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: users-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:latest
          env:
            - name: ONEBUN_SERVICES
              value: "users"
            - name: ORDERS_SERVICE_URL
              value: "http://orders-service:3002"
---
# orders-deployment.yaml  
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: myapp:latest
          env:
            - name: ONEBUN_SERVICES
              value: "orders"
            - name: USERS_SERVICE_URL
              value: "http://users-service:3001"
```

### Inter-Service Communication

When a service runs in a separate process, use `externalServiceUrls` to configure URLs:

```typescript
// In orders service, calling users service
const usersClient = createHttpClient({
  baseUrl: app.getServiceUrl('users'), // Returns externalServiceUrls.users or local URL
});

const user = await usersClient.get(`/users/${userId}`);
```

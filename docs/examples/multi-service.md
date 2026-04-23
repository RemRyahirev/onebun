---
description: Running multiple microservices from single process. OneBunApplication multi-service mode, shared config, service communication.
---

# Multi-Service Application Example

Running multiple microservices from a single process with shared configuration and inter-service communication.

## Project Structure

```
multi-service/
├── src/
│   ├── index.ts
│   ├── config.ts
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

## Configuration

Shared config with per-service settings and inter-service URLs:

```typescript
// src/config.ts
import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  app: {
    name: Env.string({ default: 'multi-service' }),
    environment: Env.string({ default: 'development' }),
  },

  // Per-service ports and database URLs
  users: {
    port: Env.number({ default: 3001, env: 'USERS_PORT' }),
    database: {
      url: Env.string({ env: 'USERS_DATABASE_URL', sensitive: true }),
    },
  },
  orders: {
    port: Env.number({ default: 3002, env: 'ORDERS_PORT' }),
    database: {
      url: Env.string({ env: 'ORDERS_DATABASE_URL', sensitive: true }),
    },
  },

  // Inter-service communication
  usersServiceUrl: Env.string({ default: 'http://localhost:3001', env: 'USERS_SERVICE_URL' }),

  redis: {
    host: Env.string({ default: 'localhost' }),
    port: Env.number({ default: 6379 }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}
```

## Application Entry Point

The core of multi-service — `OneBunApplication` with `getConfig` for typed port access and `getServiceUrl` for runtime URLs:

```typescript
// src/index.ts
import { getConfig, OneBunApplication } from '@onebun/core';
import { type AppConfig, envSchema } from './config';
import { OrderModule } from './orders/orders.module';
import { UserModule } from './users/users.module';

const config = getConfig<AppConfig>(envSchema);

const app = new OneBunApplication({
  services: {
    users: {
      module: UserModule,
      port: config.get('users.port'),
      routePrefix: true,
      metrics: { prefix: 'users_' },
      tracing: { serviceName: 'users-service' },
    },
    orders: {
      module: OrderModule,
      port: config.get('orders.port'),
      routePrefix: true,
      envOverrides: {
        'database.url': { fromEnv: 'ORDERS_DATABASE_URL' },
      },
      metrics: { prefix: 'orders_' },
      tracing: { serviceName: 'orders-service' },
    },
  },
  envSchema,
  envOptions: { loadDotEnv: true },
  externalServiceUrls: {
    users: process.env.USERS_SERVICE_URL,
    orders: process.env.ORDERS_SERVICE_URL,
  },
  metrics: { enabled: true },
  tracing: { enabled: true },
});

app.start().then(() => {
  const logger = app.getLogger();
  logger.info('Multi-service application started');
  logger.info('Running services:', app.getRunningServices());
  logger.info(`Users service: ${app.getServiceUrl('users')}`);
  logger.info(`Orders service: ${app.getServiceUrl('orders')}`);
});
```

## Inter-Service Communication

Services call each other via `createHttpClient` with URLs from typed config:

```typescript
// src/orders/orders.service.ts (excerpt)
@Service()
export class OrderService extends BaseService {
  private orders = new Map<string, Order>();
  private readonly usersClient;

  constructor() {
    super();
    this.usersClient = createHttpClient({
      baseUrl: this.config.get('usersServiceUrl'),
    });
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

    // Calculate total and create order...
  }
}
```

## .env

```bash
APP_NAME=multi-service
NODE_ENV=development

USERS_PORT=3001
USERS_DATABASE_URL=postgres://localhost:5432/users_db

ORDERS_PORT=3002
ORDERS_DATABASE_URL=postgres://localhost:5432/orders_db

USERS_SERVICE_URL=http://localhost:3001

REDIS_HOST=localhost
REDIS_PORT=6379
```

## Testing the Services

```bash
# Users Service (port 3001)
curl http://localhost:3001/users/users
curl http://localhost:3001/users/users/1
curl -X POST http://localhost:3001/users/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Charlie", "email": "charlie@example.com"}'

# Orders Service (port 3002)
curl http://localhost:3002/orders/orders
curl -X POST http://localhost:3002/orders/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "1",
    "items": [
      {"productId": "prod-1", "quantity": 2, "price": 29.99},
      {"productId": "prod-2", "quantity": 1, "price": 49.99}
    ]
  }'
curl http://localhost:3002/orders/orders?userId=1
curl -X PUT http://localhost:3002/orders/orders/{orderId}/status \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

## Graceful Shutdown

`OneBunApplication` in multi-service mode supports graceful shutdown out of the box. When the process receives SIGTERM or SIGINT, it calls `stop()` on each running service, which triggers lifecycle hooks in order.

### Shutdown Sequence

1. `beforeApplicationDestroy(signal)` — called on all services/controllers with the signal name
2. WebSocket connections closed
3. Queue service stopped, queue adapter disconnected
4. HTTP servers stopped
5. `onModuleDestroy()` — called on all services/controllers
6. Shared Redis disconnected (if configured)
7. `onApplicationDestroy(signal)` — final cleanup hook

### Implementing Lifecycle Hooks

Services and controllers can implement lifecycle hooks to clean up resources:

```typescript
import { Service, BaseService } from '@onebun/core';
import type { OnModuleInit, OnModuleDestroy, BeforeApplicationDestroy } from '@onebun/core';

@Service()
export class OrderService extends BaseService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationDestroy {

  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Called after DI resolution — set up resources
  async onModuleInit(): Promise<void> {
    this.logger.info('OrderService initialized');

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredOrders();
    }, 60000);
  }

  // Called at the start of shutdown — stop accepting new work
  async beforeApplicationDestroy(signal?: string): Promise<void> {
    this.logger.info('Shutdown signal received, stopping new order processing', { signal });
  }

  // Called during shutdown — clean up resources
  async onModuleDestroy(): Promise<void> {
    this.logger.info('Cleaning up OrderService');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private cleanupExpiredOrders(): void {
    // periodic cleanup logic
  }
}
```

### Programmatic Shutdown

```typescript
const app = new OneBunApplication({
  services: {
    users: { module: UserModule, port: 3001 },
    orders: { module: OrderModule, port: 3002 },
  },
  envSchema,
});

await app.start();

// Programmatic stop — all services shut down gracefully
await app.stop();
```

::: tip
`OneBunApplication.stop()` in multi-service mode calls `stop()` on each child `OneBunApplication` instance. Individual child `OneBunApplication.stop()` accepts `{ closeSharedRedis?: boolean; signal?: string }` if you need more control when stopping services directly.
:::

### Lifecycle Hook Reference

| Interface | Method | When Called |
|-----------|--------|------------|
| `OnModuleInit` | `onModuleInit()` | After DI resolution, before HTTP server starts |
| `OnApplicationInit` | `onApplicationInit()` | After all modules initialized, before HTTP server starts |
| `BeforeApplicationDestroy` | `beforeApplicationDestroy(signal?)` | Start of shutdown (stop accepting work) |
| `OnModuleDestroy` | `onModuleDestroy()` | During shutdown, after HTTP server stops |
| `OnApplicationDestroy` | `onApplicationDestroy(signal?)` | End of shutdown (final cleanup) |

## Key Patterns

1. **OneBunApplication multi-service mode**: Run multiple services in one process
2. **Service Isolation**: Each service has its own module, port, and route prefix
3. **Environment Overrides**: Per-service environment variable customization
4. **Inter-service Communication**: Use `createHttpClient` with typed config URLs
5. **Shared Configuration**: Common settings via `envSchema`
6. **Trace Propagation**: Traces automatically flow between services
7. **Metrics Aggregation**: All services expose metrics on their respective ports
8. **Graceful Shutdown**: Lifecycle hooks for clean resource management

## Production: Service Selection via Environment

`OneBunApplication` in multi-service mode has built-in support for selecting which services to run via environment variables. No need for separate entry files — use the same code everywhere.

### Built-in Options

```typescript
interface MultiServiceApplicationOptions {
  // Queue config applied to every service (same broker/config for all)
  queue?: QueueApplicationOptions;
  
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

---

> Full source code: [examples/multi-service](https://github.com/RemRyahirev/onebun/tree/master/examples/multi-service)

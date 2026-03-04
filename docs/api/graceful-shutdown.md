---
description: "Graceful shutdown, lifecycle hooks (OnModuleInit, OnApplicationInit, OnModuleDestroy, BeforeApplicationDestroy, OnApplicationDestroy), signal handling, shutdown sequence."
---

<llm-only>

## Quick Reference for AI

**Graceful shutdown is enabled by default.** SIGTERM/SIGINT triggers the full shutdown sequence.

**Shutdown sequence (in order):**
1. `beforeApplicationDestroy(signal)` hooks
2. WebSocket cleanup
3. Queue service stop + adapter disconnect
4. HTTP server stop
5. `onModuleDestroy()` hooks
6. Shared Redis disconnect
7. `onApplicationDestroy(signal)` hooks

**5 lifecycle hook interfaces:**
```typescript
implements OnModuleInit           // after DI, before HTTP start
implements OnApplicationInit      // after all modules, before HTTP start
implements OnModuleDestroy        // during shutdown, after HTTP stops
implements BeforeApplicationDestroy  // start of shutdown
implements OnApplicationDestroy      // end of shutdown (final cleanup)
```

**Disable/enable:**
```typescript
// Disable automatic shutdown handling
const app = new OneBunApplication(AppModule, { gracefulShutdown: false });

// Enable manually later
app.enableGracefulShutdown();

// Programmatic shutdown
await app.stop();
await app.stop({ closeSharedRedis: false, signal: 'SIGTERM' });
```

**Imports:**
```typescript
import { type OnModuleInit, type OnApplicationInit, type OnModuleDestroy, type BeforeApplicationDestroy, type OnApplicationDestroy } from '@onebun/core';
```

</llm-only>

# Graceful Shutdown & Lifecycle

Package: `@onebun/core`

## Overview

OneBun enables graceful shutdown **by default**. When the application receives a SIGTERM or SIGINT signal, it runs a deterministic shutdown sequence — closing connections, flushing buffers, and calling lifecycle hooks in a defined order.

This page covers:
- The full shutdown sequence
- All 5 lifecycle hook interfaces with practical examples
- Configuration options (disable, programmatic shutdown)
- Patterns for database connections, caches, and background tasks

## Shutdown Sequence

When a shutdown signal is received (or `app.stop()` is called), the following steps execute in order:

| Step | What happens |
|------|-------------|
| 1. **`beforeApplicationDestroy(signal)`** | All services/controllers implementing `BeforeApplicationDestroy` are notified. Use this to stop accepting new work and flush buffers. |
| 2. **WebSocket cleanup** | All WebSocket connections are closed gracefully. |
| 3. **Queue service stop** | Queue subscribers stop consuming; queue adapter disconnects. |
| 4. **HTTP server stop** | Bun HTTP server stops accepting new connections. In-flight requests complete. |
| 5. **`onModuleDestroy()`** | All services/controllers implementing `OnModuleDestroy` are called. Close database connections, release resources. |
| 6. **Shared Redis disconnect** | The shared Redis connection pool (used by Cache, WebSocket, Queue) is closed. |
| 7. **`onApplicationDestroy(signal)`** | Final cleanup hooks. Flush metrics, send shutdown notifications, etc. |

> **Startup hooks** (`onModuleInit`, `onApplicationInit`) run in dependency order during application bootstrap, before the HTTP server starts.

## Lifecycle Hooks

OneBun provides five lifecycle hook interfaces. Implement them on any service or controller to hook into specific points of the application lifecycle.

### OnModuleInit

Called after the service/controller is instantiated and all dependencies are injected. Runs **before** the HTTP server starts. Called sequentially in dependency order.

```typescript
import { Service, BaseService, type OnModuleInit } from '@onebun/core';

@Service()
export class DatabaseService extends BaseService implements OnModuleInit {
  private pool: DatabasePool;

  async onModuleInit() {
    this.pool = await createPool({
      host: this.config.get('db.host'),
      port: this.config.get('db.port'),
    });
    await this.pool.connect();
    this.logger.info('Database pool connected');
  }
}
```

**Use for:** establishing connections, initializing clients, loading configuration.

### OnApplicationInit

Called after **all** modules are initialized, but **before** the HTTP server starts listening. Use for application-wide setup that depends on all services being ready.

```typescript
import { Service, BaseService, type OnApplicationInit } from '@onebun/core';

@Service()
export class StartupService extends BaseService implements OnApplicationInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async onApplicationInit() {
    // Seed default data if empty
    const count = await this.db.getUserCount();
    if (count === 0) {
      await this.db.seedDefaultUsers();
      this.logger.info('Seeded default users');
    }

    // Warm frequently-accessed caches
    const settings = await this.db.getAllSettings();
    await this.cache.set('app:settings', settings, { ttl: 3600000 });
    this.logger.info('Cache warmed');
  }
}
```

**Use for:** seeding data, warming caches, running migrations, health checks.

### OnModuleDestroy

Called during shutdown, **after** the HTTP server stops. Use to close connections and release resources.

```typescript
import { Service, BaseService, type OnModuleDestroy } from '@onebun/core';

@Service()
export class DatabaseService extends BaseService implements OnModuleDestroy {
  private pool: DatabasePool;

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.info('Database pool closed');
  }
}
```

**Use for:** closing database connections, releasing file handles, stopping background timers.

### BeforeApplicationDestroy

Called at the **very start** of the shutdown process, before anything else is torn down. The signal that triggered shutdown is passed as an argument.

```typescript
import { Service, BaseService, type BeforeApplicationDestroy } from '@onebun/core';

@Service()
export class WorkerService extends BaseService implements BeforeApplicationDestroy {
  private accepting = true;

  async beforeApplicationDestroy(signal?: string) {
    this.logger.info(`Shutdown initiated by ${signal}, stopping worker`);

    // Stop accepting new work
    this.accepting = false;

    // Wait for in-progress jobs to finish (up to 10s)
    await this.drainQueue(10000);

    // Flush any buffered results
    await this.resultBuffer.flush();
  }

  canAcceptWork(): boolean {
    return this.accepting;
  }
}
```

**Use for:** stop accepting new work, drain queues, flush write buffers, mark instance as unhealthy in service discovery.

### OnApplicationDestroy

Called at the **very end** of the shutdown process, after everything else (HTTP server, Redis, etc.) has been closed. The signal is passed as an argument.

```typescript
import { Service, BaseService, type OnApplicationDestroy } from '@onebun/core';

@Service()
export class TelemetryService extends BaseService implements OnApplicationDestroy {
  async onApplicationDestroy(signal?: string) {
    // Final metrics flush
    await this.metricsExporter.flush();

    // Send shutdown notification
    await this.alerting.notify({
      level: 'info',
      message: `Service shut down (${signal})`,
      timestamp: Date.now(),
    });

    this.logger.info('Telemetry flushed, goodbye');
  }
}
```

**Use for:** final metrics/traces flush, shutdown notifications, audit logging.

### Hook execution order summary

| Phase | Hook | Signal arg? |
|-------|------|-------------|
| **Startup** | `onModuleInit()` | No |
| **Startup** | `onApplicationInit()` | No |
| **Shutdown** | `beforeApplicationDestroy(signal?)` | Yes |
| **Shutdown** | `onModuleDestroy()` | No |
| **Shutdown** | `onApplicationDestroy(signal?)` | Yes |

## Configuration

### Default behavior

Graceful shutdown is enabled by default. No configuration needed:

```typescript
const app = new OneBunApplication(AppModule);
await app.start();
// SIGTERM/SIGINT handlers are automatically registered
```

### Disabling automatic shutdown

```typescript
const app = new OneBunApplication(AppModule, {
  gracefulShutdown: false,
});
await app.start();
```

### Enabling manually

After disabling, you can re-enable at any point:

```typescript
const app = new OneBunApplication(AppModule, {
  gracefulShutdown: false,
});
await app.start();

// Later: enable signal handlers
app.enableGracefulShutdown();
```

### Programmatic shutdown

Call `app.stop()` directly to trigger the shutdown sequence:

```typescript
// Full shutdown (closes everything including shared Redis)
await app.stop();

// Keep shared Redis open (other consumers may still need it)
await app.stop({ closeSharedRedis: false });

// Pass a signal name for lifecycle hooks
await app.stop({ signal: 'SIGTERM' });
```

#### stop() options

```typescript
interface StopOptions {
  /** Close the shared Redis connection pool. Default: true */
  closeSharedRedis?: boolean;
  /** Signal name passed to lifecycle hooks. E.g. 'SIGTERM', 'SIGINT' */
  signal?: string;
}
```

## Examples

### Database service with full lifecycle

```typescript
import {
  Service,
  BaseService,
  type OnModuleInit,
  type OnModuleDestroy,
  type BeforeApplicationDestroy,
} from '@onebun/core';

@Service()
export class DatabaseService extends BaseService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationDestroy
{
  private pool: DatabasePool;
  private healthy = false;

  async onModuleInit() {
    this.pool = await createPool(this.config.get('db'));
    await this.pool.connect();
    this.healthy = true;
    this.logger.info('Database connected');
  }

  async beforeApplicationDestroy(signal?: string) {
    // Mark unhealthy so health checks fail → load balancer stops routing
    this.healthy = false;
    this.logger.info(`Database marked unhealthy (${signal})`);
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.info('Database pool closed');
  }

  isHealthy(): boolean {
    return this.healthy;
  }
}
```

### Custom shutdown handler

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  gracefulShutdown: false, // We'll handle it ourselves
});

await app.start();

// Custom signal handling with timeout
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);

  const timeout = setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    await app.stop({ signal });
    clearTimeout(timeout);
    console.log('Clean shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    clearTimeout(timeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### Programmatic shutdown (e.g. from admin endpoint)

```typescript
import { Controller, Post, type OneBunApplication } from '@onebun/core';

@Controller('/admin')
class AdminController {
  constructor(private readonly app: OneBunApplication) {}

  @Post('/shutdown')
  async shutdown() {
    // Respond first, then shut down
    setTimeout(() => this.app.stop({ signal: 'admin-request' }), 100);
    return this.success({ message: 'Shutting down...' });
  }
}
```

## See Also

- [Core API — OneBunApplication](/api/core) — application bootstrap and options
- [Services API — Lifecycle Hooks](/api/services#lifecycle-hooks) — detailed service lifecycle examples

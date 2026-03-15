---
description: Testing utilities for OneBun applications — unit testing helpers, integration testing module, fake timers, mock loggers, and testcontainers.
---

<llm-only>

## Testing Utilities Internal Notes

**Unit Testing Helpers** (`createTestService`, `createTestController`):
- Create instances with mock logger (using `bun:test` `mock()`) and mock config
- Call `initializeService()` / `initializeController()` internally so `this.logger` and `this.config` are available
- Logger methods are `mock()` functions — assert with `.mock.calls`
- Config returns values from the provided `config` object via `get(path)`
- Dependencies passed via `deps` array are spread into the constructor

**TestingModule** (integration/e2e testing):
- Creates a real HTTP server on port 0 (OS picks free port)
- Uses `makeMockLoggerLayer()` for silent logging
- `overrideProvider()` injects mock via Effect.Context tag before `setup()`
- `inject()` makes real HTTP requests via `undici.fetch` (bypasses global fetch mocks)
- Always call `close()` in `afterEach` to prevent port leaks
- `_testProviders` is an internal option used to pass overrides to the application

**Testcontainers** (`createRedisContainer`, `createNatsContainer`):
- Require Docker daemon running
- Return `TestContainer` with `url`, `host`, `port`, `container`, `stop()`
- Default images: `redis:7-alpine`, `nats:2.10-alpine`
- NATS supports `enableJetStream: true` option
- Always call `stop()` in `afterAll` to clean up containers

**Mock Utilities**:
- `createMockConfig(values, options)` — returns `IConfig` with `get()` returning from values map
- `createMockSyncLogger()` — no-op sync logger, `child()` returns itself
- `createMockLogger()` — no-op async Effect logger
- `makeMockLoggerLayer()` — Effect Layer providing mock async logger
- `useFakeTimers()` — replaces global `setTimeout`/`setInterval`/`Date.now`, returns control object
- `FakeTimers` class and `fakeTimers` singleton are also exported for direct use, but `useFakeTimers()` is the recommended API

**Exported types**: `TestInstanceResult<T>`, `TestContainer`, `RedisContainerOptions`, `NatsContainerOptions`, `CompiledTestingModule`

</llm-only>

# Testing

OneBun provides a set of testing utilities for unit and integration testing of services, controllers, and full application modules.

All testing utilities are exported from `@onebun/core`:

```typescript
import {
  createTestService,
  createTestController,
  TestingModule,
  useFakeTimers,
  createMockConfig,
  createMockLogger,
  makeMockLoggerLayer,
  createMockSyncLogger,
  createRedisContainer,
  createNatsContainer,
} from '@onebun/core';
```

## Unit Testing — `createTestService` / `createTestController`

For isolated unit testing of services and controllers without starting an HTTP server.

### `createTestService`

Creates a service instance with a mock logger and mock config. Calls `initializeService()` internally, so `this.logger` and `this.config` are available in the service.

```typescript
import { createTestService } from '@onebun/core';

const { instance, logger, config } = createTestService(UserService);

// Use the service
const result = instance.findById('123');

// Assert logger calls (logger methods are bun:test mock functions)
expect((logger.info as any).mock.calls).toHaveLength(1);
```

#### With config and dependencies

```typescript
const { instance } = createTestService(UserService, {
  config: { 'database.url': 'postgres://localhost/test' },
  deps: [mockRepository, mockCacheService],
});
```

**Options:**
- `config` — `Record<string, unknown>` — values returned by `config.get(path)`
- `deps` — `unknown[]` — constructor arguments (injected dependencies)

**Return type: `TestInstanceResult<T>`**
- `instance: T` — the created service instance
- `logger: SyncLogger` — mock logger with `mock()` functions (assert with `.mock.calls`)
- `config: IConfig` — mock config

### `createTestController`

Same API as `createTestService`, but calls `initializeController()` instead.

```typescript
import { createTestController } from '@onebun/core';

const { instance, logger, config } = createTestController(UserController, {
  deps: [mockUserService],
});
```

## Integration Testing — `TestingModule`

For full integration testing with a real HTTP server, middleware pipeline, and DI.

### Basic Usage

```typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { TestingModule, type CompiledTestingModule } from '@onebun/core';

describe('UserController', () => {
  let module: CompiledTestingModule;

  afterEach(async () => {
    await module.close();
  });

  it('returns users', async () => {
    module = await TestingModule
      .create({
        controllers: [UserController],
        providers: [UserService],
      })
      .compile();

    const response = await module.inject('GET', '/users');
    expect(response.status).toBe(200);
  });
});
```

### API

#### `TestingModule.create(options)`

Creates a new `TestingModule` builder.

- `controllers` — controller classes to include
- `providers` — service/provider classes to include
- `imports` — pre-decorated `@Module()` classes to import

#### `.overrideProvider(ServiceClass)`

Replaces a service with a mock. Returns an override builder:

```typescript
// Replace with a plain object
module = await TestingModule
  .create({ controllers: [UserController], providers: [UserService] })
  .overrideProvider(UserService).useValue({ findById: () => mockUser })
  .compile();

// Replace with another class
module = await TestingModule
  .create({ controllers: [UserController], providers: [UserService] })
  .overrideProvider(UserService).useClass(MockUserService)
  .compile();
```

#### `.setOptions(options)`

Sets additional application options (`basePath`, `envSchema`, `cors`, etc.):

```typescript
module = await TestingModule
  .create({ controllers: [UserController], providers: [UserService] })
  .setOptions({ basePath: '/api', envSchema: myEnvSchema })
  .compile();
```

#### `.compile()`

Starts the application on a random free port. Returns a `CompiledTestingModule`.

#### `module.inject(method, path, options?)`

Sends a real HTTP request to the test server:

```typescript
const response = await module.inject('POST', '/users', {
  body: { name: 'Alice' },
  headers: { 'Authorization': 'Bearer token' },
  query: { include: 'profile' },
});
```

#### `module.get(ServiceClass)`

Retrieves a service instance by class:

```typescript
const service = module.get(UserService);
expect(service).toBeInstanceOf(UserService);
```

#### `module.getApp()`

Returns the underlying `OneBunApplication` instance.

#### `module.getPort()`

Returns the port the test server is listening on.

#### `module.getConfig()`

Returns the application config. Requires `envSchema` to be set via `setOptions()`.

#### `module.close()`

Stops the test server and releases resources. Always call this in `afterEach` or `afterAll`.

## Testcontainers — `createRedisContainer` / `createNatsContainer`

Helpers for spinning up Redis and NATS containers in tests. Requires Docker.

### `createRedisContainer`

```typescript
import { createRedisContainer, type TestContainer } from '@onebun/core';

let redis: TestContainer;

beforeAll(async () => {
  redis = await createRedisContainer();
  // redis.url → 'redis://localhost:55123'
  // redis.host → 'localhost'
  // redis.port → 55123
});

afterAll(async () => {
  await redis.stop();
});
```

**Options:**
- `image` — Docker image (default: `redis:7-alpine`)
- `startupTimeout` — timeout in ms (default: `30000`)

### `createNatsContainer`

```typescript
import { createNatsContainer, type TestContainer } from '@onebun/core';

let nats: TestContainer;

beforeAll(async () => {
  nats = await createNatsContainer({ enableJetStream: true });
  // nats.url → 'nats://localhost:55124'
});

afterAll(async () => {
  await nats.stop();
});
```

**Options:**
- `image` — Docker image (default: `nats:2.10-alpine`)
- `startupTimeout` — timeout in ms (default: `30000`)
- `enableJetStream` — enable JetStream (default: `false`)

### `TestContainer` interface

```typescript
interface TestContainer {
  url: string;                    // Full connection URL
  host: string;                   // Container host
  port: number;                   // Mapped port
  container: StartedTestContainer; // testcontainers instance
  stop(): Promise<void>;          // Stop and remove container
}
```

## Other Utilities

### `useFakeTimers`

Replaces global `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, and `Date.now` with controllable fakes. Useful for testing timer-based logic without real delays.

```typescript
import { useFakeTimers } from '@onebun/core';
import { describe, it, expect, afterEach } from 'bun:test';

describe('TimerService', () => {
  const timers = useFakeTimers();

  afterEach(() => {
    timers.restore();
  });

  it('executes callback after delay', () => {
    let called = false;
    setTimeout(() => { called = true; }, 1000);

    timers.advanceTime(999);
    expect(called).toBe(false);

    timers.advanceTime(1);
    expect(called).toBe(true);
  });
});
```

**Returned methods:**
- `advanceTime(ms)` — advance time by `ms` milliseconds, executing any due timers
- `runAllTimers()` — execute all pending `setTimeout` callbacks (not intervals)
- `now()` — get current fake time
- `getTimerCount()` — get number of pending timers
- `clearAllTimers()` — clear all pending timers without executing
- `restore()` — restore real timers

### `createMockConfig`

Creates a mock `IConfig` object for testing. Returns values from the provided map via `get(path)`.

```typescript
import { createMockConfig } from '@onebun/core';

const config = createMockConfig({
  'server.port': 3000,
  'server.host': '0.0.0.0',
});

config.get('server.port'); // 3000
config.isInitialized;      // true
```

**Options:**
- `values` — `Record<string, unknown>` — config values
- `options.isInitialized` — whether config is initialized (default: `true`)

### `createMockLogger`

Creates a silent async `Logger` (Effect-based). All methods return `Effect.succeed(undefined)`, `child()` returns itself.

```typescript
import { createMockLogger } from '@onebun/core';

const logger = createMockLogger();
// Use with Effect programs that require Logger
```

### `makeMockLoggerLayer`

Creates an Effect `Layer` that provides a silent mock logger. Used internally by `TestingModule`.

```typescript
import { makeMockLoggerLayer } from '@onebun/core';

const loggerLayer = makeMockLoggerLayer();
// Use with Effect.provide(loggerLayer)
```

### `createMockSyncLogger`

Creates a silent no-op `SyncLogger`. All methods are no-ops, `child()` returns itself.

```typescript
import { createMockSyncLogger } from '@onebun/core';

const logger = createMockSyncLogger();
logger.info('this does nothing');
logger.child({ context: 'test' }); // returns same logger
```

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
- `overrideProvider()` registers the mock under the service's Effect.Context tag in the application's `GlobalScope`, which PHASE -1 of module init seeds into EVERY module before any provider is constructed — so it reaches services and imported modules, not only root-module controllers, and the real provider is skipped rather than built and discarded
- `inject()` makes real HTTP requests via `undici.fetch` (bypasses global fetch mocks)
- Always call `close()` in `afterEach` to prevent port leaks
- `_testProviders` is an internal option; the application copies it into its `GlobalScope.overrides` before building the module tree (there is no post-hoc pass over the root module any more)
- No `envSchema` in `setOptions()` + a service reading `this.config` in its constructor = `DependencyResolutionError: Could not resolve dependency X`. `module.ts` re-throws only `OneBun*`-named errors; the config stub's plain `Error` is logged to the silent mock logger and the service is dropped

**Testcontainers** (`createRedisContainer`, `createNatsContainer`, `createPostgresContainer`):
- `testcontainers` is a REQUIRED peer dependency of `@onebun/core`, declared without `peerDependenciesMeta.optional`. The `@onebun/core/testing` barrel value-imports it, so it must be installed for any import from that subpath, not only for the container helpers. That is the intended contract: integration tests are the default, and the subpath is a boundary of concern rather than a way to make the peer conditional
- Belongs in the consumer's `devDependencies`; a production install never resolves the subpath
- Require Docker daemon running
- Return `TestContainer` with `url`, `host`, `port`, `container`, `stop()`
- Default images: `redis:7-alpine`, `nats:2.10-alpine`, `postgres:16-alpine`
- `createPostgresContainer` waits for the SECOND `database system is ready to accept connections` line. The image starts a temporary server for its init scripts, logs that line for it, stops it, and only then starts the real one — waiting for the first hands back a URL that is about to stop working
- NATS supports `enableJetStream: true` option
- Always call `stop()` in `afterAll` to clean up containers

**Mock Utilities**:
- `createMockConfig(values, options)` — returns `IConfig` with `get()` returning from values map
- `createMockSyncLogger()` — no-op sync logger, `child()` returns itself
- `createMockLogger()` — no-op async Effect logger
- `makeMockLoggerLayer()` — Effect Layer providing mock async logger
- `useFakeTimers()` — replaces global `setTimeout`/`setInterval`/`Date.now`, returns control object. `runAllTimers()` picks its target times from timeouts only, but reaches them via `advanceTimersByTime`, so intervals DO fire (and survive) — it is not an interval-free mode
- `FakeTimers` class and `fakeTimers` singleton are also exported for direct use, but `useFakeTimers()` is the recommended API

**Exported types**: `TestInstanceResult<T>`, `TestContainer`, `RedisContainerOptions`, `NatsContainerOptions`, `CompiledTestingModule`

</llm-only>

# Testing

OneBun provides a set of testing utilities for unit and integration testing of services, controllers, and full application modules.

All testing utilities are exported from `@onebun/core/testing`:

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
  createPostgresContainer,
} from '@onebun/core/testing';
```

## Installation

`@onebun/core/testing` requires `testcontainers` as a peer dependency:

```bash
bun add -d testcontainers
```

**This is deliberate, and it is not optional.** OneBun treats integration tests against real
dependencies as the default way to test a service — not as an advanced option — and ships the
container helpers to make that the path of least resistance. A framework that made them
conditional would be inviting the mock-everything alternative it exists to avoid.

Install it in `devDependencies`. The subpath keeps it out of `@onebun/core`'s own entry point,
so a production install (`bun install --production`) never pulls a Docker client, and nothing
in your runtime bundle references it.

Running the container helpers additionally needs a Docker daemon (or a Podman socket) on the
machine executing the tests. The rest of `@onebun/core/testing` — `createTestService`,
`TestingModule`, `useFakeTimers`, the mock helpers — does not.

## Unit Testing — `createTestService` / `createTestController`

For isolated unit testing of services and controllers without starting an HTTP server.

### `createTestService`

Creates a service instance with a mock logger and mock config. Calls `initializeService()` internally, so `this.logger` and `this.config` are available in the service.

```typescript
import { createTestService } from '@onebun/core/testing';
import type { Mock } from 'bun:test';
import type { SyncLogger } from '@onebun/logger';

const { instance, logger, config } = createTestService(UserService);

// Use the service
const result = instance.findById('123');

// Logger methods are bun:test mocks at runtime, but `logger` is declared as a plain
// SyncLogger — without the cast, `.mock` is a type error
expect((logger.info as Mock<SyncLogger['info']>).mock.calls).toHaveLength(1);
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
- `logger: SyncLogger` — mock logger whose methods are `bun:test` `mock()` functions; the declared type is plain `SyncLogger`, so cast (`logger.info as Mock<SyncLogger['info']>`) before asserting on `.mock.calls`
- `config: IConfig` — mock config

### `createTestController`

Same API as `createTestService`, but calls `initializeController()` instead.

```typescript
import { createTestController } from '@onebun/core/testing';

const { instance, logger, config } = createTestController(UserController, {
  deps: [mockUserService],
});
```

## Integration Testing — `TestingModule`

For full integration testing with a real HTTP server, middleware pipeline, and DI.

### Basic Usage

```typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { TestingModule, type CompiledTestingModule } from '@onebun/core/testing';

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

The override is applied to every module before any provider is constructed, so it reaches controllers, **services** that inject the overridden class, and imported modules — including an imported module that provides the overridden class itself. The real provider is then not constructed at all.

#### `.setOptions(options)`

Sets additional application options (`basePath`, `envSchema`, `cors`, etc.):

```typescript
module = await TestingModule
  .create({ controllers: [UserController], providers: [UserService] })
  .setOptions({ basePath: '/api', envSchema: myEnvSchema })
  .compile();
```

::: warning `envSchema` is required by any service that reads `this.config` in its constructor
Without it the application config is the not-initialized stub, and `config.get()` throws
`Configuration not initialized. Provide envSchema in ApplicationOptions.` from inside the
constructor. Module init only re-throws errors whose `name` starts with `OneBun`; anything else is
logged — to `TestingModule`'s silent mock logger, where you never see it — and the service is left
unregistered. What surfaces is the dependent's failure instead:

```
DependencyResolutionError: Could not resolve dependency UserService for controller UserController.
  - Ensure UserService is decorated with @Service() and listed in a module's providers.
```

The service *is* decorated and *is* in `providers`; the missing `envSchema` is the real cause. A
service that reads `this.config` only inside a method is unaffected at boot and throws into a 500 at
request time instead.
:::

#### `.compile()`

Starts the application on a random free port. Returns a `CompiledTestingModule`.

#### `module.inject(method, path, options?)`

Sends a real HTTP request to the test server:

<!-- typecheck: skip -->
```typescript
const response = await module.inject('POST', '/users', {
  body: { name: 'Alice' },
  headers: { 'Authorization': 'Bearer token' },
  query: { include: 'profile' },
});
```

::: tip
`module` here is the `CompiledTestingModule` from the Basic Usage example above. Do not name your own
variable `module` outside a `describe` scope that declares it — at module top level it resolves to
Node's global `module`, and `module.inject` is then a type error rather than a call.
:::

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

## Testcontainers — `createRedisContainer` / `createNatsContainer` / `createPostgresContainer`

Helpers for spinning up Redis and NATS containers in tests. Requires Docker.

### `createRedisContainer`

```typescript
import { createRedisContainer, type TestContainer } from '@onebun/core/testing';

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
import { createNatsContainer, type TestContainer } from '@onebun/core/testing';

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

### `createPostgresContainer`

```typescript
import { createPostgresContainer, type TestContainer } from '@onebun/core/testing';

let postgres: TestContainer;

beforeAll(async () => {
  postgres = await createPostgresContainer();
  // postgres.url → 'postgresql://onebun:onebun@localhost:55231/onebun_test'
});

afterAll(async () => {
  await postgres.stop();
});
```

**Options** (`PostgresContainerOptions`):
- `image` — Docker image (default: `postgres:16-alpine`)
- `startupTimeout` — timeout in ms (default: `30000`, `60000` under CI)
- `database` — database to create (default: `onebun_test`)
- `username` — role to create (default: `onebun`)
- `password` — its password (default: `onebun`)

::: tip It waits for the second "ready" line, deliberately
The postgres image starts a temporary server to run its initialisation scripts and logs
`database system is ready to accept connections` for it, then shuts it down and starts the real
one. Waiting for the first line returns a URL that is about to stop working, and the failure lands
in whichever test connects first rather than in the helper.
:::

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
import { useFakeTimers } from '@onebun/core/testing';
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
- `advanceTime(ms)` — advance time by `ms` milliseconds, executing every timer that falls due in that span — an interval fires once per period crossed, so a 100 ms interval ticks 10 times under `advanceTime(1000)`
- `runAllTimers()` — run until no `setTimeout` is left pending. Only timeouts choose how far time jumps, but the jump goes through `advanceTime`, so **intervals still fire along the way** and remain pending afterwards: a 100 ms interval next to a 1000 ms timeout ticks 10 times
- `now()` — get current fake time
- `getTimerCount()` — get number of pending timers
- `clearAllTimers()` — clear all pending timers without executing
- `restore()` — restore real timers

### `createMockConfig`

Creates a mock `IConfig` object for testing. Returns values from the provided map via `get(path)`.

```typescript
import { createMockConfig } from '@onebun/core/testing';

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
import { createMockLogger } from '@onebun/core/testing';

const logger = createMockLogger();
// Use with Effect programs that require Logger
```

### `makeMockLoggerLayer`

Creates an Effect `Layer` that provides a silent mock logger. Used internally by `TestingModule`.

```typescript
import { makeMockLoggerLayer } from '@onebun/core/testing';

const loggerLayer = makeMockLoggerLayer();
// Use with Effect.provide(loggerLayer)
```

### `createMockSyncLogger`

Creates a silent no-op `SyncLogger`. All methods are no-ops, `child()` returns itself.

```typescript
import { createMockSyncLogger } from '@onebun/core/testing';

const logger = createMockSyncLogger();
logger.info('this does nothing');
logger.child({ context: 'test' }); // returns same logger
```

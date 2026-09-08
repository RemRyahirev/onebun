# Testing — Full Reference

## Unit Testing

### createTestService

Creates a service instance with mocked logger and config, without bootstrapping the application.
The returned logger's methods really are `bun:test` mocks, but `TestInstanceResult.logger` is typed
`SyncLogger`, and `SyncLogger.info` is a plain `(message: string, ...args: unknown[]) => void` with
no `.mock` property. Reaching the mock handle therefore needs a cast — `logger.info.mock.calls`
does not compile (TS2339), even though it would work at runtime.

```typescript
import type { Mock } from 'bun:test';

import { createTestService } from '@onebun/core/testing';
import type { TestInstanceResult } from '@onebun/core/testing';
import type { SyncLogger } from '@onebun/core';

const { instance, logger, config } = createTestService(MyService, {
  // Config values accessible via this.config.get()
  config: {
    'server.port': 3000,
    'budget.reserveFloorCents': 500,
  },
  // Constructor dependencies in parameter order
  deps: [mockRepository, mockCacheService],
});

// Logger assertions — cast to expose the mock handle the type hides
instance.doWork();
const info = logger.info as Mock<SyncLogger['info']>;
expect(info.mock.calls[0]?.[0]).toBe('Working');

// Config is the mock IConfig instance
expect(config.get('server.port')).toBe(3000);
```

### createTestController

Same API as `createTestService`, but initializes the controller context (calls
`initializeController` instead of `initializeService`).

```typescript
import { createTestController } from '@onebun/core/testing';

const { instance, logger } = createTestController(ItemController, {
  deps: [mockItemService],
});

const response = await instance.findAll('10');
expect(response).toBeDefined();
```

### Return type: TestInstanceResult<T>

```typescript
interface TestInstanceResult<T> {
  instance: T;           // fully initialized service/controller
  logger: SyncLogger;    // methods are mock()s at runtime; the SyncLogger type hides .mock
  config: IConfig;       // mock config (IConfig<OneBunAppConfig>)
}
```

`SyncLogger` and `IConfig` come from `@onebun/core`, not from `@onebun/core/testing` — the testing
barrel re-exports containers, service-helpers, test-utils and testing-module, and none of the four
re-exports either type (`import type { SyncLogger } from '@onebun/core/testing'` is TS2305).

## Integration Testing — TestingModule

For tests that need a real HTTP server with the full middleware/guard/DI pipeline.

### Setup

```typescript
import { TestingModule } from '@onebun/core/testing';
import type { CompiledTestingModule } from '@onebun/core/testing';

describe('ItemController', () => {
  let app: CompiledTestingModule;

  beforeEach(async () => {
    app = await TestingModule
      .create({
        controllers: [ItemController],
        providers: [ItemService, ItemRepository],
        imports: [DrizzleModule.forRoot(testDbConfig)],
      })
      .overrideProvider(ItemRepository).useValue(mockRepo)
      .setOptions({
        envSchema: testEnvSchema,
        basePath: '/api/v1',
        cors: { origin: '*' },
      })
      .compile();
  });

  afterEach(() => app.close());
});
```

### Key points

- `.compile()` starts a real HTTP server on **port 0** (OS picks a free port)
- Uses `makeMockLoggerLayer()` internally — logs are silenced
- `.overrideProvider(Class)` accepts `.useValue(mock)` or `.useClass(MockClass)`
- overrideProvider() reaches services and imported modules, not only root-module controllers — the mock is seeded into every module before any provider is built, and the real provider is then not constructed at all
- Always call `.close()` in `afterEach` to prevent port leaks

### CompiledTestingModule API

```typescript
// Make HTTP requests to the test server
const res = await app.inject('GET', '/items', {
  headers: { Authorization: 'Bearer token' },
  query: { limit: '10' },
});

const res = await app.inject('POST', '/items', {
  body: { name: 'test' },
  headers: { 'Content-Type': 'application/json' },
});

// Access internals
const service = app.get(ItemService);           // retrieve DI instance
const port = app.getPort();                      // server port
const config = app.getConfig();                  // app config
const underlyingApp = app.getApp();              // OneBunApplication instance
```

`inject()` uses `undici.fetch` internally, which bypasses global fetch mocks — this
ensures test requests aren't intercepted by test setup.

## Testcontainers

For integration tests that need real external services.

**`testcontainers` must be installed for ANY import from `@onebun/core/testing`, not just the
container helpers** — `bun add -d testcontainers`. It is declared in `@onebun/core`'s
`peerDependencies` with no `peerDependenciesMeta.optional`, and the testing barrel does
`export * from './containers'` while `containers.ts` value-imports `{ GenericContainer, Wait }` at
module top level. So even a file that only pulls `createTestService` resolves the whole
testcontainers graph, and without the peer the import fails outright. This is deliberate: the
subpath is the boundary that keeps a Docker client out of a production install, and integration
tests against real services are the framework's default way to test.

A Docker daemon is needed only to *run* the container helpers; `createTestService`,
`TestingModule`, `useFakeTimers` and the mock helpers do not touch it.

### createRedisContainer

```typescript
import { createRedisContainer } from '@onebun/core/testing';
import type { TestContainer } from '@onebun/core/testing';

let redis: TestContainer;

beforeAll(async () => {
  redis = await createRedisContainer({
    image: 'redis:7-alpine',          // default
    startupTimeout: 30_000,           // ms; default is 60_000 under CI, 30_000 locally
  });
  // redis.url  — e.g., 'redis://localhost:55001'
  // redis.host — e.g., 'localhost'
  // redis.port — e.g., 55001
});

afterAll(() => redis.stop());
```

### createNatsContainer

```typescript
import { createNatsContainer } from '@onebun/core/testing';

let nats: TestContainer;

beforeAll(async () => {
  nats = await createNatsContainer({
    image: 'nats:2.10-alpine',        // default
    enableJetStream: true,             // passes --js flag to NATS server
    startupTimeout: 30_000,            // ms; default is 60_000 under CI, 30_000 locally
  });
  // nats.url — e.g., 'nats://localhost:55002'
});

afterAll(() => nats.stop());
```

The startup-timeout default is `process.env.CI ? 60_000 : 30_000` — passing a flat `30_000`
explicitly *shortens* the timeout on CI, which is the environment where image pulls are slowest.
Omit the option unless you actually need a different budget.

### TestContainer interface

```typescript
interface TestContainer {
  url: string;
  host: string;
  port: number;
  container: StartedTestContainer;     // from testcontainers library
  stop(): Promise<void>;
}
```

## Mock Utilities

### useFakeTimers

Replaces `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, and `Date.now`
with controlled versions. Analogous to Jest's fake timers but for `bun:test`.

```typescript
import { useFakeTimers } from '@onebun/core/testing';

test('delayed operation', () => {
  const timers = useFakeTimers();

  let called = false;
  setTimeout(() => { called = true; }, 5000);

  expect(called).toBe(false);
  timers.advanceTime(5000);
  expect(called).toBe(true);

  timers.restore();   // always restore after test
});
```

API:
- `advanceTime(ms)` — advances clock, executes any due timers (intervals reschedule and can fire
  many times in one call)
- `runAllTimers()` — drains every pending `setTimeout`, **and fires intervals along the way**
- `now()` — a function returning the current fake timestamp, not a property
- `getTimerCount()` — number of pending timers
- `clearAllTimers()` — clears all pending timers
- `restore()` — restores original timer functions

`runAllTimers()` only uses non-interval timers to *pick the next target time*; it then calls
`advanceTimersByTime()` to reach it, and that executes every timer due in the span it crosses,
intervals included. A 100 ms interval plus a 1000 ms timeout means 10 interval ticks. Intervals
never end the loop by themselves (it stops when no timeout is left, or throws
`runAllTimers: Maximum iterations reached` after 1000 rounds), so a test that wants "just the
timeouts" must `clearInterval(handle)` first — `clearAllTimers()` would drop the timeouts too.
`advanceTime(ms)` is no escape: it is the same executor `runAllTimers` delegates to, so it fires
intervals as well and only bounds how far the clock moves. Use it to choose how many interval ticks
you take, not to avoid them.

`now` is `() => number`, so `timers.now` is the closure, never the timestamp — always call it. The
mistake never passes silently: `expect(timers.now).toBe(1000)` is TS2769 ("Argument of type 'number'
is not assignable to parameter of type '() => number'"), and in a file that is never typechecked it
still fails the assertion at runtime.

If a test takes >10ms when using fake timers, the mock is likely used incorrectly.

### Mock Loggers

```typescript
import {
  createMockLogger,       // Effect-based async logger (all methods → Effect.succeed)
  createMockSyncLogger,   // Synchronous silencer: plain no-op arrows, NOT bun:test mocks
  makeMockLoggerLayer,    // Effect Layer providing mock logger
} from '@onebun/core/testing';
```

- `createMockSyncLogger()` — every method is a bare `() => {}` and `child()` returns the same
  object. There is no `bun:test` instrumentation, so `logger.info.mock` is `undefined` and
  `logger.info.mock.calls` throws `TypeError: undefined is not an object`. Use it to silence logs,
  never to assert on them
- The mock-instrumented sync logger is a separate, **non-exported** helper
  (`createMockableSyncLogger()` in `service-helpers.ts`), reachable only through
  `createTestService` / `createTestController`. If you need logging assertions, build the subject
  with one of those instead of constructing it yourself with `createMockSyncLogger()`
- `createMockLogger()` — Effect-based, methods return `Effect.succeed(undefined)`
- `makeMockLoggerLayer()` — for Effect Layer composition, used internally by TestingModule

### createMockConfig

```typescript
import { createMockConfig } from '@onebun/core/testing';

const config = createMockConfig(
  { 'server.port': 3000, 'db.path': ':memory:' },
  { isInitialized: true },
);

config.get('server.port');  // 3000
```

## Typical Test File Structure

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';

import { createTestService } from '@onebun/core/testing';
import type { SyncLogger } from '@onebun/core';   // NOT from @onebun/core/testing

describe('MyService', () => {
  let service: MyService;
  let logger: SyncLogger;

  beforeEach(() => {
    const result = createTestService(MyService, {
      config: { 'feature.enabled': true },
      deps: [mockDep],
    });
    service = result.instance;
    logger = result.logger;
  });

  test('does work', () => {
    service.doWork();
    expect((logger.info as Mock<SyncLogger['info']>).mock.calls).toHaveLength(1);
  });
});
```

## Anti-Patterns

| Anti-pattern | Correct approach |
|---|---|
| `toBeTruthy()` / `toBeFalsy()` | Use specific matchers: `toBe(true)`, `toBeNull()`, etc. |
| Test takes >10ms with fake timers | Fake timer mock is likely used incorrectly |
| Not calling `close()` / `stop()` | Always clean up in `afterEach`/`afterAll` to prevent leaks |
| Mocking fetch for integration tests | `TestingModule.inject()` uses `undici.fetch` — bypasses global mocks |
| Manual mock loggers | Use `createTestService`/`createTestController` — mocks are built in |
| `createMockSyncLogger().info.mock.calls` | That logger is plain no-ops — build the subject with `createTestService` to get an instrumented one |
| `logger.info.mock.calls` on `TestInstanceResult` | Cast first: `(logger.info as Mock<SyncLogger['info']>).mock.calls` — the declared type has no `.mock` |
| `expect(timers.now).toBe(1000)` | `now` is a function: `expect(timers.now()).toBe(1000)` |

## JetStream durable teardown in tests

A test that subscribes with a `group` leaves a durable consumer on the broker. `unsubscribe()`
and `disconnect()` deliberately do NOT remove it, so a suite that reuses a stream across cases
accumulates consumers and can see a later case attach to an earlier one's position. Tear it down
explicitly:

```typescript
afterEach(async () => {
  // `deleteDurableConsumer` is JetStream-only, so it is not on the QueueAdapter interface.
  // It THROWS when the adapter is not connected or when no declared stream binds the pattern,
  // so guard it — an unguarded throw here replaces the real assertion failure of the test.
  try {
    await adapter.deleteDurableConsumer('orders.created', 'test-workers');  // false if already gone
  } catch {
    // teardown must not mask the case's own failure
  }

  await adapter.disconnect();
});
```

Only a genuine `ConsumerNotFound` yields `false`; everything else propagates. `deleteDurableConsumer()`
starts with `ensureConnected()` (throws `JetStreamQueueAdapter not connected. Call connect() first.`)
and then resolves the stream through the same `resolveStreamForSubject()` that `subscribe()` uses —
a delete must name exactly the stream the subscription bound to, or it cannot decommission what
`subscribe()` created. It throws and lists every declared stream rather than guessing, on BOTH the
no-match case and the two-candidates case: on a destructive call a mistyped pattern would otherwise
delete a consumer on an unrelated stream. A permissions denial is rethrown as itself.
That is exactly the shape that bites in an `afterEach` after a failed case, where the adapter may
never have connected.

Prefer a stream name unique to the test file over deleting consumers one by one when a suite
creates many.

/**
 * Behavioural coverage for the sections of docs/testing.md that the neighbouring
 * `docs-examples.test.ts` leaves unpinned.
 *
 * Everything comes through `@onebun/core/testing` — the specifier the page tells the reader
 * to use — so a barrel that stops re-exporting a helper fails here rather than in a consumer.
 *
 * @source docs:testing.md
 */

import { connect } from 'node:net';

import { SQL } from 'bun';
import {
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import { Effect } from 'effect';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Service,
} from '@onebun/core';
import type { CompiledTestingModule, TestContainer } from '@onebun/core/testing';
import {
  createMockConfig,
  createMockSyncLogger,
  createNatsContainer,
  createPostgresContainer,
  createRedisContainer,
  createTestService,
  makeMockLoggerLayer,
  TestingModule,
} from '@onebun/core/testing';
import type { SyncLogger } from '@onebun/logger';
import { LoggerService } from '@onebun/logger';

// ============================================================================
// Helpers
// ============================================================================

const SOCKET_TIMEOUT_MS = 5_000;
const REDIS_CONTAINER_PORT = 6379;
const CONTAINER_TEST_TIMEOUT_MS = 120_000;
const NOT_STOPPED = 'not stopped';

/** Every console method the framework's own `ConsoleTransport` writes through. */
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

/**
 * A `SyncLogger` that is deliberately NOT a no-op: it records `level className: message` for
 * every call, and `child()` mints a new logger carrying the merged context — the two things the
 * mock does differently. Used as the positive control for the mock, so that "silent" cannot be
 * satisfied by "never called".
 */
function makeRecordingSyncLogger(sink: string[], context: Record<string, unknown> = {}): SyncLogger {
  const write = (level: string) => (message: string): void => {
    sink.push(`${level} ${String(context.className ?? '-')}: ${message}`);
  };

  return {
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    fatal: write('fatal'),
    child: (childContext: Record<string, unknown>): SyncLogger =>
      makeRecordingSyncLogger(sink, { ...context, ...childContext }),
  };
}

/**
 * Open a raw TCP socket to a container, optionally send a line, and resolve with the first
 * chunk that ends a protocol line. Both Redis (`PING` → `+PONG`) and NATS (server-initiated
 * `INFO {...}`) answer in one line, so this is enough to prove the returned `host`/`port`
 * really address a working server — and, after `stop()`, that they no longer do.
 */
async function readLine(host: string, port: number, payload = ''): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = '';

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.on('connect', () => {
      if (payload) {
        socket.write(payload);
      }
    });
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('\r\n')) {
        socket.destroy();
        resolve(buffer);
      }
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timed out waiting for a protocol line'));
    });
    socket.on('error', (error: Error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function isReachable(host: string, port: number, payload = ''): Promise<boolean> {
  return await readLine(host, port, payload).then(() => true, () => false);
}

/** Parse the `INFO {...}` line a NATS server sends on connect. */
function parseNatsInfo(line: string): { jetstream?: boolean; version?: string } {
  const json = line.slice('INFO '.length, line.indexOf('\r\n'));

  return JSON.parse(json) as { jetstream?: boolean; version?: string };
}

// ============================================================================
// Fixtures
// ============================================================================

/** Counts its own calls so `module.get()` can be checked for handing back the live instance. */
@Service()
class VisitCounterService extends BaseService {
  private visits = 0;

  bump(): number {
    this.visits += 1;

    return this.visits;
  }

  total(): number {
    return this.visits;
  }
}

@Service()
class NeverRegisteredService extends BaseService {
  answer(): number {
    return 42;
  }
}

@Controller('/visits')
class VisitCounterController extends BaseController {
  constructor(private readonly counter: VisitCounterService) {
    super();
  }

  @Get('/hit')
  hit(): { visits: number } {
    return { visits: this.counter.bump() };
  }
}

/** Exposes the logger the framework wired in, so identity can be asserted. */
@Service()
class LoggerProbeService extends BaseService {
  currentLogger(): SyncLogger {
    return this.logger;
  }

  emit(): void {
    this.logger.info('inside the service');
  }
}

@Service()
class PingService extends BaseService {
  ping(): string {
    return 'pong';
  }
}

// ============================================================================
// The @onebun/core/testing barrel
// ============================================================================

describe('docs/testing.md — the @onebun/core/testing barrel', () => {
  /**
   * The page opens with "All testing utilities are exported from `@onebun/core/testing`" and
   * then lists ten names. A barrel that drops one — or a subpath export that stops resolving —
   * breaks every consumer's test file, so the list is pinned and the helpers that need no
   * Docker are called through the namespace itself: they must be values, not just types.
   *
   * @source docs:testing.md#testing-utilities-internal-notes
   */
  it('re-exports every helper the opening snippet imports, as working values', async () => {
    const barrel = await import('@onebun/core/testing');

    const documented = [
      'createTestService',
      'createTestController',
      'TestingModule',
      'useFakeTimers',
      'createMockConfig',
      'createMockLogger',
      'makeMockLoggerLayer',
      'createMockSyncLogger',
      'createRedisContainer',
      'createNatsContainer',
    ];

    expect(documented.filter(name => !(name in barrel))).toEqual([]);

    // Called through the namespace: a name that resolved to `undefined` would throw here.
    /* eslint-disable @typescript-eslint/naming-convention */
    expect(barrel.createMockConfig({ 'server.port': 3000 }).get('server.port')).toBe(3000);
    /* eslint-enable @typescript-eslint/naming-convention */
    expect(barrel.createTestService(PingService).instance.ping()).toBe('pong');
    expect(barrel.createTestController(VisitCounterController, {
      deps: [{ bump: () => 7 }],
    }).instance.hit()).toEqual({ visits: 7 });

    const syncLogger = barrel.createMockSyncLogger();
    expect(syncLogger.child({ context: 'barrel' })).toBe(syncLogger);
    expect(Effect.runSync(barrel.createMockLogger().info('through the barrel'))).toBeUndefined();

    const timers = barrel.useFakeTimers();
    try {
      expect(timers.getTimerCount()).toBe(0);
      setTimeout(() => undefined, 10);
      expect(timers.getTimerCount()).toBe(1);
    } finally {
      timers.restore();
    }
  });
});

// ============================================================================
// module.get(ServiceClass)
// ============================================================================

describe('docs/testing.md — module.get(ServiceClass)', () => {
  /**
   * "Retrieves a service instance by class" — and the one the running application injected,
   * not a fresh copy. Asserted by driving state through HTTP and reading it back: if `get()`
   * ever constructed a new instance, the counter would read 0 instead of 2, and the value
   * pushed in through the handle would not reach the next request.
   *
   * @source docs:testing.md#modulegetserviceclass
   */
  it('hands back the very instance the controller was injected with', async () => {
    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({ controllers: [VisitCounterController], providers: [VisitCounterService] })
        .compile();

      const first = await module.inject('GET', '/visits/hit');
      const second = await module.inject('GET', '/visits/hit');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const service = module.get(VisitCounterService);

      expect(service.total()).toBe(2);
      // Mutating through the retrieved handle is visible to the next request → same object.
      expect(service.bump()).toBe(3);

      const third = await module.inject('GET', '/visits/hit');
      const body = await third.json() as { result: { visits: number } };
      expect(body.result.visits).toBe(4);
    } finally {
      await module?.close();
    }
  });

  /**
   * The other half of "by class": a class the module never provided has no instance to
   * return, and `get()` says so instead of handing back `undefined`.
   *
   * @source docs:testing.md#modulegetserviceclass
   */
  it('throws for a class that is not in providers', async () => {
    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({ controllers: [VisitCounterController], providers: [VisitCounterService] })
        .compile();

      const compiled = module;

      expect(() => compiled.get(NeverRegisteredService))
        .toThrow('Service NeverRegisteredService not found. Make sure it\'s registered in the module\'s providers.');
    } finally {
      await module?.close();
    }
  });
});

// ============================================================================
// createRedisContainer
// ============================================================================

describe('docs/testing.md — createRedisContainer', () => {
  /**
   * The snippet's comments claim `redis.url` / `redis.host` / `redis.port` address a running
   * Redis, and the surrounding prose claims `stop()` tears it down. Both are checked over a
   * raw socket: `PING` must answer `+PONG` before `stop()`, and the port must be dead after.
   *
   * @source docs:testing.md#createrediscontainer
   */
  it('returns a url/host/port that speak Redis, and stop() takes the server away', async () => {
    const redis = await createRedisContainer();
    let stopped = false;

    try {
      expect(redis.url).toBe(`redis://${redis.host}:${redis.port}`);
      expect(redis.port).toBeGreaterThan(0);

      expect(await readLine(redis.host, redis.port, 'PING\r\n')).toBe('+PONG\r\n');

      await redis.stop();
      stopped = true;

      expect(await isReachable(redis.host, redis.port, 'PING\r\n')).toBe(false);
    } finally {
      if (!stopped) {
        await redis.stop();
      }
    }
  }, CONTAINER_TEST_TIMEOUT_MS);
});

// ============================================================================
// createPostgresContainer
// ============================================================================

describe('docs/testing.md — createPostgresContainer', () => {
  /**
   * The snippet's comment claims `postgres.url` addresses a running server, and the tip claims
   * the helper waits for the SECOND "ready to accept connections" line because the first belongs
   * to the temporary server the image uses for its init scripts.
   *
   * Both are checked by connecting immediately: the URL the helper returns must already accept a
   * query. Waiting on the first line returns while the init server is on its way down, so this
   * case fails — not always, which is the point of pinning it rather than trusting the strategy.
   *
   * @source docs:testing.md#createpostgrescontainer
   */
  it('returns a url that already accepts queries, with the documented database and user', async () => {
    const postgres = await createPostgresContainer();

    try {
      expect(postgres.url).toBe(
        `postgresql://onebun:onebun@${postgres.host}:${postgres.port}/onebun_test`,
      );

      const sql = new SQL(postgres.url);

      try {
        const rows = await sql`SELECT current_database() AS db, current_user AS usr` as Array<{
          db: string;
          usr: string;
        }>;

        expect(rows).toEqual([{ db: 'onebun_test', usr: 'onebun' }]);
      } finally {
        await sql.close();
      }
    } finally {
      await postgres.stop();
    }
  }, CONTAINER_TEST_TIMEOUT_MS);

  /**
   * The documented `database` / `username` / `password` options.
   *
   * @source docs:testing.md#createpostgrescontainer
   */
  it('creates the database and role the options name', async () => {
    const postgres = await createPostgresContainer({
      database: 'custom_db',
      username: 'custom_user',
      password: 'custom_pass',
    });

    try {
      expect(postgres.url).toBe(
        `postgresql://custom_user:custom_pass@${postgres.host}:${postgres.port}/custom_db`,
      );

      const sql = new SQL(postgres.url);

      try {
        const rows = await sql`SELECT current_database() AS db, current_user AS usr` as Array<{
          db: string;
          usr: string;
        }>;

        expect(rows).toEqual([{ db: 'custom_db', usr: 'custom_user' }]);
      } finally {
        await sql.close();
      }
    } finally {
      await postgres.stop();
    }
  }, CONTAINER_TEST_TIMEOUT_MS);
});

// ============================================================================
// createNatsContainer
// ============================================================================

describe('docs/testing.md — createNatsContainer', () => {
  /**
   * `enableJetStream` is documented as an option defaulting to `false`. A NATS server
   * advertises `"jetstream":true` in the `INFO` line it sends on connect only when it was
   * started with `--js`, so the flag is observable end to end: present when the option is
   * passed, absent when it is not.
   *
   * @source docs:testing.md#createnatscontainer
   */
  it('enableJetStream: true starts a server whose INFO advertises jetstream', async () => {
    const nats = await createNatsContainer({ enableJetStream: true });

    try {
      expect(nats.url).toBe(`nats://${nats.host}:${nats.port}`);

      const line = await readLine(nats.host, nats.port);
      expect(line.startsWith('INFO ')).toBe(true);
      expect(parseNatsInfo(line).jetstream).toBe(true);
    } finally {
      await nats.stop();
    }
  }, CONTAINER_TEST_TIMEOUT_MS);

  /**
   * @source docs:testing.md#createnatscontainer
   */
  it('defaults enableJetStream to false and the image to nats:2.10-alpine', async () => {
    const nats = await createNatsContainer();

    try {
      const info = parseNatsInfo(await readLine(nats.host, nats.port));

      expect(info.jetstream).toBeUndefined();
      // The documented default image is `nats:2.10-alpine`; the server reports its version.
      expect(info.version?.startsWith('2.10.')).toBe(true);
    } finally {
      await nats.stop();
    }
  }, CONTAINER_TEST_TIMEOUT_MS);
});

// ============================================================================
// TestContainer interface
// ============================================================================

describe('docs/testing.md — TestContainer interface', () => {
  /**
   * The interface listing annotates each field with what it means: `url` is the full
   * connection URL, `port` is the MAPPED port, `container` is the testcontainers instance,
   * `stop()` stops and removes. Every claim is checked against a live container rather than a
   * hand-built object, and the key set is pinned so an added or renamed field surfaces here.
   *
   * @source docs:testing.md#testcontainer-interface
   */
  it('every documented field describes the running container it came from', async () => {
    const redis: TestContainer = await createRedisContainer();
    let stopResult: unknown = NOT_STOPPED;

    try {
      expect(Object.keys(redis).sort()).toEqual(['container', 'host', 'port', 'stop', 'url']);

      // `container` is the testcontainers instance the other three fields were read from.
      expect(redis.container.getHost()).toBe(redis.host);
      expect(redis.container.getMappedPort(REDIS_CONTAINER_PORT)).toBe(redis.port);

      // `port` is the MAPPED port, not the 6379 the server listens on inside the container.
      expect(redis.port).not.toBe(REDIS_CONTAINER_PORT);

      // `url` is the full connection URL built from host and mapped port.
      expect(new URL(redis.url).protocol).toBe('redis:');
      expect(new URL(redis.url).port).toBe(String(redis.port));

      stopResult = await redis.stop();
    } finally {
      if (stopResult === NOT_STOPPED) {
        await redis.stop();
      }
    }

    // `stop(): Promise<void>` — resolves with nothing, and the container is gone afterwards.
    expect(stopResult).toBeUndefined();
    expect(await isReachable(redis.host, redis.port, 'PING\r\n')).toBe(false);
  }, CONTAINER_TEST_TIMEOUT_MS);
});

// ============================================================================
// makeMockLoggerLayer
// ============================================================================

describe('docs/testing.md — makeMockLoggerLayer', () => {
  /**
   * "Creates an Effect `Layer` that provides a silent mock logger. Use with
   * `Effect.provide(loggerLayer)`." A program that requires `Logger` must therefore become
   * runnable by that layer alone — if the layer stopped providing `LoggerService`, `runSync`
   * would die with a missing-service defect. `child()` returning the same instance is what
   * distinguishes the mock from a real logger, which mints a new child.
   *
   * @source docs:testing.md#makemockloggerlayer
   */
  it('satisfies the Logger requirement on its own, with the mock logger inside', () => {
    const loggerLayer = makeMockLoggerLayer();

    const program = Effect.flatMap(LoggerService, logger => logger.info('through the layer', { a: 1 }));

    expect(Effect.runSync(Effect.provide(program, loggerLayer))).toBeUndefined();

    const provided = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
    expect(provided.child({ context: 'x' })).toBe(provided);
    // Not a silence check: what this pins is that every method RESOLVES WITH `undefined` — it
    // goes red when createMockLogger's noOp becomes e.g. `Effect.succeed('logged')`.
    expect(Effect.runSync(provided.error('resolves with undefined'))).toBeUndefined();
  });
});

// ============================================================================
// createMockSyncLogger
// ============================================================================

describe('docs/testing.md — createMockSyncLogger', () => {
  /**
   * "All methods are no-ops, `child()` returns itself." The second half is not cosmetic:
   * `BaseService.initializeService()` stores `logger.child({ className })`, so a mock whose
   * `child()` returned a new object would leave `this.logger` pointing at something the test
   * never holds. Both halves are asserted, the identity one through the framework path the
   * helper exists for.
   *
   * @source docs:testing.md#createmocksynclogger
   */
  it('is a no-op SyncLogger whose child() is itself, all the way into a service', () => {
    const logger = createMockSyncLogger();

    expect(logger.info('this does nothing')).toBeUndefined();
    expect(logger.child({ context: 'test' })).toBe(logger);
    expect([
      logger.trace('t'),
      logger.debug('d'),
      logger.warn('w'),
      logger.error('e'),
      logger.fatal('f'),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);

    const service = new LoggerProbeService();
    service.initializeService(logger, createMockConfig({}));

    // `this.logger` inside the service is the very object handed in, because child() === self.
    expect(service.currentLogger()).toBe(logger);

    // "All methods are no-ops" is a claim about OUTPUT, which a return value cannot show, and a
    // silent logger cannot report on its own silence. So the console — where the framework's real
    // SyncLogger ends up — is watched across the service call, and the same call is then replayed
    // through a recorder to prove it is the mock swallowing it, not the call never happening.
    const written: string[] = [];
    const consoleSpies = CONSOLE_METHODS.map(method => spyOn(console, method)
      .mockImplementation((...args: unknown[]) => {
        written.push(`${method}: ${args.join(' ')}`);
      }));

    try {
      service.emit();
    } finally {
      // `mockRestore()` also clears the recorded calls, hence the array of our own.
      consoleSpies.forEach(spy => spy.mockRestore());
    }

    expect(written).toEqual([]);

    const recorded: string[] = [];
    const recordingProbe = new LoggerProbeService();
    recordingProbe.initializeService(makeRecordingSyncLogger(recorded), createMockConfig({}));
    recorded.length = 0; // Drop the framework's own "Service ... initialized" line.
    recordingProbe.emit();

    // The same call through a logger that records: it arrives on the child `initializeService`
    // stamps with the class name, which is the wiring `child() === self` has to survive.
    expect(recorded).toEqual(['info LoggerProbeService: inside the service']);

    // A grandchild is still the same object, so nested `child()` calls cannot leak either.
    expect(logger.child({ context: 'a' }).child({ context: 'b' })).toBe(logger);
  });

  /**
   * The mock is what makes `createTestService` usable at all; the logger that helper injects
   * differs only in that its methods are `bun:test` mocks. Pinning that both satisfy the same
   * `SyncLogger` surface keeps the two from drifting apart.
   *
   * @source docs:testing.md#createmocksynclogger
   */
  it('carries the same SyncLogger surface as the logger createTestService injects', () => {
    const { instance, logger } = createTestService(LoggerProbeService);

    expect(instance.currentLogger()).toBe(logger);
    expect(Object.keys(createMockSyncLogger()).sort()).toEqual(Object.keys(logger).sort());
  });
});

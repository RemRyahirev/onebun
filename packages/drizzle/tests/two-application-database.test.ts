/**
 * Two applications in one process, two databases, one unnamed registration.
 *
 * `registration.ts` keeps ONE unnamed registration per base module and overwrites it without a
 * check — eleven lines above the named branch, which throws for exactly this. Measured in
 * multi-service mode: two services, both plain `forRoot()`, one pointing at `db_a.sqlite` and
 * one at `db_b.sqlite`. Both `DrizzleService` instances opened `db_b.sqlite`; `db_a.sqlite` was
 * never created.
 *
 * Per-application options are not what ships, for the reason the globality half records: an
 * unnamed `forRoot()` returns the base module itself, so both applications hold the same class
 * reference and the producing call cannot be recovered. What ships is the refusal — before
 * anything is opened — and the named registration as the way to actually have two.
 */

import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  BaseService,
  Module,
  OneBunApplication,
  resetRegistrations,
  Service,
} from '@onebun/core';

import {
  DatabaseType,
  DrizzleModule,
  DrizzleService,
} from '../src';

const PRIMARY = Symbol('PRIMARY_DB');
const ANALYTICS = Symbol('ANALYTICS_DB');

@Service()
class Reader extends BaseService {
  constructor(public db: DrizzleService) {
    super();
  }
}

@Module({ providers: [Reader], exports: [Reader] })
class ReaderModule {}

describe('two applications configuring one DrizzleModule', () => {
  let scratch: string;

  const conn = (url: string) => ({ type: DatabaseType.SQLITE as const, options: { url } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetOf = (service: DrizzleService): string | undefined => (service as any).connectionOptions?.options?.url;

  const boot = (moduleClass: Function): OneBunApplication => new OneBunApplication(
    moduleClass as new () => object,
    {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    },
  );

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'onebun-two-app-db-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  /**
   * @source docs:api/drizzle.md#forfeature-method
   */
  test('should refuse to boot rather than give both applications one database', async () => {
    const dbA = join(scratch, 'db_a.sqlite');
    const dbB = join(scratch, 'db_b.sqlite');

    @Module({ imports: [DrizzleModule.forRoot({ connection: conn(dbA) }), ReaderModule] })
    class ServiceA {}

    @Module({ imports: [DrizzleModule.forRoot({ connection: conn(dbB) }), ReaderModule] })
    class ServiceB {}

    const first = boot(ServiceA);
    try {
      // Before: this booted and opened db_b.sqlite — the file the OTHER application named.
      await expect(first.start()).rejects.toThrow(/a different configuration/);
    } finally {
      await first.stop();
    }

    const second = boot(ServiceB);
    try {
      await expect(second.start()).rejects.toThrow(/DrizzleModule\.forRoot\(\)/);
    } finally {
      await second.stop();
    }

    // Refused BEFORE anything was opened: neither file exists. A check that fired after the
    // connection would still leave one application talking to the wrong database.
    expect(existsSync(dbA)).toBe(false);
    expect(existsSync(dbB)).toBe(false);
  });

  test('should name both call sites and the database each one asked for', async () => {
    const dbA = join(scratch, 'named_a.sqlite');
    const dbB = join(scratch, 'named_b.sqlite');

    @Module({ imports: [DrizzleModule.forRoot({ connection: conn(dbA) }), ReaderModule] })
    class ServiceA {}

    @Module({ imports: [DrizzleModule.forRoot({ connection: conn(dbB) }), ReaderModule] })
    class ServiceB {}

    const app = boot(ServiceA);
    let message = '';
    try {
      await app.start();
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await app.stop();
    }

    expect(message).toContain(dbA);
    expect(message).toContain(dbB);
    const sites = message.match(/two-application-database\.test\.ts:\d+:\d+/g) ?? [];
    expect(sites.length).toBe(2);
    expect(sites[0]).not.toBe(sites[1]);

    expect(ServiceB).toBeDefined();
  });

  test('should stay silent when both applications configure the same database', async () => {
    const shared = join(scratch, 'shared.sqlite');

    @Module({ imports: [DrizzleModule.forRoot({ connection: conn(shared) }), ReaderModule] })
    class ServiceA {}

    @Module({ imports: [DrizzleModule.forRoot({ connection: conn(shared) }), ReaderModule] })
    class ServiceB {}

    const first = boot(ServiceA);
    const second = boot(ServiceB);
    try {
      await first.start();
      await second.start();

      expect(targetOf(first.getService(Reader).db)).toBe(shared);
      expect(targetOf(second.getService(Reader).db)).toBe(shared);
    } finally {
      await first.stop();
      await second.stop();
    }
  });

  test('should let two applications reach their own database through named registrations', async () => {
    const dbA = join(scratch, 'primary.sqlite');
    const dbB = join(scratch, 'analytics.sqlite');

    @Service()
    class PrimaryReader extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    @Service()
    class AnalyticsReader extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    @Module({
      imports: [DrizzleModule.forFeature(PRIMARY)],
      providers: [PrimaryReader],
      exports: [PrimaryReader],
    })
    class PrimaryModule {}

    @Module({
      imports: [DrizzleModule.forFeature(ANALYTICS)],
      providers: [AnalyticsReader],
      exports: [AnalyticsReader],
    })
    class AnalyticsModule {}

    @Module({
      imports: [DrizzleModule.forRoot({ connection: conn(dbA), as: PRIMARY }), PrimaryModule],
    })
    class ServiceA {}

    @Module({
      imports: [DrizzleModule.forRoot({ connection: conn(dbB), as: ANALYTICS }), AnalyticsModule],
    })
    class ServiceB {}

    const first = boot(ServiceA);
    const second = boot(ServiceB);
    try {
      await first.start();
      await second.start();

      // The remedy the error advertises, verified rather than assumed — and asserted on the
      // resolved target, because two instances sharing one target is the defect itself.
      expect(targetOf(first.getService(PrimaryReader).db)).toBe(dbA);
      expect(targetOf(second.getService(AnalyticsReader).db)).toBe(dbB);
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});

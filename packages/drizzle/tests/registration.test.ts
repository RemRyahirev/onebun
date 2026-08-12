/**
 * Named registrations — the supported way to configure a dynamic module more than once.
 *
 * The defect they replace: `forRoot()` stored options on the module CLASS, which the whole
 * process shares, so two calls with two databases produced two `DrizzleService` instances
 * both connected to whichever was evaluated LAST — silently, with nothing in the logs. The
 * documentation presented that arrangement as the way to run a main and an analytics
 * database.
 */

import { mkdtempSync, rmSync } from 'node:fs';
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
  BaseController,
  BaseService,
  Controller,
  Get,
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

const MAIN = Symbol('MAIN_DB');
const ANALYTICS = 'analytics-db';

describe('named registrations', () => {
  let scratch: string;

  const conn = (url: string) => ({ type: DatabaseType.SQLITE as const, options: { url } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetOf = (service: DrizzleService): string | undefined => (service as any).connectionOptions?.options?.url;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'onebun-registrations-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    // forRoot() runs at module-evaluation time, so the registry is process-wide and each
    // case must start from a clean one.
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  test('two registrations reach two DIFFERENT databases, with no @Inject anywhere', async () => {
    const mainDb = join(scratch, 'main.db');
    const analyticsDb = join(scratch, 'analytics.db');

    @Service()
    class MainRepo extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    @Service()
    class ReportRepo extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    // Each feature selects its registration at its own module boundary...
    @Module({ imports: [DrizzleModule.forFeature(MAIN)], providers: [MainRepo], exports: [MainRepo] })
    class MainModule {}

    @Module({ imports: [DrizzleModule.forFeature(ANALYTICS)], providers: [ReportRepo], exports: [ReportRepo] })
    class AnalyticsModule {}

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(mainDb), autoMigrate: false, as: MAIN }),
        DrizzleModule.forRoot({ connection: conn(analyticsDb), autoMigrate: false, as: ANALYTICS }),
        MainModule,
        AnalyticsModule,
      ],
      controllers: [HealthController],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const root = (app as any).rootModule;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const find = (cls: Function): any => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const search = (module: any): any => module.getServiceByClass(cls)
           
          ?? (module.childModules ?? []).map(search).find(Boolean);

        return search(root);
      };

      // Asserted on the resolved connection TARGET, not on instance identity: two instances
      // pointing at one database is exactly the defect, and `instA !== instB` passes for it.
      expect(targetOf(find(MainRepo).db)).toBe(mainDb);
      expect(targetOf(find(ReportRepo).db)).toBe(analyticsDb);
    } finally {
      await app.stop();
    }
  });

  test('a symbol and a string both work as tokens', () => {
    const first = DrizzleModule.forRoot({ connection: conn(':memory:'), autoMigrate: false, as: MAIN });
    const second = DrizzleModule.forRoot({ connection: conn(':memory:'), autoMigrate: false, as: ANALYTICS });

    expect(first).not.toBe(second);
    expect(DrizzleModule.forFeature(MAIN)).toBe(first);
    expect(DrizzleModule.forFeature(ANALYTICS)).toBe(second);
  });

  test('registering one token twice throws instead of replacing the first', () => {
    DrizzleModule.forRoot({ connection: conn(':memory:'), autoMigrate: false, as: MAIN });

    expect(() => DrizzleModule.forRoot({ connection: conn(':memory:'), autoMigrate: false, as: MAIN }))
      .toThrow(/already registered/);
  });

  test('selecting a token nobody configured fails at boot, naming the missing call', async () => {
    @Service()
    class Orphan extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    // forFeature() creates the registration on first mention — the feature module is
    // evaluated before the root that would configure it — so the check lands at boot.
    @Module({ imports: [DrizzleModule.forFeature('never-configured')], providers: [Orphan] })
    class OrphanModule {}

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({ imports: [OrphanModule], controllers: [HealthController] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    let error: Error | undefined;
    try {
      await app.start();
    } catch (thrown) {
      error = thrown as Error;
    } finally {
      await app.stop();
    }

    expect(error?.message).toMatch(/never configured/);
    expect(error?.message).toContain('never-configured');
  });

  test('a module selecting TWO registrations is refused, naming both', async () => {
    @Service()
    class Greedy extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    @Module({
      imports: [DrizzleModule.forFeature(MAIN), DrizzleModule.forFeature(ANALYTICS)],
      providers: [Greedy],
    })
    class GreedyModule {}

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(join(scratch, 'a.db')), autoMigrate: false, as: MAIN }),
        DrizzleModule.forRoot({ connection: conn(join(scratch, 'b.db')), autoMigrate: false, as: ANALYTICS }),
        GreedyModule,
      ],
      controllers: [HealthController],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    let error: Error | undefined;
    try {
      await app.start();
    } catch (thrown) {
      error = thrown as Error;
    } finally {
      await app.stop();
    }

    // Without this the module silently gets whichever registration was listed last — the
    // wrong-database failure the whole feature exists to prevent. "Could not resolve" would
    // be misleading for a service that is present twice, so the error names both.
    expect(error?.name).toBe('OneBunAmbiguousRegistrationError');
    expect(error?.message).toContain('DrizzleModule_MAIN_DB');
    expect(error?.message).toContain('DrizzleModule_analytics_db');
  });

  test('the single-registration case is unchanged — no token anywhere', async () => {
    const onlyDb = join(scratch, 'only.db');

    @Service()
    class Repo extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    // A leaf that imports NOTHING still resolves it, because an unnamed registration keeps
    // the base module's @Global() identity exactly as before registrations existed.
    @Module({ providers: [Repo], exports: [Repo] })
    class Leaf {}

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(onlyDb), autoMigrate: false }),
        Leaf,
      ],
      controllers: [HealthController],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      expect(targetOf(app.getService(DrizzleService))).toBe(onlyDb);
      expect(targetOf(app.getService(Repo).db)).toBe(onlyDb);
    } finally {
      await app.stop();
    }
  });
});

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
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Inject,
  Global as GlobalDecorator,
  isGlobalModule,
  Module,
  OneBunApplication,
  removeFromGlobalModules,
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

  test('@Inject(TOKEN) resolves per registration in a module that holds BOTH', async () => {
    const mainDb = join(scratch, 'inject-main.db');
    const analyticsDb = join(scratch, 'inject-analytics.db');

    @Service()
    class Counter extends BaseService {
      readonly id = 'counter';
    }

    @Service()
    class Reconciler extends BaseService {
      constructor(
        @Inject(MAIN) public main: DrizzleService,
        @Inject(ANALYTICS) public analytics: DrizzleService,
        public counter: Counter,
      ) {
        super();
      }
    }

    @Controller('/reconcile')
    class ReconcileController extends BaseController {
      constructor(
        @Inject(ANALYTICS) private analytics: DrizzleService,
        private counter: Counter,
      ) {
        super();
      }

      @Get('/')
      report() {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target: (this.analytics as any).connectionOptions?.options?.url as string,
          counter: this.counter.id,
        };
      }
    }

    // The ONE module that legitimately needs both. Everything else selects one registration
    // at its boundary and writes a plain constructor.
    @Module({
      imports: [
        DrizzleModule.forFeature(MAIN),
        DrizzleModule.forFeature(ANALYTICS),
      ],
      providers: [Counter, Reconciler],
      controllers: [ReconcileController],
      exports: [Reconciler],
    })
    class ReconcileModule {}

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(mainDb), autoMigrate: false, as: MAIN }),
        DrizzleModule.forRoot({ connection: conn(analyticsDb), autoMigrate: false, as: ANALYTICS }),
        ReconcileModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const reconciler = app.getService(Reconciler);
      expect(targetOf(reconciler.main)).toBe(mainDb);
      expect(targetOf(reconciler.analytics)).toBe(analyticsDb);
      // The un-annotated parameter still resolves normally — the token map is a SIDE map, so
      // design:paramtypes is untouched and partial injection keeps working.
      expect(reconciler.counter.id).toBe('counter');

      // Through a real request: @Controller replaces the class with a subclass, so the token
      // map has to be carried onto the wrapper or the controller silently gets the other one.
      const response = await fetch(`http://127.0.0.1:${app.getPort()}/reconcile`);
      const body = await response.json() as { result: { target: string; counter: string } };
      expect(body.result.target).toBe(analyticsDb);
      expect(body.result.counter).toBe('counter');
    } finally {
      await app.stop();
    }
  });

  test('@Inject(TOKEN) for a registration the module never selected fails, naming what it did select', async () => {
    const mainDb = join(scratch, 'unselected-main.db');
    const analyticsDb = join(scratch, 'unselected-analytics.db');

    @Service()
    class Forgetful extends BaseService {
      constructor(@Inject(ANALYTICS) public analytics: DrizzleService) {
        super();
      }
    }

    // Imports MAIN, asks for ANALYTICS. Falling back to the tag slot would hand it the main
    // database — the silent wrong-database failure this mechanism exists to prevent.
    @Module({ imports: [DrizzleModule.forFeature(MAIN)], providers: [Forgetful] })
    class ForgetfulModule {}

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(mainDb), autoMigrate: false, as: MAIN }),
        DrizzleModule.forRoot({ connection: conn(analyticsDb), autoMigrate: false, as: ANALYTICS }),
        ForgetfulModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await expect(app.start()).rejects.toThrow(
        /did not select the registration 'analytics-db'.*It selected: DrizzleModule_MAIN_DB.*forFeature\('analytics-db'\)/s,
      );
    } finally {
      await app.stop();
    }
  });

  test('app.getService(Class, TOKEN) reaches a registration a FEATURE module selected', async () => {
    const mainDb = join(scratch, 'lookup-main.db');
    const analyticsDb = join(scratch, 'lookup-analytics.db');

    @Module({ imports: [DrizzleModule.forFeature(ANALYTICS)] })
    class ReportsModule {}

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(mainDb), autoMigrate: false, as: MAIN }),
        DrizzleModule.forRoot({ connection: conn(analyticsDb), autoMigrate: false, as: ANALYTICS }),
        ReportsModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      // The tag-keyed slot holds one instance per module and cannot answer for a second
      // registration; the token walks the tree to the module that selected it.
      expect(targetOf(app.getService(DrizzleService, ANALYTICS))).toBe(analyticsDb);
      expect(targetOf(app.getService(DrizzleService, MAIN))).toBe(mainDb);
      expect(() => app.getService(DrizzleService, 'never-registered')).toThrow(/not found for registration/);
    } finally {
      await app.stop();
    }
  });

  test('a named registration cannot also be global', () => {
    // Ambient visibility has one slot per service class, so two global registrations would
    // collapse back into one instance — the defect, with extra steps.
    expect(() => DrizzleModule.forRoot({
      connection: conn(':memory:'),
      autoMigrate: false,
      as: MAIN,
      isGlobal: true,
    })).toThrow(/never global/);
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

/**
 * `isGlobal` alongside `as` — the mirror of the CacheModule case.
 *
 * `{ as, isGlobal: false }` used to run `removeFromGlobalModules(DrizzleModule)` against the
 * process-wide registry, so naming a second database switched off ambient resolution for the
 * FIRST one, in every application in the process. The boot then failed inside an unrelated
 * module that injected `DrizzleService` and imported nothing.
 */
describe('isGlobal alongside a registration token', () => {
  let scratch: string;
  let wasGlobal: boolean;

  const conn = (url: string) => ({ type: DatabaseType.SQLITE as const, options: { url } });

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'onebun-as-isglobal-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetRegistrations();
    wasGlobal = isGlobalModule(DrizzleModule);
  });

  afterEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
    // Leave the process-wide registry as this file found it.
    if (wasGlobal) {
      GlobalDecorator()(DrizzleModule);
    } else {
      removeFromGlobalModules(DrizzleModule);
    }
  });

  test('a named registration does not change the base module globality', () => {
    DrizzleModule.forRoot({ connection: conn(join(scratch, 'base.sqlite')) });
    const before = isGlobalModule(DrizzleModule);

    DrizzleModule.forRoot({ connection: conn(join(scratch, 'named.sqlite')), as: ANALYTICS, isGlobal: false });

    expect(isGlobalModule(DrizzleModule)).toBe(before);
  });

  test('an unrelated module still resolves the service ambiently', async () => {
    @Service()
    class ReportService extends BaseService {
      constructor(public db: DrizzleService) {
        super();
      }
    }

    @Module({ providers: [ReportService], exports: [ReportService] })
    class ReportModule {}

    @Module({
      imports: [
        DrizzleModule.forRoot({ connection: conn(join(scratch, 'main.sqlite')) }),
        DrizzleModule.forRoot({ connection: conn(join(scratch, 'analytics.sqlite')), as: ANALYTICS, isGlobal: false }),
        ReportModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      // Pre-fix: "Could not resolve dependency DrizzleService for service ReportService".
      await app.start();

      expect(app.getService(ReportService).db).toBeInstanceOf(DrizzleService);
    } finally {
      await app.stop();
    }
  });

  test('still throws for the combination that asks for the impossible', () => {
    expect(() => DrizzleModule.forRoot({
      connection: conn(join(scratch, 'never.sqlite')),
      as: MAIN,
      isGlobal: true,
    })).toThrow(/never global/);
  });
});

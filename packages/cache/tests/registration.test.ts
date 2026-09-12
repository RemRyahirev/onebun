/**
 * Named registrations for CacheModule.
 *
 * Same defect as DrizzleModule's: `forRoot()` stored options on the module CLASS, so two
 * calls produced two `CacheService` instances both reading whichever configuration was
 * evaluated LAST. Two caches sized for different jobs silently shared one size.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  BaseService,
  Global as GlobalDecorator,
  isGlobalModule,
  Module,
  OneBunApplication,
  removeFromGlobalModules,
  resetRegistrations,
  Service,
} from '@onebun/core';

import {
  CacheModule,
  CacheService,
  CacheType,
} from '../src';

const SESSIONS = Symbol('SESSIONS_CACHE');
const FRAGMENTS = 'fragments-cache';

describe('named cache registrations', () => {
  // Asserted through BEHAVIOUR — how many entries the cache keeps — rather than by reading a
  // private field: two services reading one configuration is the defect, and it is the
  // configuration, not the instance count, that has to differ.
  const capacityOf = async (service: CacheService): Promise<number> => {
    await service.waitForInit();
    await service.set('a', 1);
    await service.set('b', 2);
    const kept = [await service.get('a'), await service.get('b')].filter((v) => v !== undefined);

    return kept.length;
  };

  afterEach(() => {
    resetRegistrations();
    CacheModule.clearOptions();
  });

  test('two registrations give two caches with their OWN options', async () => {
    @Service()
    class SessionStore extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Service()
    class FragmentStore extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Module({
      imports: [CacheModule.forFeature(SESSIONS)],
      providers: [SessionStore],
      exports: [SessionStore],
    })
    class SessionsModule {}

    @Module({
      imports: [CacheModule.forFeature(FRAGMENTS)],
      providers: [FragmentStore],
      exports: [FragmentStore],
    })
    class FragmentsModule {}

    @Module({
      imports: [
        CacheModule.forRoot({
          type: CacheType.MEMORY,
          cacheOptions: { maxSize: 1 },
          as: SESSIONS,
        }),
        CacheModule.forRoot({
          type: CacheType.MEMORY,
          cacheOptions: { maxSize: 10 },
          as: FRAGMENTS,
        }),
        SessionsModule,
        FragmentsModule,
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

      const sessions = app.getService(SessionStore).cache;
      const fragments = app.getService(FragmentStore).cache;

      // Asserted on the CONFIGURATION each service resolved, not on instance identity: two
      // instances reading one configuration is exactly the defect, and an identity assertion
      // passes for it.
      expect(await capacityOf(sessions)).toBe(1);
      expect(await capacityOf(fragments)).toBe(2);
    } finally {
      await app.stop();
    }
  });

  test('registering one cache token twice throws instead of replacing the first', () => {
    CacheModule.forRoot({ type: CacheType.MEMORY, as: SESSIONS });

    expect(() => CacheModule.forRoot({ type: CacheType.MEMORY, as: SESSIONS }))
      .toThrow(/already registered/);
  });

  test('a named cache registration cannot also be global', () => {
    expect(() => CacheModule.forRoot({ type: CacheType.MEMORY, as: SESSIONS, isGlobal: true }))
      .toThrow(/never global/);
  });

  test('the single-registration case is unchanged — no token anywhere', async () => {
    @Service()
    class Store extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    // A leaf that imports nothing still resolves it: an unnamed registration keeps the base
    // module's @Global() identity exactly as before registrations existed.
    @Module({ providers: [Store], exports: [Store] })
    class Leaf {}

    @Module({
      imports: [
        CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 1 } }),
        Leaf,
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

      expect(await capacityOf(app.getService(Store).cache)).toBe(1);
    } finally {
      await app.stop();
    }
  });
});

/**
 * `isGlobal` alongside `as`.
 *
 * A named registration is never global — its minted class is deliberately not `@Global()` — so
 * `{ as, isGlobal: true }` asks for the impossible and throws. `{ as, isGlobal: false }` asks for
 * what already holds, and used to be granted by running `removeFromGlobalModules(CacheModule)`
 * against the process-wide registry: it answered for the UNNAMED registration, in every
 * application in the process. Measured, `isGlobalModule(CacheModule)` went true -> false across a
 * named call, and a module that injected `CacheService` ambiently — importing nothing, having
 * nothing to do with the token — failed to boot.
 */
describe('isGlobal alongside a registration token', () => {
  let wasGlobal: boolean;

  beforeEach(() => {
    resetRegistrations();
    wasGlobal = isGlobalModule(CacheModule);
  });

  afterEach(() => {
    resetRegistrations();
    CacheModule.clearOptions();
    // Leave the process-wide registry as this file found it: these cases read and write it.
    if (wasGlobal) {
      GlobalDecorator()(CacheModule);
    } else {
      removeFromGlobalModules(CacheModule);
    }
  });

  test('a named registration does not change the base module globality', () => {
    CacheModule.forRoot({ type: CacheType.MEMORY });
    const before = isGlobalModule(CacheModule);

    CacheModule.forRoot({ type: CacheType.MEMORY, as: FRAGMENTS, isGlobal: false });

    // Asserted against what it WAS, not against `true` — the registry is process-wide and this
    // test says nothing about what some other file left in it.
    expect(isGlobalModule(CacheModule)).toBe(before);
  });

  test('an unrelated module still resolves the service ambiently', async () => {
    @Service()
    class ReportService extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    // Imports nothing. It has no relationship to the token at all — which is what made the
    // pre-fix failure so misleading: the error named THIS module.
    @Module({ providers: [ReportService], exports: [ReportService] })
    class ReportModule {}

    @Module({
      imports: [
        CacheModule.forRoot({ type: CacheType.MEMORY }),
        CacheModule.forRoot({ type: CacheType.MEMORY, as: FRAGMENTS, isGlobal: false }),
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
      // Pre-fix: DependencyResolutionError, "Could not resolve dependency CacheService for
      // service ReportService".
      await app.start();

      expect(app.getService(ReportService).cache).toBeInstanceOf(CacheService);
    } finally {
      await app.stop();
    }
  });

  test('a named registration alone still does not make the service ambient', async () => {
    removeFromGlobalModules(CacheModule);

    @Service()
    class LonelyService extends BaseService {
      constructor(public cache: CacheService) {
        super();
      }
    }

    @Module({ providers: [LonelyService], exports: [LonelyService] })
    class LonelyModule {}

    @Module({
      imports: [
        CacheModule.forRoot({ type: CacheType.MEMORY, as: SESSIONS, isGlobal: false }),
        LonelyModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      // The counter-direction: deleting the registry write must not make a NAMED registration
      // ambient. With no unnamed forRoot() anywhere, nothing reaches a module that imports nothing.
      await expect(app.start()).rejects.toThrow(/Could not resolve dependency CacheService/);
    } finally {
      await app.stop();
    }
  });

  test('still throws for the combination that asks for the impossible', () => {
    expect(() => CacheModule.forRoot({ type: CacheType.MEMORY, as: SESSIONS, isGlobal: true }))
      .toThrow(/never global/);
  });
});

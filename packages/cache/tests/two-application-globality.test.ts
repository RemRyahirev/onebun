/**
 * Two applications in one process, one `CacheModule`.
 *
 * `globalModules` is a `Set` on `globalThis` keyed by the module CLASS, with no application
 * dimension, and an unnamed `forRoot()` returns that very class — so the `forRoot` EVALUATION
 * order decided globality for the whole process. Measured, both directions:
 *
 *   isGlobal:false then default -> both saw global. The application that explicitly opted out
 *     booted anyway, and a leaf that never imported CacheModule got CacheService injected.
 *   default then isGlobal:false -> both saw non-global and BOTH failed at start() with
 *     "Could not resolve dependency", including the application that declared nothing.
 *
 * Boot order was irrelevant in both directions; only the order of the `forRoot()` calls mattered.
 *
 * Per-application globality is not what ships, because it cannot be built: both applications
 * hold the same class reference, so nothing downstream can tell the two calls apart. What ships
 * is the refusal — located, naming both calls, and pointing at the token that does work.
 */

import {
  afterEach,
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
  CacheModule,
  CacheService,
  CacheType,
} from '../src';

const SESSIONS = Symbol('SESSIONS_CACHE');
const FRAGMENTS = Symbol('FRAGMENTS_CACHE');

/** A leaf that does NOT import CacheModule: it resolves CacheService only if ambience reaches it. */
@Service()
class LeafStore extends BaseService {
  constructor(public cache: CacheService) {
    super();
  }
}

@Module({ providers: [LeafStore], exports: [LeafStore] })
class LeafModule {}

function boot(moduleClass: Function): OneBunApplication {
  return new OneBunApplication(moduleClass as new () => object, {
    port: 0,
    host: '127.0.0.1',
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
  });
}

describe('two applications disagreeing about one CacheModule', () => {
  afterEach(() => {
    resetRegistrations();
    CacheModule.clearOptions();
  });

  /**
   * @source docs:api/decorators.md#global
   */
  test('should refuse the boot when the opt-out was evaluated first', async () => {
    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY, isGlobal: false }), LeafModule],
    })
    class OptedOutApp {}

    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY }), LeafModule],
    })
    class DefaultApp {}

    const optedOut = boot(OptedOutApp);
    try {
      // Before: this booted, and LeafStore — which never imported CacheModule — was handed a
      // CacheService anyway. The application's own declaration was silently ignored.
      await expect(optedOut.start()).rejects.toThrow(/different ambient visibility/);
    } finally {
      await optedOut.stop();
    }

    const withDefault = boot(DefaultApp);
    try {
      await expect(withDefault.start()).rejects.toThrow(/CacheModule\.forRoot\(\)/);
    } finally {
      await withDefault.stop();
    }
  });

  test('should refuse the boot when the opt-out was evaluated second', async () => {
    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY }), LeafModule],
    })
    class DefaultApp {}

    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY, isGlobal: false }), LeafModule],
    })
    class OptedOutApp {}

    // Before: BOTH failed with "Could not resolve dependency", including DefaultApp, which
    // declared nothing about globality. The error blamed the victim's own module.
    const withDefault = boot(DefaultApp);
    try {
      await expect(withDefault.start()).rejects.toThrow(/different ambient visibility/);
    } finally {
      await withDefault.stop();
    }

    const optedOut = boot(OptedOutApp);
    try {
      await expect(optedOut.start()).rejects.toThrow(/different ambient visibility/);
    } finally {
      await optedOut.stop();
    }
  });

  test('should refuse two default registrations that configure different caches', async () => {
    @Module({
      imports: [
        CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 1 } }),
        LeafModule,
      ],
    })
    class SmallCacheApp {}

    @Module({
      imports: [
        CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 100 } }),
        LeafModule,
      ],
    })
    class BigCacheApp {}

    // Both agree the module is ambient; they disagree about what it IS. Before, the second call
    // replaced the first and both applications' caches were sized by whichever ran last.
    const app = boot(SmallCacheApp);
    try {
      await expect(app.start()).rejects.toThrow(/a different configuration/);
    } finally {
      await app.stop();
    }

    expect(BigCacheApp).toBeDefined();
  });

  test('should boot both applications when the two registrations agree', async () => {
    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY }), LeafModule],
    })
    class FirstApp {}

    @Module({
      imports: [CacheModule.forRoot({ type: CacheType.MEMORY }), LeafModule],
    })
    class SecondApp {}

    const first = boot(FirstApp);
    const second = boot(SecondApp);
    try {
      await first.start();
      await second.start();

      // Agreement is the common case — a library re-exporting a configured module, a test
      // re-registering one — and it must stay silent, ambient injection included.
      expect(first.getService(LeafStore).cache).toBeInstanceOf(CacheService);
      expect(second.getService(LeafStore).cache).toBeInstanceOf(CacheService);
    } finally {
      await first.stop();
      await second.stop();
    }
  });

  /**
   * @source docs:api/core.md#global-modules
   */
  test('should stay silent about a conflict over a module the application never imports', async () => {
    @Module({ imports: [CacheModule.forRoot({ type: CacheType.MEMORY, isGlobal: false })] })
    class OptedOutApp {}

    @Module({ imports: [CacheModule.forRoot({ type: CacheType.MEMORY })] })
    class DefaultApp {}

    @Module({})
    class UnrelatedApp {}

    const unrelated = boot(UnrelatedApp);
    try {
      // The gate: someone else's disagreement is not this application's failure.
      await unrelated.start();
      expect(unrelated.getHttpUrl()).toContain('127.0.0.1');
    } finally {
      await unrelated.stop();
    }

    expect(OptedOutApp).toBeDefined();
    expect(DefaultApp).toBeDefined();
  });

  test('should let two applications keep their own cache through named registrations', async () => {
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
        CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 1 }, as: SESSIONS }),
        SessionsModule,
      ],
    })
    class SessionsApp {}

    @Module({
      imports: [
        CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { maxSize: 10 }, as: FRAGMENTS }),
        FragmentsModule,
      ],
    })
    class FragmentsApp {}

    const capacityOf = async (service: CacheService): Promise<number> => {
      await service.waitForInit();
      await service.set('a', 1);
      await service.set('b', 2);

      return [await service.get('a'), await service.get('b')].filter((value) => value !== undefined).length;
    };

    const sessions = boot(SessionsApp);
    const fragments = boot(FragmentsApp);
    try {
      await sessions.start();
      await fragments.start();

      // The remedy the error message advertises, verified rather than assumed: each application
      // reaches its OWN configuration. Asserted on capacity, because two instances sharing one
      // configuration is the defect and an identity assertion passes for it.
      expect(await capacityOf(sessions.getService(SessionStore).cache)).toBe(1);
      expect(await capacityOf(fragments.getService(FragmentStore).cache)).toBe(2);
    } finally {
      await sessions.stop();
      await fragments.stop();
    }
  });
});

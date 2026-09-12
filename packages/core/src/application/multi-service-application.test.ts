import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { BeforeApplicationDestroy, OnModuleDestroy } from '../module/lifecycle';

import { TypedEnv } from '@onebun/envs';

import {
  Controller,
  Get,
  Global,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { QueueService } from '../queue';
import { Subscribe } from '../queue/decorators';

import { OneBunApplication } from './application';

const HTTP_OK = 200;

// Test modules
@Module({
  controllers: [],
  providers: [],
})
class TestModuleA {}

@Module({
  controllers: [],
  providers: [],
})
class TestModuleB {}

@Module({
  controllers: [],
  providers: [],
})
class TestModuleC {}

describe('OneBunApplication multi-service mode', () => {
  beforeEach(() => {
    TypedEnv.clear();
    // Clean up ENV filters
    delete process.env.ONEBUN_SERVICES;
    delete process.env.ONEBUN_EXCLUDE_SERVICES;
  });

  describe('constructor', () => {
    test('should create instance with services config', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
      });

      expect(app).toBeDefined();
      expect(app.getRunningServices()).toHaveLength(0); // Not started yet
    });

    test('should detect multi-service mode from object argument', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      // Multi-service methods should work
      expect(app.getRunningServices()).toEqual([]);

      // Single-service methods should throw
      expect(() => app.getPort()).toThrow('only available in single-service mode');
    });

    test('should detect single-service mode from class argument', () => {
      const app = new OneBunApplication(TestModuleA);

      // Single-service methods should not throw type errors
      expect(() => app.getPort()).not.toThrow();

      // Multi-service methods should throw
      expect(() => app.getRunningServices()).toThrow('only available in multi-service mode');
    });
  });

  describe('getServiceUrl', () => {
    test('should throw when service not running and no external URL', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(() => app.getServiceUrl('serviceA')).toThrow(
        'Service "serviceA" not available',
      );
    });

    test('should return external URL when configured', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
        externalServiceUrls: {
          serviceA: 'http://external-service:3001',
        },
      });

      expect(app.getServiceUrl('serviceA')).toBe('http://external-service:3001');
    });
  });

  describe('getApplication', () => {
    test('should return undefined when service not running', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.getApplication('serviceA')).toBeUndefined();
    });
  });

  describe('isServiceRunning', () => {
    test('should return false when service not started', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.isServiceRunning('serviceA')).toBe(false);
    });
  });

  describe('getRunningServices', () => {
    test('should return empty array before start', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.getRunningServices()).toEqual([]);
    });
  });

  describe('getLogger', () => {
    test('should return logger instance in multi-service mode', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      const logger = app.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    test('should return logger instance in single-service mode', () => {
      const app = new OneBunApplication(TestModuleA);

      const logger = app.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });
  });

  describe('mode guards', () => {
    test('should throw when calling single-service methods in multi-service mode', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(() => app.getConfig()).toThrow('only available in single-service mode');
      expect(() => app.getPort()).toThrow('only available in single-service mode');
      expect(() => app.getHttpUrl()).toThrow('only available in single-service mode');
      expect(() => app.getServer()).toThrow('only available in single-service mode');
      expect(() => app.getService(TestModuleA)).toThrow('only available in single-service mode');
      expect(() => app.getQueueService()).toThrow('only available in single-service mode');
      expect(() => app.getOpenApiSpec()).toThrow('only available in single-service mode');
    });

    test('should throw when calling multi-service methods in single-service mode', () => {
      const app = new OneBunApplication(TestModuleA);

      expect(() => app.getRunningServices()).toThrow('only available in multi-service mode');
      expect(() => app.getServiceUrl('any')).toThrow('only available in multi-service mode');
      expect(() => app.getApplication('any')).toThrow('only available in multi-service mode');
      expect(() => app.isServiceRunning('any')).toThrow('only available in multi-service mode');
    });
  });

  describe('options merging', () => {
    test('should merge app-level and service-level options', () => {
      // Test that options are properly structured
      const app = new OneBunApplication({
        services: {
          serviceA: {
            module: TestModuleA,
            port: 3001,
            host: 'localhost',
            envOverrides: {
              DB_NAME: { value: 'service_a_db' },
            },
          },
        },
        host: '0.0.0.0',
        envOverrides: {
          COMMON_VAR: { value: 'common_value' },
        },
      });

      expect(app).toBeDefined();
    });

    test('should support multiple services with different configs', () => {
      const app = new OneBunApplication({
        services: {
          users: {
            module: TestModuleA,
            port: 3001,
            envOverrides: {
              DB_NAME: { fromEnv: 'USERS_DB_NAME' },
            },
          },
          orders: {
            module: TestModuleB,
            port: 3002,
            envOverrides: {
              DB_NAME: { value: 'orders_db' },
            },
          },
          payments: {
            module: TestModuleC,
            port: 3003,
          },
        },
      });

      expect(app).toBeDefined();
    });
  });

  describe('queue option', () => {
    @Controller('/queue-health')
    class QueueHealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Controller('/queue-consumer')
    class QueueConsumerController extends BaseController {
      @Subscribe('multi.service.event')
      async handle(): Promise<void> {
        // no-op consumer; its presence is what auto-enables the queue
      }
    }

    @Module({ controllers: [QueueHealthController] })
    class ProducerServiceModule {}

    @Module({ controllers: [QueueHealthController] })
    class PlainServiceModule {}

    @Module({ controllers: [QueueConsumerController] })
    class ConsumerServiceModule {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: OneBunApplication<any, any>;

    afterEach(async () => {
      await app?.stop();
      TypedEnv.clear();
    });

    function twoServices(): {
      svcA: { module: typeof ProducerServiceModule; port: number };
      svcB: { module: typeof PlainServiceModule; port: number };
    } {
      return {
        svcA: { module: ProducerServiceModule, port: 0 },
        svcB: { module: PlainServiceModule, port: 0 },
      };
    }

    // `getQueueService()` explains why there is no queue rather than answering null, so the
    // "this child has none" assertions read that answer through the throw.
    function queueServiceOf(name: string): unknown {
      try {
        return app.getApplication(name as never)!.getQueueService();
      } catch {
        return null;
      }
    }

    test('should accept queue option and pass it to child applications', async () => {
      // Row (e): an explicit enabled:true reaches every child, including ones with no
      // queue decorator. Asserted on observable state, not on the option being accepted.
      app = new OneBunApplication({
        services: twoServices(),
        queue: { enabled: true, adapter: 'memory' },
      });

      await app.start();

      expect(queueServiceOf('svcA')).not.toBeNull();
      expect(queueServiceOf('svcB')).not.toBeNull();
    });

    test('an adapter configured without `enabled` enables the queue in every child', async () => {
      // Row (a) — the bug this item fixes.
      app = new OneBunApplication({
        services: twoServices(),
        queue: { adapter: 'memory' },
      });

      await app.start();

      expect(queueServiceOf('svcA')).not.toBeNull();
      expect(queueServiceOf('svcB')).not.toBeNull();
    });

    test('queue.enabled: false with no backend keeps every child disabled but still started', async () => {
      // Row (b): disabled, and no contradiction — the warning count is pinned in
      // multi-service-orchestrator.test.ts, which can substitute a capturing logger.
      app = new OneBunApplication({
        services: twoServices(),
        queue: { enabled: false },
      });

      await app.start();

      expect(queueServiceOf('svcA')).toBeNull();
      expect(queueServiceOf('svcB')).toBeNull();
      expect(app.getRunningServices()).toHaveLength(2);
    });

    test('queue.enabled: false with a configured adapter keeps every child disabled but still started', async () => {
      // Row (c): the override wins over the backend config, and startAll() does not throw.
      app = new OneBunApplication({
        services: twoServices(),
        queue: { enabled: false, adapter: 'memory' },
      });

      await app.start();

      expect(queueServiceOf('svcA')).toBeNull();
      expect(queueServiceOf('svcB')).toBeNull();
      expect(app.getRunningServices()).toHaveLength(2);
    });

    test('a child carrying a queue decorator still auto-enables when no queue option is set', async () => {
      // Row (d): the orchestrator must forward `undefined` untouched. Materialising an
      // explicit `enabled: false` here would silently kill decorator auto-detection.
      app = new OneBunApplication({
        services: {
          svcA: { module: ConsumerServiceModule, port: 0 },
          svcB: { module: PlainServiceModule, port: 0 },
        },
      });

      await app.start();

      expect(queueServiceOf('svcA')).not.toBeNull();
      expect(queueServiceOf('svcB')).toBeNull();
    });

    test('no queue option and no queue decorator leaves every child disabled', async () => {
      // Row (f): the unchanged baseline.
      app = new OneBunApplication({ services: twoServices() });

      await app.start();

      expect(queueServiceOf('svcA')).toBeNull();
      expect(queueServiceOf('svcB')).toBeNull();
    });
  });

  describe('filtering configuration', () => {
    test('should accept enabledServices option', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
        enabledServices: ['serviceA'],
      });

      expect(app).toBeDefined();
    });

    test('should accept excludedServices option', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
        excludedServices: ['serviceB'],
      });

      expect(app).toBeDefined();
    });
  });

  describe('integration: start/stop with filtering', () => {
    // Minimal controller for integration tests
    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({ controllers: [HealthController] })
    class IntegrationModuleA {}

    @Module({ controllers: [HealthController] })
    class IntegrationModuleB {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: OneBunApplication<any, any>;

    afterEach(async () => {
      await app?.stop();
      TypedEnv.clear();
      delete process.env.ONEBUN_SERVICES;
      delete process.env.ONEBUN_EXCLUDE_SERVICES;
    });

    test('should start all services by default', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcA', 'svcB']);
      expect(app.isServiceRunning('svcA')).toBe(true);
      expect(app.isServiceRunning('svcB')).toBe(true);
    });

    test('should filter services via enabledServices option', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
        enabledServices: ['svcA'],
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcA']);
      expect(app.isServiceRunning('svcA')).toBe(true);
      expect(app.isServiceRunning('svcB')).toBe(false);
    });

    test('should filter services via excludedServices option', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
        excludedServices: ['svcB'],
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcA']);
      expect(app.isServiceRunning('svcB')).toBe(false);
    });

    test('should filter services via ONEBUN_SERVICES env', async () => {
      process.env.ONEBUN_SERVICES = 'svcB';

      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcB']);
      expect(app.isServiceRunning('svcA')).toBe(false);
    });

    test('should exclude services via ONEBUN_EXCLUDE_SERVICES env', async () => {
      process.env.ONEBUN_EXCLUDE_SERVICES = 'svcA';

      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcB']);
    });

    test('should provide service URLs via getServiceUrl after start', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
        },
      });

      await app.start();

      const url = app.getServiceUrl('svcA');
      expect(url).toMatch(/^http:\/\//);
    });

    test('should provide child app via getApplication after start', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
        },
      });

      await app.start();

      const child = app.getApplication('svcA');
      expect(child).toBeDefined();
      expect(child!.getPort()).toBeGreaterThan(0);
    });

    test('should stop all services cleanly', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();
      expect(app.getRunningServices()).toHaveLength(2);

      await app.stop();
      expect(app.getRunningServices()).toEqual([]);
    });
  });

  describe('per-sub-application GlobalScope', () => {
    let constructed = 0;

    @Service()
    class ScopedGlobalService extends BaseService {
      readonly id: number;

      constructor() {
        super();
        constructed++;
        this.id = constructed;
      }
    }

    @Global()
    @Module({ providers: [ScopedGlobalService], exports: [ScopedGlobalService] })
    class ScopedGlobalModule {}

    /** Resolves QueueService through the ordinary DI path, by tag. */
    @Service()
    class QueueProbeService extends BaseService {
      constructor(readonly queue: QueueService) {
        super();
      }
    }

    @Controller('/scoped')
    class ScopedController extends BaseController {
      constructor(private svc: ScopedGlobalService) {
        super();
      }

      @Get('/')
      id() {
        return { id: this.svc.id };
      }
    }

    @Module({
      imports: [ScopedGlobalModule],
      controllers: [ScopedController],
      providers: [QueueProbeService],
    })
    class ScopedModuleOne {}

    @Module({
      imports: [ScopedGlobalModule],
      controllers: [ScopedController],
      providers: [QueueProbeService],
    })
    class ScopedModuleTwo {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: OneBunApplication<any, any> | undefined;

    const startPair = async (): Promise<void> => {
      app = new OneBunApplication({
        services: {
          one: { module: ScopedModuleOne, port: 0 },
          two: { module: ScopedModuleTwo, port: 0 },
        },
        metrics: { enabled: false },
      });
      await app.start();
    };

    beforeEach(() => {
      constructed = 0;
    });

    afterEach(async () => {
      await app?.stop();
      app = undefined;
      TypedEnv.clear();
    });

    test('each sub-application holds its OWN @Global() instance', async () => {
      await startPair();

      const first = app!.getApplication('one')!.getService(ScopedGlobalService);
      const second = app!.getApplication('two')!.getService(ScopedGlobalService);

      // One global service instance per SUB-APPLICATION, not per process.
      expect(first).not.toBe(second);
      expect(constructed).toBe(2);
    });

    test('stopping one sub-application leaves the other fully functional', async () => {
      await startPair();

      const two = app!.getApplication('two')!;
      // Disposing sub-app one's scope must not empty a scope its sibling is still using.
      await app!.getApplication('one')!.stop();

      const response = await fetch(`${two.getHttpUrl()}/scoped`);
      expect(response.status).toBe(HTTP_OK);
      expect(two.getService(ScopedGlobalService)).toBeDefined();
    });

    test('each sub-application resolves QueueService to the proxy its own start() wrote', async () => {
      await startPair();

      // Sub-apps start concurrently; with a process-wide registry the proxy each one wrote
      // could be captured by a sibling still in PHASE 0 of its own module tree.
      const probeOne = app!.getApplication('one')!.getService(QueueProbeService);
      const probeTwo = app!.getApplication('two')!.getService(QueueProbeService);

      expect(probeOne.queue).toBeDefined();
      expect(probeTwo.queue).toBeDefined();
      expect(probeOne.queue).not.toBe(probeTwo.queue);
    });
  });

  /**
   * One process, one signal handler. Every child used to register its own, each ending in
   * `process.exit(0)`, so the first service to finish stopping killed the process while
   * its siblings were still inside `beforeApplicationDestroy`.
   */
  describe('signal-driven shutdown', () => {
    const HOOK_DELAY_MS = 80;
    const events: string[] = [];

    @Service()
    class AlphaLifecycleService extends BaseService
      implements BeforeApplicationDestroy, OnModuleDestroy {
      async beforeApplicationDestroy(): Promise<void> {
        events.push('alpha:before:enter');
        await Bun.sleep(HOOK_DELAY_MS);
        events.push('alpha:before:exit');
      }

      onModuleDestroy(): void {
        events.push('alpha:moduleDestroy');
      }
    }

    @Service()
    class BravoLifecycleService extends BaseService
      implements BeforeApplicationDestroy, OnModuleDestroy {
      async beforeApplicationDestroy(): Promise<void> {
        events.push('bravo:before:enter');
        await Bun.sleep(HOOK_DELAY_MS);
        events.push('bravo:before:exit');
      }

      onModuleDestroy(): void {
        events.push('bravo:moduleDestroy');
      }
    }

    @Module({ providers: [AlphaLifecycleService] })
    class AlphaModule {}

    @Module({ providers: [BravoLifecycleService] })
    class BravoModule {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: OneBunApplication<any, any> | undefined;

    beforeEach(() => {
      events.length = 0;
    });

    afterEach(async () => {
      await app?.stop();
      app = undefined;
      TypedEnv.clear();
    });

    test('one SIGTERM stops every service completely before the process exits', async () => {
      const signalHandlers: Record<string, (() => void)[]> = { SIGTERM: [], SIGINT: [] };
      const originalProcessOn = process.on.bind(process);
      const originalExit = process.exit.bind(process);
      const exitCodes: number[] = [];

      process.on = ((event: string, handler: () => void) => {
        if (event === 'SIGTERM' || event === 'SIGINT') {
          signalHandlers[event].push(handler);

          return process;
        }

        return originalProcessOn(event as 'exit', handler as () => void);
      }) as typeof process.on;
      process.exit = ((code?: number) => {
        exitCodes.push(code ?? 0);
      }) as typeof process.exit;

      try {
        app = new OneBunApplication({
          services: {
            alpha: { module: AlphaModule, port: 0 },
            bravo: { module: BravoModule, port: 0 },
          },
          metrics: { enabled: false },
        });
        await app.start();

        // The FIRST handler registered is the one that used to win the race and exit the
        // process; driving it must now stop the whole process' worth of services.
        signalHandlers.SIGTERM[0]();

        const startedAt = Date.now();
        while (exitCodes.length === 0 && Date.now() - startedAt < 5000) {
          await Bun.sleep(5);
        }
      } finally {
        process.on = originalProcessOn;
        process.exit = originalExit;
      }

      // bravo used to be cut mid-teardown: its beforeApplicationDestroy never returned
      // and its onModuleDestroy never ran at all.
      expect(events).toContain('alpha:before:exit');
      expect(events).toContain('bravo:before:exit');
      expect(events).toContain('alpha:moduleDestroy');
      expect(events).toContain('bravo:moduleDestroy');

      // Exactly one handler for the whole process — the parent's.
      expect(signalHandlers.SIGTERM).toHaveLength(1);
      expect(signalHandlers.SIGINT).toHaveLength(1);

      // stopAll() ran to completion before the exit, and exited exactly once.
      expect(app!.getRunningServices()).toEqual([]);
      expect(exitCodes).toEqual([0]);
    });

    test('gracefulShutdown: false installs no handler at all', async () => {
      const signalHandlers: string[] = [];
      const originalProcessOn = process.on.bind(process);

      process.on = ((event: string, handler: () => void) => {
        if (event === 'SIGTERM' || event === 'SIGINT') {
          signalHandlers.push(event);

          return process;
        }

        return originalProcessOn(event as 'exit', handler as () => void);
      }) as typeof process.on;

      try {
        app = new OneBunApplication({
          services: {
            alpha: { module: AlphaModule, port: 0 },
            bravo: { module: BravoModule, port: 0 },
          },
          metrics: { enabled: false },
          gracefulShutdown: false,
        });
        await app.start();
      } finally {
        process.on = originalProcessOn;
      }

      expect(signalHandlers).toEqual([]);
    });
  });
});

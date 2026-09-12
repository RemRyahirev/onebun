/**
 * Multi-Service Orchestrator Tests
 *
 * Covers the parts of the queue enable decision that are invisible through
 * `OneBunApplication`'s public multi-service API. In multi-service mode the application
 * builds its own logger and hands it to the orchestrator, ignoring any caller
 * `loggerLayer`, so the contradiction warning can only be observed by constructing the
 * orchestrator directly with a substituted `SyncLogger`.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { BeforeApplicationDestroy } from '../module/lifecycle';
import type { QueueAdapter, Subscription } from '../queue/types';

import { TypedEnv } from '@onebun/envs';
import type { SyncLogger } from '@onebun/logger';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { createMockSyncLogger } from '../testing/test-utils';

import { MultiServiceOrchestrator } from './multi-service-orchestrator';
import { QUEUE_DISABLED_WITH_ADAPTER_WARNING } from './queue-enablement';

@Controller('/orchestrated')
class OrchestratedController extends BaseController {
  @Get('/')
  health() {
    return { ok: true };
  }
}

@Module({ controllers: [OrchestratedController] })
class ServiceModuleA {}

@Module({ controllers: [OrchestratedController] })
class ServiceModuleB {}

/** Adapter that counts constructions, so "never built" is assertable. */
/* eslint-disable @typescript-eslint/no-empty-function */
class SpyQueueAdapter implements QueueAdapter {
  static constructCount = 0;

  readonly name = 'spy';
  readonly type = 'jetstream';
  private connected = false;

  constructor(_options?: unknown) {
    SpyQueueAdapter.constructCount++;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(): Promise<string> {
    return 'spy-id';
  }

  async publishBatch(): Promise<string[]> {
    return [];
  }

  async subscribe(): Promise<Subscription> {
    return {
      async unsubscribe() {},
      pause() {},
      resume() {},
      pattern: '',
      isActive: true,
    };
  }

  supports(): boolean {
    return false;
  }
  on(): void {}
  off(): void {}
}
/* eslint-enable @typescript-eslint/no-empty-function */

describe('MultiServiceOrchestrator queue enablement', () => {
  let warnings: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orchestrator: MultiServiceOrchestrator<any> | null;

  function makeCapturingLogger(): SyncLogger {
    const logger: SyncLogger = {
      ...createMockSyncLogger(),
      warn(message: string) {
        warnings.push(message);
      },
      child: () => logger,
    };

    return logger;
  }

  function contradictionWarnings(): string[] {
    return warnings.filter(message => message === QUEUE_DISABLED_WITH_ADAPTER_WARNING);
  }

  beforeEach(() => {
    warnings = [];
    orchestrator = null;
    SpyQueueAdapter.constructCount = 0;
    TypedEnv.clear();
    delete process.env.ONEBUN_SERVICES;
    delete process.env.ONEBUN_EXCLUDE_SERVICES;
  });

  afterEach(async () => {
    await orchestrator?.stopAll();
    TypedEnv.clear();
  });

  test('warns exactly once for two services when enabled: false contradicts a configured adapter', async () => {
    orchestrator = new MultiServiceOrchestrator(
      {
        services: {
          svcA: { module: ServiceModuleA, port: 0 },
          svcB: { module: ServiceModuleB, port: 0 },
        },
        queue: { enabled: false, adapter: SpyQueueAdapter, options: { servers: 'stub://none' } },
      },
      makeCapturingLogger(),
    );

    await orchestrator.startAll();

    // Once for the whole process, not once per service — the orchestrator resolves the
    // decision before the loop and strips the backend keys before handing them to children.
    expect(contradictionWarnings()).toHaveLength(1);
    expect(SpyQueueAdapter.constructCount).toBe(0);
    const svcA = orchestrator.getApplication('svcA')!;
    const svcB = orchestrator.getApplication('svcB')!;

    expect(() => svcA.getQueueService()).toThrow();
    expect(() => svcB.getQueueService()).toThrow();
  });

  test('does not warn when enabled: false carries no backend config', async () => {
    orchestrator = new MultiServiceOrchestrator(
      {
        services: {
          svcA: { module: ServiceModuleA, port: 0 },
          svcB: { module: ServiceModuleB, port: 0 },
        },
        queue: { enabled: false },
      },
      makeCapturingLogger(),
    );

    await orchestrator.startAll();

    expect(contradictionWarnings()).toHaveLength(0);

    const svcA = orchestrator.getApplication('svcA')!;

    expect(() => svcA.getQueueService()).toThrow();
  });

  test('does not warn when a configured adapter is actually used', async () => {
    orchestrator = new MultiServiceOrchestrator(
      {
        services: { svcA: { module: ServiceModuleA, port: 0 } },
        queue: { adapter: 'memory' },
      },
      makeCapturingLogger(),
    );

    await orchestrator.startAll();

    expect(contradictionWarnings()).toHaveLength(0);
    expect(orchestrator.getApplication('svcA')!.getQueueService()).not.toBeNull();
  });

  test('warns once even when service filtering skips every service', async () => {
    // The decision is resolved before shouldStartService(), so the contradiction is
    // reported regardless of how many services actually start.
    orchestrator = new MultiServiceOrchestrator(
      {
        services: {
          svcA: { module: ServiceModuleA, port: 0 },
          svcB: { module: ServiceModuleB, port: 0 },
        },
        excludedServices: ['svcA', 'svcB'],
        queue: { enabled: false, adapter: SpyQueueAdapter, options: { servers: 'stub://none' } },
      },
      makeCapturingLogger(),
    );

    await orchestrator.startAll();

    expect(contradictionWarnings()).toHaveLength(1);
    expect(SpyQueueAdapter.constructCount).toBe(0);
  });
});

/**
 * Shutdown ordering and signal-handler ownership. Both are only visible from the
 * orchestrator: the application builds the parent logger itself, so the per-service
 * `Service "x" stopped` lines cannot be captured through the public multi-service API.
 */
describe('MultiServiceOrchestrator shutdown', () => {
  const HOOK_DELAY_MS = 150;
  const SEQUENTIAL_FLOOR_MS = HOOK_DELAY_MS * 2;

  let logLines: { level: string; message: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orchestrator: MultiServiceOrchestrator<any> | null;

  @Service()
  class SlowTeardownService extends BaseService implements BeforeApplicationDestroy {
    async beforeApplicationDestroy(): Promise<void> {
      await Bun.sleep(HOOK_DELAY_MS);
    }
  }

  @Module({ providers: [SlowTeardownService] })
  class SlowModuleA {}

  @Module({ providers: [SlowTeardownService] })
  class SlowModuleB {}

  function makeRecordingLogger(): SyncLogger {
    const record = (level: string) => (message: string) => {
      logLines.push({ level, message });
    };
    const logger: SyncLogger = {
      ...createMockSyncLogger(),
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      fatal: record('fatal'),
      child: () => logger,
    };

    return logger;
  }

  beforeEach(() => {
    logLines = [];
    orchestrator = null;
    TypedEnv.clear();
  });

  afterEach(async () => {
    await orchestrator?.stopAll();
    TypedEnv.clear();
  });

  test('stops services concurrently, not one after another', async () => {
    orchestrator = new MultiServiceOrchestrator(
      {
        services: {
          svcA: { module: SlowModuleA, port: 0 },
          svcB: { module: SlowModuleB, port: 0 },
        },
        metrics: { enabled: false },
      },
      makeRecordingLogger(),
    );

    await orchestrator.startAll();

    const startedAt = Date.now();
    await orchestrator.stopAll();
    const elapsed = Date.now() - startedAt;

    // Sequential teardown costs the sum of the hooks; concurrent costs the slowest one.
    expect(elapsed).toBeLessThan(SEQUENTIAL_FLOOR_MS);

    // Preserved diagnostics, not a regression test: these lines were already emitted on
    // the explicit-stop path. What is new is that a SIGTERM now reaches this code at all.
    const messages = logLines.map(line => line.message);
    expect(messages).toContain('Service "svcA" stopped');
    expect(messages).toContain('Service "svcB" stopped');
    expect(messages).toContain('Multi-service application stopped');
    expect(messages.indexOf('Multi-service application stopped'))
      .toBeGreaterThan(messages.indexOf('Service "svcB" stopped'));

    orchestrator = null;
  });

  test('children never register their own signal handlers', async () => {
    const registered: string[] = [];
    const originalProcessOn = process.on.bind(process);

    process.on = ((event: string, handler: () => void) => {
      if (event === 'SIGTERM' || event === 'SIGINT') {
        registered.push(event);

        return process;
      }

      return originalProcessOn(event as 'exit', handler as () => void);
    }) as typeof process.on;

    try {
      orchestrator = new MultiServiceOrchestrator(
        {
          services: {
            svcA: { module: SlowModuleA, port: 0 },
            svcB: { module: SlowModuleB, port: 0 },
          },
          metrics: { enabled: false },
        },
        makeRecordingLogger(),
      );

      await orchestrator.startAll();
    } finally {
      process.on = originalProcessOn;
    }

    // Every child used to install a SIGTERM/SIGINT pair ending in process.exit(0).
    expect(registered).toEqual([]);
  });
});

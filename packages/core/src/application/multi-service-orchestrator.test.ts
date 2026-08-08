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

import type { QueueAdapter, Subscription } from '../queue/types';

import { TypedEnv } from '@onebun/envs';
import type { SyncLogger } from '@onebun/logger';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
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
    expect(orchestrator.getApplication('svcA')!.getQueueService()).toBeNull();
    expect(orchestrator.getApplication('svcB')!.getQueueService()).toBeNull();
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
    expect(orchestrator.getApplication('svcA')!.getQueueService()).toBeNull();
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

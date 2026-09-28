/**
 * A start() that rejects undoes what it started.
 *
 * It used to log the error and rethrow with no teardown, so the queue connection, the system-metrics
 * sampler and everything else acquired before the failure stayed open. A caller that caught the
 * rejection without calling stop() — a test, a supervisor, a retry loop — never exited.
 *
 * What a real process does is pinned by `failed-start-exit.test.ts`, which runs one; these cases pin
 * the sequence itself: what was released, the error that comes out, what gets logged, and what a
 * later stop() or start() does — a retry on the same instance boots as it did before the rollback
 * existed, without the failed attempt's connection and sampler still running beside it.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Effect, Runtime } from 'effect';

import type { OnModuleDestroy } from '../module/lifecycle';
import type {
  Message,
  QueueAdapter,
  Subscription,
} from '../queue/types';

import { makeLoggerFromOptions, shutdownLogger } from '@onebun/logger';
import { createMetricsService, Registry } from '@onebun/metrics';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { Subscribe } from '../queue/decorators';
import { makeRecordingLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

/** What every adapter below was asked to do, across all instances. */
const adapterCalls = {
  constructed: 0,
  connected: 0,
  disconnected: 0,
};

/** Destroy hooks that ran, in order. */
const destroyed: string[] = [];

/** The exact object the failing subscribe throws, so identity can be asserted, not just the text. */
let subscribeError = new Error('unset');

/** Set by a test that wants the rollback's own disconnect to fail as well. */
let disconnectError: Error | null = null;

/** How many more subscriptions the adapter refuses; a retry test lets the second boot through. */
let refusalsLeft = Number.POSITIVE_INFINITY;

/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * Connects, then refuses the first subscription — the shape of a JetStream adapter asked to consume a
 * pattern no declared stream binds. Everything before the refusal really was acquired.
 */
class RefusingSubscribeAdapter implements QueueAdapter {
  readonly name = 'refusing';
  readonly type = 'jetstream';
  private connected = false;

  constructor(_options?: unknown) {
    adapterCalls.constructed++;
  }

  async connect(): Promise<void> {
    adapterCalls.connected++;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    adapterCalls.disconnected++;
    this.connected = false;
    if (disconnectError) {
      throw disconnectError;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(): Promise<string> {
    return 'id';
  }

  async publishBatch(): Promise<string[]> {
    return [];
  }

  async subscribe(pattern: string): Promise<Subscription> {
    if (refusalsLeft > 0) {
      refusalsLeft--;
      throw subscribeError;
    }

    return {
      pattern,
      isActive: true,
      async unsubscribe(): Promise<void> {},
      pause(): void {},
      resume(): void {},
    };
  }

  supports(): boolean {
    return false;
  }

  on(): void {}

  off(): void {}
}
/* eslint-enable @typescript-eslint/no-empty-function */

@Service()
class WorkerStateService extends BaseService implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    destroyed.push('WorkerStateService');
  }
}

@Controller('/worker')
class WorkerController extends BaseController {
  constructor(private readonly state: WorkerStateService) {
    super();
  }

  @Subscribe('unbound.subject', { group: 'workers' })
  async handle(_message: Message<unknown>): Promise<void> {
    await Promise.resolve(this.state);
  }
}

@Module({ controllers: [WorkerController], providers: [WorkerStateService] })
class WorkerModule {}

/** The application's metrics service, as the constructor (or a retry) built it. */
function metricsServiceOf(app: OneBunApplication): Record<string, unknown> | null {
  return (app as unknown as { metricsService: Record<string, unknown> | null }).metricsService;
}

/** The application's trace service, as the constructor (or a retry) built it. */
function traceServiceOf(app: OneBunApplication): unknown {
  return (app as unknown as { traceService: unknown }).traceService;
}

/** The sampler handle `startSystemMetricsCollection()` keeps; `undefined` once it is cleared. */
function metricsSampler(app: OneBunApplication): unknown {
  return metricsServiceOf(app)?.systemMetricsInterval;
}

/** Default options — metrics on, so the sampler starts — except what a unit test cannot share. */
function createWorkerApp(loggerLayer = makeRecordingLoggerLayer().layer): OneBunApplication {
  return new OneBunApplication(WorkerModule, {
    port: 0,
    gracefulShutdown: false,
    loggerLayer,
    queue: { adapter: RefusingSubscribeAdapter },
  });
}

async function startRejection(app: OneBunApplication): Promise<unknown> {
  return await app.start().then(
    () => {
      throw new Error('start() resolved; the case needs it to reject');
    },
    (error: unknown) => error,
  );
}

describe('a start() that rejects rolls back what it started (FB-30)', () => {
  beforeEach(() => {
    adapterCalls.constructed = 0;
    adapterCalls.connected = 0;
    adapterCalls.disconnected = 0;
    destroyed.length = 0;
    subscribeError = new Error('No declared stream binds "unbound.subject"');
    disconnectError = null;
    refusalsLeft = Number.POSITIVE_INFINITY;
  });

  test('releases the queue connection, the metrics sampler and the destroy hooks, then rethrows the original error', async () => {
    const recording = makeRecordingLoggerLayer();
    const app = createWorkerApp(recording.layer);

    const error = await startRejection(app);

    // Thrown outside Effect (the adapter's subscribe), so what start() caught is the object itself.
    expect(error).toBe(subscribeError);
    expect(adapterCalls.connected).toBe(1);
    expect(adapterCalls.disconnected).toBe(1);
    expect(metricsSampler(app)).toBeUndefined();
    expect(destroyed).toEqual(['WorkerStateService']);

    // The cause is logged before the teardown, so it heads the output instead of following it.
    const messages = recording.messages();
    const failedAt = messages.indexOf('Failed to start application:');
    const rollbackAt = messages.findIndex((message) => message.startsWith('Rolling back the failed start'));
    expect(failedAt).toBeGreaterThanOrEqual(0);
    expect(rollbackAt).toBeGreaterThan(failedAt);
    expect(messages).toContain('Failed start rolled back');
    // A rollback that did its job reports nothing as failed.
    expect(recording.messages('error').filter((message) => message.includes('failed step'))).toEqual([]);
  });

  test('stop() after a rejected start() resolves without throwing and re-runs nothing', async () => {
    const app = createWorkerApp();
    await startRejection(app);

    await app.stop();
    await app.stop();

    expect(adapterCalls.disconnected).toBe(1);
    expect(destroyed).toEqual(['WorkerStateService']);
  });

  test('a rollback step that fails is logged, never substituted: start() still rejects with the original error', async () => {
    disconnectError = new Error('disconnect exploded during rollback');
    const recording = makeRecordingLoggerLayer();
    const app = createWorkerApp(recording.layer);

    const error = await startRejection(app);

    expect(error).toBe(subscribeError);
    expect((error as Error).message).toBe('No declared stream binds "unbound.subject"');

    const stepFailure = recording.records.find(
      (record) => record.level === 'error' && record.message.includes('"disconnecting the queue adapter" failed'),
    );
    expect(stepFailure?.args[0]).toBe(disconnectError);
    expect(recording.messages('error')).toContain(
      'Rollback of the failed start completed with 1 failed step(s): disconnecting the queue adapter',
    );
    // The steps after the failed one still ran.
    expect(destroyed).toEqual(['WorkerStateService']);
    expect(metricsSampler(app)).toBeUndefined();
  });

  test('a retry on the same instance boots, and the failed attempt left nothing running beside it', async () => {
    refusalsLeft = 1;
    const app = createWorkerApp();

    expect(await startRejection(app)).toBe(subscribeError);
    const failedMetrics = metricsServiceOf(app);
    const failedTrace = traceServiceOf(app);

    await app.start();

    try {
      // One live connection: the failed attempt's was closed by its rollback, not left beside
      // the retry's.
      expect(adapterCalls.connected).toBe(2);
      expect(adapterCalls.disconnected).toBe(1);

      // One sampler: the failed attempt's was cleared, and the retry runs its own on a rebuilt
      // registry — the rollback disposed the first one.
      const retryMetrics = metricsServiceOf(app);
      expect(retryMetrics).not.toBe(failedMetrics);
      expect(failedMetrics?.systemMetricsInterval).toBeUndefined();
      expect(metricsSampler(app)).toBeDefined();
      expect((globalThis as Record<string, unknown>).__onebunMetricsService).toBe(retryMetrics);
      const scrape = await fetch(`http://127.0.0.1:${app.getPort()}/metrics`);
      expect(scrape.status).toBe(200);
      expect(await scrape.text()).toContain('memory_usage_bytes');

      // The rollback shut the trace provider down; the retry records through a new one.
      expect(traceServiceOf(app)).not.toBe(failedTrace);
      expect((globalThis as Record<string, unknown>).__onebunTraceService).toBe(traceServiceOf(app));
    } finally {
      await app.stop();
    }

    expect(adapterCalls.disconnected).toBe(2);
    expect(metricsSampler(app)).toBeUndefined();
    expect(destroyed).toEqual(['WorkerStateService', 'WorkerStateService']);
  });

  test('stop() after a failed start does nothing, and a stop() after a later start really stops it', async () => {
    refusalsLeft = 1;
    const app = createWorkerApp();
    await startRejection(app);

    // A no-op: it awaits the rollback, which already ran the sequence
    await app.stop();
    expect(adapterCalls.disconnected).toBe(1);
    expect(destroyed).toEqual(['WorkerStateService']);

    await app.start();
    const port = app.getPort();
    expect(port).toBeGreaterThan(0);

    // Not swallowed by the earlier rollback: the retry's listener, connection, sampler and
    // destroy hooks are all released.
    await app.stop();

    expect(adapterCalls.disconnected).toBe(2);
    expect(metricsSampler(app)).toBeUndefined();
    expect(destroyed).toEqual(['WorkerStateService', 'WorkerStateService']);
    const afterStop = await fetch(`http://127.0.0.1:${port}/metrics`).then(
      () => 'listening',
      () => 'closed',
    );
    expect(afterStop).toBe('closed');
  });

  test('a retry rebuilds the OTLP log transport the rollback closed, so its logs are still exported', async () => {
    let initCalls = 0;

    @Service()
    class FlakyBackendService extends BaseService {
      async onModuleInit(): Promise<void> {
        initCalls++;
        if (initCalls === 1) {
          throw new Error('backend down');
        }
        this.logger.warn('backend reached on the retry');
      }
    }

    @Module({ providers: [FlakyBackendService] })
    class FlakyModule {}

    const exported: string[] = [];
    const collector = Bun.serve({
      port: 0,
      async fetch(request: Request): Promise<Response> {
        exported.push(await request.text());

        return new Response('{}');
      },
    });

    try {
      const app = new OneBunApplication(FlakyModule, {
        port: 0,
        gracefulShutdown: false,
        metrics: { enabled: false },
        loggerOptions: { minLevel: 'warn', otlpEndpoint: `http://127.0.0.1:${collector.port}` },
      });

      await startRejection(app);
      // The rollback's log flush carried the cause out before it closed the transport.
      expect(exported.join('\n')).toContain('Failed to start application:');

      await app.start();
      await app.stop();

      // Logged by a service of the retry, flushed by its stop(): through a transport built again,
      // not the closed one, which drops every record.
      expect(exported.join('\n')).toContain('backend reached on the retry');
    } finally {
      await collector.stop(true);
    }
  });

  /**
   * What the caller passed in is the caller's, and the usual caller builds it once and hands it to
   * every attempt. The rollback used to end with the process-wide logger shutdown and a provider
   * shutdown that reaches every span processor, so the attempt that finally booted exported no log
   * line and no span.
   */
  describe('telemetry passed in stays open for the next attempt', () => {
    const LONG_BATCH_TIMEOUT = 600_000;

    async function exerciseSharedTelemetry(
      retry: 'a new instance' | 'the same instance',
    ): Promise<{ exported: string; spans: string[] }> {
      let initCalls = 0;

      @Service()
      class FlakyBackendService extends BaseService {
        async onModuleInit(): Promise<void> {
          initCalls++;
          if (initCalls === 1) {
            throw new Error('backend down');
          }
          this.logger.warn('backend reached on the retry');
        }
      }

      @Controller('/ping')
      class PingController extends BaseController {
        @Get('/')
        ping(): string {
          return 'pong';
        }
      }

      @Module({ controllers: [PingController], providers: [FlakyBackendService] })
      class FlakyModule {}

      const exported: string[] = [];
      const collector = Bun.serve({
        port: 0,
        async fetch(request: Request): Promise<Response> {
          exported.push(await request.text());

          return new Response('{}');
        },
      });

      // Like an OpenTelemetry processor: once shut down, it records nothing
      const spans: string[] = [];
      let processorShutDown = false;
      const spanProcessor = {
        onStart(): void {
          // Nothing to do on start
        },
        onEnd(span: { name: string }): void {
          if (!processorShutDown) {
            spans.push(span.name);
          }
        },
        async forceFlush(): Promise<void> {
          // Nothing buffered
        },
        async shutdown(): Promise<void> {
          processorShutDown = true;
          spans.push('<shut down>');
        },
      };

      // Built once and handed to every attempt
      const options = {
        port: 0,
        gracefulShutdown: false,
        metrics: { enabled: false },
        loggerLayer: makeLoggerFromOptions({
          minLevel: 'warn',
          otlpEndpoint: `http://127.0.0.1:${collector.port}`,
          otlpBatchTimeout: LONG_BATCH_TIMEOUT,
        }),
        tracing: { spanProcessors: [spanProcessor] },
      };

      try {
        const failed = new OneBunApplication(FlakyModule, options);
        await startRejection(failed);
        // Left open by the rollback: nothing of the shared transport was flushed or closed yet
        expect(exported).toEqual([]);
        expect(spans).toEqual([]);

        const app = retry === 'a new instance' ? new OneBunApplication(FlakyModule, options) : failed;
        await app.start();
        expect((await fetch(`http://127.0.0.1:${app.getPort()}/ping`)).status).toBe(200);
        // The stop() of the attempt that booted is what closes them, as stop() always has
        await app.stop();

        return { exported: exported.join('\n'), spans };
      } finally {
        await collector.stop(true);
      }
    }

    for (const retry of ['a new instance', 'the same instance'] as const) {
      test(`a loggerLayer and spanProcessors shared with ${retry} still export the retry's logs and spans`, async () => {
        const { exported, spans } = await exerciseSharedTelemetry(retry);

        expect(exported).toContain('Failed to start application:');
        expect(exported).toContain('backend reached on the retry');
        // Spans recorded by the retry, then one shutdown — the retry's stop(), not the rollback
        expect(spans.length).toBeGreaterThan(1);
        expect(spans.filter((name) => name === '<shut down>')).toEqual(['<shut down>']);
        expect(spans.at(-1)).toBe('<shut down>');
      });
    }

    test('a stop() after the failed start closes a loggerLayer passed in, as every stop() does', async () => {
      // An OTLP transport's flush timer holds the process open. A caller that gives up with
      // `await app.stop()` has always had it closed by that stop(); the rollback leaving it open
      // must not turn that into a process that never exits.
      const exported: string[] = [];
      const collector = Bun.serve({
        port: 0,
        async fetch(request: Request): Promise<Response> {
          exported.push(await request.text());

          return new Response('{}');
        },
      });

      try {
        const app = createWorkerApp(makeLoggerFromOptions({
          minLevel: 'warn',
          otlpEndpoint: `http://127.0.0.1:${collector.port}`,
          otlpBatchTimeout: LONG_BATCH_TIMEOUT,
        }));
        await startRejection(app);
        expect(exported).toEqual([]);

        await app.stop();

        // Flushed on the way down; the destroy hooks did not run a second time
        expect(exported.join('\n')).toContain('Failed to start application:');
        expect(destroyed).toEqual(['WorkerStateService']);
      } finally {
        await collector.stop(true);
      }
    });

    test('a stop() after the failed start shuts down the spanProcessors and releases the metrics.registry passed in', async () => {
      // The twin of the loggerLayer case. The rollback only flushed the processors and left the
      // registry alone; a stop() after it returned early, so a processor that holds a handle until
      // its shutdown() kept alive a process that stop() after a failed start had always let exit.
      const calls = { flushed: 0, shutdown: 0 };
      const spanProcessor = {
        onStart(): void {
          // Nothing to do on start
        },
        onEnd(): void {
          // Nothing recorded
        },
        async forceFlush(): Promise<void> {
          calls.flushed++;
        },
        async shutdown(): Promise<void> {
          calls.shutdown++;
        },
      };
      const registry = new Registry();
      Effect.runSync(createMetricsService({
        registry,
        prefix: 'caller_',
        collectHttpMetrics: false,
        collectSystemMetrics: false,
        collectGcMetrics: false,
      })).createCounter({ name: 'jobs_total', help: 'Jobs the caller counted' }).inc();

      // Through a variable: the core's typing of `metrics` does not list `registry`
      const metrics = { enabled: true, registry };
      const app = new OneBunApplication(WorkerModule, {
        port: 0,
        gracefulShutdown: false,
        loggerLayer: makeRecordingLoggerLayer().layer,
        queue: { adapter: RefusingSubscribeAdapter },
        metrics,
        tracing: { spanProcessors: [spanProcessor] },
      });

      expect(await startRejection(app)).toBe(subscribeError);
      // Left for the next attempt by the rollback
      expect(calls).toEqual({ flushed: 1, shutdown: 0 });
      expect(await registry.metrics()).toContain('caller_jobs_total');

      await app.stop();
      await app.stop();

      // Shut down once, as by every stop(); released as by every stop(); the rollback's steps
      // did not run again
      expect(calls.shutdown).toBe(1);
      expect(await registry.metrics()).not.toContain('caller_jobs_total');
      expect(destroyed).toEqual(['WorkerStateService']);
      expect(adapterCalls.disconnected).toBe(1);
    });

    test('a repeated stop() after the failed start closes nothing again, so a registry shared with a later application survives it', async () => {
      // Cleanup that stops every application it created calls stop() on the failed one a second
      // time, after another application was built on the same registry. Every stop() after the
      // first awaits the first one's outcome, as it did before the rollback existed.
      const registry = new Registry();
      const metrics = { enabled: true, registry };
      const app = new OneBunApplication(WorkerModule, {
        port: 0,
        gracefulShutdown: false,
        loggerLayer: makeRecordingLoggerLayer().layer,
        queue: { adapter: RefusingSubscribeAdapter },
        metrics,
      });

      expect(await startRejection(app)).toBe(subscribeError);
      await app.stop();

      // What the next application registers on the shared registry
      Effect.runSync(createMetricsService({
        registry,
        prefix: 'next_',
        collectHttpMetrics: false,
        collectSystemMetrics: false,
        collectGcMetrics: false,
      })).createCounter({ name: 'requests_total', help: 'Registered after the first stop()' }).inc();

      await Promise.all([app.stop(), app.stop()]);

      expect(await registry.metrics()).toContain('next_requests_total');
      expect(destroyed).toEqual(['WorkerStateService']);
      expect(adapterCalls.disconnected).toBe(1);
    });

    test('a metrics.registry passed in keeps what is registered on it, and the retry scrapes it', async () => {
      refusalsLeft = 1;
      const registry = new Registry();
      // The caller's own metric, on the registry it hands to the application
      Effect.runSync(createMetricsService({
        registry,
        prefix: 'caller_',
        collectHttpMetrics: false,
        collectSystemMetrics: false,
        collectGcMetrics: false,
      })).createCounter({ name: 'jobs_total', help: 'Jobs the caller counted' }).inc();

      // Through a variable: the core's typing of `metrics` does not list `registry`
      const metrics = { enabled: true, registry };
      const app = new OneBunApplication(WorkerModule, {
        port: 0,
        gracefulShutdown: false,
        loggerLayer: makeRecordingLoggerLayer().layer,
        queue: { adapter: RefusingSubscribeAdapter },
        metrics,
      });

      expect(await startRejection(app)).toBe(subscribeError);
      const failedMetrics = metricsServiceOf(app);
      // The sampler is gone; the registry was not cleared
      expect(metricsSampler(app)).toBeUndefined();
      expect(await registry.metrics()).toContain('caller_jobs_total');

      await app.start();

      try {
        // Kept, not rebuilt: its metrics are still registered on the caller's registry, and
        // registering the same names there a second time would throw
        expect(metricsServiceOf(app)).toBe(failedMetrics);
        expect(metricsSampler(app)).toBeDefined();
        const scrape = await (await fetch(`http://127.0.0.1:${app.getPort()}/metrics`)).text();
        expect(scrape).toContain('caller_jobs_total');
        expect(scrape).toContain('memory_usage_bytes');
      } finally {
        await app.stop();
      }
    });

    test('in multi-service mode, a service whose start fails leaves the logs of one that started exporting', async () => {
      const exported: string[] = [];
      const collector = Bun.serve({
        port: 0,
        async fetch(request: Request): Promise<Response> {
          exported.push(await request.text());

          return new Response('{}');
        },
      });
      const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `http://127.0.0.1:${collector.port}`;

      @Controller('/sibling')
      class SiblingController extends BaseController {
        @Get('/')
        serve(): string {
          this.logger.warn('sibling served a request');

          return 'ok';
        }
      }

      @Module({ controllers: [SiblingController] })
      class SiblingModule {}

      @Service()
      class FailsAfterSiblingStarted extends BaseService {
        async onModuleInit(): Promise<void> {
          await Bun.sleep(100);
          throw new Error('child boot failed');
        }
      }

      @Module({ providers: [FailsAfterSiblingStarted] })
      class FailingModule {}

      const app = new OneBunApplication({
        services: {
          sibling: { module: SiblingModule, port: 0 },
          failing: { module: FailingModule, port: 0 },
        },
        gracefulShutdown: false,
        metrics: { enabled: false },
      });

      try {
        await expect(app.start()).rejects.toThrow('child boot failed');
        const sibling = app.getApplication('sibling');
        expect(sibling).toBeDefined();

        try {
          expect((await fetch(`http://127.0.0.1:${sibling!.getPort()}/sibling`)).status).toBe(200);
          await shutdownLogger();

          expect(exported.join('\n')).toContain('child boot failed');
          // Written after the failing service rolled back, through the sibling's own transport
          expect(exported.join('\n')).toContain('sibling served a request');
        } finally {
          await sibling?.stop();
        }
      } finally {
        if (previousEndpoint === undefined) {
          delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
        } else {
          process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = previousEndpoint;
        }
        await collector.stop(true);
      }
    });
  });

  test('a stopped application still starts again, as it did before the rollback existed', async () => {
    @Module({})
    class EmptyModule {}

    const app = new OneBunApplication(EmptyModule, {
      port: 0,
      gracefulShutdown: false,
      metrics: { enabled: false },
      loggerLayer: makeRecordingLoggerLayer().layer,
    });
    await app.start();
    await app.stop();

    await app.start();

    try {
      expect(app.getPort()).toBeGreaterThan(0);
    } finally {
      // stop() is spent — the latch it set is terminal, as it always was — so the restarted
      // listener is closed directly.
      await (app as unknown as { server: { stop(force: boolean): Promise<void> } | null }).server?.stop(true);
    }
  });

  test('a start() that fails on a running application does not roll back the running boot', async () => {
    let boots = 0;

    @Service()
    class SecondBootFails extends BaseService {
      async onModuleInit(): Promise<void> {
        boots++;
        if (boots === 2) {
          throw new Error('second boot refused');
        }
      }
    }

    @Controller('/alive')
    class AliveController extends BaseController {
      @Get('/')
      alive(): string {
        return 'yes';
      }
    }

    @Module({ controllers: [AliveController], providers: [SecondBootFails] })
    class RunningModule {}

    const app = new OneBunApplication(RunningModule, {
      port: 0,
      gracefulShutdown: false,
      loggerLayer: makeRecordingLoggerLayer().layer,
    });
    await app.start();
    const port = app.getPort();

    try {
      await expect(app.start()).rejects.toThrow('second boot refused');

      // What a rollback would have reached is the running boot: its listener and its sampler.
      expect((await fetch(`http://127.0.0.1:${port}/alive`)).status).toBe(200);
      expect(metricsSampler(app)).toBeDefined();
    } finally {
      await app.stop();
    }
  });

  test('an onModuleInit failure is rethrown as the value start() caught: Effect\'s wrapper, message intact', async () => {
    // The boundary the docs draw. start() never swaps the error it caught, but a service's
    // onModuleInit runs inside Effect, so what it caught there is already a FiberFailure.
    const initError = new Error('backend down');

    @Service()
    class BackendService extends BaseService implements OnModuleDestroy {
      async onModuleInit(): Promise<void> {
        throw initError;
      }

      async onModuleDestroy(): Promise<void> {
        destroyed.push('BackendService');
      }
    }

    @Module({ providers: [BackendService] })
    class BackendModule {}

    const app = new OneBunApplication(BackendModule, {
      port: 0,
      gracefulShutdown: false,
      loggerLayer: makeRecordingLoggerLayer().layer,
    });

    const error = await startRejection(app);

    expect(Runtime.isFiberFailure(error)).toBe(true);
    expect(error).not.toBe(initError);
    expect((error as Error).message).toBe('backend down');
    // Rolled back all the same: destroy hooks included, sampler cleared.
    expect(destroyed).toEqual(['BackendService']);
    expect(metricsSampler(app)).toBeUndefined();
  });

  test('a start() that fails before anything was acquired rolls back without a failed step', async () => {
    const recording = makeRecordingLoggerLayer();
    const app = createWorkerApp(recording.layer);
    const configError = new Error('Config initialization failed');
    (app as unknown as { config: { initialize(): Promise<void> } }).config = {
      async initialize(): Promise<void> {
        throw configError;
      },
    };

    expect(await startRejection(app)).toBe(configError);

    expect(adapterCalls.constructed).toBe(0);
    expect(destroyed).toEqual([]);
    expect(recording.messages()).toContain('Failed start rolled back');
    expect(recording.messages('error').filter((message) => message.includes('failed step'))).toEqual([]);
  });
});

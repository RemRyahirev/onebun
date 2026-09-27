/**
 * A stop() called while start() is still booting waits for the boot, then stops what it started.
 *
 * It used to run its sequence beside the boot. A service still in `onModuleInit` had its destroy
 * hook run under it, the sequence released what existed at that moment and took the terminal
 * shutdown latch — and the boot then went on to connect the queue and open the listener, which
 * nothing would ever release: every later stop() awaited the spent latch. With a boot that then
 * failed, the rollback awaited that same stop() instead of running, so the late acquisitions were
 * not rolled back either. The process never exited.
 *
 * The spawned-process cases pin the property that matters — the process ends by itself; the
 * in-process cases pin the order, what is released, the error `start()` rejects with, the retry
 * after it, the bound on the wait and multi-service mode.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { OnApplicationInit, OnModuleDestroy } from '../module/lifecycle';
import type {
  Message,
  QueueAdapter,
  Subscription,
} from '../queue/types';

import { Controller, Module } from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { Subscribe } from '../queue/decorators';
import { makeRecordingLoggerLayer, useFakeTimers } from '../testing/test-utils';

import { OneBunApplication } from './application';
import {
  runStopDuringStart,
  type StopDuringStartResult,
  type StopDuringStartRun,
} from './failed-start-fixtures/fixture-protocol';

/** Lifecycle steps, in the order they happened. */
const events: string[] = [];

/** Adapter connections opened and closed, across all instances. */
const adapterCalls = { connected: 0, disconnected: 0 };

/** When set, the adapter refuses every subscription with exactly this object. */
let subscribeError: Error | null = null;

/** How many more `onModuleInit` calls throw once they are let through. */
let initFailuresLeft = 0;

/** The `onModuleInit` gate of the boot under test; `null` lets a boot straight through. */
let initGate: InitGate | null = null;

/** Called by `onModuleInit` before its first await — still inside the synchronous part of `start()`. */
let onInitEntered: (() => void) | null = null;

/** When set, `SelfStoppingService.onApplicationInit` awaits it: a stop() from inside the boot's own hook. */
let stopFromApplicationInit: (() => Promise<void>) | null = null;

interface InitGate {
  /** Resolves once `onModuleInit` is waiting at the gate. */
  entered: Promise<void>;
  /** Lets `onModuleInit` go on. */
  release(): void;
  /** Called by `onModuleInit` on reaching the gate. */
  enter(): void;
  /** What `onModuleInit` waits on. */
  released: Promise<void>;
}

function holdInit(): InitGate {
  let enter: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  initGate = {
    entered, released, enter, release,
  };

  return initGate;
}

/* eslint-disable @typescript-eslint/no-empty-function */
/** Connects, and accepts subscriptions unless `subscribeError` is set. */
class RecordingAdapter implements QueueAdapter {
  readonly name = 'recording';
  readonly type = 'memory';
  private connected = false;

  async connect(): Promise<void> {
    adapterCalls.connected++;
    events.push('queue:connected');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    adapterCalls.disconnected++;
    events.push('queue:disconnected');
    this.connected = false;
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
    if (subscribeError) {
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
class GatedBackendService extends BaseService implements OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    events.push('init:entered');
    onInitEntered?.();
    const gate = initGate;
    if (gate) {
      gate.enter();
      await gate.released;
    }
    events.push('init:left');
    if (initFailuresLeft > 0) {
      initFailuresLeft--;
      throw new Error('backend down');
    }
  }

  async onModuleDestroy(): Promise<void> {
    events.push('module:destroyed');
  }
}

@Controller('/jobs')
class JobsController extends BaseController {
  constructor(private readonly backend: GatedBackendService) {
    super();
  }

  @Subscribe('jobs.requested')
  async handle(_message: Message<unknown>): Promise<void> {
    await Promise.resolve(this.backend);
  }
}

@Module({ controllers: [JobsController], providers: [GatedBackendService] })
class JobsModule {}

@Module({ providers: [GatedBackendService] })
class BackendOnlyModule {}

@Service()
class SelfStoppingService extends BaseService implements OnApplicationInit, OnModuleDestroy {
  async onApplicationInit(): Promise<void> {
    const stopFromHook = stopFromApplicationInit;
    if (!stopFromHook) {
      return;
    }
    events.push('hook:stop-called');
    await stopFromHook();
    events.push('hook:stop-resolved');
  }

  async onModuleDestroy(): Promise<void> {
    events.push('module:destroyed');
  }
}

@Module({ providers: [SelfStoppingService] })
class SelfStoppingModule {}

/** Default options — metrics on, so the sampler starts — except what a unit test cannot share. */
function createJobsApp(
  port: number,
  recording = makeRecordingLoggerLayer(),
  shutdownTimeout?: number,
): OneBunApplication {
  return new OneBunApplication(JobsModule, {
    port,
    gracefulShutdown: false,
    loggerLayer: recording.layer,
    queue: { adapter: RecordingAdapter },
    shutdownTimeout,
  });
}

/** The sampler handle `startSystemMetricsCollection()` keeps; `undefined` once it is cleared. */
function metricsSampler(app: OneBunApplication): unknown {
  return (app as unknown as {
    metricsService: { systemMetricsInterval?: unknown } | null;
  }).metricsService?.systemMetricsInterval;
}

/** A port nothing listens on, so the listener can be probed after the stop by a known number. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port;
  await probe.stop(true);

  return port!;
}

async function listenerState(port: number): Promise<'listening' | 'closed'> {
  return await fetch(`http://127.0.0.1:${port}/`).then(
    () => 'listening' as const,
    () => 'closed' as const,
  );
}

describe('a stop() called while start() is still booting', () => {
  beforeEach(() => {
    events.length = 0;
    adapterCalls.connected = 0;
    adapterCalls.disconnected = 0;
    subscribeError = null;
    initFailuresLeft = 0;
    initGate = null;
    onInitEntered = null;
    stopFromApplicationInit = null;
  });

  test('waits for the boot, then stops what it went on to acquire — once, after every init hook', async () => {
    const recording = makeRecordingLoggerLayer();
    const port = await freePort();
    const app = createJobsApp(port, recording);
    const gate = holdInit();

    const starting = app.start().then(() => {
      events.push('start:resolved');
    });
    await gate.entered;
    const stopping = app.stop().then(() => {
      events.push('stop:resolved');
    });
    // A second stop() and the first share one sequence
    const stoppingAgain = app.stop();
    gate.release();
    await Promise.all([starting, stopping, stoppingAgain]);

    // The queue the boot connected after stop() was called is disconnected, and the destroy hook
    // runs after onModuleInit finished rather than under it.
    expect(events.filter((event) => event !== 'start:resolved')).toEqual([
      'init:entered',
      'init:left',
      'queue:connected',
      'module:destroyed',
      'queue:disconnected',
      'stop:resolved',
    ]);
    // start() is not turned into a failure: the boot resolved, and stop() came after it
    expect(events.indexOf('start:resolved')).toBeLessThan(events.indexOf('stop:resolved'));
    expect(adapterCalls).toEqual({ connected: 1, disconnected: 1 });
    expect(metricsSampler(app)).toBeUndefined();
    expect(await listenerState(port)).toBe('closed');

    expect(recording.messages()).toContain(
      'stop() called while start() is still booting: stopping once the boot settles',
    );
    expect(recording.messages().filter((message) => message === 'OneBun application stopped')).toHaveLength(1);
  });

  test('a stop() reached before the boot\'s first await is queued behind the boot as well', async () => {
    // Effect runs setup() eagerly, so an onModuleInit with no await before it is called from
    // inside start()'s own synchronous part — before start() has returned its promise.
    const port = await freePort();
    const app = createJobsApp(port);
    let stopping: Promise<void> | null = null;
    onInitEntered = (): void => {
      onInitEntered = null;
      stopping = app.stop().then(() => {
        events.push('stop:resolved');
      });
    };

    await app.start();
    expect(stopping).not.toBeNull();
    await stopping;

    expect(events).toEqual([
      'init:entered',
      'init:left',
      'queue:connected',
      'module:destroyed',
      'queue:disconnected',
      'stop:resolved',
    ]);
    expect(metricsSampler(app)).toBeUndefined();
    expect(await listenerState(port)).toBe('closed');
  });

  test('a boot that then fails rethrows its own error, rolled back by itself, with nothing left running', async () => {
    const recording = makeRecordingLoggerLayer();
    const port = await freePort();
    const app = createJobsApp(port, recording);
    const gate = holdInit();
    const refusal = new Error('No declared stream binds "jobs.requested"');
    subscribeError = refusal;

    const starting = app.start().then(
      () => {
        throw new Error('start() resolved; the case needs it to reject');
      },
      (error: unknown) => {
        events.push('start:rejected');

        return error;
      },
    );
    await gate.entered;
    const stopping = app.stop().then(() => {
      events.push('stop:resolved');
    });
    gate.release();

    // The very object the refused subscription threw, not a cleanup error in its place
    expect(await starting).toBe(refusal);
    await stopping;

    expect(events).toEqual([
      'init:entered',
      'init:left',
      'queue:connected',
      'module:destroyed',
      'queue:disconnected',
      'start:rejected',
      'stop:resolved',
    ]);
    expect(adapterCalls).toEqual({ connected: 1, disconnected: 1 });
    expect(metricsSampler(app)).toBeUndefined();
    expect(await listenerState(port)).toBe('closed');
    // The boot's own rollback did the releasing, and the stop() after it ran no step again
    expect(recording.messages()).toContain('Failed start rolled back');
    expect(recording.messages()).not.toContain('OneBun application stopped');
  });

  test('after a boot that failed under it, a retry on the same instance boots, and a stop() after the retry stops it', async () => {
    const port = await freePort();
    const app = createJobsApp(port);
    const gate = holdInit();
    initFailuresLeft = 1;

    const firstAttempt = app.start().then(
      () => 'resolved',
      (error: unknown) => (error as Error).message,
    );
    await gate.entered;
    const stopping = app.stop();
    gate.release();

    expect(await firstAttempt).toBe('backend down');
    await stopping;

    initGate = null;
    await app.start();
    expect(await listenerState(port)).toBe('listening');

    // Not swallowed by a latch the stop() during the first boot took: the retry is released
    await app.stop();

    expect(await listenerState(port)).toBe('closed');
    expect(adapterCalls).toEqual({ connected: 1, disconnected: 1 });
    expect(metricsSampler(app)).toBeUndefined();
    expect(events.filter((event) => event === 'module:destroyed')).toHaveLength(2);
  });

  test('the wait counts toward shutdownTimeout: a boot that outlives it is stopped when it settles', async () => {
    // Fake time: the budget costs the test nothing, and leaves the real sequence after the boot room
    const shutdownTimeoutMs = 5_000;
    const recording = makeRecordingLoggerLayer();
    const port = await freePort();
    const app = createJobsApp(port, recording, shutdownTimeoutMs);
    const gate = holdInit();

    const starting = app.start();
    await gate.entered;
    // Started before the modules are set up, so it is running while the boot is held
    const sampler = metricsSampler(app) as Timer;
    expect(sampler.hasRef()).toBe(true);

    const timers = useFakeTimers();
    let stopping: Promise<void>;
    try {
      stopping = app.stop();
      timers.advanceTime(shutdownTimeoutMs);
    } finally {
      // Before the deadline's continuation runs: the sampler it clears is a real interval
      timers.restore();
    }
    await stopping;

    // stop() resolved with the boot still held in onModuleInit, and said why
    expect(events).toEqual(['init:entered']);
    expect(recording.messages('error')).toContain(
      `Shutdown timed out after ${shutdownTimeoutMs}ms while waiting for start() to finish booting; `
      + 'the application stops when the boot settles',
    );
    // The one thing released under the boot: a boot that never settles must not keep the process
    // alive through the sampler (the spawned case below). Cleared, not only forgotten.
    expect(metricsSampler(app)).toBeUndefined();
    expect(sampler.hasRef()).toBe(false);
    expect(recording.messages()).toContain('System metrics collection stopped');
    expect(adapterCalls).toEqual({ connected: 0, disconnected: 0 });

    gate.release();
    await starting;
    // Joins the stop chained to the boot rather than starting one of its own
    await app.stop();

    expect(adapterCalls).toEqual({ connected: 1, disconnected: 1 });
    expect(metricsSampler(app)).toBeUndefined();
    expect(await listenerState(port)).toBe('closed');
    expect(events.filter((event) => event === 'module:destroyed')).toHaveLength(1);
  });

  test('a stop() awaited inside the boot\'s own onApplicationInit sits out shutdownTimeout before the boot goes on', async () => {
    // The caveat docs/api/core.md#graceful-shutdown states — throw from the hook to abort a boot:
    // the hook waits for a stop() that waits for the boot, which waits for the hook, until the
    // deadline breaks the circle. Nothing is torn down under the hook meanwhile.
    const shutdownTimeoutMs = 5_000;
    const recording = makeRecordingLoggerLayer();
    const app = new OneBunApplication(SelfStoppingModule, {
      port: 0,
      gracefulShutdown: false,
      loggerLayer: recording.layer,
      shutdownTimeout: shutdownTimeoutMs,
    });
    let stopCalled: (timers: ReturnType<typeof useFakeTimers>) => void = () => undefined;
    const stopCalledFromHook = new Promise<ReturnType<typeof useFakeTimers>>((resolve) => {
      stopCalled = resolve;
    });
    stopFromApplicationInit = async (): Promise<void> => {
      // Fake time from here on: the deadline this stop() sets is the one the test advances
      const timers = useFakeTimers();
      const stopping = app.stop();
      stopCalled(timers);
      await stopping;
    };

    const starting = app.start().then(() => {
      events.push('start:resolved');
    });
    const timers = await stopCalledFromHook;
    try {
      // A few turns of the loop: neither side moves on its own
      for (let turn = 0; turn < 3; turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(events).toEqual(['hook:stop-called']);
      timers.advanceTime(shutdownTimeoutMs);
    } finally {
      timers.restore();
    }
    await starting;
    // Joins the stop chained to the boot
    await app.stop();

    expect(recording.messages('error')).toContain(
      `Shutdown timed out after ${shutdownTimeoutMs}ms while waiting for start() to finish booting; `
      + 'the application stops when the boot settles',
    );
    // The boot went on only once the hook's stop() gave up, and was stopped after it resolved
    expect(events.filter((event) => event !== 'start:resolved')).toEqual([
      'hook:stop-called',
      'hook:stop-resolved',
      'module:destroyed',
    ]);
    expect(events.indexOf('start:resolved')).toBeLessThan(events.indexOf('module:destroyed'));
    expect(recording.messages().filter((message) => message === 'OneBun application stopped')).toHaveLength(1);
  });

  test('in multi-service mode, a stop() during start() waits for the services to boot, then stops them', async () => {
    const gate = holdInit();
    const app = new OneBunApplication({
      services: {
        backend: { module: BackendOnlyModule, port: 0 },
      },
      gracefulShutdown: false,
      metrics: { enabled: false },
    });

    const starting = app.start();
    await gate.entered;
    const stopping = app.stop();
    gate.release();
    await Promise.all([starting, stopping]);

    // stopAll() used to find nothing started yet and return, leaving the service to finish
    // booting and run on
    expect(events).toEqual(['init:entered', 'init:left', 'module:destroyed']);
    expect(app.getRunningServices()).toEqual([]);
  });
});

/** The fixture gets this long before it is killed and the case fails. */
const KILL_AFTER_MS = 15_000;
/** And has to be gone well inside it: the boot and the stop take well under a second. */
const EXIT_WITHIN_MS = 10_000;
const CASE_TIMEOUT_MS = 30_000;

function expectEndedByItself(
  run: StopDuringStartRun,
  queue: StopDuringStartResult['queue'] = { connected: 1, disconnected: 1 },
): void {
  // The output rides along in the message, so a hang is diagnosable from the test report alone.
  expect({ killed: run.killed, output: run.killed ? run.output : '' }).toEqual({ killed: false, output: '' });
  expect(run.exitCode).toBe(0);
  expect(run.elapsedMs).toBeLessThan(EXIT_WITHIN_MS);
  // By default the boot connected the queue after stop() was called, and the stop released it; the
  // sampler, running before the stop, is gone
  expect(run.result?.queue).toEqual(queue);
  expect(run.result?.samplerDuringBoot).toBe(true);
  expect(run.result?.samplerRunning).toBe(false);
}

describe('a process that called stop() while start() was still booting exits by itself', () => {
  test('when the boot then connects the queue and resolves', async () => {
    const run = await runStopDuringStart({ FAIL_AT: 'none' }, KILL_AFTER_MS);

    expectEndedByItself(run);
    expect(run.result?.rejected).toBeNull();
    expect(run.result?.events).toEqual([
      'init:entered',
      'stop:called',
      'init:left',
      'queue:connected',
      'start:settled',
      'module:destroyed',
      'queue:disconnected',
      'stop:resolved',
    ]);
  }, CASE_TIMEOUT_MS);

  test('when the boot then connects the queue and fails: start() rejects with its own error', async () => {
    const run = await runStopDuringStart({ FAIL_AT: 'application-init' }, KILL_AFTER_MS);

    expectEndedByItself(run);
    expect(run.result?.rejected).toBe('fixture: onApplicationInit refused to finish the boot');
    expect(run.result?.events).toEqual([
      'init:entered',
      'stop:called',
      'init:left',
      'queue:connected',
      'module:destroyed',
      'queue:disconnected',
      'start:settled',
      'stop:resolved',
    ]);
  }, CASE_TIMEOUT_MS);

  test('when the boot never settles: stop() gives up at shutdownTimeout, and what it left running does not hold the process', async () => {
    // onModuleInit awaits a promise nothing settles and holds nothing itself, so only what the
    // application left running can keep the process alive. The sampler did: stop() released
    // nothing under the boot, and the process ran until it was killed.
    const run = await runStopDuringStart({ FAIL_AT: 'never-settles', SHUTDOWN_TIMEOUT: '300' }, KILL_AFTER_MS);

    expectEndedByItself(run, { connected: 0, disconnected: 0 });
    expect(run.result?.rejected).toBeNull();
    expect(run.result?.events).toEqual(['init:entered', 'stop:called', 'stop:resolved']);
    expect(run.output).toContain('Shutdown timed out after 300ms while waiting for start() to finish booting');
  }, CASE_TIMEOUT_MS);
});

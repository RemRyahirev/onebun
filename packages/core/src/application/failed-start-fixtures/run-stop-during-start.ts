/**
 * An application that is stopped while its start() is still in `onModuleInit`, in a fresh
 * process: `bun <this file>`.
 *
 * Run it with cwd = the repository root — that is where Bun reads the tsconfig that turns on
 * `experimentalDecorators`; from anywhere else the decorators below silently record nothing.
 *
 * Default options (metrics on, so the system-metrics sampler runs) plus an in-memory queue with a
 * subscription and an interval job. A service's `onModuleInit` is held until `stop()` has been
 * called; only then does the boot go on to connect the queue — the acquisition a stop() running
 * beside the boot never saw. `FAIL_AT` picks how the boot ends:
 * - `none` — it resolves: the queue is up and the listener open when the stop() gets to run;
 * - `application-init` — an `onApplicationInit` hook throws after the queue is up;
 * - `never-settles` — `onModuleInit` awaits a promise nothing settles, and holds nothing itself:
 *   `stop()` gives up after `SHUTDOWN_TIMEOUT` ms, and nobody awaits `start()`.
 *
 * Nothing calls `process.exit`: the process prints one `RESULT_MARKER` line once stop() has
 * resolved and is left to end on its own. Still running seconds later, it is holding something
 * nothing released — the queue's timers, the sampler or the listener.
 */
import type { OnApplicationInit, OnModuleDestroy } from '../../module/lifecycle';
import type { Message } from '../../queue/types';

import { Controller, Module } from '../../decorators/decorators';
import { Controller as BaseController } from '../../module/controller';
import { BaseService, Service } from '../../module/service';
import { InMemoryQueueAdapter } from '../../queue/adapters/memory.adapter';
import { Interval, Subscribe } from '../../queue/decorators';
import { OneBunApplication } from '../application';

import { RESULT_MARKER, type StopDuringStartResult } from './fixture-protocol';

const failAt = process.env.FAIL_AT ?? 'none';
const shutdownTimeout = process.env.SHUTDOWN_TIMEOUT ? Number(process.env.SHUTDOWN_TIMEOUT) : undefined;

/** Long enough never to fire during the run: only its timer has to exist. */
const HEARTBEAT_EVERY_MS = 60_000;

const events: string[] = [];
const queue = { connected: 0, disconnected: 0 };

let enteredInit: () => void = () => undefined;
const initEntered = new Promise<void>((resolve) => {
  enteredInit = resolve;
});
let callStop: () => void = () => undefined;
const stopCalled = new Promise<void>((resolve) => {
  callStop = resolve;
});

/** The in-memory adapter, counted: its connection holds the event loop through its timers. */
class CountedMemoryAdapter extends InMemoryQueueAdapter {
  override async connect(): Promise<void> {
    await super.connect();
    queue.connected++;
    events.push('queue:connected');
  }

  override async disconnect(): Promise<void> {
    await super.disconnect();
    queue.disconnected++;
    events.push('queue:disconnected');
  }
}

@Service()
class SlowBackendService extends BaseService implements OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    events.push('init:entered');
    enteredInit();
    if (failAt === 'never-settles') {
      await new Promise<void>(() => undefined);
    }
    await stopCalled;
    events.push('init:left');
  }

  async onModuleDestroy(): Promise<void> {
    events.push('module:destroyed');
  }
}

@Controller('/work')
class WorkController extends BaseController implements OnApplicationInit {
  constructor(private readonly backend: SlowBackendService) {
    super();
  }

  @Subscribe('work.requested')
  async handle(_message: Message<unknown>): Promise<void> {
    await Promise.resolve(this.backend);
  }

  @Interval(HEARTBEAT_EVERY_MS, { pattern: 'work.heartbeat' })
  heartbeat(): { at: number } {
    return { at: Date.now() };
  }

  async onApplicationInit(): Promise<void> {
    if (failAt === 'application-init') {
      throw new Error('fixture: onApplicationInit refused to finish the boot');
    }
  }
}

@Module({ controllers: [WorkController], providers: [SlowBackendService] })
class WorkModule {}

const app = new OneBunApplication(WorkModule, {
  port: 0,
  queue: { adapter: CountedMemoryAdapter },
  shutdownTimeout,
});

let rejected: string | null = null;
const starting = app.start().then(
  () => {
    events.push('start:settled');
  },
  (error: unknown) => {
    rejected = error instanceof Error ? error.message : String(error);
    events.push('start:settled');
  },
);

/** The sampler handle `startSystemMetricsCollection()` keeps; `undefined` once it is cleared. */
function samplerHandle(): unknown {
  return (app as unknown as {
    metricsService: { systemMetricsInterval?: unknown } | null;
  }).metricsService?.systemMetricsInterval;
}

await initEntered;
// Started before the modules are set up, so it is already running here
const samplerDuringBoot = samplerHandle() !== undefined;
const stopping = app.stop();
events.push('stop:called');
callStop();
await stopping;
events.push('stop:resolved');
if (failAt !== 'never-settles') {
  await starting;
}

const result: StopDuringStartResult = {
  failAt,
  rejected,
  events,
  queue,
  samplerDuringBoot,
  samplerRunning: samplerHandle() !== undefined,
};
process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify(result)}\n`);

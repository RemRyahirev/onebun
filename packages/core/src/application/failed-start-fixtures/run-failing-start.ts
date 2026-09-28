/**
 * An application whose start() rejects late, in a fresh process: `bun <this file>`.
 *
 * Run it with cwd = the repository root — that is where Bun reads the tsconfig that turns on
 * `experimentalDecorators`; from anywhere else the decorators below silently record nothing.
 *
 * Default options (metrics on, so the system-metrics sampler runs) plus an in-memory queue with a
 * subscription and an interval job, so every timer a boot starts is live when the failure lands.
 * `FAIL_AT` picks where it lands:
 * - `application-init` — an `onApplicationInit` hook throws: the queue is up, the routes are built;
 * - `listen` — `Bun.serve` cannot bind `FIXTURE_PORT`, which the test is holding: the last step.
 *
 * The rejection is caught and `stop()` is NOT called — that is the case under test. The process
 * prints one `RESULT_MARKER` line and is then left to end on its own; it has nothing scheduled to
 * keep it alive, so a process still running seconds later is holding something the rollback missed.
 */
import type { OnApplicationInit } from '../../module/lifecycle';
import type { Message } from '../../queue/types';

import { Controller, Module } from '../../decorators/decorators';
import { Controller as BaseController } from '../../module/controller';
import { Interval, Subscribe } from '../../queue/decorators';
import { OneBunApplication } from '../application';

import { RESULT_MARKER } from './fixture-protocol';

const failAt = process.env.FAIL_AT ?? 'application-init';

/** Long enough never to fire during the run: only its timer has to exist. */
const HEARTBEAT_EVERY_MS = 60_000;

@Controller('/work')
class WorkController extends BaseController implements OnApplicationInit {
  @Subscribe('work.requested')
  async handle(_message: Message<unknown>): Promise<void> {
    await Promise.resolve();
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

@Module({ controllers: [WorkController] })
class WorkModule {}

const app = new OneBunApplication(WorkModule, {
  port: failAt === 'listen' ? Number(process.env.FIXTURE_PORT) : 0,
});

let rejected: string | null = null;
try {
  await app.start();
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error);
}

process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify({ failAt, rejected })}\n`);

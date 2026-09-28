/**
 * A JetStream application whose start() rejects after the adapter's connection opened, in a fresh
 * process: `NATS_URL=nats://... bun <this file>`. `METRICS=off` disables metrics.
 *
 * Run it with cwd = the repository root — that is where Bun reads the tsconfig that turns on
 * `experimentalDecorators`; from anywhere else `@Subscribe` silently records nothing, no consumer
 * is attempted, and the start does not fail at all.
 *
 * By default `@Subscribe` names a subject no declared stream binds, so the adapter refuses the
 * subscription once it is connected: the failure the FB-30 reporter hit, minus the workqueue.
 * `FAIL_AT=connect` declares a stream with `replicas: 3` instead, which a single-node server
 * refuses from inside the adapter's own `connect()` — after the socket opened, before the adapter
 * counts itself connected, so the rollback's `disconnect()` has nothing it would close.
 *
 * The rejection is caught and `stop()` is NOT called. The process prints one `RESULT_MARKER` line
 * and is left to end on its own — before the rollback, the open NATS connection (and, with
 * metrics on, the sampler) kept it alive indefinitely.
 */
import {
  BaseController,
  Controller,
  Module,
  OneBunApplication,
  Subscribe,
  type Message,
} from '@onebun/core';

import { JetStreamQueueAdapter } from '../../src/jetstream.adapter';

/** The prefix of the one line this fixture prints its observations on. */
const RESULT_MARKER = '@@failed-start-result ';
/** More than one replica needs a cluster, so a single-node server refuses the stream. */
const CLUSTER_ONLY_REPLICAS = 3;

@Controller('/workers')
class WorkerController extends BaseController {
  @Subscribe('unbound.subject', { group: 'fb30-workers' })
  async handle(_message: Message<unknown>): Promise<void> {
    await Promise.resolve();
  }
}

@Module({ controllers: [WorkerController] })
class WorkerModule {}

const app = new OneBunApplication(WorkerModule, {
  port: 0,
  ...(process.env.METRICS === 'off' ? { metrics: { enabled: false } } : {}),
  queue: {
    adapter: JetStreamQueueAdapter,
    options: {
      servers: process.env.NATS_URL ?? 'nats://127.0.0.1:4222',
      streams: process.env.FAIL_AT === 'connect'
        // Refused by the stream reconcile inside connect(), after the socket opened.
        ? [{
          name: 'FB30_REPLICATED',
          subjects: ['fb30.replicated.>'],
          storage: 'memory' as const,
          replicas: CLUSTER_ONLY_REPLICAS,
        }]
        : [{ name: 'FB30_UNRELATED', subjects: ['fb30.unrelated.>'], storage: 'memory' as const }],
    },
  },
});

let rejected: string | null = null;
try {
  await app.start();
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error);
}

process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify({ rejected })}\n`);

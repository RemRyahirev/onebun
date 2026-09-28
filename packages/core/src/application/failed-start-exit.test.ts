/**
 * A process whose start() rejected, and which caught it without calling stop(), ends by itself.
 *
 * Before the rollback it never did: the system-metrics sampler and the queue adapter each held the
 * event loop open, so a test or a supervisor that caught a failed boot hung until it was killed.
 * Only a separate process can show that — an open handle inside the test runner keeps nothing
 * alive, because the runner exits when the tests do.
 *
 * The fixture runs with default options (metrics on) and an in-memory queue carrying a
 * subscription and an interval job; see `failed-start-fixtures/run-failing-start.ts`.
 */

import {
  describe,
  expect,
  test,
} from 'bun:test';

import { runFailingStart, type FailingStartRun } from './failed-start-fixtures/fixture-protocol';

/** The fixture gets this long before it is killed and the case fails. */
const KILL_AFTER_MS = 15_000;
/** And has to be gone well inside it: the boot and the rollback take well under a second. */
const EXIT_WITHIN_MS = 10_000;
const CASE_TIMEOUT_MS = 30_000;

function expectEndedByItself(run: FailingStartRun, rejection: string): void {
  // The output rides along in the message, so a hang is diagnosable from the test report alone.
  expect({ killed: run.killed, output: run.killed ? run.output : '' }).toEqual({ killed: false, output: '' });
  expect(run.exitCode).toBe(0);
  expect(run.elapsedMs).toBeLessThan(EXIT_WITHIN_MS);
  expect(run.result?.rejected).toContain(rejection);
}

describe('a process that caught a failed start() exits by itself (FB-30)', () => {
  test('when an onApplicationInit hook throws', async () => {
    const run = await runFailingStart({ FAIL_AT: 'application-init' }, KILL_AFTER_MS);

    expectEndedByItself(run, 'onApplicationInit refused to finish the boot');
  }, CASE_TIMEOUT_MS);

  test('when the listener cannot bind its port — the last step of the boot', async () => {
    const holder = Bun.serve({ port: 0, fetch: () => new Response('taken') });

    try {
      const run = await runFailingStart({ FAIL_AT: 'listen', FIXTURE_PORT: String(holder.port) }, KILL_AFTER_MS);

      expectEndedByItself(run, String(holder.port));
    } finally {
      await holder.stop(true);
    }
  }, CASE_TIMEOUT_MS);

  test('when its logger exports over OTLP — the rollback closes the logger the application built', async () => {
    // The OTLP transport's flush timer holds the loop. The rollback closes only the transport of
    // the logger this application built — not every one in the process — and that still has to
    // be enough for the process to end, with the cause delivered first.
    const exported: string[] = [];
    const collector = Bun.serve({
      port: 0,
      async fetch(request: Request): Promise<Response> {
        exported.push(await request.text());

        return new Response('{}');
      },
    });

    try {
      const run = await runFailingStart(
        { FAIL_AT: 'application-init', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `http://127.0.0.1:${collector.port}` },
        KILL_AFTER_MS,
      );

      expectEndedByItself(run, 'onApplicationInit refused to finish the boot');
      expect(exported.join('\n')).toContain('Failed to start application:');
    } finally {
      await collector.stop(true);
    }
  }, CASE_TIMEOUT_MS);
});

/**
 * A JetStream application whose start() rejected, caught without stop(), ends by itself (FB-30).
 *
 * The reporter's worker never got that far only because the rejection was uncaught. Caught — as a
 * test or a supervisor does — the process lived on: the adapter's NATS connection and the default
 * system-metrics sampler each held the event loop open, and releasing only one of them was not
 * enough. `OneBunApplication.start()` now rolls back what it started before rethrowing.
 *
 * A failure inside the adapter's own `connect()` — a declared stream the server refuses — is not
 * reached by that rollback: the adapter never counted itself connected, so its `disconnect()` is a
 * no-op. `connect()` closes the connection it opened before rethrowing; the last two cases pin it.
 *
 * Only a separate process can show it: the test runner exits when its tests do, whatever handles
 * are left open. Runs against a real nats-server, unconditionally, like the other integration files.
 */

import { resolve } from 'node:path';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { createNatsContainer, type TestContainer } from '@onebun/core/testing';

const CONTAINER_BOOT_MS = 120_000;
/** The fixture gets this long before it is killed and the case fails. */
const KILL_AFTER_MS = 15_000;
/** And has to be gone well inside it: connecting, failing and rolling back take about a second. */
const EXIT_WITHIN_MS = 10_000;
const CASE_TIMEOUT_MS = 30_000;

/** tests -> nats -> packages -> repository root, where the decorator tsconfig applies. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');
const FIXTURE = resolve(import.meta.dir, 'fixtures/failed-start.fixture.ts');
const RESULT_MARKER = '@@failed-start-result ';

interface FixtureRun {
  killed: boolean;
  exitCode: number;
  elapsedMs: number;
  rejected: string | null | undefined;
  output: string;
}

async function runFixture(env: Record<string, string>): Promise<FixtureRun> {
  const startedAt = performance.now();
  const child = Bun.spawn([process.execPath, FIXTURE], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let killed = false;
  const watchdog = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, KILL_AFTER_MS);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(watchdog);

  const line = stdout.split('\n').find((candidate) => candidate.startsWith(RESULT_MARKER));
  const result = line === undefined
    ? undefined
    : JSON.parse(line.slice(RESULT_MARKER.length)) as { rejected: string | null };

  return {
    killed,
    exitCode,
    elapsedMs: performance.now() - startedAt,
    rejected: result?.rejected,
    output: `${stdout}\n${stderr}`,
  };
}

/** What the default fixture fails on: a subscription refused once the adapter is connected. */
const UNBOUND_SUBSCRIBE = 'No declared stream binds "unbound.subject"';
/** What `FAIL_AT=connect` fails on: a stream the single-node server refuses inside `connect()`. */
const REFUSED_STREAM = 'FB30_REPLICATED';

function expectEndedByItself(run: FixtureRun, failure: string): void {
  // The output rides along in the message, so a hang is diagnosable from the test report alone.
  expect({ killed: run.killed, output: run.killed ? run.output : '' }).toEqual({ killed: false, output: '' });
  expect(run.exitCode).toBe(0);
  expect(run.elapsedMs).toBeLessThan(EXIT_WITHIN_MS);
  // It failed for the reason the fixture sets up, after the connection was open.
  expect(run.rejected).toContain(failure);
}

describe('a JetStream application that caught its failed start() exits by itself (FB-30)', () => {
  let nats: TestContainer;

  beforeAll(async () => {
    nats = await createNatsContainer({ enableJetStream: true });
  }, CONTAINER_BOOT_MS);

  afterAll(async () => {
    await nats.stop();
  }, CONTAINER_BOOT_MS);

  it('with default options, metrics sampler included', async () => {
    expectEndedByItself(await runFixture({ NATS_URL: nats.url }), UNBOUND_SUBSCRIBE);
  }, CASE_TIMEOUT_MS);

  it('with metrics disabled, where the NATS connection alone used to hold it', async () => {
    expectEndedByItself(await runFixture({ NATS_URL: nats.url, METRICS: 'off' }), UNBOUND_SUBSCRIBE);
  }, CASE_TIMEOUT_MS);

  it('when the adapter\'s own connect() fails after the connection opened', async () => {
    // A declared stream the server refuses — here `replicas: 3` on one node; a narrowing or a
    // create-only change on redeploy takes the same path. The adapter never counts itself
    // connected, so the rollback's disconnect() has nothing to close: connect() has to.
    expectEndedByItself(
      await runFixture({ NATS_URL: nats.url, METRICS: 'off', FAIL_AT: 'connect' }),
      REFUSED_STREAM,
    );
  }, CASE_TIMEOUT_MS);

  it('when the adapter\'s own connect() fails, with default options', async () => {
    expectEndedByItself(await runFixture({ NATS_URL: nats.url, FAIL_AT: 'connect' }), REFUSED_STREAM);
  }, CASE_TIMEOUT_MS);
});

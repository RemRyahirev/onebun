/**
 * How a test runs a fixture of this directory and reads what it observed.
 *
 * A module of its own because importing a fixture would boot its application inside the test
 * process — and the property under test is whether a whole process ends.
 */
import { resolve } from 'node:path';

/** The prefix of the one line a fixture prints its observations on. */
export const RESULT_MARKER = '@@failed-start-result ';

/** failed-start-fixtures -> application -> src -> core -> packages -> repository root. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../../..');
const FAILING_START_FIXTURE = resolve(import.meta.dir, 'run-failing-start.ts');
const STOP_DURING_START_FIXTURE = resolve(import.meta.dir, 'run-stop-during-start.ts');

/** One spawned fixture: how it ended, and what it printed on its `RESULT_MARKER` line. */
export interface FixtureRun<TResult> {
  /** `null` when the watchdog had to kill it. */
  exitCode: number | null;
  /** The watchdog killed it: something the application left open kept the event loop alive. */
  killed: boolean;
  /** From spawn to exit. */
  elapsedMs: number;
  /** What the fixture printed after its application settled, or `null` if it never got that far. */
  result: TResult | null;
  /** stdout and stderr, for the failure message. */
  output: string;
}

export type FailingStartRun = FixtureRun<{ failAt: string; rejected: string | null }>;

/** What `run-stop-during-start.ts` observed. */
export interface StopDuringStartResult {
  failAt: string;
  /** The message `start()` rejected with, or `null` when it resolved. */
  rejected: string | null;
  /** The lifecycle in the order it happened, `init:entered` to `stop:resolved`. */
  events: string[];
  /** Adapter connections opened and closed over the whole run. */
  queue: { connected: number; disconnected: number };
  /** Whether the system-metrics sampler was running while the boot was held in `onModuleInit`. */
  samplerDuringBoot: boolean;
  /** Whether the system-metrics sampler was still scheduled after `stop()` resolved. */
  samplerRunning: boolean;
}

export type StopDuringStartRun = FixtureRun<StopDuringStartResult>;

/**
 * Run a fixture in a fresh `bun` process whose cwd is the repository root, so the root
 * tsconfig's decorator settings apply, and kill it if it is still alive after `killAfterMs`.
 */
async function runFixture<TResult>(
  fixture: string,
  env: Record<string, string>,
  killAfterMs: number,
): Promise<FixtureRun<TResult>> {
  const startedAt = performance.now();
  const child = Bun.spawn([process.execPath, fixture], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let killed = false;
  const watchdog = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, killAfterMs);

  const [stdout, stderr, exited] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(watchdog);

  const line = stdout.split('\n').find((candidate) => candidate.startsWith(RESULT_MARKER));

  return {
    exitCode: killed ? null : exited,
    killed,
    elapsedMs: performance.now() - startedAt,
    result: line === undefined ? null : JSON.parse(line.slice(RESULT_MARKER.length)) as TResult,
    output: `${stdout}\n${stderr}`,
  };
}

/** `run-failing-start.ts`: a start() that rejects late, caught without a stop(). */
export async function runFailingStart(
  env: Record<string, string>,
  killAfterMs: number,
): Promise<FailingStartRun> {
  return await runFixture(FAILING_START_FIXTURE, env, killAfterMs);
}

/** `run-stop-during-start.ts`: a stop() called while start() is still in `onModuleInit`. */
export async function runStopDuringStart(
  env: Record<string, string>,
  killAfterMs: number,
): Promise<StopDuringStartRun> {
  return await runFixture(STOP_DURING_START_FIXTURE, env, killAfterMs);
}

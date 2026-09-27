/**
 * How a test runs `run-failing-start.ts` and reads what it observed.
 *
 * A module of its own because importing the fixture would boot its application inside the test
 * process — and the property under test is whether a whole process ends.
 */
import { resolve } from 'node:path';

/** The prefix of the one line the fixture prints its observations on. */
export const RESULT_MARKER = '@@failed-start-result ';

/** failed-start-fixtures -> application -> src -> core -> packages -> repository root. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../../..');
const FIXTURE = resolve(import.meta.dir, 'run-failing-start.ts');

export interface FailingStartRun {
  /** `null` when the watchdog had to kill it. */
  exitCode: number | null;
  /** The watchdog killed it: something the rollback missed kept the event loop alive. */
  killed: boolean;
  /** From spawn to exit. */
  elapsedMs: number;
  /** What the fixture printed after catching the rejection, or `null` if it never got that far. */
  result: { failAt: string; rejected: string | null } | null;
  /** stdout and stderr, for the failure message. */
  output: string;
}

/**
 * Run the fixture in a fresh `bun` process whose cwd is the repository root, so the root
 * tsconfig's decorator settings apply, and kill it if it is still alive after `killAfterMs`.
 */
export async function runFailingStart(
  env: Record<string, string>,
  killAfterMs: number,
): Promise<FailingStartRun> {
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
    result: line === undefined
      ? null
      : JSON.parse(line.slice(RESULT_MARKER.length)) as FailingStartRun['result'],
    output: `${stdout}\n${stderr}`,
  };
}

/**
 * How a test runs `run-scenario.ts` and reads what it observed.
 *
 * A module of its own because importing the runner would run a scenario in the test process —
 * the one thing an import-order fixture must never do.
 */
import { resolve } from 'node:path';

/** The prefix of the one line the runner prints its observations on. */
export const RESULT_MARKER = '@@reflect-interop-result ';

/** reflect-interop-fixtures -> decorators -> src -> core -> packages -> repository root. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../../..');
const RUNNER = resolve(import.meta.dir, 'run-scenario.ts');

export interface ScenarioRun {
  exitCode: number;
  result: Record<string, unknown>;
}

/**
 * Run one scenario — a comma-separated step list, see `run-scenario.ts` — in a fresh `bun`
 * process whose cwd is the repository root, so the root tsconfig's decorator settings apply.
 */
export async function runScenario(steps: string): Promise<ScenarioRun> {
  const child = Bun.spawn([process.execPath, RUNNER, steps], {
    cwd: REPOSITORY_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  const line = stdout.split('\n').find((candidate) => candidate.startsWith(RESULT_MARKER));
  if (line === undefined) {
    throw new Error(`Scenario "${steps}" printed no result (exit ${exitCode}).\n${stdout}\n${stderr}`);
  }

  return { exitCode, result: JSON.parse(line.slice(RESULT_MARKER.length)) as Record<string, unknown> };
}

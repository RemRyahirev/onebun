/**
 * How a test runs `no-runtime.ts` and reads what it observed.
 *
 * A module of its own because importing the runner would run it in the test process, where
 * testcontainers has already cached a working runtime client.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The prefix of the one line the runner prints its observations on. */
export const RESULT_MARKER = '@@containers-no-runtime ';

/** The `DOCKER_HOST` the runner is started with: a socket that does not exist. */
export const MISSING_DOCKER_HOST = 'unix:///nonexistent.sock';

/** How a rejection looks to a caller: what a test would assert on. */
export interface ObservedRejection {
  constructorName: string;
  isPlainError: boolean;
  message: string;
  hasCleanupFailure: boolean;
}

export type Observed = ObservedRejection | 'resolved';

export interface NoRuntimeResult {
  /** What testcontainers itself throws when it finds no runtime — the error 0.8.1 passed through. */
  testcontainers: Observed;
  helpers: Record<string, Observed>;
}

/** containers-fixtures -> testing -> src -> core -> packages -> repository root. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../../..');
const RUNNER = resolve(import.meta.dir, 'no-runtime.ts');

/**
 * Run the helpers in a fresh `bun` process with `DOCKER_HOST` aimed at a missing socket and `HOME` /
 * `XDG_RUNTIME_DIR` aimed at an empty directory.
 */
export async function runWithoutRuntime(): Promise<NoRuntimeResult> {
  const emptyHome = await mkdtemp(join(tmpdir(), 'onebun-no-runtime-'));

  try {
    const child = Bun.spawn([process.execPath, RUNNER], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        DOCKER_HOST: MISSING_DOCKER_HOST,
        HOME: emptyHome,
        XDG_RUNTIME_DIR: emptyHome,
      },
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
      throw new Error(`no-runtime.ts printed no result (exit ${exitCode}).\n${stdout}\n${stderr}`);
    }

    return JSON.parse(line.slice(RESULT_MARKER.length)) as NoRuntimeResult;
  } finally {
    await rm(emptyHome, { recursive: true, force: true });
  }
}

/**
 * How a test runs `pre-10-3.ts` — the container helpers against a testcontainers from before 10.3.0
 * — and reads what it observed.
 *
 * The runner cannot import `containers.ts` from its place in the repository: `testcontainers` would
 * resolve to the installed 11.x. So a temporary directory gets a copy of `containers.ts` and of the
 * internal module it imports beside `node_modules/testcontainers`, a stub of the 10.0–10.2 shape, and
 * the runner imports the copy.
 */
import {
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The prefix of the one line the runner prints its observations on. */
export const RESULT_MARKER = '@@containers-pre-10-3 ';

/** The global the stub reads its `start()` from: the runner decides what a start does. */
export const STUB_START = '__onebunPre103Start';

/** What the stub's `start()` is: it gets the image and every label put on the builder. */
export type StubStart = (image: string, labels: Record<string, string>) => Promise<unknown>;

/** The labels the runner passes to every helper call. */
/* eslint-disable @typescript-eslint/naming-convention -- label keys are reverse-DNS by convention */
export const CALLER_LABELS = { 'dev.onebun.fb26.harness': 'pre-10-3' };
/* eslint-enable @typescript-eslint/naming-convention */

/** The module the runner writes beside the stub to show a named import of it does not link. */
export const NAMED_IMPORT_PROBE = 'named-import-probe.ts';

/**
 * testcontainers 10.0–10.2 as far as `containers.ts` can tell: tsc's CommonJS output, with
 * `GenericContainer` and `Wait` and no `getContainerRuntimeClient`.
 */
const STUB_INDEX = `'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
class GenericContainer {
  constructor(image) { this.image = image; this.labels = {}; }
  withExposedPorts() { return this; }
  withWaitStrategy() { return this; }
  withStartupTimeout() { return this; }
  withLogConsumer() { return this; }
  withCommand() { return this; }
  withEnvironment() { return this; }
  withLabels(labels) { this.labels = { ...this.labels, ...labels }; return this; }
  async start() { return await globalThis[${JSON.stringify(STUB_START)}](this.image, this.labels); }
}
Object.defineProperty(exports, 'GenericContainer', { enumerable: true, get: () => GenericContainer });
const Wait = { forLogMessage() { return {}; } };
Object.defineProperty(exports, 'Wait', { enumerable: true, get: () => Wait });
`;

const STUB_PACKAGE = JSON.stringify({ name: 'testcontainers', version: '10.2.2', main: 'index.js' });

const PROBE_SOURCE = `import { getContainerRuntimeClient } from 'testcontainers';

export const exported = typeof getContainerRuntimeClient;
`;

/** How a start the stub rejected looks to a caller of the helper. */
export interface FailedStart {
  /** The helper rejected with the very object `start()` threw. */
  sameError: boolean;
  message: string;
  hasCleanupFailure: boolean;
  /** The labels on the builder when `start()` ran — that is, before `create`. */
  labels: Record<string, string>;
}

export interface Pre103Result {
  /** A named import of `getContainerRuntimeClient` from the stub: expected NOT to link. */
  namedImport: { links: boolean; error: string };
  /** Importing the copy of `containers.ts`. */
  containers: { links: boolean; error: string };
  helpers: Record<string, { failedStart: FailedStart; startedUrl: string }>;
}

/** The sources the copy is made of: `containers.ts` and every module of its own that it imports. */
const CONTAINERS_SOURCES = ['containers.ts', 'container-ownership.ts'];
const RUNNER = resolve(import.meta.dir, 'pre-10-3.ts');

/** Run `pre-10-3.ts` in a fresh `bun` process against a stub of testcontainers 10.0–10.2. */
export async function runAgainstPre103Testcontainers(): Promise<Pre103Result> {
  const dir = await mkdtemp(join(tmpdir(), 'onebun-pre-10-3-'));

  try {
    const stubDir = join(dir, 'node_modules', 'testcontainers');
    await mkdir(stubDir, { recursive: true });
    await Bun.write(join(stubDir, 'package.json'), STUB_PACKAGE);
    await Bun.write(join(stubDir, 'index.js'), STUB_INDEX);
    await Bun.write(join(dir, NAMED_IMPORT_PROBE), PROBE_SOURCE);
    for (const source of CONTAINERS_SOURCES) {
      // containers-fixtures -> testing
      await Bun.write(join(dir, source), Bun.file(resolve(import.meta.dir, '..', source)));
    }

    const child = Bun.spawn([process.execPath, RUNNER, dir], {
      cwd: dir,
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
      throw new Error(`pre-10-3.ts printed no result (exit ${exitCode}).\n${stdout}\n${stderr}`);
    }

    return JSON.parse(line.slice(RESULT_MARKER.length)) as Pre103Result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

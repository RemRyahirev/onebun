/**
 * The container helpers against a testcontainers from before 10.3.0 — `GenericContainer` and `Wait`,
 * no `getContainerRuntimeClient` — in a fresh process: `bun <this file> <dir>`, where `<dir>` holds
 * a copy of `containers.ts` and `container-ownership.ts` beside a stub `node_modules/testcontainers`
 * of that shape.
 *
 * Prints one line, `RESULT_MARKER` followed by JSON, and exits 0. Run it through
 * `runAgainstPre103Testcontainers()` in `pre-10-3-protocol.ts`, which prepares `<dir>`.
 */
import { join } from 'node:path';

import type { TestContainer } from '../containers';

import {
  type FailedStart,
  type Pre103Result,
  type StubStart,
  CALLER_LABELS,
  NAMED_IMPORT_PROBE,
  RESULT_MARKER,
  STUB_START,
} from './pre-10-3-protocol';

type Helper = (options?: { labels?: Record<string, string> }) => Promise<TestContainer>;

const HELPER_NAMES = ['createRedisContainer', 'createNatsContainer', 'createPostgresContainer'] as const;
const STUB_HOST = 'stub-host';
const STUB_PORT = 40_000;

const [dir] = process.argv.slice(2);
const globals = globalThis as unknown as Record<string, StubStart>;

async function linkOf(path: string): Promise<{ links: boolean; error: string; module?: unknown }> {
  try {
    return { links: true, error: '', module: await import(path) };
  } catch (error) {
    return { links: false, error: String(error) };
  }
}

async function failedStartOf(helper: Helper): Promise<FailedStart> {
  const injected = new Error('injected');
  let seen: Record<string, string> = {};
  globals[STUB_START] = async (_image, labels) => {
    seen = labels;
    throw injected;
  };

  try {
    await helper({ labels: CALLER_LABELS });
  } catch (error) {
    return {
      sameError: error === injected,
      message: String((error as { message?: unknown }).message),
      hasCleanupFailure: typeof error === 'object' && error !== null && 'containerCleanupFailure' in error,
      labels: seen,
    };
  }
  throw new Error('the helper resolved although start() rejected');
}

async function startedUrlOf(helper: Helper): Promise<string> {
  globals[STUB_START] = async () => ({
    getHost: () => STUB_HOST,
    getMappedPort: () => STUB_PORT,
    async stop() {
      // The stub started nothing.
    },
  });

  return (await helper()).url;
}

const namedImport = await linkOf(join(dir, NAMED_IMPORT_PROBE));
const containers = await linkOf(join(dir, 'containers.ts'));
const helpers: Pre103Result['helpers'] = {};

if (containers.links) {
  const loaded = containers.module as Record<(typeof HELPER_NAMES)[number], Helper>;
  for (const name of HELPER_NAMES) {
    helpers[name] = {
      failedStart: await failedStartOf(loaded[name]),
      startedUrl: await startedUrlOf(loaded[name]),
    };
  }
}

const result: Pre103Result = {
  namedImport: { links: namedImport.links, error: namedImport.error },
  containers: { links: containers.links, error: containers.error },
  helpers,
};

process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
process.exit(0);

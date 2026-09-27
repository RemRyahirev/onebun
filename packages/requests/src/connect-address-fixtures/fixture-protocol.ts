/**
 * How a test runs `pinned-request.ts` in a fresh process — one that trusts a test CA, or talks
 * through a proxy — and reads what the request resolved with.
 *
 * A fresh process because `fetch` reads both from the environment, `NODE_EXTRA_CA_CERTS` once at
 * startup.
 */
import { resolve } from 'node:path';

/** The prefix of the one line the fixture prints its outcome on. */
export const RESULT_MARKER = '@@pinned-request-result ';

/** connect-address-fixtures -> src -> requests -> packages -> repository root. */
const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../..');
const FIXTURE = resolve(import.meta.dir, 'pinned-request.ts');

/** Environment variables `fetch` reads a proxy from, lower-cased. */
const PROXY_VARIABLES: readonly string[] = ['http_proxy', 'https_proxy', 'no_proxy'];

/** What the request resolved or failed with. */
export type PinnedRequestResult =
  | { success: true; statusCode: number | undefined; result: unknown }
  /** `causeCode`: the `code` of the raw error in `details.details`, such as a TLS verification code. */
  | { success: false; error: string; causeCode: string };

export interface PinnedRequestRun {
  /** `null` when the fixture printed no result line. */
  result: PinnedRequestResult | null;
  /** stdout and stderr, for the failure message. */
  output: string;
}

export interface PinnedRequestOptions {
  /** A CA certificate file for the process to trust, through `NODE_EXTRA_CA_CERTS`. */
  caFile?: string;
  /**
   * Environment for the process on top of the test's own, such as `HTTPS_PROXY`. The test's own
   * proxy variables are never passed on: a proxy would take a request to a local fixture elsewhere.
   */
  env?: Record<string, string>;
  /** Kill the process if it is still running after this long. */
  killAfterMs: number;
}

/** GET `url` under `connectAddress` through the HTTP client, from a fresh `bun` process. */
export async function runPinnedRequest(
  url: string,
  connectAddress: string,
  options: PinnedRequestOptions,
): Promise<PinnedRequestRun> {
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !PROXY_VARIABLES.includes(name.toLowerCase())));
  const child = Bun.spawn([process.execPath, FIXTURE], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...inherited,
      ...(options.caFile === undefined ? {} : { NODE_EXTRA_CA_CERTS: options.caFile }),
      ...options.env,
      FIXTURE_URL: url,
      FIXTURE_CONNECT_ADDRESS: connectAddress,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), options.killAfterMs);

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(watchdog);

  const line = stdout.split('\n').find((candidate) => candidate.startsWith(RESULT_MARKER));

  return {
    result: line === undefined ? null : JSON.parse(line.slice(RESULT_MARKER.length)) as PinnedRequestResult,
    output: `${stdout}\n${stderr}`,
  };
}

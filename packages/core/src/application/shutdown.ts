/**
 * Shutdown primitives
 *
 * One bounded shape for "wait for in-flight work, then give up and say what was left".
 * `OneBunApplication.stop()` uses it for the HTTP drain; WebSocket sockets and in-flight
 * scheduled jobs plug in by contributing another {@link InFlightSource} to the same wait,
 * so a shutdown never grows a second, differently-bounded waiting loop.
 *
 * @see docs:api/core.md
 */

/**
 * Default deadline for the whole shutdown sequence, in milliseconds.
 *
 * 15s sits inside a Kubernetes default `terminationGracePeriodSeconds` of 30s with room
 * for the container runtime's own SIGKILL margin.
 *
 * @see docs:api/core.md
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Share of the shutdown budget the in-flight drain may consume.
 *
 * The drain must not be able to eat the entire budget: a single long-lived response — an
 * SSE stream, a hung upstream call — would otherwise leave no time for the destroy hooks
 * that flush buffers and release locks, which is the work that actually loses data.
 */
export const DRAIN_BUDGET_RATIO = 0.5;

/**
 * How long to wait for `server.stop(true)` to settle before continuing the teardown.
 *
 * Short on purpose. Measured against a bare `Bun.serve` with no framework involved: after a
 * SERVER-initiated `ws.close()` the close callback fires and the socket is gone, but
 * `server.pendingWebSockets` stays at 1 and `stop(true)` never settles — still pending after 8 s.
 * The listener is genuinely down by then (a fetch to the port is refused), so waiting past this
 * buys nothing and costs the entire shutdown budget.
 */
export const SERVER_STOP_TIMEOUT_MS = 250;

/** Poll interval for the drain loop. Only ever runs while the application is stopping. */
const DRAIN_POLL_INTERVAL_MS = 5;

/**
 * A countable source of in-flight work that a shutdown must wait for.
 *
 * @see docs:api/core.md
 */
export interface InFlightSource {
  /** Human-readable name used in the "still running" diagnostics. */
  readonly name: string;
  /** How many units of work are still in flight right now. */
  pending(): number;
}

/**
 * What the drain waited for and what it gave up on.
 *
 * @see docs:api/core.md
 */
export interface DrainReport {
  /** Every source reached zero before the deadline. */
  readonly drained: boolean;
  /** Wall time actually spent waiting, in milliseconds. */
  readonly waitedMs: number;
  /** Work still in flight when the deadline expired; empty when `drained` is true. */
  readonly remaining: readonly { readonly name: string; readonly pending: number }[];
}

/** Sum of everything still in flight across the given sources. */
function snapshot(sources: readonly InFlightSource[]): { name: string; pending: number }[] {
  const remaining: { name: string; pending: number }[] = [];
  for (const source of sources) {
    const pending = source.pending();
    if (pending > 0) {
      remaining.push({ name: source.name, pending });
    }
  }

  return remaining;
}

/**
 * Wait until every source reports zero in-flight work, or until `timeoutMs` elapses.
 *
 * Never throws and never waits longer than the deadline: the caller is expected to
 * force-close whatever `remaining` still names.
 *
 * @param sources - Work counters to wait for
 * @param timeoutMs - Hard deadline in milliseconds; `0` or less checks once and returns
 * @returns What was drained and what was left
 *
 * @see docs:api/core.md
 */
export async function drainInFlight(
  sources: readonly InFlightSource[],
  timeoutMs: number,
): Promise<DrainReport> {
  const startedAt = Date.now();

  let remaining = snapshot(sources);
  while (remaining.length > 0 && Date.now() - startedAt < timeoutMs) {
    await Bun.sleep(DRAIN_POLL_INTERVAL_MS);
    remaining = snapshot(sources);
  }

  return {
    drained: remaining.length === 0,
    waitedMs: Date.now() - startedAt,
    remaining,
  };
}

/**
 * Render a drain snapshot for a log line: `2 HTTP request(s), 1 WebSocket connection(s)`.
 *
 * @see docs:api/core.md
 */
export function describeRemaining(
  remaining: readonly { readonly name: string; readonly pending: number }[],
): string {
  if (remaining.length === 0) {
    return 'nothing';
  }

  return remaining.map(entry => `${entry.pending} ${entry.name}`).join(', ');
}

/**
 * A cancellable deadline usable in `Promise.race`.
 *
 * @see docs:api/core.md
 */
export interface Deadline {
  /** Resolves to `'timeout'` once the deadline expires. Never rejects. */
  readonly expired: Promise<'timeout'>;
  /** Clear the underlying timer so it cannot keep the process alive. */
  cancel(): void;
}

/**
 * Create a cancellable deadline. The timer is always cleared by `cancel()`, so a shutdown
 * that finishes early does not hold the event loop open for the rest of the budget.
 *
 * @param timeoutMs - Deadline in milliseconds
 *
 * @see docs:api/core.md
 */
export function createDeadline(timeoutMs: number): Deadline {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      resolve('timeout');
    }, timeoutMs);
  });

  return {
    expired,
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

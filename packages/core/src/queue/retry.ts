/**
 * Queue retry policy.
 *
 * `SubscribeOptions.retry` was accepted, type-checked and documented long before any core adapter
 * read it. These two helpers are what the memory and Redis adapters now resolve it through, so the
 * cap and the backoff mean one thing rather than one thing per adapter.
 *
 * The backoff formulas match `calculateRetryDelay` in `@onebun/requests`: the framework already
 * ships `'fixed' | 'linear' | 'exponential'` for HTTP retries, and a queue that computed them
 * differently would be a second dialect of the same three words.
 */

import type { DeadLetterOptions, RetryOptions } from './types';

/**
 * Attempts a subscription makes when `retry` says nothing.
 *
 * One — today's observable behaviour. A higher default would silently turn every existing
 * throwing handler into several deliveries, and a non-idempotent side effect into several
 * side effects, on the strength of an upgrade nobody asked for. `retry.attempts` is opt-in.
 */
export const DEFAULT_RETRY_ATTEMPTS = 1;

/** Base delay used when `retry` asks for a backoff but gives no `delay`. */
export const DEFAULT_RETRY_DELAY_MS = 100;

/**
 * How many times a subscription delivers a message before giving up.
 *
 * Counts total attempts, not extra ones: `attempts: 3` means the handler runs at most three
 * times, matching the `attempt >= maxAttempts` comparison the documented error-handling recipe
 * already uses. A value below 1 is raised to 1 — refusing to deliver at all is not a retry
 * policy, and silently accepting `attempts: 0` would make a subscription that never fires.
 *
 * `deadLetter.maxRetries` is the second source, in the same precedence order JetStream uses to
 * resolve `max_deliver`: `retry.attempts` first, `deadLetter.maxRetries` second, the default
 * last. Pass it only on an adapter that has a dead-letter queue — on one that reports
 * `supports('dead-letter-queue') === false` the field caps a route that does not exist, and
 * honouring it there would give the same options two different attempt counts for no reason.
 *
 * @see docs:api/queue.md
 */
export function resolveMaxAttempts(retry?: RetryOptions, deadLetter?: DeadLetterOptions): number {
  const attempts = retry?.attempts ?? deadLetter?.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;

  return attempts < 1 ? 1 : Math.floor(attempts);
}

/**
 * Delay before the attempt that follows `attempt`.
 *
 * `attempt` is 1-based, as `Message.attempt` is: after the first delivery fails, the wait is
 * `retryDelayMs(retry, 1)`.
 *
 * With no `retry` at all this is 0 — there is no retry to schedule, and a caller that asks
 * anyway should not be made to wait for a redelivery that will not happen.
 *
 * @see docs:api/queue.md
 */
export function retryDelayMs(retry: RetryOptions | undefined, attempt: number): number {
  if (!retry) {
    return 0;
  }

  const delay = retry.delay ?? DEFAULT_RETRY_DELAY_MS;

  switch (retry.backoff) {
    case 'linear':
      return delay * attempt;
    case 'exponential':
      return delay * 2 ** (attempt - 1);
    case 'fixed':
    default:
      return delay;
  }
}

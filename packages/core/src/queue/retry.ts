/**
 * Queue retry policy.
 *
 * `SubscribeOptions.retry` was accepted, type-checked and documented long before any core adapter
 * read it. The helpers below are what the memory and Redis adapters resolve it through, so the
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
 * One: a handler that throws is delivered once. A higher default would silently turn every
 * throwing handler into several deliveries, and a non-idempotent side effect into several side
 * effects, without anyone having asked for retries. `retry.attempts` is opt-in.
 */
export const DEFAULT_RETRY_ATTEMPTS = 1;

/** Base delay used when `retry` asks for a backoff but gives no `delay`. */
export const DEFAULT_RETRY_DELAY_MS = 100;

/**
 * The attempts cap of a subscription with no limit — what `resolveMaxAttempts` returns and
 * `Message.maxAttempts` reports for it on every adapter that honours `retry`.
 *
 * `-1` because that is what the option is written as and what JetStream's `max_deliver` holds for
 * the same policy, so one number means "no limit" in the options, on the wire and on the message.
 * Internal to the adapters: handler code asks `isLastAttempt()` rather than comparing with it.
 *
 * @see docs:api/queue.md
 */
export const UNLIMITED_ATTEMPTS = -1;

/**
 * How many times a subscription delivers a message before giving up.
 *
 * Counts total attempts, not extra ones: `attempts: 3` means the handler runs at most three
 * times, matching the `attempt >= maxAttempts` comparison `isLastAttempt` makes for a positive
 * cap. A positive fraction is floored, but never below 1.
 *
 * A number of zero or below means no limit, and resolves to `UNLIMITED_ATTEMPTS` whatever the
 * exact value: `-1` is the documented spelling, and `0` and other negative numbers mean the same,
 * because that is how NATS reads `max_deliver` — one rule for every adapter rather than a
 * JetStream reading and a memory/Redis one. A non-finite number (`Infinity`, `NaN`) sets no limit
 * either, and resolves to the same `-1`.
 *
 * Only a value that really is a number takes that rule. One that reaches here untyped — a string
 * from an environment variable or a JSON file — is read with `Number()`: below 1 is raised to 1,
 * the rest is floored, so `'3'` is 3 and `'0'` or `'-1'` is a single delivery. One that does not
 * read as a finite number gets the default. The resolved cap
 * is therefore a finite positive integer or `-1`, nothing else.
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
  const configured: unknown = retry?.attempts ?? deadLetter?.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;

  if (typeof configured === 'number' && !(configured > 0 && Number.isFinite(configured))) {
    return UNLIMITED_ATTEMPTS;
  }

  const attempts = Number(configured);

  if (!Number.isFinite(attempts)) {
    return DEFAULT_RETRY_ATTEMPTS;
  }

  return attempts < 1 ? 1 : Math.floor(attempts);
}

/**
 * True when `attempt` is the last delivery `maxAttempts` allows.
 *
 * The one comparison the adapters make against a resolved cap, and the one the documented
 * error-handling recipe makes against `message.attempt` and `message.maxAttempts`. A bare
 * `attempt >= maxAttempts` holds for `UNLIMITED_ATTEMPTS` on the very first delivery, which would
 * end — or dead-letter — a message the subscription asked to retry without end.
 *
 * Either value `undefined` answers false: that is a message nothing tracks delivery for (core
 * NATS, or `ackMode: 'none'`), and no delivery of it is the last one.
 *
 * @see docs:api/queue.md
 */
export function isLastAttempt(attempt: number | undefined, maxAttempts: number | undefined): boolean {
  if (attempt === undefined || maxAttempts === undefined) {
    return false;
  }

  return maxAttempts > 0 && attempt >= maxAttempts;
}

/**
 * Delay before the attempt that follows `attempt`.
 *
 * `attempt` is 1-based, as `Message.attempt` is: after the first delivery fails, the wait is
 * `retryDelayMs(retry, 1)`.
 *
 * `retry.maxDelay`, when set, is the ceiling of the result for every backoff, the default wait of
 * an unlimited subscription with no `retry` aside (that one has no `retry` to carry it).
 *
 * With no `retry` at all this is 0 — there is no retry to schedule, and a caller that asks
 * anyway should not be made to wait for a redelivery that will not happen.
 *
 * The exception is a subscription with no attempts limit: pass its resolved cap as `maxAttempts`,
 * and with no `retry` it waits the documented defaults — `'fixed'`, `DEFAULT_RETRY_DELAY_MS` —
 * instead. Without a `retry` the limit can only come from `deadLetter.maxRetries` or JetStream's
 * `consumerConfig.maxDeliver`, and a zero wait there would redeliver a failing message as fast
 * as the broker can hand it back, for ever. An explicit `retry.delay: 0` is still honoured.
 *
 * @see docs:api/queue.md
 */
export function retryDelayMs(retry: RetryOptions | undefined, attempt: number, maxAttempts?: number): number {
  const policy: RetryOptions | undefined = retry ?? (maxAttempts !== undefined && maxAttempts <= 0 ? {} : undefined);

  if (!policy) {
    return 0;
  }

  const delay = policy.delay ?? DEFAULT_RETRY_DELAY_MS;
  let computed: number;

  switch (policy.backoff) {
    case 'linear':
      computed = delay * attempt;
      break;
    case 'exponential':
      computed = delay * 2 ** (attempt - 1);
      break;
    case 'fixed':
    default:
      computed = delay;
  }

  // A base delay of 0 stays 0 at any attempt: `0 * Infinity` is NaN once the exponent overflows.
  if (Number.isNaN(computed)) {
    computed = 0;
  }

  // `Math.min` also bounds a ladder that has overflowed to `Infinity`. Not set: no ceiling at all.
  return policy.maxDelay === undefined ? computed : Math.min(computed, policy.maxDelay);
}

/**
 * Refuses a `retry.maxDelay` that is not a finite, non-negative number.
 *
 * Called by every adapter that honours `retry`, at `subscribe()`, so a bad value fails the call
 * that registered the subscription — with the pattern in the message — rather than turning into a
 * `NaN` wait on the first failed delivery. `undefined` (no ceiling) is valid.
 *
 * @throws Error naming the subscription pattern and the value received
 *
 * @see docs:api/queue.md
 */
export function validateRetryOptions(retry: RetryOptions | undefined, pattern: string): void {
  const maxDelay: unknown = retry?.maxDelay;

  if (maxDelay === undefined) {
    return;
  }

  if (typeof maxDelay !== 'number' || !Number.isFinite(maxDelay) || maxDelay < 0) {
    throw new Error(
      `Invalid retry.maxDelay for subscription "${pattern}": expected a finite number of milliseconds ` +
      `of 0 or more, got ${typeof maxDelay === 'string' ? JSON.stringify(maxDelay) : String(maxDelay)} ` +
      `(${typeof maxDelay}). Omit maxDelay for a backoff with no ceiling.`,
    );
  }
}

/**
 * Acknowledgment semantics: which mode a subscription runs in, and what the handler did.
 *
 * Every adapter used to spell "auto" as "not manual". That reading is only
 * correct while the union has exactly two members: the moment a third one is added it
 * falls into the auto branch silently, in all six places at once. Resolving the mode in
 * one function is what makes a new member a compile-time decision instead of a
 * behavioural accident. The nack-state helpers below exist for the same reason: every
 * adapter has to answer "was this message handled, or dropped?" identically, or the same
 * handler reports differently depending on which broker is behind it.
 */

import type { Message } from './types';
import type { AckMode, SubscribeOptions } from './types';

/** The mode a subscription runs in when it declares none. */
export const DEFAULT_ACK_MODE: AckMode = 'auto';

/**
 * The acknowledgment mode a subscription actually runs in.
 *
 * @param options - Subscribe options, possibly absent.
 * @returns The declared mode, or `'auto'` when nothing was declared.
 *
 * @see docs:api/queue.md
 */
export function resolveAckMode(options?: SubscribeOptions): AckMode {
  return options?.ackMode ?? DEFAULT_ACK_MODE;
}

/**
 * Whether the adapter acknowledges on the handler's behalf.
 *
 * True for `'auto'` only. `'manual'` hands the decision to the handler and `'none'`
 * removes acknowledgement altogether, so both answer false — but for opposite reasons,
 * which is exactly why the old `!== 'manual'` test could not express this.
 *
 * @see docs:api/queue.md
 */
export function acknowledgesAutomatically(options?: SubscribeOptions): boolean {
  return resolveAckMode(options) === 'auto';
}

/**
 * Whether the broker tracks delivery state for this subscription at all.
 *
 * False only for `'none'`. When it is false, redelivery, dead-letter routing, `retry`,
 * `deadLetter`, `ack_wait`, `max_deliver` and the `attempt`/`maxAttempts`/`redelivered`
 * fields are all inert, and an adapter must not pretend otherwise.
 *
 * @see docs:api/queue.md
 */
export function tracksDelivery(options?: SubscribeOptions): boolean {
  return resolveAckMode(options) !== 'none';
}

/**
 * The accessor an adapter's message class exposes so its consume loop can tell a nacked
 * message from a handled one.
 *
 * Deliberately NOT part of the public `Message` interface. Whether a message was nacked is
 * the adapter's own bookkeeping — a handler already knows what it called, and widening
 * `Message` would invite handlers to read the flag back and branch on it.
 *
 * @see docs:api/queue.md
 */
export interface NackAwareMessage {
  /** True once `nack()` has been called on this message. */
  readonly wasNacked: boolean;
}

/**
 * Whether the handler explicitly nacked this message.
 *
 * A handler that catches its own exception and calls `nack()` returns NORMALLY, so control
 * flow alone cannot tell it apart from a success — which is how every adapter came to emit
 * `onMessageProcessed` for a message it had just dropped or requeued, and every metric built
 * on queue events came to count that as a success.
 *
 * Structural rather than an `instanceof`: the four message classes live in two packages and
 * share no base class, and an adapter that has no nack state at all correctly answers false.
 *
 * @see docs:api/queue.md
 */
export function wasNacked(message: Message): boolean {
  return (message as Partial<NackAwareMessage>).wasNacked === true;
}

/**
 * The error `onMessageFailed` carries for a nacked message.
 *
 * Built here rather than per adapter so the text a listener sees does not depend on which
 * broker is behind the subscription. The handler did not throw, so there is no cause to
 * attach — the nack IS the failure signal.
 *
 * @see docs:api/queue.md
 */
export function nackedError(message: Message): Error {
  return new Error(`Message ${message.id} on pattern "${message.pattern}" was nacked by its handler`);
}

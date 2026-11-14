/**
 * The error every queue adapter's publish path throws.
 *
 * One class for every backend, so the decision a failed publish forces on its caller — repeat it,
 * repeat it only with a deduplication id, or stop — is made from `reason` alone, never from the
 * driver's own error classes, which come from packages an application does not depend on directly.
 */

/**
 * Why a publish failed, named by what it means for the message.
 *
 * - `'unavailable'` — nothing was stored, because the broker could not take the publish: the adapter
 *   is not connected, the connection is closed or draining, the client gave up reaching the broker
 *   before the message left the process, or the broker refused because it cannot accept writes at the
 *   moment (a Redis replica — `READONLY` —, a busy script, a dataset still loading, a cluster without
 *   a quorum; JetStream API error 10008). Repeating the publish cannot store it twice. A repeat can
 *   succeed while the client is still connected or reconnecting, once the broker takes writes again;
 *   once the client has given up reconnecting, publishes keep failing as `'unavailable'` until the
 *   application is restarted.
 * - `'rejected'` — the broker answered and did not store the message, or the client refused before
 *   sending on a limit the broker announced (`max_payload`) or a subject or header it cannot carry.
 *   Repeating the publish cannot store it twice. Whether a repeat can succeed depends on the cause the
 *   message names: a configuration error — no JetStream stream binds the subject, a stream limit, a
 *   permission, a Redis `WRONGTYPE` — fails every repeat until it is fixed, while a condition that
 *   passes — a JetStream stream without a leader for a few seconds during a cluster election, which
 *   the server answers exactly like a missing stream — lets a later repeat succeed.
 * - `'unknown'` — the message may or may not have been stored. It left the process, or may still
 *   leave it, and no answer came back: an acknowledgement timeout, a connection lost while the
 *   publish was in flight, an acknowledgement the connection was not allowed to receive. Repeating it
 *   can store it twice, unless it carries a `messageId` the broker deduplicates — JetStream does,
 *   inside the stream's duplicate window; the memory, Redis and core-NATS adapters do not. Every
 *   failure an adapter cannot classify is reported as `'unknown'`, never as `'unavailable'`.
 *
 * @see docs:api/queue.md
 */
export type QueuePublishFailureReason = 'unavailable' | 'rejected' | 'unknown';

/**
 * What `QueuePublishError` is constructed with, beside its message.
 *
 * @see docs:api/queue.md
 */
export interface QueuePublishErrorOptions {
  /** Why the publish failed. */
  reason: QueuePublishFailureReason;
  /** The pattern `publish()` was called with. */
  pattern: string;
  /** The error the driver or the adapter raised, kept as it was thrown. */
  cause?: unknown;
}

/**
 * A publish that did not complete, with what it means for the message.
 *
 * Thrown by the publish path of every built-in adapter — memory, Redis, NATS and JetStream — and by
 * `QueueService.publish()` and `publishBatch()`, which pass the adapter's error through. A custom
 * adapter throws it too. It is an `Error`, so code that only catches `Error` keeps working; the
 * message names the cause that actually happened, and the driver's original error is kept as
 * `cause`.
 *
 * A payload `JSON.stringify` cannot serialize, and a pattern the adapter cannot translate, are
 * mistakes in the call rather than publish outcomes: they throw their own error before anything is
 * attempted. Everything the driver refuses is a `QueuePublishError`.
 *
 * `instanceof` holds while the application loads one copy of `@onebun/core`, which its peer
 * dependency arranges. Code that may see a second copy — two incompatible `@onebun/core` versions
 * installed side by side — checks `error.name === 'QueuePublishError'` instead; `name` is set on
 * every instance.
 *
 * @example
 * ```typescript
 * try {
 *   await queue.publish('orders.created', order, { messageId: `order-${order.id}` });
 * } catch (error) {
 *   if (error instanceof QueuePublishError && error.safeToRepeat) {
 *     // Nothing was stored: repeating cannot duplicate it. Whether to repeat, how often and when
 *     // is the caller's policy — the message names the cause.
 *     return await retryLater(order);
 *   }
 *   throw error;
 * }
 * ```
 *
 * @see docs:api/queue.md
 */
export class QueuePublishError extends Error {
  override name = 'QueuePublishError';

  /** Why the publish failed — see `QueuePublishFailureReason`. */
  readonly reason: QueuePublishFailureReason;

  /** The pattern `publish()` was called with. */
  readonly pattern: string;

  /**
   * Whether repeating the publish cannot store the message twice: true when the failed attempt
   * certainly stored nothing (`'unavailable'`, `'rejected'`), false when it may have (`'unknown'`).
   *
   * Safe is not the same as successful — a `'rejected'` publish caused by a configuration error
   * fails every repeat until that is fixed.
   */
  readonly safeToRepeat: boolean;

  /**
   * @param message - What happened, naming the real cause.
   * @param options - The reason, the pattern, and the original error as `cause`.
   */
  constructor(message: string, options: QueuePublishErrorOptions) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.reason = options.reason;
    this.pattern = options.pattern;
    this.safeToRepeat = options.reason !== 'unknown';
  }
}

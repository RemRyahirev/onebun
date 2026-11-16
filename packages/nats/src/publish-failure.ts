/**
 * What a failed NATS publish was, read off the error the driver raised.
 *
 * Shared by `NatsClient.publish()` (core NATS) and `JetStreamQueueAdapter.publish()`. The driver
 * already distinguishes every case worth distinguishing — a closed connection, an acknowledgement
 * timeout, a server refusal with an API code — but in classes from `@nats-io/nats-core` and
 * `@nats-io/jetstream`, which an application does not depend on directly. This module turns them
 * into the one `QueuePublishError` every OneBun adapter throws.
 *
 * Package-internal: deliberately not re-exported from `src/index.ts`.
 */

import { QueuePublishError, type QueuePublishFailureReason } from '@onebun/core';

/**
 * How many `cause` links the classification follows. The driver nests at most three deep
 * (`JetStreamNotEnabled` → `RequestError` → `NoResponders`); the bound only guards against a cycle.
 */
const MAX_CAUSE_DEPTH = 8;

/**
 * The failure, in the detail a message needs. Each kind maps to exactly one reason.
 *
 * - `noResponders` — JetStream only: the server answered that nothing listens on the subject. It
 *   answers that when no stream binds the subject (and when it runs without JetStream at all), and
 *   also while the stream that binds it has no leader, as during a cluster election.
 * - `jetStreamUnavailable` — JetStream answered with an API error that means it cannot take writes
 *   right now (10008, "JetStream system temporarily unavailable").
 * - `apiError` — JetStream answered the publish with any other API error: a stream limit, JetStream
 *   disabled for the account.
 * - `permission` — the server denied this connection permission to publish to the subject.
 * - `replyDenied` — the server denied a permission the publish does not need to be stored: the
 *   subscription to the reply inbox its acknowledgement would arrive on. The client fails every
 *   pending request with that denial, while the message itself goes through.
 * - `refusedLocally` — the client refused before sending: a subject or header it cannot carry, or a
 *   payload above the `max_payload` the server announced.
 * - `closed` — the connection is closed: the driver gave up reconnecting, or it was closed.
 * - `draining` — the connection is draining for shutdown.
 * - `timeout` — no acknowledgement arrived in time.
 * - `noAnswer` — the request ended without an acknowledgement for another reason, most often
 *   because the connection closed while it was pending.
 * - `unrecognised` — none of the above.
 */
export type NatsPublishFailureKind =
  | 'noResponders'
  | 'jetStreamUnavailable'
  | 'apiError'
  | 'permission'
  | 'replyDenied'
  | 'refusedLocally'
  | 'closed'
  | 'draining'
  | 'timeout'
  | 'noAnswer'
  | 'unrecognised';

/** A classified NATS publish failure. */
export interface NatsPublishFailure {
  kind: NatsPublishFailureKind;
  reason: QueuePublishFailureReason;
  /** The numeric JetStream API code, when the server answered with one. */
  apiCode?: number;
}

/**
 * The names the driver gives the errors of a JetStream API answer. `JetStreamNotEnabled` is listed
 * because the driver also raises it for API code 10039 (JetStream disabled for the account), with
 * the `JetStreamApiError` as its cause; the no-responders variant is recognised before this list.
 */
const JETSTREAM_API_ERROR_NAMES = new Set([
  'JetStreamApiError',
  'StreamNotFoundError',
  'ConsumerNotFoundError',
  'JetStreamNotEnabled',
]);

/**
 * JetStream API codes that mean "cannot take writes right now", not "refused this message":
 * nats-server's `JSClusterNotAvailErr` (10008, "JetStream system temporarily unavailable"). Not
 * named by the client's `JetStreamApiCodes`. Nothing was stored, and a later repeat can succeed.
 */
const JETSTREAM_CLUSTER_NOT_AVAILABLE_CODE = 10008;
const JETSTREAM_UNAVAILABLE_CODES = new Set([JETSTREAM_CLUSTER_NOT_AVAILABLE_CODE]);

/** The parts of the `cause` chain the classification decides on. */
interface CauseChain {
  names: Set<string>;
  apiCode?: number;
  /** `operation` of the first `PermissionViolationError` on the chain: `'publish'` or `'subscription'`. */
  deniedOperation?: unknown;
}

function readCauseChain(cause: unknown): CauseChain {
  const chain: CauseChain = { names: new Set<string>() };
  let current: unknown = cause;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null; depth += 1) {
    const { name, code, operation } = current as { name?: unknown; code?: unknown; operation?: unknown };

    if (typeof name === 'string') {
      if (name === 'PermissionViolationError' && !chain.names.has(name)) {
        chain.deniedOperation = operation;
      }
      chain.names.add(name);
    }
    // The client exposes an API error's `code` as a prototype getter, so it is read by plain
    // access — the same rule `hasApiErrorCode()` follows.
    if (chain.apiCode === undefined && typeof code === 'number') {
      chain.apiCode = code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return chain;
}

/**
 * Classifies a rejection from `js.publish()` or `nc.publish()`.
 *
 * Reads the `name` of every error on the `cause` chain rather than testing `instanceof`: the
 * driver sets each name explicitly, the decisive one is often a cause rather than the error itself
 * (a denied publish is a `RequestError` whose cause is a `PermissionViolationError`), and a name
 * survives a second copy of the driver in the dependency tree, where a class identity does not.
 *
 * Every mapping is to what the driver proves. A permission violation is a refusal only when the
 * operation denied is the publish itself: the client fails every pending request when the server
 * denies the reply-inbox subscription, and the message has been stored by then. A name not listed
 * here is `unrecognised`, and so `'unknown'` — never `'unavailable'`, which promises that nothing
 * was stored.
 *
 * @param cause - What the driver threw or rejected with.
 * @returns The kind of failure and the reason it maps to.
 */
export function classifyNatsPublishFailure(cause: unknown): NatsPublishFailure {
  const { names, apiCode, deniedOperation } = readCauseChain(cause);

  // `NoRespondersError` names itself `NoResponders`.
  if (names.has('NoResponders')) {
    return { kind: 'noResponders', reason: 'rejected' };
  }
  if (names.has('PermissionViolationError')) {
    return deniedOperation === 'publish'
      ? { kind: 'permission', reason: 'rejected' }
      : { kind: 'replyDenied', reason: 'unknown' };
  }
  for (const name of names) {
    if (JETSTREAM_API_ERROR_NAMES.has(name)) {
      return apiCode !== undefined && JETSTREAM_UNAVAILABLE_CODES.has(apiCode)
        ? { kind: 'jetStreamUnavailable', reason: 'unavailable', apiCode }
        : { kind: 'apiError', reason: 'rejected', apiCode };
    }
  }
  if (names.has('InvalidSubjectError') || names.has('InvalidArgumentError')) {
    return { kind: 'refusedLocally', reason: 'rejected' };
  }
  if (names.has('ClosedConnectionError')) {
    return { kind: 'closed', reason: 'unavailable' };
  }
  if (names.has('DrainingConnectionError')) {
    return { kind: 'draining', reason: 'unavailable' };
  }
  if (names.has('TimeoutError')) {
    return { kind: 'timeout', reason: 'unknown' };
  }
  if (names.has('RequestError')) {
    return { kind: 'noAnswer', reason: 'unknown' };
  }

  return { kind: 'unrecognised', reason: 'unknown' };
}

/** The error's message without a trailing period, so it can be followed by one. */
function describeCause(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);

  return text.replace(/\.+$/, '');
}

const NOT_STORED_REPEAT_SAFE = 'Nothing was stored, so repeating the publish cannot store the message twice';
const NOTHING_SENT = 'Nothing was sent, so repeating the publish cannot store the message twice.';
const MAY_BE_STORED = 'The message may or may not have been stored, so repeating the publish can store it twice '
  + 'unless it carries a messageId that a JetStream stream deduplicates.';

/**
 * The sentence after "Failed to publish …:" for each kind — what happened, then what it means for
 * the message. `cause` is interpolated only where its text is accurate: the no-responders rejection
 * is reworded, because the server says "jetstream is not enabled" when JetStream is running and
 * only the stream is missing, or only its leader.
 */
function explain(failure: NatsPublishFailure, cause: unknown): string {
  switch (failure.kind) {
    case 'noResponders':
      return 'no JetStream stream answered for that subject. Either no stream on the broker binds that subject, or '
        + 'the server runs without JetStream — a configuration error: every repeat fails the same way until it is '
        + 'fixed. Or the stream that binds it has no leader at the moment, as during a cluster election — that '
        + `passes within seconds, and a repeat then succeeds. ${NOT_STORED_REPEAT_SAFE}.`;
    case 'jetStreamUnavailable':
      return `JetStream cannot take writes right now — API error ${failure.apiCode}, "${describeCause(cause)}". `
        + `${NOT_STORED_REPEAT_SAFE}, and a repeat can succeed once JetStream recovers.`;
    case 'apiError': {
      const code = failure.apiCode === undefined ? '' : ` ${failure.apiCode}`;

      return `the server refused it with JetStream API error${code}, "${describeCause(cause)}". `
        + `${NOT_STORED_REPEAT_SAFE}; a repeat succeeds only once that cause has changed.`;
    }
    case 'permission':
      return `the server does not permit this connection to publish to that subject (${describeCause(cause)}). `
        + `${NOT_STORED_REPEAT_SAFE}; a repeat succeeds only once the permission is granted.`;
    case 'replyDenied':
      return 'the server denied this connection the subscription its acknowledgement would arrive on '
        + `(${describeCause(cause)}), so no acknowledgement can arrive — but the publish itself was allowed and `
        + `may well have been stored. ${MAY_BE_STORED}`;
    case 'refusedLocally':
      return `the client refused to send it — ${describeCause(cause)}. `
        + `${NOT_STORED_REPEAT_SAFE}; the same publish is refused the same way.`;
    case 'closed':
      return 'the connection to NATS is closed — the client gave up reconnecting, or the connection was closed. '
        + NOTHING_SENT;
    case 'draining':
      return `the connection to NATS is draining for shutdown. ${NOTHING_SENT}`;
    case 'timeout':
      return 'no acknowledgement arrived in time. A slow or frozen server may have stored it without the '
        + 'acknowledgement arriving; a publish made while the client was reconnecting is usually dropped at the '
        + `next connection attempt. ${MAY_BE_STORED}`;
    case 'noAnswer':
      return `the request ended before the server acknowledged it (${describeCause(cause)}). ${MAY_BE_STORED}`;
    default:
      return `${describeCause(cause)}. OneBun does not recognise this error, so it cannot tell whether the `
        + `message was sent. ${MAY_BE_STORED}`;
  }
}

/**
 * The `QueuePublishError` for a failed NATS publish.
 *
 * @param pattern - What `publish()` was called with; becomes `QueuePublishError.pattern`.
 * @param target - What was addressed, as the message names it: `JetStream subject "orders.>"`.
 * @param cause - What the driver threw or rejected with; kept as `cause`.
 * @param advice - Extra sentences for one kind of failure, appended after the explanation —
 *   the JetStream adapter's stream declarations for `noResponders`.
 * @returns The error to throw.
 */
export function natsPublishError(
  pattern: string,
  target: string,
  cause: unknown,
  advice?: Partial<Record<NatsPublishFailureKind, string>>,
): QueuePublishError {
  const failure = classifyNatsPublishFailure(cause);
  const extra = advice?.[failure.kind];

  return new QueuePublishError(
    `Failed to publish OneBun pattern "${pattern}" to ${target}: ${explain(failure, cause)}`
    + `${extra === undefined ? '' : ` ${extra}`} The driver's error is attached as the cause of this error.`,
    { reason: failure.reason, pattern, cause },
  );
}

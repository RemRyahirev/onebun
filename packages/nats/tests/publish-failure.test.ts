/**
 * classifyNatsPublishFailure / natsPublishError
 *
 * Driven by the driver's own error classes, built the way the driver builds them for each failure —
 * the shapes `publish-failure.integration.test.ts` provokes on a live server. Only the cases a live
 * server cannot produce on demand are covered here alone.
 */

import { JetStreamApiError } from '@nats-io/jetstream';
import { jserrors } from '@nats-io/jetstream/internal';
import { errors } from '@nats-io/transport-node';
import {
  describe,
  expect,
  it,
} from 'bun:test';

import { QueuePublishError } from '@onebun/core';

import { classifyNatsPublishFailure, natsPublishError } from '../src/publish-failure';

/** What `js.publish()` rejects with when no stream binds the subject. */
function noStreamBinds(subject: string): Error {
  const noResponders = new errors.NoRespondersError(subject);
  const request = new errors.RequestError(noResponders.message, { cause: noResponders });

  return new jserrors.JetStreamNotEnabled('jetstream is not enabled', { cause: request });
}

/** What `js.publish()` rejects with when the server answers with an API error. */
function apiError(code: number, description: string): Error {
  return new JetStreamApiError({ err_code: code, code: 503, description });
}

/** What a mux request rejects with: the decisive error as `cause` of a `RequestError`. */
function viaRequest(cause: Error): Error {
  return new errors.RequestError(cause.message, { cause });
}

describe('classifyNatsPublishFailure', () => {
  const cases: Array<[string, () => unknown, string, string]> = [
    ['no stream binds the subject', () => noStreamBinds('orders.created'), 'noResponders', 'rejected'],
    ['a stream limit (API error 10077)', () => apiError(10077, 'maximum messages exceeded'), 'apiError', 'rejected'],
    [
      'JetStream disabled for the account (API error 10039)',
      () => new jserrors.JetStreamNotEnabled('jetstream not enabled for account', {
        cause: apiError(10039, 'jetstream not enabled for account'),
      }),
      'apiError',
      'rejected',
    ],
    [
      'a denied publish',
      () => viaRequest(new errors.PermissionViolationError(
        'Permissions Violation for Publish to "orders.created"',
        'publish',
        'orders.created',
      )),
      'permission',
      'rejected',
    ],
    [
      // What the client fails every pending request with when the server denies the subscription to
      // the reply inbox: the publish itself was allowed, and stored.
      'a denied reply-inbox subscription',
      () => viaRequest(new errors.PermissionViolationError(
        'Permissions Violation for Subscription to "_INBOX.abc.*"',
        'subscription',
        '_INBOX.abc.*',
      )),
      'replyDenied',
      'unknown',
    ],
    [
      'JetStream temporarily unavailable (API error 10008)',
      () => apiError(10008, 'JetStream system temporarily unavailable'),
      'jetStreamUnavailable',
      'unavailable',
    ],
    [
      'a header the client cannot carry',
      () => errors.InvalidArgumentError.format('header', 'values cannot contain \\r or \\n'),
      'refusedLocally',
      'rejected',
    ],
    ['a payload above max_payload', () => errors.InvalidArgumentError.format('payload', 'max_payload size exceeded'), 'refusedLocally', 'rejected'],
    ['an illegal subject', () => new errors.InvalidSubjectError('bad subject'), 'refusedLocally', 'rejected'],
    ['a closed connection', () => new errors.ClosedConnectionError(), 'closed', 'unavailable'],
    ['a draining connection', () => new errors.DrainingConnectionError(), 'draining', 'unavailable'],
    ['an acknowledgement timeout', () => new errors.TimeoutError(), 'timeout', 'unknown'],
    [
      'a connection closed while the request was pending',
      () => viaRequest(new errors.RequestError('connection closed')),
      'noAnswer',
      'unknown',
    ],
    ['an error the driver does not raise', () => new Error('something else'), 'unrecognised', 'unknown'],
    ['a thrown non-error', () => 'a string', 'unrecognised', 'unknown'],
  ];

  for (const [label, make, kind, reason] of cases) {
    it(`classifies ${label} as ${reason}`, () => {
      expect(classifyNatsPublishFailure(make())).toMatchObject({ kind, reason });
    });
  }

  it('reads the API code the server answered with', () => {
    expect(classifyNatsPublishFailure(apiError(10077, 'maximum messages exceeded')).apiCode).toBe(10077);
  });

  it('stops on a cause cycle instead of looping', () => {
    const first = new Error('first') as Error & { cause?: unknown };
    const second = new Error('second', { cause: first });
    first.cause = second;

    expect(classifyNatsPublishFailure(first)).toMatchObject({ reason: 'unknown' });
  });
});

describe('natsPublishError', () => {
  it('is a QueuePublishError carrying the reason, the pattern and the driver error as cause', () => {
    const cause = new errors.TimeoutError();
    const error = natsPublishError('orders.{id}', 'JetStream subject "orders.*"', cause);

    expect(error).toBeInstanceOf(QueuePublishError);
    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe('unknown');
    expect(error.safeToRepeat).toBe(false);
    expect(error.pattern).toBe('orders.{id}');
    expect(error.cause).toBe(cause);
  });

  it('names the cause that happened rather than a missing stream', () => {
    const timeout = natsPublishError('orders.created', 'JetStream subject "orders.created"', new errors.TimeoutError());
    const closed = natsPublishError('orders.created', 'JetStream subject "orders.created"', new errors.ClosedConnectionError());

    expect(timeout.message).toContain('no acknowledgement arrived in time');
    expect(timeout.message).toContain('may or may not have been stored');
    expect(closed.message).toContain('the connection to NATS is closed');
    expect(closed.message).toContain('Nothing was sent');
    for (const error of [timeout, closed]) {
      expect(error.message).not.toContain('binds');
      expect(error.message).not.toContain('no stream');
    }
  });

  it('rewords the no-responders answer, naming both causes it has, instead of "jetstream is not enabled"', () => {
    const error = natsPublishError('orders.created', 'JetStream subject "orders.created"', noStreamBinds('orders.created'));

    expect(error.message).toContain('no stream on the broker binds that subject');
    expect(error.message).toContain('has no leader at the moment');
    expect(error.message).toContain('repeating the publish cannot store the message twice');
    expect(error.message).not.toContain('jetstream is not enabled');
  });

  it('never tells a caller that a rejected publish fails for good', () => {
    const rejections = [
      noStreamBinds('a'),
      apiError(10077, 'maximum messages exceeded'),
      viaRequest(new errors.PermissionViolationError('Permissions Violation for Publish to "a"', 'publish', 'a')),
    ];

    for (const rejection of rejections) {
      const error = natsPublishError('a', 'subject "a"', rejection);

      expect(error.reason).toBe('rejected');
      expect(error.message).toContain('Nothing was stored');
      expect(error.message).not.toContain('until that is fixed.');
    }
  });

  it('does not double a period the driver\'s message already ends with', () => {
    const error = natsPublishError('a', 'subject "a"', apiError(10077, 'maximum messages exceeded.'));

    expect(error.message).not.toContain('..');
  });

  it('appends the advice for the kind that happened, and only for it', () => {
    const advice = { noResponders: 'Declare a stream.' };

    expect(natsPublishError('a', 'subject "a"', noStreamBinds('a'), advice).message).toContain('Declare a stream.');
    expect(natsPublishError('a', 'subject "a"', new errors.TimeoutError(), advice).message)
      .not.toContain('Declare a stream.');
  });

  it('quotes the API code and the server\'s description', () => {
    const error = natsPublishError('a', 'subject "a"', apiError(10077, 'maximum messages exceeded'));

    expect(error.message).toContain('JetStream API error 10077, "maximum messages exceeded"');
  });
});

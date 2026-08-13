/**
 * Config Stamp Tests
 *
 * The reconciliation primitive shared by the consumer and stream paths. Everything
 * here is pure: no adapter, no broker, no module mock — `isNotFoundError` takes the
 * API code as a parameter precisely so this file needs none.
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  CONFIG_CYCLE_WINDOW_MS,
  CONFIG_STAMP_KEYS,
  decideStamp,
  hashReconcileConfig,
  isNotFoundError,
  stampMetadata,
  type StampMetadata,
} from '../src/config-stamp';

const CONSUMER_NOT_FOUND = 10014;
const STREAM_NOT_FOUND = 10059;

describe('hashReconcileConfig', () => {
  it('is stable across object key insertion order', () => {
    const a = hashReconcileConfig({ ack_wait: 1, filter_subject: 'x', max_deliver: 3 });
    const b = hashReconcileConfig({ max_deliver: 3, filter_subject: 'x', ack_wait: 1 });

    expect(a).toBe(b);
  });

  it('is stable across array element order', () => {
    // The rule the stream item depends on: reordering `subjects` in application
    // code must not read as a configuration change.
    expect(hashReconcileConfig({ subjects: ['a.x', 'a.y'] }))
      .toBe(hashReconcileConfig({ subjects: ['a.y', 'a.x'] }));
  });

  it('treats an explicitly undefined value as an omitted key', () => {
    expect(hashReconcileConfig({ ack_wait: 1, max_deliver: undefined }))
      .toBe(hashReconcileConfig({ ack_wait: 1 }));
  });

  it('changes when a hashed value changes', () => {
    expect(hashReconcileConfig({ max_ack_pending: 100 }))
      .not.toBe(hashReconcileConfig({ max_ack_pending: 1 }));
  });

  it('returns 32 lower-case hex characters', () => {
    expect(hashReconcileConfig({ filter_subject: 'orders.created' })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not mutate the caller object', () => {
    const subset = { subjects: ['b', 'a'] };

    hashReconcileConfig(subset);

    expect(subset.subjects).toEqual(['b', 'a']);
  });
});

describe('decideStamp', () => {
  const desired = 'd'.repeat(32);
  const other = 'c'.repeat(32);
  const now = 1_700_000_000_000;

  function stampedAt(offsetMs: number): string {
    return new Date(now - offsetMs).toISOString();
  }

  it('updates with no previous hash when the resource carries no metadata', () => {
    expect(decideStamp(undefined, desired, now)).toEqual({ action: 'update', prevHash: undefined });
  });

  it('updates with no previous hash when metadata carries no config hash', () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- an operator-owned wire key
    expect(decideStamp({ 'team.owner': 'billing' }, desired, now))
      .toEqual({ action: 'update', prevHash: undefined });
  });

  it('is a noop when the applied hash already equals the desired one', () => {
    const metadata: StampMetadata = { [CONFIG_STAMP_KEYS.configHash]: desired };

    expect(decideStamp(metadata, desired, now)).toEqual({ action: 'noop' });
  });

  it('evaluates noop before the cycle check', () => {
    // Both keys equal the desired hash. A cycle check running first would report a
    // cycle for a resource that is already exactly right.
    const metadata: StampMetadata = {
      [CONFIG_STAMP_KEYS.configHash]: desired,
      [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
      [CONFIG_STAMP_KEYS.reconciledAt]: stampedAt(0),
    };

    expect(decideStamp(metadata, desired, now)).toEqual({ action: 'noop' });
  });

  it('reports a cycle when the desired hash was applied inside the window', () => {
    const metadata: StampMetadata = {
      [CONFIG_STAMP_KEYS.configHash]: other,
      [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
      [CONFIG_STAMP_KEYS.reconciledAt]: stampedAt(CONFIG_CYCLE_WINDOW_MS - 1000),
    };

    expect(decideStamp(metadata, desired, now).action).toBe('cycle');
  });

  it('updates instead of cycling once the window has passed', () => {
    const metadata: StampMetadata = {
      [CONFIG_STAMP_KEYS.configHash]: other,
      [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
      [CONFIG_STAMP_KEYS.reconciledAt]: stampedAt(CONFIG_CYCLE_WINDOW_MS + 1000),
    };

    expect(decideStamp(metadata, desired, now)).toEqual({ action: 'update', prevHash: other });
  });

  it('treats a missing timestamp as a cycle', () => {
    const metadata: StampMetadata = {
      [CONFIG_STAMP_KEYS.configHash]: other,
      [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
    };

    expect(decideStamp(metadata, desired, now).action).toBe('cycle');
  });

  it('treats an unparseable timestamp as a cycle', () => {
    const metadata: StampMetadata = {
      [CONFIG_STAMP_KEYS.configHash]: other,
      [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
      [CONFIG_STAMP_KEYS.reconciledAt]: 'not-a-date',
    };

    expect(decideStamp(metadata, desired, now).action).toBe('cycle');
  });

  it('updates when neither hash matches', () => {
    const metadata: StampMetadata = { [CONFIG_STAMP_KEYS.configHash]: other };

    expect(decideStamp(metadata, desired, now)).toEqual({ action: 'update', prevHash: other });
  });
});

describe('stampMetadata', () => {
  it('carries every pre-existing key forward', () => {
    // The client's update API merges with a shallow Object.assign, so the map sent
    // replaces the server's wholesale — anything not carried forward is destroyed.
    const result = stampMetadata({ _nats_v: '2', other: 'x' }, 'h2', 'h1', 0);

    expect(result._nats_v).toBe('2');
    expect(result.other).toBe('x');
    expect(result[CONFIG_STAMP_KEYS.configHash]).toBe('h2');
    expect(result[CONFIG_STAMP_KEYS.prevConfigHash]).toBe('h1');
    expect(result[CONFIG_STAMP_KEYS.reconciledAt]).toBeDefined();
  });

  it('omits the previous-hash key on the create path', () => {
    expect(CONFIG_STAMP_KEYS.prevConfigHash in stampMetadata(undefined, 'h1')).toBe(false);
  });

  it('drops a stale previous-hash rather than leaving it', () => {
    const existing: StampMetadata = { [CONFIG_STAMP_KEYS.prevConfigHash]: 'stale' };

    expect(CONFIG_STAMP_KEYS.prevConfigHash in stampMetadata(existing, 'h1')).toBe(false);
  });

  it('writes a parseable ISO timestamp', () => {
    const result = stampMetadata(undefined, 'h1');

    expect(Number.isNaN(Date.parse(result[CONFIG_STAMP_KEYS.reconciledAt]))).toBe(false);
  });

  it('does not mutate the existing map', () => {
    const existing: StampMetadata = { other: 'x' };

    stampMetadata(existing, 'h2', 'h1', 0);

    expect(Object.keys(existing)).toEqual(['other']);
  });
});

describe('isNotFoundError', () => {
  it('matches the requested numeric code', () => {
    expect(isNotFoundError({ code: CONSUMER_NOT_FOUND }, CONSUMER_NOT_FOUND)).toBe(true);
  });

  it('does not treat another API code as absence', () => {
    // The stream code is not the consumer code: a StreamNotFound must never make the
    // consumer path believe the consumer is missing.
    expect(isNotFoundError({ code: STREAM_NOT_FOUND }, CONSUMER_NOT_FOUND)).toBe(false);
  });

  it('rejects an error carrying no code', () => {
    expect(isNotFoundError(new Error('boom'), CONSUMER_NOT_FOUND)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isNotFoundError(undefined, CONSUMER_NOT_FOUND)).toBe(false);
  });

  it('rejects a string that merely looks like the code', () => {
    expect(isNotFoundError('10014', CONSUMER_NOT_FOUND)).toBe(false);
    expect(isNotFoundError({ code: '10014' }, CONSUMER_NOT_FOUND)).toBe(false);
  });

  it('reads `code` exposed as a prototype getter', () => {
    // The shape the client actually throws: `code` is a getter over a private field,
    // so Object.hasOwn, spreading and JSON round-trips all lose it.
    class ApiErrorLike extends Error {
      get code(): number {
        return CONSUMER_NOT_FOUND;
      }
    }

    const error = new ApiErrorLike('consumer not found');

    expect(Object.hasOwn(error, 'code')).toBe(false);
    expect(isNotFoundError(error, CONSUMER_NOT_FOUND)).toBe(true);
  });
});

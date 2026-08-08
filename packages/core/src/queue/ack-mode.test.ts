/**
 * Acknowledgment Mode Tests
 *
 * The decision every adapter shares. It used to be spelled as a negation of `'manual'`
 * in six separate places, which silently read any new union member as `'auto'` — these
 * cases pin the three-way split so that cannot come back.
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  DEFAULT_ACK_MODE,
  acknowledgesAutomatically,
  resolveAckMode,
  tracksDelivery,
} from './ack-mode';

describe('resolveAckMode', () => {
  it('defaults to auto when nothing is declared', () => {
    expect(resolveAckMode(undefined)).toBe('auto');
    expect(resolveAckMode({})).toBe('auto');
    expect(DEFAULT_ACK_MODE).toBe('auto');
  });

  it('returns each declared mode unchanged', () => {
    expect(resolveAckMode({ ackMode: 'auto' })).toBe('auto');
    expect(resolveAckMode({ ackMode: 'manual' })).toBe('manual');
    expect(resolveAckMode({ ackMode: 'none' })).toBe('none');
  });
});

describe('acknowledgesAutomatically', () => {
  it('is true only for auto', () => {
    expect(acknowledgesAutomatically(undefined)).toBe(true);
    expect(acknowledgesAutomatically({ ackMode: 'auto' })).toBe(true);
  });

  it('is false for manual and for none — for opposite reasons', () => {
    // `manual` hands the decision to the handler; `none` removes acknowledgement
    // altogether. The old `!== 'manual'` test could not tell these apart, and read
    // `none` as `auto`.
    expect(acknowledgesAutomatically({ ackMode: 'manual' })).toBe(false);
    expect(acknowledgesAutomatically({ ackMode: 'none' })).toBe(false);
  });
});

describe('tracksDelivery', () => {
  it('is false only for none', () => {
    expect(tracksDelivery({ ackMode: 'none' })).toBe(false);
  });

  it('is true for every mode that acknowledges something', () => {
    expect(tracksDelivery(undefined)).toBe(true);
    expect(tracksDelivery({ ackMode: 'auto' })).toBe(true);
    expect(tracksDelivery({ ackMode: 'manual' })).toBe(true);
  });

  it('is independent of acknowledgesAutomatically', () => {
    // The two questions are orthogonal: `manual` acknowledges by hand but the broker
    // still tracks delivery, so retry and dead-lettering stay live.
    expect(acknowledgesAutomatically({ ackMode: 'manual' })).toBe(false);
    expect(tracksDelivery({ ackMode: 'manual' })).toBe(true);
  });
});

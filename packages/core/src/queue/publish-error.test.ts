import {
  describe,
  expect,
  it,
} from 'bun:test';

import { QueuePublishError, type QueuePublishFailureReason } from './index';

describe('QueuePublishError', () => {
  it('is an Error, so code that only catches Error keeps working', () => {
    const error = new QueuePublishError('broker gone', { reason: 'unavailable', pattern: 'orders.created' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(QueuePublishError);
    expect(error.name).toBe('QueuePublishError');
    expect(error.message).toBe('broker gone');
    expect(error.stack).toContain('QueuePublishError');
  });

  it('carries the reason and the pattern as fields a caller can branch on', () => {
    const error = new QueuePublishError('refused', { reason: 'rejected', pattern: 'orders.{id}' });

    expect(error.reason).toBe('rejected');
    expect(error.pattern).toBe('orders.{id}');
  });

  it('keeps the original error as cause, untouched', () => {
    const original = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const error = new QueuePublishError('no ack', { reason: 'unknown', pattern: 'x', cause: original });

    expect(error.cause).toBe(original);
  });

  it('has no cause at all when none was given', () => {
    const error = new QueuePublishError('not connected', { reason: 'unavailable', pattern: 'x' });

    expect('cause' in error).toBe(false);
  });

  it('says repeating is safe exactly when the failed attempt stored nothing', () => {
    const safe = (reason: QueuePublishFailureReason): boolean =>
      new QueuePublishError('m', { reason, pattern: 'x' }).safeToRepeat;

    expect(safe('unavailable')).toBe(true);
    expect(safe('rejected')).toBe(true);
    expect(safe('unknown')).toBe(false);
  });

  it('exposes its fields as own properties, so a structured logger sees them', () => {
    const error = new QueuePublishError('m', { reason: 'unknown', pattern: 'orders.created' });

    expect(Object.keys(error)).toEqual(expect.arrayContaining(['reason', 'pattern', 'safeToRepeat']));
  });
});

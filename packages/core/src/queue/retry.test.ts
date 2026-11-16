import {
  describe,
  expect,
  it,
} from 'bun:test';

import {
  DEFAULT_RETRY_DELAY_MS,
  retryDelayMs,
  validateRetryOptions,
} from './retry';

describe('retryDelayMs with retry.maxDelay', () => {
  it('is the ladder untouched when maxDelay is not set', () => {
    expect(retryDelayMs({ backoff: 'linear', delay: 1000 }, 12)).toBe(12_000);
    expect(retryDelayMs({ backoff: 'exponential', delay: 1000 }, 12)).toBe(2_048_000);
    expect(retryDelayMs({ backoff: 'fixed', delay: 1000 }, 12)).toBe(1000);
  });

  it.each(['linear', 'exponential'] as const)('never exceeds the ceiling under %s', (backoff) => {
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      expect(retryDelayMs({ backoff, delay: 1000, maxDelay: 30_000 }, attempt)).toBeLessThanOrEqual(30_000);
    }
  });

  it('doubles up to the ceiling and stays there under exponential', () => {
    const waits = Array.from(
      { length: 8 },
      (_, index) => retryDelayMs({ backoff: 'exponential', delay: 1000, maxDelay: 30_000 }, index + 1),
    );

    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('grows by delay per attempt up to the ceiling under linear', () => {
    const waits = Array.from(
      { length: 5 },
      (_, index) => retryDelayMs({ backoff: 'linear', delay: 1000, maxDelay: 3500 }, index + 1),
    );

    expect(waits).toEqual([1000, 2000, 3000, 3500, 3500]);
  });

  it('leaves a computed value below, at and above the ceiling as the formula gives it or the ceiling', () => {
    const retry = { backoff: 'exponential', delay: 100, maxDelay: 400 } as const;

    expect(retryDelayMs(retry, 2)).toBe(200); // below
    expect(retryDelayMs(retry, 3)).toBe(400); // at
    expect(retryDelayMs(retry, 4)).toBe(400); // above
  });

  it('caps a ladder that has overflowed to Infinity', () => {
    expect(retryDelayMs({ backoff: 'exponential', delay: 1000, maxDelay: 5000 }, 5000)).toBe(5000);
  });

  it('caps a fixed delay that is above the ceiling too', () => {
    expect(retryDelayMs({ backoff: 'fixed', delay: 1000, maxDelay: 250 }, 1)).toBe(250);
  });

  it('applies to the default base delay of 100 ms', () => {
    expect(retryDelayMs({ backoff: 'exponential', maxDelay: 300 }, 1)).toBe(DEFAULT_RETRY_DELAY_MS);
    expect(retryDelayMs({ backoff: 'exponential', maxDelay: 300 }, 3)).toBe(300);
  });

  it('applies to an unlimited subscription that sets maxDelay without a backoff', () => {
    expect(retryDelayMs({ attempts: -1, maxDelay: 50 }, 1, -1)).toBe(50);
    expect(retryDelayMs({ attempts: -1, delay: 10, maxDelay: 50 }, 1, -1)).toBe(10);
  });

  it('keeps the 100 ms default of an unlimited subscription with no retry', () => {
    expect(retryDelayMs(undefined, 9, -1)).toBe(DEFAULT_RETRY_DELAY_MS);
  });

  it('keeps a base delay of 0 at 0 at any attempt, never NaN', () => {
    const retry = { backoff: 'exponential', delay: 0, maxDelay: 1000 } as const;

    expect(retryDelayMs(retry, 1024)).toBe(0);
    expect(retryDelayMs(retry, 1025)).toBe(0);
    expect(retryDelayMs(retry, 100_000)).toBe(0);
    expect(retryDelayMs({ backoff: 'exponential', delay: 0 }, 5000)).toBe(0);
  });

  it('honours maxDelay: 0 as no wait', () => {
    expect(retryDelayMs({ backoff: 'exponential', delay: 1000, maxDelay: 0 }, 3)).toBe(0);
  });
});

describe('validateRetryOptions', () => {
  it('accepts no retry, no maxDelay and a finite non-negative maxDelay', () => {
    expect(() => validateRetryOptions(undefined, 'a.b')).not.toThrow();
    expect(() => validateRetryOptions({ attempts: 3 }, 'a.b')).not.toThrow();
    expect(() => validateRetryOptions({ maxDelay: 0 }, 'a.b')).not.toThrow();
    expect(() => validateRetryOptions({ maxDelay: 30_000 }, 'a.b')).not.toThrow();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses maxDelay %p, naming the subscription',
    (maxDelay) => {
      expect(() => validateRetryOptions({ maxDelay }, 'orders.created')).toThrow(
        /retry\.maxDelay.*"orders\.created"/,
      );
    },
  );

  it('refuses an untyped value that is not a number, showing its type', () => {
    expect(() => validateRetryOptions({ maxDelay: '30000' as unknown as number }, 'a.b'))
      .toThrow(/got "30000" \(string\)/);
  });
});

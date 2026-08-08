/**
 * Queue Enablement Tests
 *
 * The full truth table of the enable decision, exercised at the decision level so every
 * branch is covered without booting an application or reaching a real broker. In
 * particular this is the only place the `queue.redis`-alone leg can be proven: enabling
 * it through a live `start()` would construct a real RedisQueueAdapter.
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import type { QueueApplicationOptions } from '../types';

import {
  hasExplicitQueueAdapterConfig,
  QUEUE_DISABLED_WITH_ADAPTER_WARNING,
  resolveQueueEnablement,
} from './queue-enablement';

/** Stands in for a custom adapter class; never constructed here. */
class StubAdapterCtor {}

describe('hasExplicitQueueAdapterConfig', () => {
  it('is false when no queue options are given at all', () => {
    expect(hasExplicitQueueAdapterConfig(undefined)).toBe(false);
  });

  it('is false for an empty queue object', () => {
    expect(hasExplicitQueueAdapterConfig({})).toBe(false);
  });

  it('is false when only `enabled` is set', () => {
    expect(hasExplicitQueueAdapterConfig({ enabled: true })).toBe(false);
    expect(hasExplicitQueueAdapterConfig({ enabled: false })).toBe(false);
  });

  it('is true for a built-in adapter name', () => {
    expect(hasExplicitQueueAdapterConfig({ adapter: 'memory' })).toBe(true);
  });

  it('is true for a custom adapter constructor', () => {
    const options = { adapter: StubAdapterCtor } as unknown as QueueApplicationOptions;

    expect(hasExplicitQueueAdapterConfig(options)).toBe(true);
  });

  it('is true when only `options` is present', () => {
    const options = { options: { servers: 'nats://localhost:4222' } } as unknown as QueueApplicationOptions;

    expect(hasExplicitQueueAdapterConfig(options)).toBe(true);
  });

  it('is true when only `redis` is present', () => {
    expect(hasExplicitQueueAdapterConfig({ redis: { url: 'redis://localhost:6379' } })).toBe(true);
  });
});

describe('resolveQueueEnablement', () => {
  describe('rule 1 — queue decorators on a controller', () => {
    it('enables when handlers exist and nothing is configured', () => {
      expect(resolveQueueEnablement(undefined, true)).toEqual({
        enabled: true,
        hasAdapterConfig: false,
        contradiction: false,
      });
    });

    it('stays disabled when nothing is configured and no handlers exist', () => {
      expect(resolveQueueEnablement(undefined, false)).toEqual({
        enabled: false,
        hasAdapterConfig: false,
        contradiction: false,
      });
    });
  });

  describe('rule 2 — explicit enabled: true', () => {
    it('enables with no handlers and no backend', () => {
      expect(resolveQueueEnablement({ enabled: true }, false).enabled).toBe(true);
    });
  });

  describe('rule 3 — an explicitly configured backend', () => {
    it('enables for a built-in adapter name with no handlers', () => {
      const decision = resolveQueueEnablement({ adapter: 'memory' }, false);

      expect(decision.enabled).toBe(true);
      expect(decision.hasAdapterConfig).toBe(true);
      expect(decision.contradiction).toBe(false);
    });

    it('enables for a custom adapter constructor with no handlers', () => {
      const options = { adapter: StubAdapterCtor } as unknown as QueueApplicationOptions;

      expect(resolveQueueEnablement(options, false).enabled).toBe(true);
    });

    it('enables when only `options` is present', () => {
      const options = { options: { servers: 'nats://localhost:4222' } } as unknown as QueueApplicationOptions;

      expect(resolveQueueEnablement(options, false).enabled).toBe(true);
    });

    it('enables when only `redis` is present', () => {
      const decision = resolveQueueEnablement({ redis: { useSharedProvider: true } }, false);

      expect(decision.enabled).toBe(true);
      expect(decision.hasAdapterConfig).toBe(true);
    });
  });

  describe('the enabled: false override', () => {
    it('beats queue decorators, and reports no contradiction without a backend', () => {
      const decision = resolveQueueEnablement({ enabled: false }, true);

      expect(decision.enabled).toBe(false);
      expect(decision.contradiction).toBe(false);
    });

    it('beats a configured adapter and reports the contradiction', () => {
      const options = { enabled: false, adapter: StubAdapterCtor } as unknown as QueueApplicationOptions;
      const decision = resolveQueueEnablement(options, false);

      expect(decision.enabled).toBe(false);
      expect(decision.hasAdapterConfig).toBe(true);
      expect(decision.contradiction).toBe(true);
    });

    it('reports the contradiction even when handlers also exist', () => {
      const decision = resolveQueueEnablement({ enabled: false, redis: {} }, true);

      expect(decision.enabled).toBe(false);
      expect(decision.contradiction).toBe(true);
    });
  });

  describe('guards', () => {
    it('does not treat a bare queue object as a backend config', () => {
      // Checking `queue !== undefined` instead of the three concrete keys would flip the
      // existing `queue: { enabled: false }` case in application.test.ts.
      expect(resolveQueueEnablement({}, false).enabled).toBe(false);
    });

    it('never throws for any input', () => {
      const inputs: Array<QueueApplicationOptions | undefined> = [
        undefined,
        {},
        { enabled: true },
        { enabled: false },
        { adapter: 'memory' },
        { adapter: 'redis', enabled: false },
        { redis: {} },
      ];

      for (const input of inputs) {
        expect(() => resolveQueueEnablement(input, true)).not.toThrow();
        expect(() => resolveQueueEnablement(input, false)).not.toThrow();
      }
    });
  });
});

describe('QUEUE_DISABLED_WITH_ADAPTER_WARNING', () => {
  it('names the contradiction so the operator can act on it', () => {
    expect(QUEUE_DISABLED_WITH_ADAPTER_WARNING).toContain('queue.enabled: false');
    expect(QUEUE_DISABLED_WITH_ADAPTER_WARNING).toContain('queue.adapter');
  });
});

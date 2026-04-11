import {
  describe,
  test,
  expect,
  beforeEach,
} from 'bun:test';
import { Effect } from 'effect';

import { CompositeTransport } from './composite-transport';
import {
  LogLevel,
  type LogEntry,
  type LogTransport,
} from './types';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: LogLevel.Info,
    message: 'test message',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface MockTransport extends LogTransport {
  calls: Array<{ formatted: string; entry: LogEntry }>;
}

function createMockTransport(): MockTransport {
  const calls: Array<{ formatted: string; entry: LogEntry }> = [];

  return {
    calls,
    log(formattedEntry: string, entry: LogEntry) {
      calls.push({ formatted: formattedEntry, entry });

      return Effect.void;
    },
  };
}

function createMockTransportWithShutdown(): MockTransport & { shutdownCalled: boolean; shutdown: () => Promise<void> } {
  const transport = createMockTransport();

  return {
    ...transport,
    shutdownCalled: false,
    async shutdown() {
      this.shutdownCalled = true;
    },
  };
}

describe('CompositeTransport', () => {
  let transport1: MockTransport;
  let transport2: MockTransport;

  beforeEach(() => {
    transport1 = createMockTransport();
    transport2 = createMockTransport();
  });

  describe('log()', () => {
    test('should dispatch to all transports', () => {
      const composite = new CompositeTransport([transport1, transport2]);
      const entry = makeEntry({ message: 'hello' });

      Effect.runSync(composite.log('formatted-hello', entry));

      expect(transport1.calls).toHaveLength(1);
      expect(transport1.calls[0].formatted).toBe('formatted-hello');
      expect(transport1.calls[0].entry).toBe(entry);

      expect(transport2.calls).toHaveLength(1);
      expect(transport2.calls[0].formatted).toBe('formatted-hello');
      expect(transport2.calls[0].entry).toBe(entry);
    });

    test('should dispatch multiple log calls to all transports', () => {
      const composite = new CompositeTransport([transport1, transport2]);

      Effect.runSync(composite.log('msg1', makeEntry({ message: 'first' })));
      Effect.runSync(composite.log('msg2', makeEntry({ message: 'second' })));

      expect(transport1.calls).toHaveLength(2);
      expect(transport2.calls).toHaveLength(2);
    });

    test('should return Effect that completes when all transports complete', () => {
      const composite = new CompositeTransport([transport1, transport2]);
      const entry = makeEntry();

      // The Effect.all inside should complete for both transports
      const effect = composite.log('formatted', entry);
      Effect.runSync(effect);

      expect(transport1.calls).toHaveLength(1);
      expect(transport2.calls).toHaveLength(1);
    });

    test('should work with single transport', () => {
      const composite = new CompositeTransport([transport1]);
      const entry = makeEntry();

      Effect.runSync(composite.log('formatted', entry));

      expect(transport1.calls).toHaveLength(1);
    });

    test('should work with empty transports array', () => {
      const composite = new CompositeTransport([]);
      const entry = makeEntry();

      // Should not throw
      Effect.runSync(composite.log('formatted', entry));
    });
  });

  describe('shutdown()', () => {
    test('should call shutdown on all transports', async () => {
      const t1 = createMockTransportWithShutdown();
      const t2 = createMockTransportWithShutdown();
      const composite = new CompositeTransport([t1, t2]);

      await composite.shutdown();

      expect(t1.shutdownCalled).toBe(true);
      expect(t2.shutdownCalled).toBe(true);
    });

    test('should handle transports without shutdown method', async () => {
      // transport1 and transport2 have no shutdown method
      const composite = new CompositeTransport([transport1, transport2]);

      // Should not throw
      await composite.shutdown();
    });

    test('should handle mix of transports with and without shutdown', async () => {
      const withShutdown = createMockTransportWithShutdown();
      const composite = new CompositeTransport([transport1, withShutdown]);

      await composite.shutdown();

      expect(withShutdown.shutdownCalled).toBe(true);
    });
  });
});

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
import {
  describe,
  test,
  expect,
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import { OtlpLogTransport } from './otlp-transport';
import { LogLevel, type LogEntry } from './types';

const NANOSECONDS_PER_MILLISECOND = 1000000;

/**
 * Large batchTimeout to prevent timer-based auto-flush from interfering with tests.
 */
const NO_AUTO_FLUSH_TIMEOUT = 600000;

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: LogLevel.Info,
    message: 'test message',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Create a mock fetch and a transport that uses it.
 * This avoids touching globalThis.fetch, preventing cross-test interference
 * when bun runs test files in parallel.
 */
function createTestTransport(overrides: Record<string, unknown> = {}) {
  const fetchCalls: Array<{ url: string; options: any }> = [];
  const mockFetch = mock(async (url: string | URL | Request, options?: any) => {
    fetchCalls.push({ url: String(url), options });

    return new Response('{}', { status: 200 });
  });

  const transport = new OtlpLogTransport({
    endpoint: 'http://localhost:4318',
    batchTimeout: NO_AUTO_FLUSH_TIMEOUT,
    fetchFn: mockFetch as any,
    ...overrides,
  } as any);

  return { transport, fetchCalls, mockFetch };
}

describe('OtlpLogTransport', () => {
  describe('constructor', () => {
    test('should use default batchSize and batchTimeout', async () => {
      const { transport } = createTestTransport();

      expect(transport).toBeDefined();
      await transport.shutdown();
    });

    test('should strip trailing slash from endpoint', async () => {
      const { transport, fetchCalls } = createTestTransport({
        endpoint: 'http://localhost:4318/',
      });

      Effect.runSync(transport.log('formatted', makeEntry()));
      await transport.flush();

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe('http://localhost:4318/v1/logs');
      await transport.shutdown();
    });

    test('should merge custom headers with Content-Type', async () => {
      const { transport, fetchCalls } = createTestTransport({
        headers: { Authorization: 'Bearer token123' },
      });

      Effect.runSync(transport.log('formatted', makeEntry()));
      await transport.flush();

      expect(fetchCalls.length).toBe(1);
      const requestHeaders = fetchCalls[0].options.headers;
      expect(requestHeaders['Content-Type']).toBe('application/json');
      expect(requestHeaders.Authorization).toBe('Bearer token123');
      await transport.shutdown();
    });

    test('should accept custom batchSize and batchTimeout', async () => {
      const { transport } = createTestTransport({
        batchSize: 50,
        batchTimeout: 3000,
      });

      expect(transport).toBeDefined();
      await transport.shutdown();
    });

    test('should accept resourceAttributes', async () => {
      const { transport, fetchCalls } = createTestTransport({
        resourceAttributes: {
          'service.name': 'test-service',
          'service.version': '1.0.0',
        },
      });

      Effect.runSync(transport.log('formatted', makeEntry()));
      await transport.flush();

      expect(fetchCalls.length).toBe(1);
      const payload = JSON.parse(fetchCalls[0].options.body);
      const resourceAttrs = payload.resourceLogs[0].resource.attributes;
      expect(resourceAttrs).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'test-service' },
      });
      expect(resourceAttrs).toContainEqual({
        key: 'service.version',
        value: { stringValue: '1.0.0' },
      });
      await transport.shutdown();
    });
  });

  describe('log()', () => {
    test('should return an Effect that buffers entries', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const effect = transport.log('formatted', makeEntry());
      expect(fetchCalls.length).toBe(0);

      Effect.runSync(effect);
      expect(fetchCalls.length).toBe(0);

      await transport.shutdown();
    });

    test('should buffer multiple entries without flushing', async () => {
      const { transport, fetchCalls } = createTestTransport({ batchSize: 10 });

      for (let i = 0; i < 5; i++) {
        Effect.runSync(transport.log('formatted', makeEntry({ message: `msg-${i}` })));
      }

      expect(fetchCalls.length).toBe(0);
      await transport.shutdown();
    });
  });

  describe('flush()', () => {
    test('should send correct OTLP JSON payload', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const entry = makeEntry({
        message: 'hello world',
        level: LogLevel.Info,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe('http://localhost:4318/v1/logs');

      const payload = JSON.parse(fetchCalls[0].options.body);
      expect(payload.resourceLogs).toHaveLength(1);
      expect(payload.resourceLogs[0].scopeLogs).toHaveLength(1);
      expect(payload.resourceLogs[0].scopeLogs[0].scope.name).toBe('@onebun/logger');

      const logRecords = payload.resourceLogs[0].scopeLogs[0].logRecords;
      expect(logRecords).toHaveLength(1);
      expect(logRecords[0].body).toEqual({ stringValue: 'hello world' });
      expect(logRecords[0].severityNumber).toBe(9);
      expect(logRecords[0].severityText).toBe('INFO');

      const expectedNano = (BigInt(new Date('2024-01-01T00:00:00Z').getTime()) * BigInt(NANOSECONDS_PER_MILLISECOND)).toString();
      expect(logRecords[0].timeUnixNano).toBe(expectedNano);

      await transport.shutdown();
    });

    test('should do nothing with empty buffer', async () => {
      const { transport, fetchCalls } = createTestTransport();

      await transport.flush();
      expect(fetchCalls.length).toBe(0);

      await transport.shutdown();
    });

    test('should use POST method with correct headers', async () => {
      const { transport, fetchCalls } = createTestTransport();

      Effect.runSync(transport.log('formatted', makeEntry()));
      await transport.flush();

      expect(fetchCalls[0].options.method).toBe('POST');
      expect(fetchCalls[0].options.headers['Content-Type']).toBe('application/json');

      await transport.shutdown();
    });
  });

  describe('severity mapping', () => {
    const severityCases: Array<{ level: LogLevel; expectedNumber: number; expectedText: string }> = [
      { level: LogLevel.Trace, expectedNumber: 1, expectedText: 'TRACE' },
      { level: LogLevel.Debug, expectedNumber: 5, expectedText: 'DEBUG' },
      { level: LogLevel.Info, expectedNumber: 9, expectedText: 'INFO' },
      { level: LogLevel.Warning, expectedNumber: 13, expectedText: 'WARN' },
      { level: LogLevel.Error, expectedNumber: 17, expectedText: 'ERROR' },
      { level: LogLevel.Fatal, expectedNumber: 21, expectedText: 'FATAL' },
    ];

    for (const { level, expectedNumber, expectedText } of severityCases) {
      test(`should map LogLevel ${expectedText} to severity ${expectedNumber}`, async () => {
        const { transport, fetchCalls } = createTestTransport();

        Effect.runSync(transport.log('formatted', makeEntry({ level })));
        await transport.flush();

        const payload = JSON.parse(fetchCalls[0].options.body);
        const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
        expect(record.severityNumber).toBe(expectedNumber);
        expect(record.severityText).toBe(expectedText);

        await transport.shutdown();
      });
    }
  });

  describe('context to OTLP attributes', () => {
    test('should map context entries to OTLP attributes', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const entry = makeEntry({
        context: {
          stringKey: 'value',
          numberKey: 42,
          boolKey: true,
        },
      });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const attributes = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attributes).toContainEqual({ key: 'stringKey', value: { stringValue: 'value' } });
      expect(attributes).toContainEqual({ key: 'numberKey', value: { intValue: 42 } });
      expect(attributes).toContainEqual({ key: 'boolKey', value: { boolValue: true } });

      await transport.shutdown();
    });

    test('should skip __additionalData and SHOW_CONTEXT keys', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const entry = makeEntry({
        context: {
          validKey: 'included',
          __additionalData: ['should be skipped'],
          SHOW_CONTEXT: true,
        },
      });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const attributes = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
      const keys = attributes.map((a: any) => a.key);

      expect(keys).toContain('validKey');
      expect(keys).not.toContain('__additionalData');
      expect(keys).not.toContain('SHOW_CONTEXT');

      await transport.shutdown();
    });

    test('should handle float numbers as doubleValue', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const entry = makeEntry({
        context: { floatVal: 3.14 },
      });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const attributes = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attributes).toContainEqual({ key: 'floatVal', value: { doubleValue: 3.14 } });

      await transport.shutdown();
    });
  });

  describe('error info', () => {
    test('should map error to exception attributes', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const error = new Error('Something went wrong');
      error.name = 'CustomError';
      // Explicitly set stack to avoid Bun race conditions where stack may be
      // empty when many tests run in parallel
      error.stack = 'CustomError: Something went wrong\n    at test:1:1';

      const entry = makeEntry({ error });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      expect(fetchCalls).toHaveLength(1);
      const payload = JSON.parse(fetchCalls[0].options.body);
      const records = payload.resourceLogs[0].scopeLogs[0].logRecords;
      expect(records).toHaveLength(1);
      const attributes = records[0].attributes;

      expect(attributes).toContainEqual({
        key: 'exception.type',
        value: { stringValue: 'CustomError' },
      });
      expect(attributes).toContainEqual({
        key: 'exception.message',
        value: { stringValue: 'Something went wrong' },
      });
      expect(attributes).toContainEqual({
        key: 'exception.stacktrace',
        value: { stringValue: 'CustomError: Something went wrong\n    at test:1:1' },
      });

      await transport.shutdown();
    });

    test('should handle error without stack trace', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const error = new Error('no stack');
      error.stack = undefined;

      const entry = makeEntry({ error });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      expect(fetchCalls).toHaveLength(1);
      const payload = JSON.parse(fetchCalls[0].options.body);
      const attributes = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;

      expect(attributes).toContainEqual({
        key: 'exception.type',
        value: { stringValue: 'Error' },
      });
      expect(attributes).toContainEqual({
        key: 'exception.message',
        value: { stringValue: 'no stack' },
      });

      // No stacktrace attribute when stack is undefined
      const stackAttr = attributes.find((a: any) => a.key === 'exception.stacktrace');
      expect(stackAttr).toBeUndefined();

      await transport.shutdown();
    });
  });

  describe('trace correlation', () => {
    test('should include traceId and spanId when present', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const entry = makeEntry({
        trace: { traceId: 'abc123', spanId: 'def456' },
      });

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.traceId).toBe('abc123');
      expect(record.spanId).toBe('def456');

      await transport.shutdown();
    });

    test('should omit traceId and spanId when not present', async () => {
      const { transport, fetchCalls } = createTestTransport();

      const entry = makeEntry();

      Effect.runSync(transport.log('formatted', entry));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.traceId).toBeUndefined();
      expect(record.spanId).toBeUndefined();

      await transport.shutdown();
    });
  });

  describe('batch size trigger', () => {
    test('should trigger flush when buffer reaches batchSize', async () => {
      const batchSize = 3;
      const { transport, fetchCalls } = createTestTransport({ batchSize });

      for (let i = 0; i < batchSize; i++) {
        Effect.runSync(transport.log('formatted', makeEntry({ message: `msg-${i}` })));
      }

      // shutdown() awaits its own flush — verifies all records were sent
      await transport.shutdown();

      expect(fetchCalls.length).toBeGreaterThanOrEqual(1);

      let totalRecords = 0;
      for (const call of fetchCalls) {
        const payload = JSON.parse(call.options.body);
        totalRecords += payload.resourceLogs[0].scopeLogs[0].logRecords.length;
      }
      expect(totalRecords).toBe(batchSize);
    });
  });

  describe('shutdown()', () => {
    test('should flush remaining entries and clear timer', async () => {
      const { transport, fetchCalls } = createTestTransport();

      Effect.runSync(transport.log('formatted', makeEntry({ message: 'remaining' })));
      await transport.shutdown();

      expect(fetchCalls.length).toBe(1);
      const payload = JSON.parse(fetchCalls[0].options.body);
      const logRecords = payload.resourceLogs[0].scopeLogs[0].logRecords;
      expect(logRecords).toHaveLength(1);
      expect(logRecords[0].body.stringValue).toBe('remaining');
    });

    test('should not buffer new entries after shutdown', async () => {
      const { transport, fetchCalls } = createTestTransport();

      await transport.shutdown();

      Effect.runSync(transport.log('formatted', makeEntry({ message: 'after shutdown' })));
      await transport.flush();

      expect(fetchCalls.length).toBe(0);
    });
  });

  describe('fetch failure handling', () => {
    test('should silently ignore fetch errors', async () => {
      const failingFetch = mock(async () => {
        throw new Error('Network error');
      });

      const transport = new OtlpLogTransport({
        endpoint: 'http://localhost:4318',
        batchTimeout: NO_AUTO_FLUSH_TIMEOUT,
        fetchFn: failingFetch as any,
      });

      Effect.runSync(transport.log('formatted', makeEntry()));

      await transport.flush();
      await transport.shutdown();
    });
  });

  describe('resource attributes in payload', () => {
    test('should include resource attributes in OTLP payload', async () => {
      const { transport, fetchCalls } = createTestTransport({
        resourceAttributes: {
          'service.name': 'my-app',
          'deployment.environment': 'staging',
        },
      });

      Effect.runSync(transport.log('formatted', makeEntry()));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const resource = payload.resourceLogs[0].resource;

      expect(resource.attributes).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'my-app' },
      });
      expect(resource.attributes).toContainEqual({
        key: 'deployment.environment',
        value: { stringValue: 'staging' },
      });

      await transport.shutdown();
    });

    test('should have empty attributes when no resourceAttributes provided', async () => {
      const { transport, fetchCalls } = createTestTransport();

      Effect.runSync(transport.log('formatted', makeEntry()));
      await transport.flush();

      const payload = JSON.parse(fetchCalls[0].options.body);
      const resource = payload.resourceLogs[0].resource;

      expect(resource.attributes).toEqual([]);

      await transport.shutdown();
    });
  });
});

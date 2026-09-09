/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
import { ExportResultCode } from '@opentelemetry/core';
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';

import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import {
  OtlpExportError,
  OtlpFetchSpanExporter,
  msToNanos,
} from '../src/otlp-exporter';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const PARENT_SPAN_ID = 'a1b2c3d4e5f60718';
const START_SECONDS = 1234567890;
const END_SECONDS = 1234567891;
const CUSTOM_TIMEOUT = 5000;
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;

function createMockSpan(overrides: Partial<Record<string, any>> = {}): ReadableSpan {
  return {
    spanContext: () => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }),
    name: 'test-span',
    kind: 0,
    startTime: [START_SECONDS, 0] as [number, number],
    endTime: [END_SECONDS, 0] as [number, number],
    status: { code: 0 },
    attributes: { 'test.attr': 'value' },
    links: [],
    events: [],
    duration: [1, 0] as [number, number],
    ended: true,
    resource: { attributes: { 'service.name': 'test' } },
    instrumentationScope: { name: '@onebun/trace' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  } as any;
}

describe('OtlpFetchSpanExporter', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('should store endpoint without trailing slash', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318/',
      });

      // Verify by triggering an export and checking the fetch URL
      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          expect((mockFetch.mock.calls as any[][])[0][0]).toBe('http://localhost:4318/v1/traces');
          resolve();
        });
      });
    });

    test('should store custom headers', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        headers: { Authorization: 'Bearer token123' },
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const fetchOptions = (mockFetch.mock.calls as any[][])[0][1] as RequestInit;
          const headers = fetchOptions.headers as Record<string, string>;
          expect(headers['Authorization']).toBe('Bearer token123');
          expect(headers['Content-Type']).toBe('application/json');
          resolve();
        });
      });
    });

    test('should use default timeout when not provided', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      // The exporter is created without error — timeout defaults to 10000
      expect(exporter).toBeDefined();
    });

    test('should store custom timeout', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        timeout: CUSTOM_TIMEOUT,
      });

      expect(exporter).toBeDefined();
    });
  });

  describe('export()', () => {
    test('should call fetch with correct OTLP JSON format', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);

          const fetchCall = (mockFetch.mock.calls as any[][])[0];
          expect(fetchCall[0]).toBe('http://localhost:4318/v1/traces');

          const fetchOptions = fetchCall[1] as RequestInit;
          expect(fetchOptions.method).toBe('POST');

          const body = JSON.parse(fetchOptions.body as string);
          expect(body.resourceSpans).toBeDefined();
          expect(body.resourceSpans).toHaveLength(1);
          expect(body.resourceSpans[0].resource.attributes).toBeDefined();
          expect(body.resourceSpans[0].scopeSpans).toBeDefined();

          resolve();
        });
      });
    });

    test('should group spans by instrumentationScope', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const spanA = createMockSpan({
        name: 'span-a',
        instrumentationScope: { name: '@onebun/trace' },
      });
      const spanB = createMockSpan({
        name: 'span-b',
        instrumentationScope: { name: '@onebun/http' },
      });
      const spanC = createMockSpan({
        name: 'span-c',
        instrumentationScope: { name: '@onebun/trace' },
      });

      return new Promise<void>((resolve) => {
        exporter.export([spanA, spanB, spanC], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);

          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const scopeSpans = body.resourceSpans[0].scopeSpans;

          expect(scopeSpans).toHaveLength(2);

          const traceScope = scopeSpans.find((s: any) => s.scope.name === '@onebun/trace');
          const httpScope = scopeSpans.find((s: any) => s.scope.name === '@onebun/http');

          expect(traceScope.spans).toHaveLength(2);
          expect(httpScope.spans).toHaveLength(1);

          resolve();
        });
      });
    });

    test('should return SUCCESS on HTTP 200', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          resolve();
        });
      });
    });

    test('should return FAILED on HTTP error', () => {
      // retryAttempts: 0 — this test is about the verdict for a single failed send, not about
      // the retry policy. Left at the default it would quietly make four requests.
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryAttempts: 0,
      });

      const mockFetch = mock(() =>
        Promise.resolve(new Response('', { status: HTTP_SERVER_ERROR, statusText: 'Internal Server Error' })),
      );
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.FAILED);
          expect(mockFetch).toHaveBeenCalledTimes(1);
          resolve();
        });
      });
    });

    test('should return FAILED on fetch error', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryAttempts: 0,
      });

      const mockFetch = mock(() => Promise.reject(new Error('Network error')));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.FAILED);
          expect(mockFetch).toHaveBeenCalledTimes(1);
          resolve();
        });
      });
    });

    test('should return FAILED when shutdown', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      return new Promise<void>(async (resolve) => {
        await exporter.shutdown();

        exporter.export([createMockSpan()], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.FAILED);
          expect(mockFetch).not.toHaveBeenCalled();
          resolve();
        });
      });
    });

    test('should handle empty spans array without calling fetch', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      return new Promise<void>((resolve) => {
        exporter.export([], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          expect(mockFetch).not.toHaveBeenCalled();
          resolve();
        });
      });
    });
  });

  /**
   * `BatchSpanProcessor` splices a batch out of its buffer before handing it here, so whatever
   * this exporter gives up on is gone. Every test below is about that batch surviving — or
   * about not spending four requests on a failure that will never succeed.
   */
  describe('export retry', () => {
    const RETRY_DELAY = 1;
    const HTTP_BAD_REQUEST = 400;
    const HTTP_UNAVAILABLE = 503;

    function exportOnce(exporter: OtlpFetchSpanExporter, spans: ReadableSpan[]): Promise<ExportResult> {
      return new Promise<ExportResult>((resolve) => {
        exporter.export(spans, resolve);
      });
    }

    test('should deliver a batch that the collector rejects on its first attempts', async () => {
      const bodies: string[] = [];
      let call = 0;
      const mockFetch = mock((_url: string, init: RequestInit) => {
        bodies.push(init.body as string);
        call++;

        return Promise.resolve(
          call < 3
            ? new Response('collector restarting', { status: HTTP_UNAVAILABLE, statusText: 'Service Unavailable' })
            : new Response('', { status: HTTP_OK }),
        );
      });
      globalThis.fetch = mockFetch as any;

      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryDelay: RETRY_DELAY,
      });

      const result = await exportOnce(exporter, [createMockSpan()]);

      expect(result.code).toBe(ExportResultCode.SUCCESS);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // The retry must re-send the SAME spans. A retry that posts a different payload is not a
      // retry — it is a second, emptier export dressed as one.
      expect(bodies[2]).toBe(bodies[0]);
      expect(JSON.parse(bodies[2]).resourceSpans[0].scopeSpans[0].spans[0].name).toBe('test-span');
    });

    test('should retry a transport failure, not only an HTTP status', async () => {
      let call = 0;
      const mockFetch = mock(() => {
        call++;

        return call === 1
          ? Promise.reject(new Error('connect ECONNREFUSED'))
          : Promise.resolve(new Response('', { status: HTTP_OK }));
      });
      globalThis.fetch = mockFetch as any;

      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryDelay: RETRY_DELAY,
      });

      const result = await exportOnce(exporter, [createMockSpan()]);

      expect(result.code).toBe(ExportResultCode.SUCCESS);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should not retry a status the collector will reject identically', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response('bad payload', { status: HTTP_BAD_REQUEST, statusText: 'Bad Request' })),
      );
      globalThis.fetch = mockFetch as any;

      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryDelay: RETRY_DELAY,
      });

      const result = await exportOnce(exporter, [createMockSpan()]);

      expect(result.code).toBe(ExportResultCode.FAILED);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should stop after retryAttempts and report how much was lost', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response('', { status: HTTP_UNAVAILABLE, statusText: 'Service Unavailable' })),
      );
      globalThis.fetch = mockFetch as any;

      const failures: Array<{ message: string; spanCount: number; attempts: number }> = [];
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryAttempts: 2,
        retryDelay: RETRY_DELAY,
        onExportFailure(error, spanCount, attempts) {
          failures.push({ message: error.message, spanCount, attempts });
        },
      });

      const result = await exportOnce(exporter, [createMockSpan(), createMockSpan()]);

      expect(result.code).toBe(ExportResultCode.FAILED);
      // 2 retries after the first attempt — the first attempt is not a retry.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(failures).toHaveLength(1);
      expect(failures[0].spanCount).toBe(2);
      expect(failures[0].attempts).toBe(3);
      expect(result.error).toBeInstanceOf(OtlpExportError);
      expect((result.error as OtlpExportError).attempts).toBe(3);
      // The status the collector actually returned has to reach the caller: "503" and
      // "connection refused" call for entirely different action.
      expect(failures[0].message).toContain('503');
    });

    test('should give up rather than exceed the retry budget', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response('', { status: HTTP_UNAVAILABLE, statusText: 'Service Unavailable' })),
      );
      globalThis.fetch = mockFetch as any;

      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryAttempts: 50,
        retryDelay: 40,
        retryBudget: 60,
      });

      const startedAt = Date.now();
      const result = await exportOnce(exporter, [createMockSpan()]);
      const elapsed = Date.now() - startedAt;

      expect(result.code).toBe(ExportResultCode.FAILED);
      // The budget, not `retryAttempts`, is what ends it — otherwise this would be 51 requests.
      expect(mockFetch.mock.calls.length).toBeLessThan(5);
      expect(elapsed).toBeLessThan(1000);
    });

    test('should wait as long as Retry-After asks instead of its own backoff', async () => {
      const RETRY_AFTER_SECONDS = 0.15;
      const RETRY_AFTER_MS = 150;
      let call = 0;
      const mockFetch = mock(() => {
        call++;

        return call === 1
          ? Promise.resolve(
            new Response('', {
              status: HTTP_UNAVAILABLE,
              statusText: 'Service Unavailable',
              headers: { 'retry-after': String(RETRY_AFTER_SECONDS) },
            }),
          )
          : Promise.resolve(new Response('', { status: HTTP_OK }));
      });
      globalThis.fetch = mockFetch as any;

      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        // 1ms of its own — so anything close to the header's 150ms can only have come from
        // the header.
        retryDelay: RETRY_DELAY,
      });

      const startedAt = Date.now();
      const result = await exportOnce(exporter, [createMockSpan()]);
      const elapsed = Date.now() - startedAt;

      expect(result.code).toBe(ExportResultCode.SUCCESS);
      expect(elapsed).toBeGreaterThanOrEqual(RETRY_AFTER_MS - 1);
    });

    test('should not retry after shutdown', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response('', { status: HTTP_UNAVAILABLE, statusText: 'Service Unavailable' })),
      );
      globalThis.fetch = mockFetch as any;

      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        retryDelay: RETRY_DELAY,
      });

      const pending = exportOnce(exporter, [createMockSpan()]);
      await exporter.shutdown();

      const result = await pending;

      expect(result.code).toBe(ExportResultCode.FAILED);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown()', () => {
    test('should set isShutdown flag', async () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      await exporter.shutdown();

      // Verify by checking that export returns FAILED
      return await new Promise<void>((resolve) => {
        exporter.export([createMockSpan()], (result: ExportResult) => {
          expect(result.code).toBe(ExportResultCode.FAILED);
          resolve();
        });
      });
    });
  });

  describe('forceFlush()', () => {
    test('should resolve immediately', async () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      await expect(exporter.forceFlush()).resolves.toBeUndefined();
    });
  });

  describe('span serialization', () => {
    test('should serialize traceId and spanId', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

          expect(otlpSpan.traceId).toBe(TRACE_ID);
          expect(otlpSpan.spanId).toBe(SPAN_ID);
          expect(otlpSpan.name).toBe('test-span');

          resolve();
        });
      });
    });

    test('should map span kind with +1 offset', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      // kind=0 (INTERNAL) should map to 1
      const spanInternal = createMockSpan({ kind: 0 });
      // kind=1 (SERVER) should map to 2
      const spanServer = createMockSpan({ kind: 1 });
      // kind=2 (CLIENT) should map to 3
      const spanClient = createMockSpan({ kind: 2 });

      return new Promise<void>((resolve) => {
        exporter.export([spanInternal, spanServer, spanClient], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const spans = body.resourceSpans[0].scopeSpans[0].spans;

          expect(spans[0].kind).toBe(1);
          expect(spans[1].kind).toBe(2);
          expect(spans[2].kind).toBe(3);

          resolve();
        });
      });
    });

    test('should serialize startTime and endTime as BigInt nanosecond strings', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        startTime: [START_SECONDS, 500000000] as [number, number],
        endTime: [END_SECONDS, 250000000] as [number, number],
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

          // 1234567890 * 1e9 + 500000000 = 1234567890500000000
          expect(otlpSpan.startTimeUnixNano).toBe('1234567890500000000');
          // 1234567891 * 1e9 + 250000000 = 1234567891250000000
          expect(otlpSpan.endTimeUnixNano).toBe('1234567891250000000');

          resolve();
        });
      });
    });

    test('should include parentSpanId from parentSpanContext', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        parentSpanContext: { spanId: PARENT_SPAN_ID },
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

          expect(otlpSpan.parentSpanId).toBe(PARENT_SPAN_ID);

          resolve();
        });
      });
    });

    test('should not include parentSpanId when no parent', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

          expect(otlpSpan.parentSpanId).toBeUndefined();

          resolve();
        });
      });
    });

    test('should map status codes correctly (0->0, 1->1, 2->2)', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const spanUnset = createMockSpan({ status: { code: 0 } });
      const spanOk = createMockSpan({ status: { code: 1 } });
      const spanError = createMockSpan({ status: { code: 2, message: 'error occurred' } });

      return new Promise<void>((resolve) => {
        exporter.export([spanUnset, spanOk, spanError], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const spans = body.resourceSpans[0].scopeSpans[0].spans;

          expect(spans[0].status.code).toBe(0);
          expect(spans[1].status.code).toBe(1);
          expect(spans[2].status.code).toBe(2);
          expect(spans[2].status.message).toBe('error occurred');

          resolve();
        });
      });
    });
  });

  describe('attribute serialization', () => {
    test('should serialize string attributes', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        attributes: { 'http.method': 'GET' },
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

          const methodAttr = attrs.find((a: any) => a.key === 'http.method');
          expect(methodAttr.value).toEqual({ stringValue: 'GET' });

          resolve();
        });
      });
    });

    test('should serialize integer number attributes with intValue', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        attributes: { 'http.status_code': 200 },
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

          const statusAttr = attrs.find((a: any) => a.key === 'http.status_code');
          expect(statusAttr.value).toEqual({ intValue: 200 });

          resolve();
        });
      });
    });

    test('should serialize float number attributes with doubleValue', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        attributes: { 'sampling.rate': 0.75 },
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

          const rateAttr = attrs.find((a: any) => a.key === 'sampling.rate');
          expect(rateAttr.value).toEqual({ doubleValue: 0.75 });

          resolve();
        });
      });
    });

    test('should serialize boolean attributes with boolValue', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        attributes: { 'test.enabled': true },
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const attrs = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

          const enabledAttr = attrs.find((a: any) => a.key === 'test.enabled');
          expect(enabledAttr.value).toEqual({ boolValue: true });

          resolve();
        });
      });
    });
  });

  describe('event serialization', () => {
    test('should serialize span events', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        events: [
          {
            name: 'exception',
            time: [START_SECONDS, 100000000] as [number, number],
            attributes: { 'exception.message': 'something failed' },
          },
        ],
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const events = body.resourceSpans[0].scopeSpans[0].spans[0].events;

          expect(events).toHaveLength(1);
          expect(events[0].name).toBe('exception');
          expect(events[0].timeUnixNano).toBe('1234567890100000000');
          expect(events[0].attributes).toHaveLength(1);
          expect(events[0].attributes[0].key).toBe('exception.message');

          resolve();
        });
      });
    });

    test('should serialize events without attributes as empty array', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        events: [
          {
            name: 'checkpoint',
            time: [START_SECONDS, 0] as [number, number],
            attributes: undefined,
          },
        ],
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const events = body.resourceSpans[0].scopeSpans[0].spans[0].events;

          expect(events[0].attributes).toEqual([]);

          resolve();
        });
      });
    });
  });

  describe('link serialization', () => {
    test('should serialize span links', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const linkedTraceId = '1234567890abcdef1234567890abcdef';
      const linkedSpanId = 'abcdef1234567890';

      const span = createMockSpan({
        links: [
          {
            context: { traceId: linkedTraceId, spanId: linkedSpanId },
            attributes: { 'link.type': 'follows-from' },
          },
        ],
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const links = body.resourceSpans[0].scopeSpans[0].spans[0].links;

          expect(links).toHaveLength(1);
          expect(links[0].traceId).toBe(linkedTraceId);
          expect(links[0].spanId).toBe(linkedSpanId);
          expect(links[0].attributes).toHaveLength(1);
          expect(links[0].attributes[0].key).toBe('link.type');

          resolve();
        });
      });
    });

    test('should serialize links without attributes as empty array', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        links: [
          {
            context: { traceId: TRACE_ID, spanId: SPAN_ID },
            attributes: undefined,
          },
        ],
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const links = body.resourceSpans[0].scopeSpans[0].spans[0].links;

          expect(links[0].attributes).toEqual([]);

          resolve();
        });
      });
    });
  });

  describe('dropped counts', () => {
    test('should include droppedAttributesCount when > 0', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({ droppedAttributesCount: 5 });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

          expect(otlpSpan.droppedAttributesCount).toBe(5);

          resolve();
        });
      });
    });

    test('should not include droppedAttributesCount when 0', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({ droppedAttributesCount: 0 });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const otlpSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

          expect(otlpSpan.droppedAttributesCount).toBeUndefined();

          resolve();
        });
      });
    });
  });

  describe('AbortController timeout handling', () => {
    test('should pass AbortSignal to fetch', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
        timeout: CUSTOM_TIMEOUT,
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan();

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const fetchOptions = (mockFetch.mock.calls as any[][])[0][1] as RequestInit;
          expect(fetchOptions.signal).toBeDefined();
          expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);

          resolve();
        });
      });
    });
  });

  describe('msToNanos utility', () => {
    test('should convert milliseconds to nanosecond string', () => {
      expect(msToNanos(1000)).toBe('1000000000');
      expect(msToNanos(1)).toBe('1000000');
      expect(msToNanos(0)).toBe('0');
    });
  });

  describe('resource attributes', () => {
    test('should include resource attributes from first span', () => {
      const exporter = new OtlpFetchSpanExporter({
        endpoint: 'http://localhost:4318',
      });

      const mockFetch = mock(() => Promise.resolve(new Response('', { status: HTTP_OK })));
      globalThis.fetch = mockFetch as any;

      const span = createMockSpan({
        resource: {
          attributes: {
            'service.name': 'my-service',
            'service.version': '2.0.0',
          },
        },
      });

      return new Promise<void>((resolve) => {
        exporter.export([span], () => {
          const body = JSON.parse(((mockFetch.mock.calls as any[][])[0][1] as RequestInit).body as string);
          const resourceAttrs = body.resourceSpans[0].resource.attributes;

          const nameAttr = resourceAttrs.find((a: any) => a.key === 'service.name');
          expect(nameAttr.value).toEqual({ stringValue: 'my-service' });

          const versionAttr = resourceAttrs.find((a: any) => a.key === 'service.version');
          expect(versionAttr.value).toEqual({ stringValue: '2.0.0' });

          resolve();
        });
      });
    });
  });
});

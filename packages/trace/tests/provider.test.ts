/* eslint-disable @typescript-eslint/naming-convention */
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  describe,
  test,
  expect,
  afterEach,
  beforeEach,
  spyOn,
} from 'bun:test';

import { initTracerProvider, installedTracerProvider } from '../src/provider';

const ZERO_TRACE_ID = '00000000000000000000000000000000';

describe('initTracerProvider', () => {
  afterEach(async () => {
    // Always clean up global tracer provider state
    trace.disable();
  });

  describe('provider creation', () => {
    test('should create a provider and register it globally', async () => {
      const result = initTracerProvider({
        serviceName: 'test-service',
      });

      try {
        expect(result.provider).toBeDefined();

        // Verify the provider is registered globally
        const tracer = trace.getTracer('test');
        expect(tracer).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });

    test('should return a shutdown function', async () => {
      const result = initTracerProvider({
        serviceName: 'test-service',
      });

      try {
        expect(typeof result.shutdown).toBe('function');
      } finally {
        await result.shutdown();
      }
    });
  });

  describe('without endpoint', () => {
    test('should create provider without exporter', async () => {
      const result = initTracerProvider({
        serviceName: 'no-export-service',
      });

      try {
        expect(result.provider).toBeDefined();

        // Provider should still work — it just won't export spans
        const tracer = trace.getTracer('test');
        expect(tracer).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });

    test('should create provider with empty exportOptions', async () => {
      const result = initTracerProvider({
        serviceName: 'no-export-service',
        exportOptions: {},
      });

      try {
        expect(result.provider).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });
  });

  describe('with endpoint', () => {
    test('should create provider with exporter and batch processor', async () => {
      const result = initTracerProvider({
        serviceName: 'export-service',
        exportOptions: {
          endpoint: 'http://localhost:4318',
        },
      });

      try {
        expect(result.provider).toBeDefined();

        // The tracer should be active
        const tracer = trace.getTracer('test');
        expect(tracer).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });

    test('should pass custom headers and timeout to exporter', async () => {
      const result = initTracerProvider({
        serviceName: 'custom-export-service',
        exportOptions: {
          endpoint: 'http://collector:4318',
          headers: { Authorization: 'Bearer test-token' },
          timeout: 5000,
          batchSize: 50,
          batchTimeout: 2000,
        },
      });

      try {
        expect(result.provider).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });
  });

  describe('shutdown()', () => {
    test('unregisters the global once the last provider it owns is gone', async () => {
      const result = initTracerProvider({
        serviceName: 'shutdown-test',
      });

      // Register is working
      const tracerBefore = trace.getTracer('test');
      expect(tracerBefore).toBeDefined();

      await result.shutdown();

      // The safety property, and the only one a shared process can promise: a provider that
      // has been shut down is never left installed. Whether the slot then holds a Noop or
      // another live provider depends on what else in the process is running, and the old
      // assertion — `expect(tracer).toBeDefined()` — held for every behaviour, so it could not
      // tell them apart at all.
      expect(installedTracerProvider()).not.toBe(result.provider);
    });

    test('releases the slot even when it acquired it after someone else disabled the global', async () => {
      // The stale-owner case. `trace.disable()` clears the OpenTelemetry slot but not this
      // module's memory of who owned it, so the next successful registration must overwrite
      // that memory. Requiring the remembered owner to be `null` first left this provider
      // installed but unowned, and its shutdown then declined to release it.
      trace.disable();

      const result = initTracerProvider({ serviceName: 'solo-shutdown-test' });
      expect(installedTracerProvider()).toBe(result.provider);

      await result.shutdown();

      expect(installedTracerProvider()).not.toBe(result.provider);
    });

    test('should not throw when called multiple times', async () => {
      const result = initTracerProvider({
        serviceName: 'multi-shutdown',
      });

      await result.shutdown();
      await expect(result.shutdown()).resolves.toBeUndefined();
    });
  });

  /**
   * The processors passed in `spanProcessors` belong to the caller, who may hand the same ones to
   * the next provider — an application retrying a failed start does exactly that. A plain
   * `shutdown()` shuts them down with the provider, and the next provider then recorded into a
   * processor that dropped every span.
   */
  describe('shutdown({ spanProcessors: \'flush\' })', () => {
    /** A processor that counts what it was asked to do and records the names of ended spans. */
    function countingProcessor(): { processor: SpanProcessor; ended: string[]; flushed: number[]; shutdown: number[] } {
      const ended: string[] = [];
      const flushed: number[] = [];
      const shutdown: number[] = [];
      const processor: SpanProcessor = {
        onStart(): void {
          // Nothing to do on start
        },
        onEnd(span: ReadableSpan): void {
          ended.push(span.name);
        },
        async forceFlush(): Promise<void> {
          flushed.push(1);
        },
        async shutdown(): Promise<void> {
          shutdown.push(1);
        },
      };

      return {
        processor, ended, flushed, shutdown,
      };
    }

    test('flushes the caller\'s processors and leaves them running for the next provider', async () => {
      const counting = countingProcessor();
      const first = initTracerProvider({ serviceName: 'attempt-1', spanProcessors: [counting.processor] });

      await first.shutdown({ spanProcessors: 'flush' });

      expect(counting.flushed.length).toBe(1);
      expect(counting.shutdown.length).toBe(0);
      // The global slot is handed back all the same
      expect(installedTracerProvider()).not.toBe(first.provider);

      const second = initTracerProvider({ serviceName: 'attempt-2', spanProcessors: [counting.processor] });
      second.provider.getTracer('test').startSpan('recorded-by-the-next-provider').end();
      expect(counting.ended).toEqual(['recorded-by-the-next-provider']);

      await second.shutdown();
      // Without the option, a shutdown still shuts them down, as OpenTelemetry does
      expect(counting.shutdown.length).toBe(1);
    });

    /**
     * An application's `stop()` after a failed start() is the caller done with this provider.
     * It used to return early on the idempotence flag, so a processor that holds a handle until its
     * `shutdown()` kept the process alive where that `stop()` had always shut it down.
     */
    test('a later plain shutdown() shuts down what the flush left running, and nothing else', async () => {
      const counting = countingProcessor();
      const first = initTracerProvider({ serviceName: 'failed-start', spanProcessors: [counting.processor] });

      await first.shutdown({ spanProcessors: 'flush' });
      // A repeated flush is the no-op every repeated shutdown is
      await first.shutdown({ spanProcessors: 'flush' });
      expect(counting.shutdown.length).toBe(0);

      // Built after the first let go of the global slot: a second pass must not move the slot,
      // whoever holds it — another file's provider may, in a full run
      const next = initTracerProvider({ serviceName: 'next' });
      const installed = installedTracerProvider();
      const releaseAgain = spyOn(trace, 'disable');

      try {
        await first.shutdown();
        await first.shutdown();

        expect(counting.flushed.length).toBe(1);
        expect(counting.shutdown.length).toBe(1);
        expect(releaseAgain).not.toHaveBeenCalled();
        expect(installedTracerProvider()).toBe(installed);
      } finally {
        releaseAgain.mockRestore();
        await next.shutdown();
      }
    });

    test('still shuts down the export pipeline built from exportOptions', async () => {
      const counting = countingProcessor();
      const batchShutdown = spyOn(BatchSpanProcessor.prototype, 'shutdown');

      try {
        const result = initTracerProvider({
          serviceName: 'with-export',
          spanProcessors: [counting.processor],
          exportOptions: { endpoint: 'http://127.0.0.1:1', batchTimeout: 60_000 },
        });

        await result.shutdown({ spanProcessors: 'flush' });

        expect(batchShutdown).toHaveBeenCalledTimes(1);
        expect(counting.shutdown.length).toBe(0);
      } finally {
        batchShutdown.mockRestore();
      }
    });
  });

  describe('resource configuration', () => {
    test('should use provided service name and version', async () => {
      const result = initTracerProvider({
        serviceName: 'my-custom-service',
        serviceVersion: '3.2.1',
      });

      try {
        expect(result.provider).toBeDefined();
        // Resource is set on the provider — we verify it was created without error
      } finally {
        await result.shutdown();
      }
    });

    test('should use default service name when not provided', async () => {
      const result = initTracerProvider({});

      try {
        expect(result.provider).toBeDefined();
        // Default: serviceName='onebun-service', serviceVersion='1.0.0'
      } finally {
        await result.shutdown();
      }
    });

    test('should use default service version when not provided', async () => {
      const result = initTracerProvider({
        serviceName: 'test-service',
      });

      try {
        expect(result.provider).toBeDefined();
        // Default serviceVersion='1.0.0'
      } finally {
        await result.shutdown();
      }
    });
  });
});

/**
 * Teardown against the PROCESS-GLOBAL OpenTelemetry slot.
 *
 * `trace.disable()` runs before and after each case: the global is one shared slot, and a
 * registration left behind would be visible to every later file in the run. Ownership inside
 * the module is re-derived from what is actually installed, so clearing the slot is enough.
 */
describe('initTracerProvider teardown ownership', () => {
  beforeEach(() => {
    trace.disable();
  });

  afterEach(() => {
    trace.disable();
  });

  /** Resolve a tracer from scratch and report what the global currently yields. */
  function probeFreshTracer(): { recording: boolean; traceId: string } {
    const span = trace.getTracer('probe').startSpan('probe-span');
    const result = {
      recording: span.isRecording(),
      traceId: span.spanContext().traceId,
    };
    span.end();

    return result;
  }

  test('leaves a foreign provider installed when it did not own the global', async () => {
    // A user who wired their own OpenTelemetry SDK before starting a OneBun application. Our
    // registration is refused as a duplicate, so shutdown has no business unregistering theirs
    // — and it used to, with a bare `trace.disable()`.
    const foreign = new BasicTracerProvider({});
    expect(trace.setGlobalTracerProvider(foreign)).toBe(true);

    const ours = initTracerProvider({ serviceName: 'guest' });
    await ours.shutdown();

    const probe = probeFreshTracer();

    expect(probe.recording).toBe(true);
    expect(probe.traceId).not.toBe(ZERO_TRACE_ID);

    await foreign.shutdown();
  });

  test('hands the global to a surviving provider when the owner stops', async () => {
    // Two applications in one process. The first installs the global; the second's
    // registration is refused. Stopping the first used to zero tracing for the second.
    const first = initTracerProvider({ serviceName: 'app-a' });
    const second = initTracerProvider({ serviceName: 'app-b' });

    await first.shutdown();

    const probe = probeFreshTracer();

    expect(probe.recording).toBe(true);
    expect(probe.traceId).not.toBe(ZERO_TRACE_ID);

    await second.shutdown();
  });

  test('stopping the non-owner first does not move the global', async () => {
    const first = initTracerProvider({ serviceName: 'app-a' });
    const second = initTracerProvider({ serviceName: 'app-b' });

    await second.shutdown();
    expect(probeFreshTracer().recording).toBe(true);
    // The owner is untouched by a guest leaving.
    expect(installedTracerProvider()).toBe(first.provider);

    await first.shutdown();
    expect(installedTracerProvider()).not.toBe(first.provider);
  });

  test('is idempotent, so a second stop does not disturb a live neighbour', async () => {
    // `app.stop()` is reachable more than once. A second pass must not re-enter the handover
    // and move the global on behalf of a provider that is already gone.
    const first = initTracerProvider({ serviceName: 'app-a' });
    const second = initTracerProvider({ serviceName: 'app-b' });

    await first.shutdown();
    await first.shutdown();

    expect(probeFreshTracer().recording).toBe(true);

    await second.shutdown();
  });

  test('does not tear out a registration that changed hands underneath it', async () => {
    // Ownership is re-checked against what is actually installed. Someone else calling
    // `trace.disable()` and registering their own provider must not have it removed by a
    // OneBun shutdown that still remembers owning the slot.
    const ours = initTracerProvider({ serviceName: 'app-a' });

    trace.disable();
    const foreign = new BasicTracerProvider({});
    expect(trace.setGlobalTracerProvider(foreign)).toBe(true);

    await ours.shutdown();

    expect(probeFreshTracer().recording).toBe(true);

    await foreign.shutdown();
  });
});

describe('sampling', () => {
  afterEach(() => {
    trace.disable();
  });

  /** What the provider decides, read from the span it produces. */
  function recordsSpans(samplingRate?: number): boolean {
    const result = initTracerProvider({ serviceName: 'sampling-probe', samplingRate });
    const span = result.provider.getTracer('probe').startSpan('s');
    const recording = span.isRecording();
    span.end();

    return recording;
  }

  test('samplingRate reaches the decision about what is exported', () => {
    // It used to set a traceFlags bit on OneBun's own record and nothing more, while the provider
    // sampled everything. That was invisible only because no span was ever exported — the moment
    // export works, a documented `samplingRate: 0.1` would ship ten times what was asked for.
    expect(recordsSpans(0)).toBe(false);
    expect(recordsSpans(1)).toBe(true);
  });

  test('defaults to recording everything when no rate is configured', () => {
    // The existing teardown tests build providers without a rate and assert `isRecording()`, so
    // the default has to stay always-on.
    expect(recordsSpans(undefined)).toBe(true);
  });
});

/**
 * `BatchSpanProcessor` splices a batch out of its buffer before handing it to the exporter, so a
 * batch given up on is gone — there is no queue it goes back to. These two tests are the whole
 * argument for retrying at all, and for stopping.
 */
describe('export retry through the provider', () => {
  const RETRY_DELAY = 5;
  const HTTP_UNAVAILABLE = 503;
  const FAILING_ATTEMPTS = 2;
  const SPANS_IN_BATCH = 20;

  afterEach(() => {
    trace.disable();
  });

  test('a span survives a collector that is unavailable for its first attempts', async () => {
    const received: string[] = [];
    let attempts = 0;

    const collector = Bun.serve({
      port: 0,
      async fetch(request) {
        attempts++;
        const body = await request.text();

        if (attempts <= FAILING_ATTEMPTS) {
          return new Response('collector restarting', { status: HTTP_UNAVAILABLE });
        }

        received.push(body);

        return new Response('{}');
      },
    });

    const result = initTracerProvider({
      serviceName: 'retry-probe',
      exportOptions: {
        endpoint: `http://localhost:${collector.port}`,
        retryDelay: RETRY_DELAY,
      },
    });

    try {
      const span = result.provider.getTracer('probe').startSpan('survives-the-restart');
      span.end();

      await result.provider.forceFlush();

      expect(attempts).toBe(FAILING_ATTEMPTS + 1);
      expect(received).toHaveLength(1);
      // The span itself, not merely a third request: a retry that posts an empty batch would
      // satisfy the attempt count and deliver nothing.
      expect(received[0]).toContain('survives-the-restart');
    } finally {
      await result.shutdown();
      collector.stop(true);
    }
  });

  test('a permanently dead collector costs a bounded number of attempts and no overlapping sends', async () => {
    let posts = 0;
    let inFlight = 0;
    let maxInFlight = 0;

    const collector = Bun.serve({
      port: 0,
      async fetch() {
        posts++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Bun.sleep(RETRY_DELAY);
        inFlight--;

        return new Response('down', { status: HTTP_UNAVAILABLE });
      },
    });

    const result = initTracerProvider({
      serviceName: 'dead-collector-probe',
      exportOptions: {
        endpoint: `http://localhost:${collector.port}`,
        retryAttempts: FAILING_ATTEMPTS,
        retryDelay: RETRY_DELAY,
      },
    });

    try {
      const tracer = result.provider.getTracer('probe');
      for (let i = 0; i < SPANS_IN_BATCH; i++) {
        tracer.startSpan(`span-${i}`).end();
      }

      await result.provider.forceFlush().catch(() => undefined);

      // Retries do not multiply into a resend loop: one batch, `retryAttempts` retries, done.
      expect(posts).toBe(FAILING_ATTEMPTS + 1);
      // And they never overlap — a retry holds the one batch it is retrying, so a collector
      // that stays down cannot accumulate concurrent in-flight copies of the backlog.
      expect(maxInFlight).toBe(1);
    } finally {
      await result.shutdown();
      collector.stop(true);
    }
  });
});

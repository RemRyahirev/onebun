import { trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import type { TraceOptions } from './types.js';

import { OtlpFetchSpanExporter } from './otlp-exporter.js';

/**
 * Result of TracerProvider initialization
 */
export interface TracerProviderResult {
  /**
   * The initialized BasicTracerProvider
   */
  provider: BasicTracerProvider;

  /**
   * Shutdown function that flushes pending spans and shuts down the provider
   */
  shutdown: () => Promise<void>;
}

/**
 * The provider THIS package installed as the OpenTelemetry global, if any.
 *
 * `trace.setGlobalTracerProvider()` refuses a duplicate registration and returns `false`, so
 * in a process that already has a tracer provider — a user's own SDK, or an earlier OneBun
 * application — ours is never installed. Recording which one we own is what lets shutdown tell
 * "tear down the global I put there" apart from "tear down someone else's".
 */
let globalOwner: BasicTracerProvider | null = null;

/**
 * The provider currently behind the OpenTelemetry global, or the proxy itself when none is set.
 *
 * `trace.getTracerProvider()` hands back a `ProxyTracerProvider` wrapper rather than the
 * registered instance, so identity has to be read through its delegate. `getDelegate()` is a
 * public method on the exported class, not a reach into internals.
 *
 * Exported because "is MY provider still the installed one?" is the only question that can be
 * answered about a single shared slot in a process where anyone may register their own.
 *
 * @see docs:api/trace.md
 */
export function installedTracerProvider(): unknown {
  const current = trace.getTracerProvider() as { getDelegate?: () => unknown };

  return current.getDelegate === undefined ? current : current.getDelegate();
}

/**
 * Every provider this package has created and not yet shut down.
 *
 * Needed because the global is a single slot shared by the whole process: when the owner goes
 * away, the question is not whether to unregister but whether anyone is left to hand it to.
 */
const liveProviders = new Set<BasicTracerProvider>();

/**
 * Release the process-global registration on behalf of `provider`.
 *
 * The rule, and the reason this function exists rather than a bare `trace.disable()`:
 *
 * `trace.disable()` is a PROCESS-GLOBAL de-registration. It replaces the installed provider
 * with a fresh `ProxyTracerProvider`, so every later `trace.getTracer(...)` yields a
 * non-recording tracer whose spans carry an all-zero trace id. Nothing about it is scoped to
 * the provider being shut down. Calling it unconditionally meant one application's `stop()`
 * silently zeroed tracing for every other application in the process — and tore out a user's
 * own registered SDK, which OneBun had never installed and had no business removing.
 *
 * So there are three cases, and only the last one disables anything:
 *
 * - We never owned the global (a user's SDK, or another application, got there first): touch
 *   nothing. This is the case that used to destroy a foreign SDK.
 * - We own it and another of our providers is still live: hand the global over to that one.
 *   `setGlobalTracerProvider` refuses a duplicate, so the handover is `disable()` immediately
 *   followed by the re-registration — the slot is empty only within this synchronous block.
 * - We own it and nothing is left: disable, because the alternative is leaving a shut-down
 *   provider installed, which accepts spans and drops them without a word.
 */
function releaseGlobal(provider: BasicTracerProvider): void {
  // Ownership is confirmed against what is ACTUALLY installed, not only against what we
  // remember installing. Anyone can call `trace.disable()` or register their own provider at
  // any time — another library, a test file, the application itself — and a stale `globalOwner`
  // would then have us tear out a registration we no longer hold.
  if (globalOwner !== provider || installedTracerProvider() !== provider) {
    globalOwner = globalOwner === provider ? null : globalOwner;

    return;
  }

  const successor = [...liveProviders][0];

  if (successor === undefined) {
    trace.disable();
    globalOwner = null;

    return;
  }

  trace.disable();
  trace.setGlobalTracerProvider(successor);
  globalOwner = successor;
}

/**
 * Initialize and register a global TracerProvider.
 *
 * When `exportOptions.endpoint` is configured, creates a BatchSpanProcessor
 * with a custom fetch-based OTLP exporter for Bun compatibility.
 *
 * @param options - Trace configuration options
 * @returns Provider instance and shutdown function
 *
 * @see docs:api/trace.md
 */
export function initTracerProvider(options: TraceOptions): TracerProviderResult {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName ?? 'onebun-service',
    [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '1.0.0',
  });

  const spanProcessors = [];

  if (options.exportOptions?.endpoint) {
    const exporter = new OtlpFetchSpanExporter({
      endpoint: options.exportOptions.endpoint,
      headers: options.exportOptions.headers,
      timeout: options.exportOptions.timeout,
    });

    spanProcessors.push(
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: options.exportOptions.batchSize,
        scheduledDelayMillis: options.exportOptions.batchTimeout,
      }),
    );
  }

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors,
  });

  liveProviders.add(provider);

  // Register as global TracerProvider so trace.getTracer() returns real tracers. The return
  // value is the ownership record shutdown needs — a `false` here means something else holds
  // the global and this application must not remove it later.
  // A successful registration MEANS the slot was empty and is now ours — the return value is
  // authoritative and what we remembered is not. An earlier version also required
  // `globalOwner === null`, which is wrong: a stale owner recorded before someone else called
  // `trace.disable()` then suppressed the update, leaving this provider installed but unowned,
  // so its own shutdown declined to release it and left a dead provider in the global slot.
  if (trace.setGlobalTracerProvider(provider)) {
    globalOwner = provider;
  }

  let shutdownStarted = false;

  return {
    provider,
    async shutdown() {
      // Idempotent: `app.stop()` can be reached more than once, and a second pass must not
      // re-enter the handover and move the global for a provider already gone.
      if (shutdownStarted) {
        return;
      }
      shutdownStarted = true;

      // Removed BEFORE the flush, so a concurrent shutdown cannot elect this provider as the
      // successor of another one while it is on its way down.
      liveProviders.delete(provider);

      try {
        await provider.shutdown();
      } finally {
        // In the `finally` because a failed flush is still a dead provider: leaving it
        // installed as the global would accept spans and silently drop them.
        releaseGlobal(provider);
      }
    },
  };
}

import { trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import type { TraceOptions } from './types.js';

import { installContextManager, releaseContextManager } from './context-manager.js';
import { DEFAULT_RETRY_BUDGET, OtlpFetchSpanExporter } from './otlp-exporter.js';

/**
 * How far the processor's export timeout sits above the exporter's own retry budget.
 */
const EXPORT_TIMEOUT_MARGIN = 1000;

/**
 * Result of TracerProvider initialization
 */
export interface TracerProviderResult {
  /**
   * The initialized BasicTracerProvider
   */
  provider: BasicTracerProvider;

  /**
   * Whether spans started from here will nest.
   *
   * `false` when the OpenTelemetry context-manager slot already belongs to somebody else, which
   * this package does not take. Spans are still recorded and exported; they arrive as separate
   * roots.
   */
  contextPropagates: boolean;

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

  const spanProcessors: SpanProcessor[] = [];

  // Appended, not replacing: a caller wanting to observe or fan out this application's spans
  // has to be able to do so alongside the configured OTLP export, and a processor on the
  // process-global provider would not see them — every application's spans come from its own.
  if (options.spanProcessors) {
    spanProcessors.push(...options.spanProcessors as SpanProcessor[]);
  }

  if (options.exportOptions?.endpoint) {
    const retryBudget = options.exportOptions.retryBudget ?? DEFAULT_RETRY_BUDGET;

    const exporter = new OtlpFetchSpanExporter({
      endpoint: options.exportOptions.endpoint,
      headers: options.exportOptions.headers,
      timeout: options.exportOptions.timeout,
      retryAttempts: options.exportOptions.retryAttempts,
      retryDelay: options.exportOptions.retryDelay,
      retryBudget,
      onExportFailure: options.exportOptions.onExportFailure,
    });

    spanProcessors.push(
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: options.exportOptions.batchSize,
        scheduledDelayMillis: options.exportOptions.batchTimeout,
        // The processor has its own export timeout, and its default (30s) would cut a longer
        // retry budget short — the exporter would still be waiting on a retry the processor had
        // already written off. Keeping it strictly above the budget leaves the exporter's
        // deadline the only one that decides, which is the one that knows about the retries.
        exportTimeoutMillis: retryBudget + EXPORT_TIMEOUT_MARGIN,
      }),
    );
  }

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors,
    // `samplingRate` used to reach nothing that decides what is exported — it set a traceFlags bit
    // on OneBun's own record and no more, while the provider sampled everything. That was
    // invisible only because no span was ever exported. Wiring it here is part of THIS change:
    // shipping export without it would take a documented `samplingRate: 0.1` and send ten times
    // the spans the operator asked for, in the same release that made sending work at all.
    //
    // `ParentBased` so a sampled incoming trace keeps its children: dropping a child whose parent
    // was sampled produces a trace with holes, which is worse to read than a trace that is absent.
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(options.samplingRate ?? 1),
    }),
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

  // A tracer provider decides what a span IS; the context manager decides what a span is a CHILD
  // of. Without one, `context.active()` is always `ROOT_CONTEXT`, so every span the framework
  // starts — the HTTP span, each `@Traced` method — is a separate root with its own trace id, and
  // a request that fans out to five methods produces six unrelated traces. Installed here rather
  // than at import time for the reason the provider is: an import must not claim a process-global
  // slot on behalf of an application that may never be configured.
  const contextPropagates = installContextManager();

  let shutdownStarted = false;

  return {
    provider,
    contextPropagates,
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

        // Refcounted, and only released by whoever took a claim. `contextPropagates` is false
        // when the slot was somebody else's, and releasing on that path would remove a manager
        // this package never installed.
        if (contextPropagates) {
          releaseContextManager();
        }
      }
    },
  };
}

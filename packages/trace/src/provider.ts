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
 * Initialize and register a global TracerProvider.
 *
 * When `exportOptions.endpoint` is configured, creates a BatchSpanProcessor
 * with a custom fetch-based OTLP exporter for Bun compatibility.
 *
 * @param options - Trace configuration options
 * @returns Provider instance and shutdown function
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

  // Register as global TracerProvider so trace.getTracer() returns real tracers
  trace.setGlobalTracerProvider(provider);

  return {
    provider,
    async shutdown() {
      await provider.shutdown();
      // Disable the global provider to avoid using a shutdown provider
      trace.disable();
    },
  };
}

/**
 * A metrics destination for `@onebun/requests`.
 *
 * `createHttpClient` is a free function: no instance, no application, nothing to ask which
 * application it belongs to. It used to reach a process-wide slot — owned by whichever
 * application started LAST — and record an OUTGOING call into the SERVER's own
 * `http_requests_total`, with the full URL as the route label. Measured, a call made by one
 * application produced
 * `beta_http_requests_total{controller="requests-client",route="http://127.0.0.1:35379/alpha/ping",app="beta"}`:
 * the wrong application, the wrong metric family, and a label that mints a fresh series per
 * path and per ephemeral port.
 *
 * So the destination is handed to the client instead of guessed. This is the factory for it —
 * in `@onebun/metrics`, which may depend on `@onebun/requests` (the reverse is not true).
 *
 * @see docs:api/metrics.md
 */

import type { MetricsService } from './metrics.service';

import type { RequestMetricsData } from '@onebun/requests';

/**
 * The host a URL addresses, for use as a bounded label.
 *
 * An unparsable URL yields `'unknown'` rather than itself: a label is a dimension, and echoing
 * arbitrary input into one is how a cardinality problem starts.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Build a sink that records outgoing calls into this application's registry.
 *
 * ```typescript
 * const client = createHttpClient({
 *   baseUrl: 'https://api.example.com',
 *   metricsSink: createRequestsMetricsSink(metricsService),
 * });
 * ```
 */
export function createRequestsMetricsSink(
  metricsService: MetricsService,
): (data: RequestMetricsData) => void {
  return (data: RequestMetricsData): void => {
    metricsService.recordOutgoingRequest({
      method: data.method,
      host: hostOf(data.url),
      statusCode: data.statusCode,
      // The client measures in milliseconds; Prometheus durations are seconds.
      duration: data.duration / 1000,
    });
  };
}

import { ExportResultCode } from '@opentelemetry/core';

import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * OTLP Span Exporter options
 */
export interface OtlpExporterOptions {
  /**
   * OTLP endpoint URL (e.g. 'http://localhost:4318')
   */
  endpoint: string;

  /**
   * Custom HTTP headers for export requests
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds
   * @defaultValue 10000
   */
  timeout?: number;

  /**
   * Retries after the first attempt when a send fails. `0` disables retrying.
   * @defaultValue 3
   */
  retryAttempts?: number;

  /**
   * Delay in milliseconds before the first retry; doubles each retry, capped at 5000ms.
   * @defaultValue 200
   */
  retryDelay?: number;

  /**
   * Ceiling on the total wall time one batch may spend being exported, retries included.
   * @defaultValue 10000
   */
  retryBudget?: number;

  /**
   * Called once per batch that was given up on.
   */
  onExportFailure?: (error: Error, spanCount: number, attempts: number) => void;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 200;
/**
 * Ceiling on the total wall time one batch may spend being exported.
 *
 * Exported because the `BatchSpanProcessor` in front of this exporter has its own export
 * timeout, and the two numbers must not be chosen independently — see `provider.ts`.
 */
export const DEFAULT_RETRY_BUDGET = 10000;
const RETRY_DELAY_CAP = 5000;
const RETRY_BACKOFF_FACTOR = 2;
const MILLISECONDS_PER_SECOND = 1000;
const ERROR_BODY_EXCERPT = 200;
const NANOSECONDS_PER_MILLISECOND = 1000000;
const NANOSECONDS_PER_SECOND = 1000000000;

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;

/**
 * Statuses worth sending the same batch again for.
 *
 * Deliberately narrow: a 400 means the collector rejected the payload itself and every retry
 * would be rejected identically, and a 401/403 will not become authorized by waiting. Retrying
 * those turns one lost batch into four, at the cost of blocking the batches behind it.
 */
const RETRYABLE_STATUSES = new Set([
  HTTP_REQUEST_TIMEOUT,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
]);

/**
 * A send that failed, and whether sending the same bytes again could plausibly succeed.
 */
class OtlpSendError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = 'OtlpSendError';
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The failure handed to `resultCallback` and to `onExportFailure` when a batch is abandoned.
 *
 * Carries the count of spans that were dropped and how many attempts it took to give up, so a
 * caller can report the size of the hole rather than only that there is one.
 *
 * @see docs:api/trace.md
 */
export class OtlpExportError extends Error {
  readonly spanCount: number;
  readonly attempts: number;

  constructor(cause: Error, spanCount: number, attempts: number) {
    super(`OTLP export gave up after ${attempts} attempt(s), dropping ${spanCount} span(s): ${cause.message}`);
    this.name = 'OtlpExportError';
    this.cause = cause;
    this.spanCount = spanCount;
    this.attempts = attempts;
  }
}

/**
 * Read a `Retry-After` header in either of the forms the spec allows.
 *
 * Returns `undefined` when the header is absent or unparseable — the caller then falls back to
 * its own backoff rather than treating the collector's silence as "retry immediately".
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * MILLISECONDS_PER_SECOND : 0;
  }

  const until = Date.parse(header);

  return Number.isNaN(until) ? undefined : Math.max(0, until - Date.now());
}

/**
 * Sleep, as a plain in-process wait.
 *
 * Unlike a queue message — which must never wait in a closure, because a process that dies
 * mid-backoff takes the only copy with it — a span batch has no durable home to be parked in.
 * `BatchSpanProcessor` already removed it from its buffer. Waiting here is not a choice between
 * memory and the broker; it is a choice between waiting and dropping.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Convert hrtime [seconds, nanoseconds] to nanosecond string
 */
function hrTimeToNanos(hrTime: [number, number]): string {
  const nanos = BigInt(hrTime[0]) * BigInt(NANOSECONDS_PER_SECOND) + BigInt(hrTime[1]);

  return nanos.toString();
}

/**
 * Convert OTel attribute value to OTLP JSON attribute value
 */
function toOtlpValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  return { stringValue: String(value) };
}

/**
 * Convert OTel attributes to OTLP JSON format
 */
function toOtlpAttributes(
  attributes: Record<string, unknown>,
): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: toOtlpValue(value),
  }));
}

/**
 * Map OTel SpanKind to OTLP integer
 */
function mapSpanKind(kind: number): number {
  // OTel SpanKind: INTERNAL=0, SERVER=1, CLIENT=2, PRODUCER=3, CONSUMER=4
  // OTLP:          INTERNAL=1, SERVER=2, CLIENT=3, PRODUCER=4, CONSUMER=5
  return kind + 1;
}

/**
 * Map OTel SpanStatusCode to OTLP status code
 */
function mapStatusCode(code: number): number {
  // OTel: UNSET=0, OK=1, ERROR=2
  // OTLP: STATUS_CODE_UNSET=0, STATUS_CODE_OK=1, STATUS_CODE_ERROR=2
  return code;
}

/**
 * Convert a ReadableSpan to OTLP JSON span format
 */
function spanToOtlp(span: ReadableSpan): Record<string, unknown> {
  const spanContext = span.spanContext();

  const otlpSpan: Record<string, unknown> = {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    name: span.name,
    kind: mapSpanKind(span.kind),
    startTimeUnixNano: hrTimeToNanos(span.startTime),
    endTimeUnixNano: hrTimeToNanos(span.endTime),
    attributes: toOtlpAttributes(span.attributes as Record<string, unknown>),
    status: {
      code: mapStatusCode(span.status.code),
      message: span.status.message || '',
    },
    events: span.events.map((event) => ({
      timeUnixNano: hrTimeToNanos(event.time),
      name: event.name,
      attributes: event.attributes
        ? toOtlpAttributes(event.attributes as Record<string, unknown>)
        : [],
    })),
    links: span.links.map((link) => ({
      traceId: link.context.traceId,
      spanId: link.context.spanId,
      attributes: link.attributes
        ? toOtlpAttributes(link.attributes as Record<string, unknown>)
        : [],
    })),
  };

  if (span.parentSpanContext?.spanId) {
    otlpSpan.parentSpanId = span.parentSpanContext.spanId;
  }

  if (span.droppedAttributesCount > 0) {
    otlpSpan.droppedAttributesCount = span.droppedAttributesCount;
  }

  if (span.droppedEventsCount > 0) {
    otlpSpan.droppedEventsCount = span.droppedEventsCount;
  }

  if (span.droppedLinksCount > 0) {
    otlpSpan.droppedLinksCount = span.droppedLinksCount;
  }

  return otlpSpan;
}

/**
 * Custom OTLP Span Exporter using native fetch() for Bun compatibility.
 *
 * Unlike @opentelemetry/exporter-trace-otlp-http which relies on XMLHttpRequest
 * or Node's http module, this exporter uses the native fetch() API that is
 * guaranteed to work in Bun.
 */
export class OtlpFetchSpanExporter implements SpanExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;
  private readonly retryBudget: number;
  private readonly onExportFailure: ((error: Error, spanCount: number, attempts: number) => void) | undefined;
  private isShutdown = false;

  constructor(options: OtlpExporterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.headers = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.retryAttempts = Math.max(0, Math.floor(options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS));
    this.retryDelay = Math.max(0, options.retryDelay ?? DEFAULT_RETRY_DELAY);
    this.retryBudget = Math.max(1, options.retryBudget ?? DEFAULT_RETRY_BUDGET);
    this.onExportFailure = options.onExportFailure;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.isShutdown) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('OTLP exporter has been shut down'),
      });

      return;
    }

    this.sendSpans(spans)
      .then(() => {
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        const attempts = failure instanceof OtlpExportError ? failure.attempts : 1;

        // An export that fails without a word is exactly how tracing came to deliver nothing
        // for so long. The caller gets the error object, and whoever wired `onExportFailure`
        // gets told how big the hole is.
        this.onExportFailure?.(failure, spans.length, attempts);

        resultCallback({ code: ExportResultCode.FAILED, error: failure });
      });
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
  }

  async forceFlush(): Promise<void> {
    // No internal buffering — BatchSpanProcessor handles batching
  }

  private async sendSpans(spans: ReadableSpan[]): Promise<void> {
    if (spans.length === 0) {
      return;
    }

    const body = JSON.stringify(this.buildPayload(spans));
    // One deadline for the whole batch, taken once. Every attempt and every wait is measured
    // against it, so the worst case is `retryBudget` no matter how the failures fall out —
    // which is what lets the shutdown flush use the same code path without holding the process.
    const deadline = Date.now() + this.retryBudget;

    let attempts = 0;

    for (;;) {
      attempts++;

      try {
        await this.post(body, deadline);

        return;
      } catch (error) {
        const failure = error instanceof OtlpSendError
          ? error
          // Anything that is not an HTTP response is a transport failure: connection refused,
          // DNS, TLS, or our own abort. All of them are worth trying again — a collector being
          // restarted looks exactly like this.
          : new OtlpSendError(error instanceof Error ? error.message : String(error), true);

        const delay = this.nextDelay(attempts, failure.retryAfterMs);

        if (
          !failure.retryable
          || attempts > this.retryAttempts
          || this.isShutdown
          || Date.now() + delay >= deadline
        ) {
          throw new OtlpExportError(failure, spans.length, attempts);
        }

        await wait(delay);
      }
    }
  }

  /**
   * Backoff for the retry after `attempt`, unless the collector named its own delay.
   */
  private nextDelay(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) {
      return Math.min(retryAfterMs, RETRY_DELAY_CAP);
    }

    return Math.min(this.retryDelay * RETRY_BACKOFF_FACTOR ** (attempt - 1), RETRY_DELAY_CAP);
  }

  /**
   * One POST. Throws {@link OtlpSendError} with the retry verdict already decided.
   */
  private async post(body: string, deadline: number): Promise<void> {
    // Never longer than what is left of the batch's budget: a collector that accepts the
    // connection and then says nothing would otherwise burn the whole budget on one attempt.
    const attemptTimeout = Math.max(1, Math.min(this.timeout, deadline - Date.now()));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), attemptTimeout);

    try {
      const response = await fetch(`${this.endpoint}/v1/traces`, {
        method: 'POST',
        headers: this.headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        // Read the body out so the connection is free for the retry, and put an excerpt in the
        // message — "503" alone does not distinguish a restarting collector from a rejected
        // payload, and that distinction is the whole reason someone reads this error.
        const detail = (await response.text().catch(() => '')).slice(0, ERROR_BODY_EXCERPT);

        throw new OtlpSendError(
          `OTLP export failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
          RETRYABLE_STATUSES.has(response.status),
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildPayload(spans: ReadableSpan[]): Record<string, unknown> {
    // Group spans by instrumentation scope
    const scopeSpans = new Map<string, Record<string, unknown>[]>();
    for (const span of spans) {
      const scopeName = span.instrumentationScope.name;
      if (!scopeSpans.has(scopeName)) {
        scopeSpans.set(scopeName, []);
      }
      scopeSpans.get(scopeName)!.push(spanToOtlp(span));
    }

    // Build resource attributes from the first span's resource
    const resource = spans[0].resource;
    const resourceAttributes = toOtlpAttributes(
      resource.attributes as Record<string, unknown>,
    );

    return {
      resourceSpans: [
        {
          resource: { attributes: resourceAttributes },
          scopeSpans: Array.from(scopeSpans.entries()).map(([name, scopeSpanList]) => ({
            scope: { name },
            spans: scopeSpanList,
          })),
        },
      ],
    };
  }
}

/**
 * Utility: convert milliseconds to nanosecond string
 */
export function msToNanos(ms: number): string {
  return (BigInt(Math.round(ms)) * BigInt(NANOSECONDS_PER_MILLISECOND)).toString();
}

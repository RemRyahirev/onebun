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
}

const DEFAULT_TIMEOUT = 10000;
const NANOSECONDS_PER_MILLISECOND = 1000000;
const NANOSECONDS_PER_SECOND = 1000000000;

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
  private isShutdown = false;

  constructor(options: OtlpExporterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.headers = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.isShutdown) {
      resultCallback({ code: ExportResultCode.FAILED });

      return;
    }

    this.sendSpans(spans)
      .then(() => {
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch(() => {
        resultCallback({ code: ExportResultCode.FAILED });
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

    const payload = {
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.endpoint}/v1/traces`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OTLP export failed: ${response.status} ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Utility: convert milliseconds to nanosecond string
 */
export function msToNanos(ms: number): string {
  return (BigInt(Math.round(ms)) * BigInt(NANOSECONDS_PER_MILLISECOND)).toString();
}

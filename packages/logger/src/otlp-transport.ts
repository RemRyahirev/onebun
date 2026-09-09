import { Effect } from 'effect';

import {
  type LogEntry,
  LogLevel,
  type LogTransport,
} from './types';

/**
 * OTLP Log Transport options
 */
export interface OtlpLogTransportOptions {
  /**
   * OTLP endpoint URL (e.g. 'http://localhost:4318')
   */
  endpoint: string;

  /**
   * Custom HTTP headers for export requests
   */
  headers?: Record<string, string>;

  /**
   * Maximum number of log records per batch
   * @defaultValue 100
   */
  batchSize?: number;

  /**
   * Maximum time in ms to wait before sending a batch
   * @defaultValue 5000
   */
  batchTimeout?: number;

  /**
   * Resource attributes for OTLP (e.g. service.name, service.version)
   */
  resourceAttributes?: Record<string, string>;

  /**
   * Custom fetch function for testing. Defaults to globalThis.fetch.
   * @internal
   */
  fetchFn?: typeof fetch;

  /**
   * Called once for a batch that was not delivered, with the failure and how many records were
   * lost.
   *
   * A non-2xx from the collector used to be indistinguishable from a success — the response was
   * never inspected — so a misconfigured endpoint swallowed every log line in silence. Supply
   * this to find out; it must not log through the same logger, which would loop.
   */
  onExportFailure?: (error: Error, recordCount: number) => void;

  /**
   * Ceiling on how many records may sit in the buffer waiting for a collector that is refusing
   * them. Beyond it the oldest are dropped and the drop is reported.
   *
   * @defaultValue 1000
   */
  maxBufferedRecords?: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_TIMEOUT = 5000;
const DEFAULT_TIMEOUT = 10000;
const ERROR_BODY_EXCERPT = 200;
const DEFAULT_MAX_BUFFERED_RECORDS = 1000;

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;

/**
 * Statuses worth holding the batch for. Everything else is rejected identically next time.
 */
const RETRYABLE_STATUSES = new Set([
  HTTP_REQUEST_TIMEOUT,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
]);
const NANOSECONDS_PER_MILLISECOND = 1000000;

// OTLP severity numbers per OpenTelemetry Logs specification
const OTLP_SEVERITY_TRACE = 1;
const OTLP_SEVERITY_DEBUG = 5;
const OTLP_SEVERITY_INFO = 9;
const OTLP_SEVERITY_WARN = 13;
const OTLP_SEVERITY_ERROR = 17;
const OTLP_SEVERITY_FATAL = 21;

/**
 * Map OneBun LogLevel to OTLP SeverityNumber
 */
const SEVERITY_MAP: Record<number, { number: number; text: string }> = {
  [LogLevel.Trace]: { number: OTLP_SEVERITY_TRACE, text: 'TRACE' },
  [LogLevel.Debug]: { number: OTLP_SEVERITY_DEBUG, text: 'DEBUG' },
  [LogLevel.Info]: { number: OTLP_SEVERITY_INFO, text: 'INFO' },
  [LogLevel.Warning]: { number: OTLP_SEVERITY_WARN, text: 'WARN' },
  [LogLevel.Error]: { number: OTLP_SEVERITY_ERROR, text: 'ERROR' },
  [LogLevel.Fatal]: { number: OTLP_SEVERITY_FATAL, text: 'FATAL' },
};

/**
 * Convert a value to OTLP attribute value format
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
 * Convert a record to OTLP attributes array
 */
function toOtlpAttributes(
  record: Record<string, unknown>,
): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(record)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => ({
      key,
      value: toOtlpValue(value),
    }));
}

/**
 * Convert a LogEntry to an OTLP LogRecord
 */
function logEntryToOtlpRecord(entry: LogEntry): Record<string, unknown> {
  const severity = SEVERITY_MAP[entry.level] ?? { number: OTLP_SEVERITY_INFO, text: 'INFO' };
  const timeUnixNano = (BigInt(entry.timestamp.getTime()) * BigInt(NANOSECONDS_PER_MILLISECOND)).toString();

  const attributes: Array<{ key: string; value: Record<string, unknown> }> = [];

  // Add context as attributes
  if (entry.context) {
    for (const [key, value] of Object.entries(entry.context)) {
      if (key === '__additionalData' || key === 'SHOW_CONTEXT') {
        continue;
      }
      attributes.push({ key, value: toOtlpValue(value) });
    }
  }

  // Add error info as attributes
  if (entry.error) {
    attributes.push({ key: 'exception.type', value: { stringValue: entry.error.name } });
    attributes.push({ key: 'exception.message', value: { stringValue: entry.error.message } });
    if (entry.error.stack) {
      attributes.push({ key: 'exception.stacktrace', value: { stringValue: entry.error.stack } });
    }
  }

  const record: Record<string, unknown> = {
    timeUnixNano,
    severityNumber: severity.number,
    severityText: severity.text,
    body: { stringValue: entry.message },
    attributes,
  };

  // Add trace correlation
  if (entry.trace?.traceId) {
    record.traceId = entry.trace.traceId;
  }
  if (entry.trace?.spanId) {
    record.spanId = entry.trace.spanId;
  }

  return record;
}

/**
 * OTLP HTTP Log Transport for sending logs to an OpenTelemetry Collector.
 *
 * Uses native fetch() for Bun compatibility. Batches log records and sends
 * them periodically or when the batch is full.
 */
export class OtlpLogTransport implements LogTransport {
  private buffer: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isShutdown = false;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly batchSize: number;
  private readonly batchTimeout: number;
  private readonly resourceAttributes: Array<{ key: string; value: Record<string, unknown> }>;
  private readonly fetchFn: typeof fetch;
  private readonly onExportFailure: ((error: Error, recordCount: number) => void) | undefined;
  private readonly maxBufferedRecords: number;

  constructor(options: OtlpLogTransportOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.headers = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.batchTimeout = options.batchTimeout ?? DEFAULT_BATCH_TIMEOUT;
    this.resourceAttributes = toOtlpAttributes(options.resourceAttributes ?? {});
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.onExportFailure = options.onExportFailure;
    this.maxBufferedRecords = Math.max(1, options.maxBufferedRecords ?? DEFAULT_MAX_BUFFERED_RECORDS);

    this.scheduleFlush();
  }

  log(_formattedEntry: string, entry: LogEntry): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.isShutdown) {
        return;
      }

      this.buffer.push(entry);

      if (this.buffer.length >= this.batchSize) {
        void this.flush();
      }
    });
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Held, not discarded: the records go back on the buffer if delivery fails and the failure
    // is one that waiting could fix. Clearing before the fetch meant a batch was already gone by
    // the time the collector rejected it, so there was nothing left to retry and nothing to name
    // in a report.
    const entries = this.buffer;
    this.buffer = [];

    const logRecords = entries.map(logEntryToOtlpRecord);

    const payload = {
      resourceLogs: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeLogs: [
            {
              scope: { name: '@onebun/logger' },
              logRecords,
            },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await this.fetchFn(`${this.endpoint}/v1/logs`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        // A 503, a 404 and a success used to be indistinguishable: the response was never
        // inspected. Drain the body so the connection is reusable, and put an excerpt in the
        // report — "503" alone does not separate a restarting collector from a rejected payload.
        const detail = (await response.text().catch(() => '')).slice(0, ERROR_BODY_EXCERPT);

        this.handleFailure(
          new Error(
            `OTLP log export failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
          ),
          entries,
          RETRYABLE_STATUSES.has(response.status),
        );
      }
    } catch (error) {
      // No HTTP response at all — connection refused, DNS, TLS, or our own timeout. A collector
      // being restarted looks exactly like this, so it is worth holding the batch for.
      this.handleFailure(
        error instanceof Error ? error : new Error(String(error)),
        entries,
        true,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Decide what happens to a batch that was not delivered: keep it, or give up on it.
   *
   * Kept only when waiting could plausibly help. A 400 means the collector rejected the payload
   * and will reject it identically; a 401 will not become authorized by the next flush. Holding
   * those would fill the buffer with records that can never leave it and push out the ones that
   * could.
   */
  private handleFailure(error: Error, entries: LogEntry[], retryable: boolean): void {
    if (!retryable || this.isShutdown) {
      this.reportFailure(error, entries.length);

      return;
    }

    // Back at the head: order is preserved, so a retried batch does not arrive after the records
    // that were written while it was in flight.
    this.buffer = [...entries, ...this.buffer];

    const overflow = this.buffer.length - this.maxBufferedRecords;

    if (overflow > 0) {
      // Bounded on purpose. A collector that stays down would otherwise grow this buffer until
      // the process dies — and a logger that kills the application to preserve its own backlog
      // has its priorities backwards. Oldest go first, and the drop is reported rather than
      // silent, because a gap nobody knows about is the failure this whole change is about.
      this.buffer = this.buffer.slice(overflow);
      this.reportFailure(
        new Error(`${error.message} (dropped ${overflow} buffered record(s) to stay within maxBufferedRecords)`),
        overflow,
      );

      return;
    }

    this.reportFailure(error, entries.length);
  }

  /**
   * Report a batch that was not delivered.
   *
   * Never throws, and must never log through the logger this transport belongs to — that would
   * be a loop, and a failing log backend is exactly when it would run hottest. The default
   * reporter writes to stderr for that reason.
   */
  private reportFailure(error: Error, recordCount: number): void {
    if (!this.onExportFailure) {
      return;
    }

    try {
      this.onExportFailure(error, recordCount);
    } catch {
      // A reporter that throws must not take the flush down with it.
    }
  }

  private scheduleFlush(): void {
    if (this.isShutdown) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.flush().then(() => this.scheduleFlush());
    }, this.batchTimeout);
  }
}

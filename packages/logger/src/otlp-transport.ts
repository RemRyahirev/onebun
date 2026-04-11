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
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_TIMEOUT = 5000;
const DEFAULT_TIMEOUT = 10000;
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
      await this.fetchFn(`${this.endpoint}/v1/logs`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      // Silently discard on failure — logging should not crash the application
    } finally {
      clearTimeout(timeoutId);
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

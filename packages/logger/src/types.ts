import type { Effect } from 'effect';

/**
 * Определяем уровни логирования
 */
export enum LogLevel {
  Fatal = 60,
  Error = 50,
  Warning = 40,
  Info = 30,
  Debug = 20,
  Trace = 10,
  None = 0,
}

/**
 * Trace information for log entries
 */
export interface TraceInfo {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
  error?: Error;
  trace?: TraceInfo;
}

/**
 * Log formatter interface
 */
export interface LogFormatter {
  format(entry: LogEntry): string;
}

/**
 * Log transport interface
 */
export interface LogTransport {
  log(formattedEntry: string, entry: LogEntry): Effect.Effect<void>;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  minLevel: LogLevel;
  formatter: LogFormatter;
  transport: LogTransport;
  defaultContext?: Record<string, unknown>;
}

/**
 * Logger configuration options for OneBunApplication.
 * Provides a declarative way to configure logging without Effect.js knowledge.
 */
export interface LoggerOptions {
  /**
   * Minimum log level. Messages below this level will be filtered out.
   * Can be a LogLevel enum value or a string ('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'none').
   * @defaultValue 'debug' in development, 'info' in production
   */
  minLevel?: LogLevel | string;

  /**
   * Output format for log messages.
   * - 'pretty': Human-readable colored output (best for development)
   * - 'json': Structured JSON output (best for production/log aggregation)
   * @defaultValue 'pretty' in development, 'json' in production
   */
  format?: 'json' | 'pretty';

  /**
   * Default context to include in all log messages.
   * Useful for adding service name, version, environment, etc.
   */
  defaultContext?: Record<string, unknown>;
}

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

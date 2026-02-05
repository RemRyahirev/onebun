import {
  Context,
  Effect,
  FiberRef,
  Layer,
} from 'effect';

import { JsonFormatter, PrettyFormatter } from './formatter';
import { ConsoleTransport } from './transport';
import {
  type LoggerConfig,
  type LoggerOptions,
  LogLevel,
  type TraceInfo,
} from './types';

/**
 * Custom logger service interface
 */
export type Logger = {
  trace(message: string, ...args: unknown[]): Effect.Effect<void>;
  debug(message: string, ...args: unknown[]): Effect.Effect<void>;
  info(message: string, ...args: unknown[]): Effect.Effect<void>;
  warn(message: string, ...args: unknown[]): Effect.Effect<void>;
  error(message: string, ...args: unknown[]): Effect.Effect<void>;
  fatal(message: string, ...args: unknown[]): Effect.Effect<void>;
  child(context: Record<string, unknown>): Logger;
};

/**
 * Synchronous logger interface for convenience
 */
export type SyncLogger = {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): SyncLogger;
};

/**
 * Context tag for the Logger service
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const LoggerService = Context.GenericTag<Logger>('LoggerService');

/**
 * Current trace context stored in fiber for automatic trace inclusion in logs
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const CurrentLoggerTraceContext = FiberRef.unsafeMake<TraceInfo | null>(null);

/**
 * Parse string log level to LogLevel enum.
 * Returns LogLevel.Info for unknown values.
 * 
 * @param level - String log level (case insensitive)
 * @returns LogLevel enum value
 * 
 * @example
 * ```typescript
 * parseLogLevel('debug') // LogLevel.Debug
 * parseLogLevel('INFO')  // LogLevel.Info
 * parseLogLevel('warn')  // LogLevel.Warning
 * ```
 */
export function parseLogLevel(level: string): LogLevel {
  const levelMap: Record<string, LogLevel> = {
    trace: LogLevel.Trace,
    debug: LogLevel.Debug,
    info: LogLevel.Info,
    warn: LogLevel.Warning,
    warning: LogLevel.Warning,
    error: LogLevel.Error,
    fatal: LogLevel.Fatal,
    none: LogLevel.None,
  };

  return levelMap[level.toLowerCase()] ?? LogLevel.Info;
}

/**
 * Parse arguments to extract error, context and additional data
 */
function parseLogArgs(args: unknown[]): {
  error?: Error;
  context?: Record<string, unknown>;
  additionalData?: unknown[];
} {
  if (args.length === 0) {
    return {};
  }

  let error: Error | undefined;
  let context: Record<string, unknown> | undefined;
  const additionalData: unknown[] = [];

  for (const arg of args) {
    if (arg instanceof Error) {
      // First error found becomes the main error
      if (!error) {
        error = arg;
      } else {
        additionalData.push(arg);
      }
    } else if (
      arg &&
      typeof arg === 'object' &&
      !Array.isArray(arg) &&
      arg.constructor === Object
    ) {
      // Plain objects are merged into context
      context = { ...context, ...(arg as Record<string, unknown>) };
    } else {
      // Everything else goes to additional data
      additionalData.push(arg);
    }
  }

  return {
    error,
    context: Object.keys(context || {}).length > 0 ? context : undefined,
    additionalData: additionalData.length > 0 ? additionalData : undefined,
  };
}

/**
 * Simple logger implementation that uses our formatters and transports
 */
class LoggerImpl implements Logger {
  constructor(
    private config: LoggerConfig,
    private context: Record<string, unknown> = {},
  ) {}

  private log(level: LogLevel, message: string, ...args: unknown[]): Effect.Effect<void> {
    // Check minimum logging level
    if (level < this.config.minLevel) {
      return Effect.succeed(undefined);
    }

    return Effect.flatMap(FiberRef.get(CurrentLoggerTraceContext), (traceInfo) => {
      // Try to get trace context from global context or trace service
      let currentTraceInfo = traceInfo;
      if (!currentTraceInfo && typeof globalThis !== 'undefined') {
        // Try global trace context first
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const globalTraceContext = (globalThis as any).__onebunCurrentTraceContext;
        if (globalTraceContext && globalTraceContext.traceId) {
          currentTraceInfo = globalTraceContext;
        } else {
          // Fallback to trace service
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const globalTraceService = (globalThis as any).__onebunTraceService;
          if (globalTraceService && globalTraceService.getCurrentTraceContext) {
            try {
              // Extract current trace context from global trace service
               
              const currentContext = Effect.runSync(
                globalTraceService.getCurrentTraceContext(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ) as any;
              if (currentContext && currentContext.traceId) {
                currentTraceInfo = {
                  traceId: currentContext.traceId,
                  spanId: currentContext.spanId,
                  parentSpanId: currentContext.parentSpanId,
                };
              }
            } catch {
              // Ignore errors getting trace context
            }
          }
        }
      }

      // Parse additional arguments
      const { error, context: argsContext, additionalData } = parseLogArgs(args);

      // Merge contexts
      const mergedContext = {
        ...this.config.defaultContext,
        ...this.context,
        ...argsContext,
      };

      // Add additional data to context if present
      if (additionalData && additionalData.length > 0) {
        mergedContext.__additionalData = additionalData;
      }

      // Create log entry
      const entry = {
        level,
        message,
        timestamp: new Date(),
        context: Object.keys(mergedContext).length > 0 ? mergedContext : undefined,
        error,
        trace: currentTraceInfo || undefined,
      };

      // Format and send through transport
      const formattedEntry = this.config.formatter.format(entry);

      return this.config.transport.log(formattedEntry, entry);
    });
  }

  trace(message: string, ...args: unknown[]): Effect.Effect<void> {
    return this.log(LogLevel.Trace, message, ...args);
  }

  debug(message: string, ...args: unknown[]): Effect.Effect<void> {
    return this.log(LogLevel.Debug, message, ...args);
  }

  info(message: string, ...args: unknown[]): Effect.Effect<void> {
    return this.log(LogLevel.Info, message, ...args);
  }

  warn(message: string, ...args: unknown[]): Effect.Effect<void> {
    return this.log(LogLevel.Warning, message, ...args);
  }

  error(message: string, ...args: unknown[]): Effect.Effect<void> {
    return this.log(LogLevel.Error, message, ...args);
  }

  fatal(message: string, ...args: unknown[]): Effect.Effect<void> {
    return this.log(LogLevel.Fatal, message, ...args);
  }

  child(context: Record<string, unknown>): Logger {
    return new LoggerImpl(this.config, { ...this.context, ...context });
  }
}

/**
 * Creates a development logger with pretty console output
 */
export const makeDevLogger = (config?: Partial<LoggerConfig>): Layer.Layer<Logger> => {
  return Layer.succeed(
    LoggerService,
    new LoggerImpl({
      minLevel: LogLevel.Debug,
      formatter: new PrettyFormatter(),
      transport: new ConsoleTransport(),
      defaultContext: {},
      ...config,
    }),
  );
};

/**
 * Creates a production logger with JSON output
 */
export const makeProdLogger = (config?: Partial<LoggerConfig>): Layer.Layer<Logger> => {
  return Layer.succeed(
    LoggerService,
    new LoggerImpl({
      minLevel: LogLevel.Info,
      formatter: new JsonFormatter(),
      transport: new ConsoleTransport(),
      defaultContext: {},
      ...config,
    }),
  );
};

/**
 * Synchronous logger wrapper
 */
class SyncLoggerImpl implements SyncLogger {
  constructor(private logger: Logger) {}

  private runWithTraceContext<T>(effect: Effect.Effect<T>): T {
    // Try to get trace context from global context
    let traceEffect = effect;
    if (typeof globalThis !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globalTraceContext = (globalThis as any).__onebunCurrentTraceContext;
      if (globalTraceContext && globalTraceContext.traceId) {
        traceEffect = Effect.provide(
          Effect.flatMap(FiberRef.set(CurrentLoggerTraceContext, globalTraceContext), () => effect),
          Layer.empty,
        );
      }
    }

    return Effect.runSync(traceEffect);
  }

  trace(message: string, ...args: unknown[]): void {
    this.runWithTraceContext(this.logger.trace(message, ...args));
  }

  debug(message: string, ...args: unknown[]): void {
    this.runWithTraceContext(this.logger.debug(message, ...args));
  }

  info(message: string, ...args: unknown[]): void {
    this.runWithTraceContext(this.logger.info(message, ...args));
  }

  warn(message: string, ...args: unknown[]): void {
    this.runWithTraceContext(this.logger.warn(message, ...args));
  }

  error(message: string, ...args: unknown[]): void {
    this.runWithTraceContext(this.logger.error(message, ...args));
  }

  fatal(message: string, ...args: unknown[]): void {
    this.runWithTraceContext(this.logger.fatal(message, ...args));
  }

  child(context: Record<string, unknown>): SyncLogger {
    return new SyncLoggerImpl(this.logger.child(context));
  }
}

/**
 * Create a synchronous logger from async logger
 */
export const createSyncLogger = (logger: Logger): SyncLogger => {
  return new SyncLoggerImpl(logger);
};

/**
 * Create a logger layer from LoggerOptions.
 * Provides a simple declarative API for configuring logging.
 * 
 * Priority: options > env variables > NODE_ENV defaults
 * 
 * @param options - Logger configuration options
 * @returns Layer providing Logger service
 * 
 * @example
 * ```typescript
 * const loggerLayer = makeLoggerFromOptions({
 *   minLevel: 'info',
 *   format: 'json',
 *   defaultContext: { service: 'my-service' },
 * });
 * ```
 */
export const makeLoggerFromOptions = (options?: LoggerOptions): Layer.Layer<Logger> => {
  const isDev = process.env.NODE_ENV !== 'production';

  // Resolve minLevel: options > LOG_LEVEL env > NODE_ENV default
  let minLevel: LogLevel;
  if (options?.minLevel !== undefined) {
    minLevel = typeof options.minLevel === 'string'
      ? parseLogLevel(options.minLevel)
      : options.minLevel;
  } else {
    const logLevelEnv = process.env.LOG_LEVEL?.toLowerCase();
    minLevel = logLevelEnv ? parseLogLevel(logLevelEnv) : (isDev ? LogLevel.Debug : LogLevel.Info);
  }

  // Resolve format: options > LOG_FORMAT env > NODE_ENV default
  let formatter;
  if (options?.format !== undefined) {
    formatter = options.format === 'json' ? new JsonFormatter() : new PrettyFormatter();
  } else {
    const formatEnv = process.env.LOG_FORMAT?.toLowerCase();
    formatter = formatEnv === 'json' ? new JsonFormatter()
      : formatEnv === 'pretty' ? new PrettyFormatter()
        : (isDev ? new PrettyFormatter() : new JsonFormatter());
  }

  return Layer.succeed(
    LoggerService,
    new LoggerImpl({
      minLevel,
      formatter,
      transport: new ConsoleTransport(),
      defaultContext: options?.defaultContext ?? {},
    }),
  );
};

/**
 * Create a logger based on NODE_ENV and environment variables.
 * 
 * Priority: config > env variables > NODE_ENV defaults
 * 
 * Environment variables:
 * - LOG_LEVEL: trace, debug, info, warn/warning, error, fatal, none
 * - LOG_FORMAT: json, pretty
 * 
 * @param config - Optional partial logger configuration
 * @returns Layer providing Logger service
 */
export const makeLogger = (config?: Partial<LoggerConfig>): Layer.Layer<Logger> => {
  const isDev = process.env.NODE_ENV !== 'production';

  // Read LOG_LEVEL from env (overrides default based on NODE_ENV)
  const logLevelEnv = process.env.LOG_LEVEL?.toLowerCase();
  const minLevel = config?.minLevel
    ?? (logLevelEnv ? parseLogLevel(logLevelEnv) : (isDev ? LogLevel.Debug : LogLevel.Info));

  // Read LOG_FORMAT from env (overrides default based on NODE_ENV)
  const formatEnv = process.env.LOG_FORMAT?.toLowerCase();
  const formatter = config?.formatter
    ?? (formatEnv === 'json' ? new JsonFormatter()
      : formatEnv === 'pretty' ? new PrettyFormatter()
        : (isDev ? new PrettyFormatter() : new JsonFormatter()));

  return Layer.succeed(
    LoggerService,
    new LoggerImpl({
      minLevel,
      formatter,
      transport: config?.transport ?? new ConsoleTransport(),
      defaultContext: config?.defaultContext ?? {},
    }),
  );
};

import {
  Context,
  Effect,
  Layer,
  FiberRef,
} from 'effect';

import { JsonFormatter, PrettyFormatter } from './formatter';
import { ConsoleTransport } from './transport';
import {
  LoggerConfig,
  LogLevel,
  TraceInfo,
} from './types';

/**
 * Custom logger service interface
 */
export interface Logger {
  trace(message: string, ...args: unknown[]): Effect.Effect<void>;
  debug(message: string, ...args: unknown[]): Effect.Effect<void>;
  info(message: string, ...args: unknown[]): Effect.Effect<void>;
  warn(message: string, ...args: unknown[]): Effect.Effect<void>;
  error(message: string, ...args: unknown[]): Effect.Effect<void>;
  fatal(message: string, ...args: unknown[]): Effect.Effect<void>;
  child(context: Record<string, unknown>): Logger;
}

/**
 * Synchronous logger interface for convenience
 */
export interface SyncLogger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): SyncLogger;
}

/**
 * Context tag for the Logger service
 */
export const LoggerService = Context.GenericTag<Logger>('LoggerService');

/**
 * Current trace context stored in fiber for automatic trace inclusion in logs
 */
export const CurrentLoggerTraceContext = FiberRef.unsafeMake<TraceInfo | null>(null);

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
    } else if (arg && typeof arg === 'object' && !Array.isArray(arg) && arg.constructor === Object) {
      // Plain objects are merged into context
      context = { ...context, ...arg as Record<string, unknown> };
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
  constructor(private config: LoggerConfig, private context: Record<string, unknown> = {}) {}

  private log(
    level: LogLevel,
    message: string,
    ...args: unknown[]
  ): Effect.Effect<void> {
    // Check minimum logging level
    if (level < this.config.minLevel) {
      return Effect.succeed(undefined);
    }

    return Effect.flatMap(
      FiberRef.get(CurrentLoggerTraceContext),
      (traceInfo) => {
        // Try to get trace context from global context or trace service
        let currentTraceInfo = traceInfo;
        if (!currentTraceInfo && typeof globalThis !== 'undefined') {
          // Try global trace context first
          const globalTraceContext = (globalThis as any).__onebunCurrentTraceContext;
          if (globalTraceContext && globalTraceContext.traceId) {
            currentTraceInfo = globalTraceContext;
          } else {
            // Fallback to trace service
            const globalTraceService = (globalThis as any).__onebunTraceService;
            if (globalTraceService && globalTraceService.getCurrentTraceContext) {
              try {
                // Extract current trace context from global trace service
                const currentContext = Effect.runSync(globalTraceService.getCurrentTraceContext()) as any;
                if (currentContext && currentContext.traceId) {
                  currentTraceInfo = {
                    traceId: currentContext.traceId,
                    spanId: currentContext.spanId,
                    parentSpanId: currentContext.parentSpanId,
                  };
                }
              } catch (error) {
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
      },
    );
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
      const globalTraceContext = (globalThis as any).__onebunCurrentTraceContext;
      if (globalTraceContext && globalTraceContext.traceId) {
        traceEffect = Effect.provide(
          Effect.flatMap(
            FiberRef.set(CurrentLoggerTraceContext, globalTraceContext),
            () => effect,
          ),
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
 * Create a logger based on NODE_ENV
 */
export const makeLogger = (config?: Partial<LoggerConfig>): Layer.Layer<Logger> => {
  const isDev = process.env.NODE_ENV !== 'production';

  return isDev ? makeDevLogger(config) : makeProdLogger(config);
}; 
import { Context, Effect, Layer } from 'effect';
import { ConsoleTransport } from './transport';
import { JsonFormatter, PrettyFormatter } from './formatter';
import { LoggerConfig, LogLevel } from './types';

/**
 * Custom logger service interface
 */
export interface Logger {
  trace(message: string, context?: Record<string, unknown>): Effect.Effect<void>;
  debug(message: string, context?: Record<string, unknown>): Effect.Effect<void>;
  info(message: string, context?: Record<string, unknown>): Effect.Effect<void>;
  warn(message: string, context?: Record<string, unknown>): Effect.Effect<void>;
  error(message: string, error?: Error, context?: Record<string, unknown>): Effect.Effect<void>;
  fatal(message: string, error?: Error, context?: Record<string, unknown>): Effect.Effect<void>;
  child(context: Record<string, unknown>): Logger;
}

/**
 * Synchronous logger interface for convenience
 */
export interface SyncLogger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>): void;
  fatal(message: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): SyncLogger;
}

/**
 * Context tag for the Logger service
 */
export const LoggerService = Context.GenericTag<Logger>("LoggerService");

/**
 * Simple logger implementation that uses our formatters and transports
 */
class LoggerImpl implements Logger {
  constructor(private config: LoggerConfig, private context: Record<string, unknown> = {}) {}

  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): Effect.Effect<void> {
    // Проверяем минимальный уровень логирования
    if (level < this.config.minLevel) {
      return Effect.succeed(undefined);
    }

    // Объединяем контексты
    const mergedContext = {
      ...this.config.defaultContext,
      ...this.context,
      ...context
    };

    // Создаем запись лога
    const entry = {
      level,
      message,
      timestamp: new Date(),
      context: mergedContext,
      error
    };

    // Форматируем и отправляем через транспорт
    const formattedEntry = this.config.formatter.format(entry);
    return this.config.transport.log(formattedEntry, entry);
  }

  trace(message: string, context?: Record<string, unknown>): Effect.Effect<void> {
    return this.log(LogLevel.Trace, message, undefined, context);
  }

  debug(message: string, context?: Record<string, unknown>): Effect.Effect<void> {
    return this.log(LogLevel.Debug, message, undefined, context);
  }

  info(message: string, context?: Record<string, unknown>): Effect.Effect<void> {
    return this.log(LogLevel.Info, message, undefined, context);
  }

  warn(message: string, context?: Record<string, unknown>): Effect.Effect<void> {
    return this.log(LogLevel.Warning, message, undefined, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): Effect.Effect<void> {
    return this.log(LogLevel.Error, message, error, context);
  }

  fatal(message: string, error?: Error, context?: Record<string, unknown>): Effect.Effect<void> {
    return this.log(LogLevel.Fatal, message, error, context);
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
      ...config
    })
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
      ...config
    })
  );
};

/**
 * Synchronous logger wrapper
 */
class SyncLoggerImpl implements SyncLogger {
  constructor(private logger: Logger) {}

  trace(message: string, context?: Record<string, unknown>): void {
    Effect.runSync(this.logger.trace(message, context));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    Effect.runSync(this.logger.debug(message, context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    Effect.runSync(this.logger.info(message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    Effect.runSync(this.logger.warn(message, context));
  }

  error(message: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>): void {
    if (errorOrContext instanceof Error) {
      Effect.runSync(this.logger.error(message, errorOrContext, context));
    } else {
      Effect.runSync(this.logger.error(message, undefined, errorOrContext));
    }
  }

  fatal(message: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>): void {
    if (errorOrContext instanceof Error) {
      Effect.runSync(this.logger.fatal(message, errorOrContext, context));
    } else {
      Effect.runSync(this.logger.fatal(message, undefined, errorOrContext));
    }
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
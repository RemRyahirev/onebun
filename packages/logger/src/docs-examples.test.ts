/**
 * Documentation Examples Tests for @onebun/logger
 *
 * @source docs:api/logger.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import {
  CompositeTransport,
  createSyncLogger,
  type LogEntry,
  LogLevel,
  type Logger,
  LoggerService,
  type LoggerOptions,
  type LogTransport,
  makeLogger,
  makeLoggerFromOptions,
  OtlpLogTransport,
  shutdownLogger,
  type SyncLogger,
} from '../src';

// Mock console to suppress logger output during tests
let logSpy: ReturnType<typeof spyOn>;
let infoSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
  infoSpy = spyOn(console, 'info').mockImplementation(() => undefined);
  warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

// --- Helpers: read what the logger actually wrote --------------------------------

type ConsoleSpy = ReturnType<typeof spyOn>;

/** Start of an ANSI escape sequence — present in pretty output, absent from JSON output. */
const ANSI_ESCAPE = '\u001b[';

/** Shape of a line produced by the JSON formatter, as documented in "JSON Format (Production)". */
interface JsonLogLine {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  additionalData?: unknown[];
  error?: { name: string; message: string; stack?: string };
  trace?: { traceId: string; spanId: string; parentSpanId?: string };
}

/** The text the transport handed to a console method on call #index. */
const lineAt = (spy: ConsoleSpy, index = 0): string => {
  const call = spy.mock.calls[index] as unknown[] | undefined;

  return String(call?.[0] ?? '');
};

const jsonAt = (spy: ConsoleSpy, index = 0): JsonLogLine => JSON.parse(lineAt(spy, index)) as JsonLogLine;

/** Drop the colour codes so the documented line layout can be compared as plain text. */
const stripAnsi = (text: string): string => text
  .split(ANSI_ESCAPE)
  .map((chunk, index) => (index === 0 ? chunk : chunk.slice(chunk.indexOf('m') + 1)))
  .join('');

const clearConsoleSpies = (): void => {
  logSpy.mockClear();
  infoSpy.mockClear();
  warnSpy.mockClear();
  errorSpy.mockClear();
};

// --- Helpers: build loggers deterministically -------------------------------------

/**
 * Environment that outranks NODE_ENV defaults. Cleared so the ambient shell of the test
 * runner cannot decide the format, the level or whether an OTLP transport is attached.
 */
const NEUTRAL_ENV: Record<string, string | undefined> = {
  LOG_LEVEL: undefined,
  LOG_FORMAT: undefined,
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: undefined,
};

const withEnv = <T>(vars: Record<string, string | undefined>, fn: () => T): T => {
  const saved: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

/** A sync logger built the way `makeLogger()` builds one from the ambient environment. */
const ambientSyncLogger = (): SyncLogger =>
  createSyncLogger(Effect.runSync(Effect.provide(LoggerService, makeLogger())));

const configuredLogger = (options: LoggerOptions): SyncLogger => {
  const layer = withEnv(NEUTRAL_ENV, () => makeLoggerFromOptions(options));

  return createSyncLogger(Effect.runSync(Effect.provide(LoggerService, layer)));
};

/** JSON output at every level, so assertions can read the record the logger emitted. */
const jsonLogger = (options: LoggerOptions = {}): SyncLogger =>
  configuredLogger({ format: 'json', minLevel: 'trace', ...options });

const prettyLogger = (options: LoggerOptions = {}): SyncLogger =>
  configuredLogger({ format: 'pretty', minLevel: 'trace', ...options });

describe('Logger README Examples', () => {
  describe('Basic Usage (README)', () => {
    /**
     * docs: "Logger format is automatically selected based on NODE_ENV" —
     * pretty output at debug level outside production, JSON output at info level in it.
     *
     * @source docs:api/logger.md#development-vs-production
     */
    it('should create logger based on NODE_ENV', () => {
      const devLogger = withEnv({ ...NEUTRAL_ENV, NODE_ENV: 'development' }, ambientSyncLogger);

      devLogger.debug('dev diagnostics', { userId: 123 });

      // debug is enabled outside production...
      expect(logSpy).toHaveBeenCalledTimes(1);
      const devLine = lineAt(logSpy);
      expect(devLine).toContain('DEBUG');
      expect(devLine).toContain('dev diagnostics');
      // ...and the output is the coloured pretty format, not JSON
      expect(devLine).toContain(ANSI_ESCAPE);
      expect(() => JSON.parse(devLine)).toThrow();

      clearConsoleSpies();

      const prodLogger = withEnv({ ...NEUTRAL_ENV, NODE_ENV: 'production' }, ambientSyncLogger);

      prodLogger.debug('below the production minimum level');
      prodLogger.info('prod diagnostics', { userId: 123 });

      // debug is filtered out in production, info survives as a single JSON record
      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const prodLine = jsonAt(infoSpy);
      expect(prodLine.level).toBe('info');
      expect(prodLine.message).toBe('prod diagnostics');
      expect(prodLine.context).toEqual({ userId: 123 });
      expect(lineAt(infoSpy)).not.toContain(ANSI_ESCAPE);
    });

    it('should use logger with Effect', async () => {
      // From README: Use with Effect
      // Note: The README example uses Effect.gen, but guidelines say to use pipe
      const loggerLayer = makeLogger();

      const program = Effect.flatMap(LoggerService, (logger) =>
        Effect.all([
          logger.info('Application started'),
          logger.debug('Debug information', { userId: 123 }),
        ]),
      );

      clearConsoleSpies();
      await Effect.runPromise(Effect.provide(program, loggerLayer));

      // Not merely "runs without throwing" — that assertion had no expect() at all and could only
      // fail on an exception, so a logger that emitted nothing passed it.
      expect(stripAnsi(lineAt(infoSpy))).toContain('Application started');
      expect(infoSpy.mock.calls).toHaveLength(1);
    });
  });

  describe('Synchronous API (README)', () => {
    it('should create sync logger and use directly', async () => {
      // From README: Synchronous API example
      const loggerLayer = makeLogger();

      // Get logger instance
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));

      // Create sync wrapper
      const syncLogger = createSyncLogger(logger);

      // From README: Use directly. Asserted on the emitted lines, not on "did not throw" — a
      // logger silenced entirely satisfies `.not.toThrow()`.
      clearConsoleSpies();
      syncLogger.info('Hello, World!');
      syncLogger.error('Something went wrong', new Error('Oops'));

      expect(stripAnsi(lineAt(infoSpy))).toContain('Hello, World!');
      expect(stripAnsi(lineAt(errorSpy))).toContain('Something went wrong');
      expect(stripAnsi(lineAt(errorSpy))).toContain('Oops');
    });
  });

  describe('Log Levels (README)', () => {
    it('should support all log levels', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From README: Log Levels table. Each level must reach its own console method — the
      // `.not.toThrow()` this replaces passed just as happily with every level discarded.
      clearConsoleSpies();
      syncLogger.info('General informational messages'); // Level 2
      syncLogger.warn('Warning messages'); // Level 3
      syncLogger.error('Error messages'); // Level 4
      syncLogger.fatal('Critical errors that may crash the app'); // Level 5

      expect(stripAnsi(lineAt(infoSpy))).toContain('General informational messages');
      expect(stripAnsi(lineAt(warnSpy))).toContain('Warning messages');
      expect(stripAnsi(lineAt(errorSpy, 0))).toContain('Error messages');
      expect(stripAnsi(lineAt(errorSpy, 1))).toContain('Critical errors that may crash the app');
    });
  });

  describe('Child Loggers (README)', () => {
    it('should create child logger with context', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From README: Create child logger with context
      const requestLogger = syncLogger.child({
        requestId: 'abc-123',
        userId: 456,
      });

      // All logs include the context — which is the promise, and is exactly what `.not.toThrow()`
      // could not see: a child logger that dropped its context passed the old assertion.
      clearConsoleSpies();
      requestLogger.info('Processing request');

      const parentLine = stripAnsi(lineAt(infoSpy));
      expect(parentLine).toContain('Processing request');
      expect(parentLine).toContain('abc-123');
      expect(parentLine).toContain('456');

      // From README: Create nested child — the nested context adds to the parent's, it does not
      // replace it.
      const dbLogger = requestLogger.child({ component: 'database' });

      clearConsoleSpies();
      dbLogger.info('Query executed');

      const childLine = stripAnsi(lineAt(infoSpy));
      expect(childLine).toContain('Query executed');
      expect(childLine).toContain('database');
      expect(childLine).toContain('abc-123');
    });
  });
});

describe('Logger API Documentation Examples', () => {
  describe('SyncLogger Interface (docs/api/logger.md)', () => {
    /**
     * docs: the SyncLogger interface — six level methods plus `child`, every one of them
     * emitting a record rather than silently doing nothing.
     *
     * @source docs:api/logger.md#synclogger-interface
     */
    it('should implement all interface methods', () => {
      const syncLogger = jsonLogger();

      syncLogger.trace('trace call');
      syncLogger.debug('debug call');
      syncLogger.info('info call');
      syncLogger.warn('warn call');
      syncLogger.error('error call');
      syncLogger.fatal('fatal call');

      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(2);

      expect([
        jsonAt(logSpy, 0).message,
        jsonAt(logSpy, 1).message,
        jsonAt(infoSpy).message,
        jsonAt(warnSpy).message,
        jsonAt(errorSpy, 0).message,
        jsonAt(errorSpy, 1).message,
      ]).toEqual([
        'trace call',
        'debug call',
        'info call',
        'warn call',
        'error call',
        'fatal call',
      ]);

      // child() hands back the same interface, with its context applied
      const child = syncLogger.child({ scope: 'child' });
      child.info('from child');

      expect(jsonAt(infoSpy, 1).context).toEqual({ scope: 'child' });
      expect(typeof child.child).toBe('function');
    });

    /**
     * docs: the Log Levels table — each level routes to its own console channel and is
     * dropped when it sits below the configured minimum.
     *
     * @source docs:api/logger.md#log-levels
     */
    it('should route every level and honour the minimum level', () => {
      const syncLogger = jsonLogger();

      syncLogger.trace('trace');
      syncLogger.debug('debug');
      syncLogger.info('info');
      syncLogger.warn('warn');
      syncLogger.error('error');
      syncLogger.fatal('fatal');

      expect([jsonAt(logSpy, 0).level, jsonAt(logSpy, 1).level]).toEqual(['trace', 'debug']);
      expect(jsonAt(infoSpy).level).toBe('info');
      expect(jsonAt(warnSpy).level).toBe('warn');
      expect([jsonAt(errorSpy, 0).level, jsonAt(errorSpy, 1).level]).toEqual(['error', 'fatal']);

      clearConsoleSpies();

      // Levels below the minimum never reach a transport
      const strictLogger = jsonLogger({ minLevel: 'error' });

      strictLogger.trace('dropped');
      strictLogger.debug('dropped');
      strictLogger.info('dropped');
      strictLogger.warn('dropped');
      strictLogger.error('kept');
      strictLogger.fatal('kept');

      expect(logSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Logging with Context (docs/api/logger.md)', () => {
    /**
     * @source docs:api/logger.md#object-context
     */
    it('should log with object context', () => {
      const syncLogger = jsonLogger();

      // From docs: Object Context example
      syncLogger.info('User action', {
        userId: '123',
        action: 'login',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      const line = jsonAt(infoSpy);
      expect(line.level).toBe('info');
      expect(line.message).toBe('User action');
      expect(line.context).toEqual({
        userId: '123',
        action: 'login',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });
      expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
    });

    /**
     * docs: "Output includes error name, message, and stack".
     *
     * @source docs:api/logger.md#error-logging
     */
    it('should log errors', () => {
      const syncLogger = jsonLogger();

      // From docs: Error Logging example
      const error = new Error('Something went wrong');

      // Error objects are specially handled
      syncLogger.error('Operation failed', error);

      // With additional context
      syncLogger.error('Operation failed', error, {
        operationId: '123',
        userId: '456',
      });

      const bare = jsonAt(errorSpy, 0);
      expect(bare.message).toBe('Operation failed');
      expect(bare.error?.name).toBe('Error');
      expect(bare.error?.message).toBe('Something went wrong');
      expect(bare.error?.stack).toContain('Something went wrong');
      expect(bare.context).toBeUndefined();

      const withContext = jsonAt(errorSpy, 1);
      expect(withContext.error?.message).toBe('Something went wrong');
      expect(withContext.context).toEqual({ operationId: '123', userId: '456' });
    });

    /**
     * docs: objects are merged into context, everything else lands in additionalData.
     *
     * @source docs:api/logger.md#multiple-arguments
     */
    it('should log with multiple arguments', () => {
      const syncLogger = jsonLogger();

      const requestData = { method: 'GET', path: '/api/users' };

      // From docs: Multiple Arguments example
      syncLogger.debug(
        'Processing request',
        requestData, // Object merged into context
        { step: 1 }, // Another object merged
        'additional info', // String goes to additionalData
        42, // Number goes to additionalData
      );

      const line = jsonAt(logSpy);
      expect(line.message).toBe('Processing request');
      expect(line.context).toEqual({ method: 'GET', path: '/api/users', step: 1 });
      expect(line.additionalData).toEqual(['additional info', 42]);
    });
  });

  describe('Child Loggers Pattern (docs/api/logger.md)', () => {
    /**
     * docs: a child logger's context is inherited by every call made through it, and by
     * its own children, while the parent keeps its context untouched.
     *
     * @source docs:api/logger.md#child-loggers
     */
    it('should create child logger with inherited context', async () => {
      const baseLogger = jsonLogger();

      // From docs: Child logger pattern
      const processOrder = async (orderId: string): Promise<void> => {
        // Create child logger with order context
        const orderLogger = baseLogger.child({
          orderId,
          operation: 'processOrder',
        });

        orderLogger.info('Starting order processing');

        // Simulate validation
        const validateOrder = (log: typeof orderLogger): void => {
          log.debug('Validating order');
          // Context (orderId, operation) is inherited
        };

        validateOrder(orderLogger);
        orderLogger.info('Order processing completed');
      };

      await processOrder('123');

      const orderContext = { orderId: '123', operation: 'processOrder' };
      expect(infoSpy).toHaveBeenCalledTimes(2);
      expect(jsonAt(infoSpy, 0).message).toBe('Starting order processing');
      expect(jsonAt(infoSpy, 0).context).toEqual(orderContext);
      expect(jsonAt(infoSpy, 1).message).toBe('Order processing completed');
      expect(jsonAt(infoSpy, 1).context).toEqual(orderContext);

      // The inner helper only got the child logger, yet its line carries the same context
      expect(jsonAt(logSpy).message).toBe('Validating order');
      expect(jsonAt(logSpy).context).toEqual(orderContext);

      // Nested children merge on top, the parent is unaffected
      const nested = baseLogger.child(orderContext).child({ component: 'database' });
      nested.debug('Query executed');
      expect(jsonAt(logSpy, 1).context).toEqual({ ...orderContext, component: 'database' });

      baseLogger.info('Unrelated');
      expect(jsonAt(infoSpy, 2).context).toBeUndefined();
    });
  });

  describe('Logger Configuration (docs/api/logger.md)', () => {
    /**
     * docs: LOG_LEVEL and LOG_FORMAT control the logger, and outrank the NODE_ENV defaults.
     *
     * @source docs:api/logger.md#environment-variables
     */
    it('should let LOG_LEVEL and LOG_FORMAT outrank NODE_ENV defaults', () => {
      // NODE_ENV would give pretty output at debug level — the env vars overrule it
      const syncLogger = withEnv(
        { NODE_ENV: 'development', LOG_LEVEL: 'warn', LOG_FORMAT: 'json' },
        ambientSyncLogger,
      );

      syncLogger.info('below LOG_LEVEL, dropped');
      syncLogger.warn('Rate limit approaching', { current: 95, limit: 100 });

      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const line = jsonAt(warnSpy);
      expect(line.level).toBe('warn');
      expect(line.message).toBe('Rate limit approaching');
      expect(line.context).toEqual({ current: 95, limit: 100 });
      expect(lineAt(warnSpy)).not.toContain(ANSI_ESCAPE);
    });

    /**
     * docs: "All logs will include serviceName, version, environment".
     *
     * @source docs:api/logger.md#custom-context
     */
    it('should include defaultContext in every log', () => {
      const defaultContext = {
        serviceName: 'user-service',
        version: '1.0.0',
        environment: 'test',
      };
      const syncLogger = jsonLogger({ defaultContext });

      syncLogger.info('Bootstrapped');
      syncLogger.child({ requestId: 'req-1' }).info('Handled', { status: 200 });

      expect(jsonAt(infoSpy, 0).context).toEqual(defaultContext);
      expect(jsonAt(infoSpy, 1).context).toEqual({
        ...defaultContext,
        requestId: 'req-1',
        status: 200,
      });
    });
  });

  describe('Output Formats (docs/api/logger.md)', () => {
    /**
     * docs: pretty output puts level, class name and message on one line, then each
     * context field on its own indented line.
     *
     * @source docs:api/logger.md#pretty-format-development
     */
    it('should render pretty output with indented context fields', () => {
      const syncLogger = prettyLogger();

      syncLogger.info('User created', {
        className: 'UserController',
        userId: 'abc-123',
        email: 'user@example.com',
      });

      const raw = lineAt(infoSpy);
      expect(raw).toContain(ANSI_ESCAPE);

      const lines = stripAnsi(raw).split('\n');
      expect(lines[0]).toContain('INFO');
      expect(lines[0]).toContain('[UserController] User created');
      expect(lines[1]).toBe('  userId: "abc-123"');
      expect(lines[2]).toBe('  email: "user@example.com"');
    });

    /**
     * docs: JSON output carries level, message, ISO timestamp and a nested context object.
     *
     * @source docs:api/logger.md#json-format-production
     */
    it('should render JSON output with a nested context object', () => {
      const syncLogger = jsonLogger();

      syncLogger.info('User created', {
        className: 'UserController',
        userId: 'abc-123',
        email: 'user@example.com',
      });

      const line = jsonAt(infoSpy);
      expect(line.level).toBe('info');
      expect(line.message).toBe('User created');
      expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
      expect(line.context).toEqual({
        className: 'UserController',
        userId: 'abc-123',
        email: 'user@example.com',
      });
    });
  });

  describe('Effect.js Logger (docs/api/logger.md)', () => {
    /**
     * docs: the async Logger interface pulled from the LoggerService tag, run with a layer
     * from `makeLogger()`. Nothing is written until the effect is run.
     *
     * @source docs:api/logger.md#effectjs-logger-advanced
     */
    it('should log through the Effect interface only when the program runs', async () => {
      const loggerLayer = withEnv({ ...NEUTRAL_ENV, NODE_ENV: 'production' }, () => makeLogger());

      const program = pipe(
        LoggerService,
        Effect.flatMap((logger: Logger) => logger.info('Message from Effect')),
      );

      // Building the effect logs nothing — it is a description, not an action
      expect(infoSpy).not.toHaveBeenCalled();

      await Effect.runPromise(Effect.provide(program, loggerLayer));

      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(jsonAt(infoSpy).message).toBe('Message from Effect');
      expect(jsonAt(infoSpy).level).toBe('info');
    });
  });

  describe('Best Practices (docs/api/logger.md)', () => {
    /**
     * @source docs:api/logger.md#1-use-appropriate-log-levels
     */
    it('should use appropriate log levels', () => {
      const syncLogger = jsonLogger();

      // From docs: Best Practices - Use Appropriate Log Levels
      // trace: Very detailed, usually disabled
      syncLogger.trace('Entering function', { args: ['test'] });

      // debug: Useful for debugging
      syncLogger.debug('Cache lookup', { key: 'user:123', hit: true });

      // info: Normal operations
      syncLogger.info('User logged in', { userId: '123' });

      // warn: Potential issues
      syncLogger.warn('Rate limit approaching', { current: 95, limit: 100 });

      // error: Errors that need attention
      syncLogger.error('Database connection failed', new Error('Timeout'));

      // fatal: Critical errors
      syncLogger.fatal('Application cannot start', new Error('No config'));

      expect(jsonAt(logSpy, 0).level).toBe('trace');
      expect(jsonAt(logSpy, 0).context).toEqual({ args: ['test'] });
      expect(jsonAt(logSpy, 1).level).toBe('debug');
      expect(jsonAt(logSpy, 1).context).toEqual({ key: 'user:123', hit: true });
      expect(jsonAt(infoSpy).level).toBe('info');
      expect(jsonAt(warnSpy).level).toBe('warn');
      expect(jsonAt(errorSpy, 0).level).toBe('error');
      expect(jsonAt(errorSpy, 0).error?.message).toBe('Timeout');
      expect(jsonAt(errorSpy, 1).level).toBe('fatal');
      expect(jsonAt(errorSpy, 1).error?.message).toBe('No config');
    });

    /**
     * @source docs:api/logger.md#2-include-relevant-context
     */
    it('should include relevant context', () => {
      const syncLogger = jsonLogger();

      // From docs: Best Practices - Include Relevant Context
      // Good: Includes useful context
      syncLogger.info('Order placed', {
        orderId: 'order-123',
        customerId: 'customer-456',
        total: 99.99,
        itemCount: 3,
      });

      // Bad: Missing context (still valid but not recommended)
      syncLogger.info('Order placed');

      expect(jsonAt(infoSpy, 0).context).toEqual({
        orderId: 'order-123',
        customerId: 'customer-456',
        total: 99.99,
        itemCount: 3,
      });
      // The second call carries the same message and nothing to act on
      expect(jsonAt(infoSpy, 1).message).toBe('Order placed');
      expect(jsonAt(infoSpy, 1).context).toBeUndefined();
    });

    /**
     * @source docs:api/logger.md#3-use-child-loggers-for-operations
     */
    it('should use child loggers for operations', async () => {
      const baseLogger = jsonLogger();

      // From docs: Best Practices - Use Child Loggers for Operations
      const processRequest = async (
        requestId: string,
        userId: string,
      ): Promise<void> => {
        const requestLogger = baseLogger.child({ requestId, userId });

        requestLogger.info('Request started');

        const step1 = (): void => {
          requestLogger.debug('Step 1 executing');
        };
        const step2 = (): void => {
          requestLogger.debug('Step 2 executing');
        };

        try {
          step1();
          step2();
          requestLogger.info('Request completed');
        } catch (error) {
          requestLogger.error('Request failed', error as Error);
          throw error;
        }
      };

      await processRequest('req-123', 'user-456');

      const requestContext = { requestId: 'req-123', userId: 'user-456' };
      expect(infoSpy).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();

      // Every line of the operation is correlated by the same child context
      expect([
        jsonAt(infoSpy, 0).context,
        jsonAt(logSpy, 0).context,
        jsonAt(logSpy, 1).context,
        jsonAt(infoSpy, 1).context,
      ]).toEqual([requestContext, requestContext, requestContext, requestContext]);
      expect([
        jsonAt(infoSpy, 0).message,
        jsonAt(logSpy, 0).message,
        jsonAt(logSpy, 1).message,
        jsonAt(infoSpy, 1).message,
      ]).toEqual(['Request started', 'Step 1 executing', 'Step 2 executing', 'Request completed']);
    });

    /**
     * docs: keep secrets out of the record. The logger writes back exactly the context it
     * is handed, so omitting or masking the field is what keeps it out of the output.
     *
     * @source docs:api/logger.md#4-dont-log-sensitive-data
     */
    it('should not log sensitive data', () => {
      const syncLogger = jsonLogger();

      // From docs: Best Practices - Don't Log Sensitive Data
      const email = 'user@example.com';
      const password = 'secret123';

      // Good: Omit sensitive fields
      syncLogger.info('User login', { email });
      expect(jsonAt(infoSpy, 0).context).toEqual({ email });
      expect(lineAt(infoSpy, 0)).not.toContain(password);

      // Or mask them
      syncLogger.info('User login', { email, password: '***' });
      expect(jsonAt(infoSpy, 1).context).toEqual({ email, password: '***' });
      expect(lineAt(infoSpy, 1)).not.toContain(password);

      // Bad: Logs password — nothing in the logger redacts it for you
      syncLogger.info('User login', { email, password });
      expect(jsonAt(infoSpy, 2).context).toEqual({ email, password });
    });
  });
});

/* eslint-disable @typescript-eslint/naming-convention */

// --- Helpers: OTLP export ---------------------------------------------------------

/** Large batchTimeout so the periodic flush timer cannot interfere with the assertions. */
const NO_AUTO_FLUSH_TIMEOUT = 600000;

interface OtlpAttribute {
  key: string;
  value: Record<string, unknown>;
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
  traceId?: string;
  spanId?: string;
}

interface OtlpPayload {
  resourceLogs: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeLogs: Array<{ scope: { name: string }; logRecords: OtlpLogRecord[] }>;
  }>;
}

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  payload: OtlpPayload;
}

/**
 * A fetch stand-in handed to the transport through its own `fetchFn` option — no global
 * is touched, so nothing leaks into other test files.
 */
const createFetchRecorder = (): { fetchFn: typeof fetch; requests: RecordedRequest[] } => {
  const requests: RecordedRequest[] = [];

  const fetchFn = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      payload: JSON.parse(String(init?.body ?? '{}')) as OtlpPayload,
    });

    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchFn, requests };
};

const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  level: LogLevel.Info,
  message: 'test message',
  timestamp: new Date('2024-01-15T10:30:45.123Z'),
  ...overrides,
});

const recordsOf = (request: RecordedRequest): OtlpLogRecord[] =>
  request.payload.resourceLogs[0].scopeLogs[0].logRecords;

describe('OTLP Log Export (docs/api/logger.md)', () => {
  /**
   * docs: OTLP Format — severity mapping, message as the record body, context fields as
   * attributes, error info as exception.* attributes, trace correlation, POST to /v1/logs.
   *
   * @source docs:api/logger.md#otlp-format
   */
  it('should export OtlpLogTransport', async () => {
    const { fetchFn, requests } = createFetchRecorder();
    const transport = new OtlpLogTransport({
      endpoint: 'http://localhost:4318',
      batchTimeout: NO_AUTO_FLUSH_TIMEOUT,
      fetchFn,
    });

    Effect.runSync(transport.log('formatted', makeEntry({
      message: 'User created',
      context: { userId: 'abc-123' },
    })));
    await transport.flush();

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('http://localhost:4318/v1/logs');

    const infoRecord = recordsOf(requests[0])[0];
    expect(infoRecord.severityNumber).toBe(9);
    expect(infoRecord.severityText).toBe('INFO');
    expect(infoRecord.body.stringValue).toBe('User created');
    expect(infoRecord.attributes).toContainEqual({ key: 'userId', value: { stringValue: 'abc-123' } });

    Effect.runSync(transport.log('formatted', makeEntry({
      level: LogLevel.Error,
      message: 'Operation failed',
      error: new Error('Timeout'),
      trace: { traceId: 'abc123def456', spanId: 'span123' },
    })));
    await transport.flush();

    expect(requests).toHaveLength(2);
    const errorRecord = recordsOf(requests[1])[0];
    expect(errorRecord.severityNumber).toBe(17);
    expect(errorRecord.severityText).toBe('ERROR');
    expect(errorRecord.traceId).toBe('abc123def456');
    expect(errorRecord.spanId).toBe('span123');
    expect(errorRecord.attributes).toContainEqual({
      key: 'exception.type',
      value: { stringValue: 'Error' },
    });
    expect(errorRecord.attributes).toContainEqual({
      key: 'exception.message',
      value: { stringValue: 'Timeout' },
    });

    await transport.shutdown();
  });

  /**
   * docs: "logs are sent to both console and OTLP collector", and pending records are
   * flushed on shutdown.
   *
   * @source docs:api/logger.md#otlp-log-export
   */
  it('should export CompositeTransport', async () => {
    const consoleLines: string[] = [];
    const recording: LogTransport = {
      log: (formattedEntry) => Effect.sync(() => {
        consoleLines.push(formattedEntry);
      }),
    };

    const { fetchFn, requests } = createFetchRecorder();
    const otlp = new OtlpLogTransport({
      endpoint: 'http://localhost:4318',
      batchTimeout: NO_AUTO_FLUSH_TIMEOUT,
      fetchFn,
    });
    const composite = new CompositeTransport([recording, otlp]);

    Effect.runSync(composite.log('formatted line', makeEntry({ message: 'User created' })));

    // The console half sees the record immediately, the OTLP half batches it
    expect(consoleLines).toEqual(['formatted line']);
    expect(requests).toHaveLength(0);

    // Shutdown reaches every transport, flushing the pending batch
    await composite.shutdown();

    expect(requests).toHaveLength(1);
    expect(recordsOf(requests[0])[0].body.stringValue).toBe('User created');
  });

  /**
   * docs: "Pending logs are flushed on application shutdown" — `shutdownLogger` drives the
   * transport the application logger was built with.
   *
   * @source docs:api/logger.md#otlp-format
   */
  it('should export shutdownLogger', async () => {
    const syncLogger = jsonLogger({ defaultContext: { service: 'my-service' } });

    syncLogger.info('before shutdown');
    expect(jsonAt(infoSpy).message).toBe('before shutdown');

    // Console-only transport: shutdown has nothing to flush and must stay silent about it
    await shutdownLogger();
    // Safe to call twice — the second call has no active transport left
    await shutdownLogger();

    expect(errorSpy).not.toHaveBeenCalled();

    // A transport that does buffer gets its pending records flushed by the same call path
    const { fetchFn, requests } = createFetchRecorder();
    const otlp = new OtlpLogTransport({
      endpoint: 'http://localhost:4318',
      batchTimeout: NO_AUTO_FLUSH_TIMEOUT,
      fetchFn,
    });

    Effect.runSync(otlp.log('formatted', makeEntry({ message: 'pending on shutdown' })));
    expect(requests).toHaveLength(0);

    await otlp.shutdown();

    expect(requests).toHaveLength(1);
    expect(recordsOf(requests[0])[0].body.stringValue).toBe('pending on shutdown');
  });

  /**
   * docs: OTLP Configuration — custom headers, batch size and the resource attributes that
   * carry service.name / service.version.
   *
   * @source docs:api/logger.md#configuration
   */
  it('should create OtlpLogTransport with options from docs', async () => {
    const { fetchFn, requests } = createFetchRecorder();

    // From docs: OTLP Log Export configuration (batchSize shrunk so the flush is observable)
    const transport = new OtlpLogTransport({
      endpoint: 'http://localhost:4318',
      headers: { Authorization: 'Bearer token' },
      batchSize: 2,
      batchTimeout: NO_AUTO_FLUSH_TIMEOUT,
      resourceAttributes: {
        'service.name': 'my-service',
        'service.version': '1.0.0',
      },
      fetchFn,
    });

    Effect.runSync(transport.log('one', makeEntry({ message: 'one' })));
    // Below batchSize: still buffered, nothing sent
    expect(requests).toHaveLength(0);

    Effect.runSync(transport.log('two', makeEntry({ message: 'two' })));

    // Reaching batchSize sends the whole batch in one request
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.Authorization).toBe('Bearer token');
    expect(requests[0].headers['Content-Type']).toBe('application/json');
    expect(requests[0].payload.resourceLogs[0].resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'my-service' } },
      { key: 'service.version', value: { stringValue: '1.0.0' } },
    ]);
    expect(requests[0].payload.resourceLogs[0].scopeLogs[0].scope.name).toBe('@onebun/logger');
    expect(recordsOf(requests[0]).map((record) => record.body.stringValue)).toEqual(['one', 'two']);

    // Cleanup: prevent scheduleFlush timer from leaking into other tests
    await transport.shutdown();
  });

  /**
   * docs: `otlpEndpoint` in loggerOptions turns on OTLP export while console output stays.
   *
   * @source docs:api/logger.md#configuration
   */
  it('should accept otlpEndpoint in LoggerOptions', async () => {
    // From docs: loggerOptions with otlpEndpoint
    const loggerOptions: LoggerOptions = {
      format: 'json',
      minLevel: 'info',
      defaultContext: { service: 'my-service' },
      otlpEndpoint: 'http://127.0.0.1:4318',
    };

    const layer = withEnv(NEUTRAL_ENV, () => makeLoggerFromOptions(loggerOptions));
    const syncLogger = createSyncLogger(Effect.runSync(Effect.provide(LoggerService, layer)));

    // Shut the OTLP half down first: it is a batching transport with a live timer, and a
    // test must not fire real requests at a collector. Console output has to survive it.
    await shutdownLogger();

    syncLogger.debug('below minLevel, dropped');
    syncLogger.info('User created', { userId: 'abc-123' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);

    const line = jsonAt(infoSpy);
    expect(line.level).toBe('info');
    expect(line.message).toBe('User created');
    expect(line.context).toEqual({ service: 'my-service', userId: 'abc-123' });
  });
});

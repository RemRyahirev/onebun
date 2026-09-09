/**
 * Behaviour coverage for the snippets of docs/api/logger.md that the compile gate typechecks
 * but nothing exercises: the recipes that wire a logger into a running application.
 *
 * Note for the xref scanner: `scripts/docs-xref.ts` only reads files named `docs-examples.test.ts`,
 * so the `@source` tags below are not counted as coverage until the scanner learns this name.
 *
 * The documented recipes on this page configure a whole application, so the tests import
 * `@onebun/core` and `@onebun/trace`. Neither can be a dependency of `@onebun/logger` — core
 * depends on logger, so the entry would be a cycle — hence the disable below; the packages are
 * present in the workspace and resolved through the root tsconfig paths.
 */

/* eslint-disable import/no-extraneous-dependencies */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  HttpStatusCode,
  Module,
  OneBunApplication,
  registerDependencies,
  Service,
} from '@onebun/core';
import {
  type Logger,
  LoggerService,
  LogLevel,
  makeLogger,
} from '@onebun/logger';
import { Span } from '@onebun/trace';

// The docs import this as `@onebun/core/testing`. That subpath is unresolvable from this package:
// the workspace links `@onebun/*` per package, and packages/logger has no link to core, while the
// root tsconfig maps only the bare `@onebun/core` specifier. Same module, reached by file path.
import { makeMockLoggerLayer } from '../../core/src/testing';

// --- Console capture -------------------------------------------------------------

type ConsoleSpy = ReturnType<typeof spyOn>;

let logSpy: ConsoleSpy;
let infoSpy: ConsoleSpy;
let warnSpy: ConsoleSpy;
let errorSpy: ConsoleSpy;

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

const clearConsoleSpies = (): void => {
  logSpy.mockClear();
  infoSpy.mockClear();
  warnSpy.mockClear();
  errorSpy.mockClear();
};

/** Shape of a line written by the JSON formatter, as documented in "JSON Format (Production)". */
interface JsonLogLine {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  trace?: { traceId: string; spanId: string; parentSpanId?: string };
}

const textLines = (spy: ConsoleSpy): string[] =>
  (spy.mock.calls as unknown[][]).map((call) => String(call[0] ?? ''));

/** Every line the transport handed to a console method that parses as a JSON log record. */
const jsonLines = (spy: ConsoleSpy): JsonLogLine[] => textLines(spy).flatMap((line) => {
  try {
    return [JSON.parse(line) as JsonLogLine];
  } catch {
    return [];
  }
});

const jsonLine = (spy: ConsoleSpy, message: string): JsonLogLine | undefined =>
  jsonLines(spy).find((line) => line.message === message);

// --- Environment -----------------------------------------------------------------

/**
 * The environment a logger is built in. `LOG_LEVEL` and `LOG_FORMAT` are cleared so the shell of
 * the test runner cannot pick the level or the format, and the OTLP endpoints so no transport is
 * attached to an address that does not exist.
 *
 * `NODE_ENV` is pinned rather than cleared: it decides the ambient defaults, and every assertion
 * below distinguishes a configured value only from that default. Development defaults to debug +
 * pretty, so `minLevel: 'info'` and `format: 'json'` are visibly the test's own choice. Under
 * `NODE_ENV=production` the defaults are already info + JSON, and a framework that ignored both
 * options would be indistinguishable from one that honoured them: measured under
 * `NODE_ENV=production` with `options.format` ignored, this file reports 5 fail with the pin in
 * place and 8 pass / 0 fail without it.
 */
const NEUTRAL_ENV: Record<string, string | undefined> = {
  NODE_ENV: 'development',
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

// --- Recording logger layer ------------------------------------------------------

interface CapturedLog {
  level: string;
  message: string;
  context: Record<string, unknown>;
  error?: Error;
}

/**
 * The documented "provide a layer that records" shape, extended so the inherited context of
 * child loggers is visible to assertions.
 */
const makeCapturingLogger = (sink: CapturedLog[], context: Record<string, unknown> = {}): Logger => {
  const record = (level: string) => (message: string, ...args: unknown[]): Effect.Effect<void> =>
    Effect.sync(() => {
      const merged: Record<string, unknown> = { ...context };
      let error: Error | undefined;

      for (const arg of args) {
        if (arg instanceof Error) {
          error ??= arg;
        } else if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) {
          Object.assign(merged, arg as Record<string, unknown>);
        }
      }

      sink.push({
        level,
        message,
        context: merged,
        error,
      });
    });

  return {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    child: (childContext: Record<string, unknown>) => makeCapturingLogger(
      sink,
      { ...context, ...childContext },
    ),
  };
};

const linesOf = (sink: CapturedLog[], className: string): CapturedLog[] =>
  sink.filter((entry) => entry.context.className === className);

const signature = (entries: CapturedLog[]): string[] =>
  entries.map((entry) => `${entry.level}:${entry.message}`);

describe('Logger docs coverage (docs/api/logger.md)', () => {
  describe('Usage in Controllers/Services', () => {
    /**
     * docs: "Logger is automatically available" inside a controller handler — the framework
     * hands the controller a logger scoped to its class name, and every call made through it
     * during the request reaches the configured layer.
     *
     * @source docs:api/logger.md#usage-in-controllersservices
     */
    it('should give a controller handler a working this.logger scoped to its class', async () => {
      const captured: CapturedLog[] = [];

      @Service()
      class UserService extends BaseService {
        async findAll(): Promise<Array<{ id: string }>> {
          return await Promise.resolve([{ id: 'u-1' }, { id: 'u-2' }]);
        }
      }

      // From docs: Usage in Controllers/Services
      @Controller('/users')
      class UserController extends BaseController {
        constructor(private userService: UserService) {
          super();
        }

        @Get('/')
        async findAll() {
          // Logger is automatically available
          this.logger.info('Finding all users');
          this.logger.debug('Request received', { timestamp: 1_700_000_000_000 });

          const users = await this.userService.findAll();
          this.logger.info('Users found', { count: users.length });

          return users;
        }
      }

      registerDependencies(UserController, [UserService]);

      @Module({ providers: [UserService], controllers: [UserController] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: Layer.succeed(LoggerService, makeCapturingLogger(captured)),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();
        // Drop the framework's own start-up chatter; what follows belongs to the request.
        captured.length = 0;

        const response = await fetch(`${app.getHttpUrl()}/users`);

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(await response.json()).toEqual({
          success: true,
          result: [{ id: 'u-1' }, { id: 'u-2' }],
        });

        const handlerLogs = linesOf(captured, 'UserController');

        // All three calls landed, in order, at the level each was made with
        expect(signature(handlerLogs)).toEqual([
          'info:Finding all users',
          'debug:Request received',
          'info:Users found',
        ]);

        // The context argument travels with the entry, on top of the controller's class name
        expect(handlerLogs[1]?.context).toEqual({
          className: 'UserController',
          timestamp: 1_700_000_000_000,
        });
        expect(handlerLogs[2]?.context).toEqual({ className: 'UserController', count: 2 });
      } finally {
        await app.stop();
      }
    });
  });

  describe('Logger Configuration', () => {
    /**
     * docs: `loggerOptions` configures logging declaratively — `minLevel` drops everything
     * below it, `format: 'json'` picks the JSON formatter, and `defaultContext` is attached
     * to every entry.
     *
     * @source docs:api/logger.md#using-loggeroptions-recommended
     */
    it('should apply minLevel, format and defaultContext from loggerOptions', () => {
      @Module({})
      class AppModule {}

      // From docs: Using loggerOptions (Recommended)
      const app = withEnv(NEUTRAL_ENV, () => new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerOptions: {
          minLevel: 'info',
          format: 'json',
          defaultContext: {
            service: 'user-service',
            version: '1.0.0',
          },
        },
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      }));

      clearConsoleSpies();

      const logger = app.getLogger();

      logger.debug('below the configured minimum');
      logger.info('user created');

      // minLevel: 'info' — the debug call never reaches a transport
      expect(logSpy).not.toHaveBeenCalled();

      // format: 'json' — a single machine-readable record, not the coloured pretty layout
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const line = jsonLine(infoSpy, 'user created');
      expect(line?.level).toBe('info');

      // defaultContext — merged into every entry
      expect(line?.context).toEqual({
        service: 'user-service',
        version: '1.0.0',
        className: 'OneBunApplication',
      });
    });

    /**
     * docs: the two documented ways of raising the floor — `loggerOptions.minLevel: 'info'`
     * and `loggerLayer: makeLogger({ minLevel: LogLevel.Info })` — both drop trace and debug.
     *
     * @source docs:api/logger.md#log-levels-1
     */
    it('should ignore trace and debug under either minLevel form', () => {
      @Module({})
      class AppModule {}

      // From docs: Log Levels — using loggerOptions (recommended)
      const viaOptions = withEnv(NEUTRAL_ENV, () => new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerOptions: {
          minLevel: 'info', // Ignore trace and debug
          format: 'json',
        },
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      }));

      clearConsoleSpies();

      viaOptions.getLogger().trace('dropped by minLevel');
      viaOptions.getLogger().debug('dropped by minLevel');
      viaOptions.getLogger().info('kept by minLevel');

      expect(logSpy).not.toHaveBeenCalled();
      expect(jsonLines(infoSpy).map((entry) => entry.message)).toEqual(['kept by minLevel']);

      // From docs: Log Levels — using loggerLayer with the LogLevel enum
      const viaLayer = withEnv(NEUTRAL_ENV, () => new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeLogger({ minLevel: LogLevel.Info }),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      }));

      clearConsoleSpies();

      viaLayer.getLogger().trace('enum-dropped');
      viaLayer.getLogger().debug('enum-dropped');
      viaLayer.getLogger().info('enum-kept');

      expect(logSpy).not.toHaveBeenCalled();
      expect(textLines(infoSpy)).toHaveLength(1);
      expect(textLines(infoSpy)[0]).toContain('enum-kept');
    });
  });

  describe('Getting Logger from Application', () => {
    /**
     * docs: `app.getLogger()` returns the root logger and `app.getLogger(context)` a logger
     * carrying that context — without disturbing the root one.
     *
     * @source docs:api/logger.md#getting-logger-from-application
     */
    it('should return a root logger and a context-carrying child from app.getLogger()', async () => {
      @Module({})
      class AppModule {}

      const app = withEnv(NEUTRAL_ENV, () => new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerOptions: { minLevel: 'info', format: 'json' },
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      }));

      try {
        await app.start();
        clearConsoleSpies();

        // From docs: Getting Logger from Application
        const logger = app.getLogger();
        logger.info('Application started');

        // Get logger with context
        const bootstrapLogger = app.getLogger({ className: 'Bootstrap' });
        bootstrapLogger.info('Bootstrapping complete');

        // The root logger keeps the application's own class name...
        expect(jsonLine(infoSpy, 'Application started')?.context)
          .toEqual({ className: 'OneBunApplication' });

        // ...and the context passed to getLogger() is what the returned logger carries
        expect(jsonLine(infoSpy, 'Bootstrapping complete')?.context)
          .toEqual({ className: 'Bootstrap' });

        // The child did not mutate the root logger
        logger.info('Still the root logger');
        expect(jsonLine(infoSpy, 'Still the root logger')?.context)
          .toEqual({ className: 'OneBunApplication' });
      } finally {
        await app.stop();
      }
    });
  });

  describe('Enabling JSON Logging with Trace Context', () => {
    /**
     * docs: with `loggerOptions.format: 'json'` and `tracing` enabled, "trace context will
     * appear in all logs" — every entry written during an HTTP request carries the request's
     * trace id, with no change to the controller code.
     *
     * @source docs:api/logger.md#option-1-via-application-options-recommended
     */
    it('should stamp the request trace context onto JSON log entries', async () => {
      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        async create() {
          this.logger.debug('below the configured minimum');
          this.logger.info('User created', { userId: 'usr_123' });

          return await Promise.resolve({ id: 'usr_123' });
        }
      }

      @Module({ controllers: [UserController] })
      class AppModule {}

      // From docs: Option 1: Via Application Options (Recommended)
      const app = withEnv(NEUTRAL_ENV, () => new OneBunApplication(AppModule, {
        // `port: 0` stands in for the documented 3000 so the test never fights for a port
        port: 0,
        host: '127.0.0.1',
        // Enable JSON logging
        loggerOptions: {
          minLevel: 'info',
          format: 'json',
        },
        // Enable tracing — trace context will appear in all logs
        tracing: {
          enabled: true,
          serviceName: 'user-service',
          traceHttpRequests: true,
        },
        metrics: { enabled: false },
        gracefulShutdown: false,
      }));

      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';

      try {
        await app.start();
        clearConsoleSpies();

        const response = await fetch(`${app.getHttpUrl()}/users`, {
          headers: { traceparent: `00-${incomingTraceId}-00f067aa0ba902b7-01` },
        });

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(await response.json()).toEqual({ success: true, result: { id: 'usr_123' } });

        const line = jsonLine(infoSpy, 'User created');

        // JSON output, with the handler's context...
        expect(line?.level).toBe('info');
        expect(line?.context).toEqual({ className: 'UserController', userId: 'usr_123' });

        // ...and the trace context of the request, injected without the handler asking
        expect(line?.trace?.traceId).toBe(incomingTraceId);
        expect(line?.trace?.spanId).toMatch(/^[0-9a-f]{16}$/);

        // minLevel: 'info' still applies inside a traced request
        expect(jsonLines(logSpy).map((entry) => entry.message))
          .not.toContain('below the configured minimum');
      } finally {
        await app.stop();
      }
    });
  });

  describe('Testing — Mock Logger', () => {
    /**
     * docs: `makeMockLoggerLayer()` "returns a silent layer" — an application wired with it
     * writes nothing to the console at any level.
     *
     * Silence on its own is also what a dead logging pipeline produces, so the same handler runs
     * a second time behind the ordinary console layer: the two entries missing from the first
     * half have to show up in the second, or the mock layer is not what made the app quiet.
     *
     * @source docs:api/logger.md#mock-logger
     */
    it('should swallow every entry when the app uses makeMockLoggerLayer()', async () => {
      @Controller('/ping')
      class PingController extends BaseController {
        @Get('/')
        async ping() {
          this.logger.error('handler noise', new Error('boom'));
          this.logger.warn('handler noise');

          return await Promise.resolve({ ok: true });
        }
      }

      @Module({ controllers: [PingController] })
      class AppModule {}

      @Module({ controllers: [PingController] })
      class ControlModule {}

      // From docs: Mock Logger
      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();
        clearConsoleSpies();

        const logger = app.getLogger();
        logger.trace('silent');
        logger.debug('silent');
        logger.info('silent');
        logger.warn('silent');
        logger.error('silent', new Error('silent'));
        logger.fatal('silent');
        logger.child({ className: 'Bootstrap' }).info('silent from a child');

        const response = await fetch(`${app.getHttpUrl()}/ping`);
        expect(response.status).toBe(HttpStatusCode.OK);

        expect(logSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        await app.stop();
      }

      // Positive control: same controller, same console spies, only the layer differs
      const control = withEnv(NEUTRAL_ENV, () => new OneBunApplication(ControlModule, {
        port: 0,
        host: '127.0.0.1',
        loggerOptions: { minLevel: 'debug', format: 'json' },
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      }));

      try {
        await control.start();
        clearConsoleSpies();

        const controlResponse = await fetch(`${control.getHttpUrl()}/ping`);
        expect(controlResponse.status).toBe(HttpStatusCode.OK);

        // The very entries the mock layer swallowed do reach the console without it
        expect(jsonLine(errorSpy, 'handler noise')?.level).toBe('error');
        expect(jsonLine(errorSpy, 'handler noise')?.context)
          .toEqual({ className: 'PingController' });
        expect(jsonLine(warnSpy, 'handler noise')?.level).toBe('warn');
      } finally {
        await control.stop();
      }
    });

    /**
     * docs: to assert on what was logged, provide a layer that records — the documented
     * `capturingLogger` shape, wired through `loggerLayer`, collects the entries an
     * exercised application produced.
     *
     * @source docs:api/logger.md#mock-logger
     */
    it('should collect entries through a recording loggerLayer', async () => {
      // From docs: the capturing logger example
      const logs: Array<{ level: string; message: string }> = [];

      const record = (level: string) => (message: string) =>
        Effect.sync(() => {
          logs.push({ level, message });
        });

      const capturingLogger: Logger = {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        fatal: record('fatal'),
        child: () => capturingLogger,
      };

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        async create() {
          this.logger.info('User created');

          return await Promise.resolve({ id: 'usr_1' });
        }
      }

      @Module({ controllers: [UserController] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: Layer.succeed(LoggerService, capturingLogger),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();

        // ... exercise the application ...
        const response = await fetch(`${app.getHttpUrl()}/users`);
        expect(response.status).toBe(HttpStatusCode.OK);

        expect(logs).toContainEqual({ level: 'info', message: 'User created' });

        // Nothing reached the console: the recording layer replaced the console transport
        expect(infoSpy).not.toHaveBeenCalled();
      } finally {
        await app.stop();
      }
    });
  });

  describe('Complete Example', () => {
    /**
     * docs: the PaymentService walkthrough — a child logger carries the operation context
     * through every branch, the decline path warns instead of failing, and a thrown error is
     * logged with the error object before being rethrown.
     *
     * @source docs:api/logger.md#complete-example
     */
    it('should carry child-logger context through the documented payment flow', async () => {
      const captured: CapturedLog[] = [];

      interface PaymentResult {
        success: boolean;
        transactionId?: string;
        declineReason?: string;
      }

      @Service()
      class PaymentGateway extends BaseService {
        async charge(input: { orderId: string; amount: number; currency: string }): Promise<PaymentResult> {
          return await Promise.resolve({ success: true, transactionId: `txn-${input.orderId}` });
        }
      }

      // From docs: Complete Example
      @Service()
      class PaymentService extends BaseService {
        constructor(private gateway: PaymentGateway) {
          super();
        }

        @Span('process-payment')
        async processPayment(orderId: string, amount: number): Promise<PaymentResult> {
          const logger = this.logger.child({
            orderId,
            amount,
            operation: 'processPayment',
          });

          logger.info('Payment processing started');

          try {
            // Validate
            logger.debug('Validating payment');
            await this.validatePayment(amount);

            // Process
            logger.debug('Charging payment gateway');
            const result = await this.gateway.charge({
              orderId,
              amount,
              currency: 'USD',
            });

            if (result.success) {
              logger.info('Payment successful', {
                transactionId: result.transactionId,
              });
            } else {
              logger.warn('Payment declined', {
                reason: result.declineReason,
              });
            }

            return result;
          } catch (error) {
            logger.error('Payment processing failed', error);
            throw error;
          }
        }

        private async validatePayment(amount: number): Promise<void> {
          if (amount <= 0) {
            this.logger.warn('Invalid payment amount', { amount });
            throw new Error('Amount must be positive');
          }

          await Promise.resolve();
        }
      }

      registerDependencies(PaymentService, [PaymentGateway]);

      @Module({ providers: [PaymentGateway, PaymentService] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: Layer.succeed(LoggerService, makeCapturingLogger(captured)),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();
        const payments = app.getService(PaymentService);

        captured.length = 0;
        const charged = await payments.processPayment('order-1', 100);

        expect(charged).toEqual({ success: true, transactionId: 'txn-order-1' });

        const successLogs = linesOf(captured, 'PaymentService');
        expect(signature(successLogs)).toEqual([
          'info:Payment processing started',
          'debug:Validating payment',
          'debug:Charging payment gateway',
          'info:Payment successful',
        ]);

        // Every line of the flow inherits the child context, not just the first
        const operationContext = {
          className: 'PaymentService',
          orderId: 'order-1',
          amount: 100,
          operation: 'processPayment',
        };
        expect(successLogs[0]?.context).toEqual(operationContext);
        expect(successLogs[2]?.context).toEqual(operationContext);
        expect(successLogs[3]?.context).toEqual({
          ...operationContext,
          transactionId: 'txn-order-1',
        });

        // Decline path: the gateway says no, the flow warns and returns the result
        const gateway = app.getService(PaymentGateway);
        gateway.charge = async () => await Promise.resolve({
          success: false,
          declineReason: 'insufficient_funds',
        });

        captured.length = 0;
        const declined = await payments.processPayment('order-2', 250);

        expect(declined).toEqual({ success: false, declineReason: 'insufficient_funds' });

        const declineLog = linesOf(captured, 'PaymentService').at(-1);
        expect(declineLog?.level).toBe('warn');
        expect(declineLog?.message).toBe('Payment declined');
        expect(declineLog?.context).toEqual({
          className: 'PaymentService',
          orderId: 'order-2',
          amount: 250,
          operation: 'processPayment',
          reason: 'insufficient_funds',
        });

        // Failure path: validation warns through the un-childed logger, the catch logs the
        // error object, and the rejection still reaches the caller
        captured.length = 0;
        await expect(payments.processPayment('order-3', -5)).rejects.toThrow('Amount must be positive');

        const failureLogs = linesOf(captured, 'PaymentService');
        expect(signature(failureLogs)).toEqual([
          'info:Payment processing started',
          'debug:Validating payment',
          'warn:Invalid payment amount',
          'error:Payment processing failed',
        ]);
        expect(failureLogs[2]?.context).toEqual({ className: 'PaymentService', amount: -5 });
        expect(failureLogs[3]?.error?.message).toBe('Amount must be positive');
        expect(failureLogs[3]?.context).toEqual({
          className: 'PaymentService',
          orderId: 'order-3',
          amount: -5,
          operation: 'processPayment',
        });
      } finally {
        await app.stop();
      }
    });
  });
});

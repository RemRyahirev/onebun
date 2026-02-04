/**
 * Documentation Examples Tests for @onebun/logger
 *
 * This file tests code examples from:
 * - packages/logger/README.md
 * - docs/api/logger.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
} from 'bun:test';
import { Effect } from 'effect';

import {
  createSyncLogger,
  makeLogger,
  LoggerService,
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

describe('Logger README Examples', () => {
  describe('Basic Usage (README)', () => {
    /**
     * @source packages/logger/README.md#basic-usage
     */
    it('should create logger based on NODE_ENV', () => {
      // From README: Create a logger based on NODE_ENV
      const loggerLayer = makeLogger();

      expect(loggerLayer).toBeDefined();
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

      // Should run without error
      await Effect.runPromise(Effect.provide(program, loggerLayer));
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

      // From README: Use directly
      expect(() => {
        syncLogger.info('Hello, World!');
        syncLogger.error('Something went wrong', new Error('Oops'));
        syncLogger.debug('Debug data', { userId: 123, action: 'login' });
      }).not.toThrow();
    });
  });

  describe('Log Levels (README)', () => {
    it('should support all log levels', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From README: Log Levels table
      expect(() => {
        syncLogger.trace('Detailed tracing information'); // Level 0
        syncLogger.debug('Debug information for development'); // Level 1
        syncLogger.info('General informational messages'); // Level 2
        syncLogger.warn('Warning messages'); // Level 3
        syncLogger.error('Error messages'); // Level 4
        syncLogger.fatal('Critical errors that may crash the app'); // Level 5
      }).not.toThrow();
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

      // All logs include the context
      expect(() => {
        requestLogger.info('Processing request');
      }).not.toThrow();

      // From README: Create nested child
      const dbLogger = requestLogger.child({ component: 'database' });
      expect(() => {
        dbLogger.debug('Query executed');
      }).not.toThrow();
    });
  });
});

describe('Logger API Documentation Examples', () => {
  describe('SyncLogger Interface (docs/api/logger.md)', () => {
    it('should implement all interface methods', async () => {
      // From docs: SyncLogger interface
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // Verify all methods exist
      expect(typeof syncLogger.trace).toBe('function');
      expect(typeof syncLogger.debug).toBe('function');
      expect(typeof syncLogger.info).toBe('function');
      expect(typeof syncLogger.warn).toBe('function');
      expect(typeof syncLogger.error).toBe('function');
      expect(typeof syncLogger.fatal).toBe('function');
      expect(typeof syncLogger.child).toBe('function');
    });
  });

  describe('Logging with Context (docs/api/logger.md)', () => {
    it('should log with object context', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From docs: Object Context example
      expect(() => {
        syncLogger.info('User action', {
          userId: '123',
          action: 'login',
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        });
      }).not.toThrow();
    });

    it('should log errors', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From docs: Error Logging example
      const error = new Error('Something went wrong');

      expect(() => {
        // Error objects are specially handled
        syncLogger.error('Operation failed', error);

        // With additional context
        syncLogger.error('Operation failed', error, {
          operationId: '123',
          userId: '456',
        });
      }).not.toThrow();
    });

    it('should log with multiple arguments', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      const requestData = { method: 'GET', path: '/api/users' };

      // From docs: Multiple Arguments example
      expect(() => {
        syncLogger.debug(
          'Processing request',
          requestData, // Object merged into context
          { step: 1 }, // Another object merged
          'additional info', // String goes to additionalData
          42, // Number goes to additionalData
        );
      }).not.toThrow();
    });
  });

  describe('Child Loggers Pattern (docs/api/logger.md)', () => {
    it('should create child logger with inherited context', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const baseLogger = createSyncLogger(logger);

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

      // Just await without expect - void promise works correctly
      await processOrder('123');
      // If we got here without throwing, the test passed
      expect(true).toBe(true);
    });
  });

  describe('Best Practices (docs/api/logger.md)', () => {
    it('should use appropriate log levels', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From docs: Best Practices - Use Appropriate Log Levels
      expect(() => {
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
      }).not.toThrow();
    });

    it('should include relevant context', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From docs: Best Practices - Include Relevant Context
      // Good: Includes useful context
      expect(() => {
        syncLogger.info('Order placed', {
          orderId: 'order-123',
          customerId: 'customer-456',
          total: 99.99,
          itemCount: 3,
        });
      }).not.toThrow();

      // Bad: Missing context (still valid but not recommended)
      expect(() => {
        syncLogger.info('Order placed');
      }).not.toThrow();
    });

    it('should use child loggers for operations', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const baseLogger = createSyncLogger(logger);

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

      // Just await without expect - void promise works correctly
      await processRequest('req-123', 'user-456');
      // If we got here without throwing, the test passed
      expect(true).toBe(true);
    });

    it('should not log sensitive data', async () => {
      const loggerLayer = makeLogger();
      const logger = Effect.runSync(Effect.provide(LoggerService, loggerLayer));
      const syncLogger = createSyncLogger(logger);

      // From docs: Best Practices - Don't Log Sensitive Data
      const email = 'user@example.com';
      const password = 'secret123';

      // Good: Omit sensitive fields
      expect(() => {
        syncLogger.info('User login', { email });
      }).not.toThrow();

      // Or mask them
      expect(() => {
        syncLogger.info('User login', { email, password: '***' });
      }).not.toThrow();

      // Bad: Logs password (don't do this in real code)
      // This test just verifies it doesn't crash
      expect(() => {
        syncLogger.info('User login', { email, password });
      }).not.toThrow();
    });
  });
});

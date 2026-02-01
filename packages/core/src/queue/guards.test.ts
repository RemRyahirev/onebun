/**
 * Queue Guards Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import type {
  Message,
  MessageMetadata,
  MessageGuard,
  MessageExecutionContext,
} from './types';

import {
  MessageExecutionContextImpl,
  MessageAuthGuard,
  MessageServiceGuard,
  MessageHeaderGuard,
  MessageTraceGuard,
  MessageAllGuards,
  MessageAnyGuard,
  executeMessageGuards,
  createMessageGuard,
} from './guards';

// Helper to create a mock message
function createMockMessage(metadata: MessageMetadata = {}): Message {
  return {
    id: 'test-id',
    pattern: 'test.pattern',
    data: { test: true },
    timestamp: Date.now(),
    metadata,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async ack() {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async nack() {},
  };
}

// Helper to create execution context
function createContext(metadata: MessageMetadata = {}): MessageExecutionContext {
  const message = createMockMessage(metadata);

  return new MessageExecutionContextImpl(
    message,
    'test.pattern',
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    () => {},
    class TestHandler {},
  );
}

describe('queue-guards', () => {
  describe('MessageExecutionContextImpl', () => {
    it('should provide message access', () => {
      const message = createMockMessage({ authorization: 'Bearer token' });
      const context = new MessageExecutionContextImpl(
        message,
        'test.pattern',
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        () => {},
        class TestHandler {},
      );

      expect(context.getMessage()).toBe(message);
    });

    it('should provide metadata access', () => {
      const context = createContext({ authorization: 'Bearer token' });
      const metadata = context.getMetadata();

      expect(metadata.authorization).toBe('Bearer token');
    });

    it('should provide pattern access', () => {
      const context = createContext();
      expect(context.getPattern()).toBe('test.pattern');
    });

    it('should provide handler access', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler = () => {};
      const message = createMockMessage();
      const context = new MessageExecutionContextImpl(
        message,
        'test.pattern',
        handler,
        class TestHandler {},
      );

      expect(context.getHandler()).toBe(handler);
    });

    it('should provide class access', () => {
      class TestHandler {}
      const message = createMockMessage();
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const context = new MessageExecutionContextImpl(message, 'test.pattern', () => {}, TestHandler);

      expect(context.getClass()).toBe(TestHandler);
    });
  });

  describe('MessageAuthGuard', () => {
    it('should pass when authorization is present', () => {
      const guard = new MessageAuthGuard();
      const context = createContext({ authorization: 'Bearer token123' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should fail when authorization is missing', () => {
      const guard = new MessageAuthGuard();
      const context = createContext({});

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should fail when authorization is empty', () => {
      const guard = new MessageAuthGuard();
      const context = createContext({ authorization: '' });

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('MessageServiceGuard', () => {
    it('should pass for allowed service', () => {
      const guard = new MessageServiceGuard(['payment-service', 'order-service']);
      const context = createContext({ serviceId: 'payment-service' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should fail for disallowed service', () => {
      const guard = new MessageServiceGuard(['payment-service']);
      const context = createContext({ serviceId: 'unknown-service' });

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should fail when serviceId is missing', () => {
      const guard = new MessageServiceGuard(['payment-service']);
      const context = createContext({});

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  /* eslint-disable @typescript-eslint/naming-convention */
  describe('MessageHeaderGuard', () => {
    it('should pass when header is present', () => {
      const guard = new MessageHeaderGuard('x-api-key');
      const context = createContext({ headers: { 'x-api-key': 'secret' } });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should fail when header is missing', () => {
      const guard = new MessageHeaderGuard('x-api-key');
      const context = createContext({ headers: {} });

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should fail when headers object is missing', () => {
      const guard = new MessageHeaderGuard('x-api-key');
      const context = createContext({});

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should check expected value when provided', () => {
      const guard = new MessageHeaderGuard('x-api-key', 'expected-value');
      const contextMatch = createContext({ headers: { 'x-api-key': 'expected-value' } });
      const contextNoMatch = createContext({ headers: { 'x-api-key': 'wrong-value' } });

      expect(guard.canActivate(contextMatch)).toBe(true);
      expect(guard.canActivate(contextNoMatch)).toBe(false);
    });
  /* eslint-enable @typescript-eslint/naming-convention */
  });

  describe('MessageTraceGuard', () => {
    it('should pass when traceId is present', () => {
      const guard = new MessageTraceGuard();
      const context = createContext({ traceId: 'trace-123' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should fail when traceId is missing', () => {
      const guard = new MessageTraceGuard();
      const context = createContext({});

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('MessageAllGuards', () => {
    it('should pass when all guards pass', async () => {
      const guard = new MessageAllGuards([MessageAuthGuard, MessageTraceGuard]);
      const context = createContext({ authorization: 'Bearer token', traceId: 'trace-123' });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should fail when any guard fails', async () => {
      const guard = new MessageAllGuards([MessageAuthGuard, MessageTraceGuard]);
      const context = createContext({ authorization: 'Bearer token' }); // No traceId

      const result = await guard.canActivate(context);
      expect(result).toBe(false);
    });

    it('should accept guard instances', async () => {
      const serviceGuard = new MessageServiceGuard(['allowed-service']);
      const guard = new MessageAllGuards([serviceGuard, MessageAuthGuard]);
      const context = createContext({ serviceId: 'allowed-service', authorization: 'Bearer token' });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('MessageAnyGuard', () => {
    it('should pass when any guard passes', async () => {
      const guard = new MessageAnyGuard([MessageAuthGuard, MessageTraceGuard]);
      const context = createContext({ authorization: 'Bearer token' }); // Only auth, no trace

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should fail when all guards fail', async () => {
      const guard = new MessageAnyGuard([MessageAuthGuard, MessageTraceGuard]);
      const context = createContext({}); // No auth, no trace

      const result = await guard.canActivate(context);
      expect(result).toBe(false);
    });
  });

  describe('executeMessageGuards', () => {
    it('should execute all guards and return true when all pass', async () => {
      const context = createContext({ authorization: 'Bearer token' });
      const result = await executeMessageGuards([MessageAuthGuard], context);

      expect(result).toBe(true);
    });

    it('should return false when any guard fails', async () => {
      const context = createContext({});
      const result = await executeMessageGuards([MessageAuthGuard], context);

      expect(result).toBe(false);
    });

    it('should short-circuit on first failure', async () => {
      let secondGuardCalled = false;

      class SecondGuard implements MessageGuard {
        canActivate(): boolean {
          secondGuardCalled = true;

          return true;
        }
      }

      const context = createContext({}); // Will fail auth guard
      await executeMessageGuards([MessageAuthGuard, SecondGuard], context);

      expect(secondGuardCalled).toBe(false);
    });
  });

  describe('createMessageGuard', () => {
    it('should create guard from function', () => {
      const guard = createMessageGuard((context) => {
        return context.getMetadata().authorization === 'secret';
      });

      const passContext = createContext({ authorization: 'secret' });
      const failContext = createContext({ authorization: 'wrong' });

      expect(guard.canActivate(passContext)).toBe(true);
      expect(guard.canActivate(failContext)).toBe(false);
    });

    it('should support async functions', async () => {
      const guard = createMessageGuard(async (context) => {
        await Promise.resolve(); // Simulate async operation

        return !!context.getMetadata().authorization;
      });

      const context = createContext({ authorization: 'token' });
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});

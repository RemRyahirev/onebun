/**
 * Queue Decorators Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import type {
  Message,
  MessageGuard,
  MessageExecutionContext,
} from './types';

import {
  Subscribe,
  Cron,
  Interval,
  Timeout,
  UseMessageGuards,
  OnQueueReady,
  OnQueueError,
  OnMessageFailed,
  OnMessageReceived,
  OnMessageProcessed,
  getSubscribeMetadata,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
  getMessageGuards,
  getLifecycleHandlers,
  hasQueueDecorators,
  QUEUE_METADATA,
} from './decorators';

describe('queue-decorators', () => {
  describe('@Subscribe', () => {
    it('should register subscribe metadata', () => {
      class TestService {
        @Subscribe('orders.created')
        handleOrderCreated(_message: Message) {}
      }

      const metadata = getSubscribeMetadata(TestService);
      expect(metadata.length).toBe(1);
      expect(metadata[0].pattern).toBe('orders.created');
      expect(metadata[0].propertyKey).toBe('handleOrderCreated');
    });

    it('should support subscribe options', () => {
      class TestService {
        @Subscribe('orders.*', { ackMode: 'manual', group: 'order-processors' })
        handleOrder(_message: Message) {}
      }

      const metadata = getSubscribeMetadata(TestService);
      expect(metadata[0].options?.ackMode).toBe('manual');
      expect(metadata[0].options?.group).toBe('order-processors');
    });

    it('should support multiple subscriptions', () => {
      class TestService {
        @Subscribe('orders.created')
        handleOrderCreated(_message: Message) {}

        @Subscribe('orders.updated')
        handleOrderUpdated(_message: Message) {}
      }

      const metadata = getSubscribeMetadata(TestService);
      expect(metadata.length).toBe(2);
    });
  });

  describe('@Cron', () => {
    it('should register cron metadata', () => {
      class TestService {
        @Cron('0 0 9 * * *', { pattern: 'reports.daily' })
        getDailyReport() {
          return { type: 'daily' };
        }
      }

      const metadata = getCronMetadata(TestService);
      expect(metadata.length).toBe(1);
      expect(metadata[0].expression).toBe('0 0 9 * * *');
      expect(metadata[0].options.pattern).toBe('reports.daily');
      expect(metadata[0].options.name).toBe('getDailyReport');
    });

    it('should support custom job name', () => {
      class TestService {
        @Cron('0 0 * * * *', { pattern: 'health.check', name: 'hourly-health' })
        checkHealth() {
          return { status: 'ok' };
        }
      }

      const metadata = getCronMetadata(TestService);
      expect(metadata[0].options.name).toBe('hourly-health');
    });
  });

  describe('@Interval', () => {
    it('should register interval metadata', () => {
      class TestService {
        @Interval(60000, { pattern: 'health.check' })
        getHealthData() {
          return { timestamp: Date.now() };
        }
      }

      const metadata = getIntervalMetadata(TestService);
      expect(metadata.length).toBe(1);
      expect(metadata[0].milliseconds).toBe(60000);
      expect(metadata[0].options.pattern).toBe('health.check');
    });
  });

  describe('@Timeout', () => {
    it('should register timeout metadata', () => {
      class TestService {
        @Timeout(5000, { pattern: 'init.complete' })
        getInitData() {
          return { started: true };
        }
      }

      const metadata = getTimeoutMetadata(TestService);
      expect(metadata.length).toBe(1);
      expect(metadata[0].milliseconds).toBe(5000);
      expect(metadata[0].options.pattern).toBe('init.complete');
    });
  });

  describe('@UseMessageGuards', () => {
    it('should register guard metadata', () => {
      class TestGuard implements MessageGuard {
        canActivate(_context: MessageExecutionContext): boolean {
          return true;
        }
      }

      class TestService {
        @UseMessageGuards(TestGuard)
        @Subscribe('secure.events')
        handleSecureEvent(_message: Message) {}
      }

      const guards = getMessageGuards(TestService, 'handleSecureEvent');
      expect(guards.length).toBe(1);
      expect(guards[0]).toBe(TestGuard);
    });

    it('should support multiple guards', () => {
      class Guard1 implements MessageGuard {
        canActivate(): boolean {
          return true;
        }
      }
      class Guard2 implements MessageGuard {
        canActivate(): boolean {
          return true;
        }
      }

      class TestService {
        @UseMessageGuards(Guard1, Guard2)
        @Subscribe('secure.events')
        handleSecureEvent(_message: Message) {}
      }

      const guards = getMessageGuards(TestService, 'handleSecureEvent');
      expect(guards.length).toBe(2);
    });
  });

  describe('Lifecycle decorators', () => {
    it('should register @OnQueueReady handler', () => {
      class TestService {
        @OnQueueReady()
        handleReady() {}
      }

      const handlers = getLifecycleHandlers(TestService, 'ON_READY');
      expect(handlers.length).toBe(1);
      expect(handlers[0].propertyKey).toBe('handleReady');
    });

    it('should register @OnQueueError handler', () => {
      class TestService {
        @OnQueueError()
        handleError(_error: Error) {}
      }

      const handlers = getLifecycleHandlers(TestService, 'ON_ERROR');
      expect(handlers.length).toBe(1);
    });

    it('should register @OnMessageFailed handler', () => {
      class TestService {
        @OnMessageFailed()
        handleFailed(_message: Message, _error: Error) {}
      }

      const handlers = getLifecycleHandlers(TestService, 'ON_MESSAGE_FAILED');
      expect(handlers.length).toBe(1);
    });

    it('should register @OnMessageReceived handler', () => {
      class TestService {
        @OnMessageReceived()
        handleReceived(_message: Message) {}
      }

      const handlers = getLifecycleHandlers(TestService, 'ON_MESSAGE_RECEIVED');
      expect(handlers.length).toBe(1);
    });

    it('should register @OnMessageProcessed handler', () => {
      class TestService {
        @OnMessageProcessed()
        handleProcessed(_message: Message) {}
      }

      const handlers = getLifecycleHandlers(TestService, 'ON_MESSAGE_PROCESSED');
      expect(handlers.length).toBe(1);
    });
  });

  describe('hasQueueDecorators', () => {
    it('should return true when class has subscribe decorators', () => {
      class TestService {
        @Subscribe('test')
        handle(_message: Message) {}
      }

      expect(hasQueueDecorators(TestService)).toBe(true);
    });

    it('should return true when class has cron decorators', () => {
      class TestService {
        @Cron('* * * * *', { pattern: 'test' })
        handle() {}
      }

      expect(hasQueueDecorators(TestService)).toBe(true);
    });

    it('should return true when class has interval decorators', () => {
      class TestService {
        @Interval(1000, { pattern: 'test' })
        handle() {}
      }

      expect(hasQueueDecorators(TestService)).toBe(true);
    });

    it('should return true when class has timeout decorators', () => {
      class TestService {
        @Timeout(1000, { pattern: 'test' })
        handle() {}
      }

      expect(hasQueueDecorators(TestService)).toBe(true);
    });

    it('should return false when class has no queue decorators', () => {
      class TestService {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        handle() {}
      }

      expect(hasQueueDecorators(TestService)).toBe(false);
    });
  });

  describe('QUEUE_METADATA keys', () => {
    it('should have all required metadata keys', () => {
      expect(QUEUE_METADATA.SUBSCRIBE).toBeDefined();
      expect(QUEUE_METADATA.CRON).toBeDefined();
      expect(QUEUE_METADATA.INTERVAL).toBeDefined();
      expect(QUEUE_METADATA.TIMEOUT).toBeDefined();
      expect(QUEUE_METADATA.GUARDS).toBeDefined();
      expect(QUEUE_METADATA.ON_READY).toBeDefined();
      expect(QUEUE_METADATA.ON_ERROR).toBeDefined();
      expect(QUEUE_METADATA.ON_MESSAGE_FAILED).toBeDefined();
    });
  });
});

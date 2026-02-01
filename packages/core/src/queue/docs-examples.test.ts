/**
 * Documentation Examples Tests for Queue Module
 *
 * This file tests code examples from:
 * - docs/api/queue.md
 *
 * Each test case corresponds to a code block in the documentation.
 * Keep these tests in sync with the documentation!
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import {
  Subscribe,
  Cron,
  Interval,
  Timeout,
  UseMessageGuards,
  OnQueueReady,
  OnQueueError,
  OnMessageReceived,
  OnMessageProcessed,
  OnMessageFailed,
  MessageAuthGuard,
  MessageServiceGuard,
  MessageHeaderGuard,
  MessageTraceGuard,
  MessageAllGuards,
  MessageAnyGuard,
  createMessageGuard,
  type Message,
  CronExpression,
  parseCronExpression,
  getNextRun,
  isValidCronExpression,
  matchQueuePattern,
  isQueuePatternMatch,
  createQueuePatternMatcher,
  InMemoryQueueAdapter,
  getSubscribeMetadata,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
  hasQueueDecorators,
} from './index';

/**
 * @source docs/api/queue.md#quick-start
 */
describe('Quick Start Example (docs/api/queue.md)', () => {
  it('should define service with queue decorators', () => {
    // From docs/api/queue.md: Quick Start
    class OrderService {
      @OnQueueReady()
      onReady() {
        // console.log('Queue connected');
      }

      @Subscribe('orders.created')
      async handleOrderCreated(message: Message<{ orderId: number }>) {
        // console.log('New order:', message.data.orderId);
        expect(message.data.orderId).toBeDefined();
      }

      @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.expired' })
      getCleanupData() {
        return { timestamp: Date.now() };
      }
    }

    // Verify decorators are registered
    expect(hasQueueDecorators(OrderService)).toBe(true);

    const subscriptions = getSubscribeMetadata(OrderService);
    expect(subscriptions.length).toBe(1);
    expect(subscriptions[0].pattern).toBe('orders.created');

    const cronJobs = getCronMetadata(OrderService);
    expect(cronJobs.length).toBe(1);
    expect(cronJobs[0].expression).toBe(CronExpression.EVERY_HOUR);
    expect(cronJobs[0].options.pattern).toBe('cleanup.expired');
  });
});

/**
 * @source docs/api/queue.md#subscribe-decorator
 */
describe('Subscribe Decorator Examples (docs/api/queue.md)', () => {
  it('should match wildcard patterns', () => {
    // From docs/api/queue.md: Pattern Syntax table
    // orders.created -> exact match
    expect(matchQueuePattern('orders.created', 'orders.created').matched).toBe(true);

    // orders.* -> single-level wildcard
    expect(matchQueuePattern('orders.*', 'orders.created').matched).toBe(true);
    expect(matchQueuePattern('orders.*', 'orders.updated').matched).toBe(true);

    // events.# -> multi-level wildcard
    expect(matchQueuePattern('events.#', 'events.user.created').matched).toBe(true);
    expect(matchQueuePattern('events.#', 'events.order.paid').matched).toBe(true);

    // orders.{id} -> named parameter
    const result = matchQueuePattern('orders.{id}', 'orders.123');
    expect(result.matched).toBe(true);
    expect(result.params).toEqual({ id: '123' });
  });

  it('should define subscribe with options', () => {
    // From docs/api/queue.md: Subscribe Options
    class OrderProcessor {
      @Subscribe('orders.*', {
        ackMode: 'manual',
        group: 'order-processors',
        prefetch: 10,
        retry: {
          attempts: 3,
          backoff: 'exponential',
          delay: 1000,
        },
      })
      async handleOrder(message: Message<unknown>) {
        try {
          // await this.processOrder(message.data);
          await message.ack();
        } catch {
          await message.nack(true); // requeue
        }
      }
    }

    const subscriptions = getSubscribeMetadata(OrderProcessor);
    expect(subscriptions.length).toBe(1);
    expect(subscriptions[0].options?.ackMode).toBe('manual');
    expect(subscriptions[0].options?.group).toBe('order-processors');
    expect(subscriptions[0].options?.prefetch).toBe(10);
    expect(subscriptions[0].options?.retry?.attempts).toBe(3);
  });
});

/**
 * @source docs/api/queue.md#scheduling-decorators
 */
describe('Scheduling Decorators Examples (docs/api/queue.md)', () => {
  it('should define cron job with expression', () => {
    // From docs/api/queue.md: @Cron section
    class ReportService {
      // Daily at 9 AM
      @Cron('0 0 9 * * *', { pattern: 'reports.daily' })
      getDailyReportData() {
        return { type: 'daily', date: new Date() };
      }

      // Using CronExpression enum
      @Cron(CronExpression.EVERY_HOUR, { pattern: 'health.check' })
      getHealthData() {
        return { status: 'ok' };
      }
    }

    const cronJobs = getCronMetadata(ReportService);
    expect(cronJobs.length).toBe(2);

    expect(cronJobs[0].expression).toBe('0 0 9 * * *');
    expect(cronJobs[0].options.pattern).toBe('reports.daily');

    expect(cronJobs[1].expression).toBe(CronExpression.EVERY_HOUR);
    expect(cronJobs[1].options.pattern).toBe('health.check');
  });

  it('should define interval job', () => {
    // From docs/api/queue.md: @Interval section
    class MetricsService {
      // Every 60 seconds
      @Interval(60000, { pattern: 'metrics.collect' })
      getMetrics() {
        return { cpu: process.cpuUsage() };
      }
    }

    const intervals = getIntervalMetadata(MetricsService);
    expect(intervals.length).toBe(1);
    expect(intervals[0].milliseconds).toBe(60000);
    expect(intervals[0].options.pattern).toBe('metrics.collect');
  });

  it('should define timeout job', () => {
    // From docs/api/queue.md: @Timeout section
    class InitService {
      private startTime = Date.now();

      // After 5 seconds
      @Timeout(5000, { pattern: 'init.complete' })
      getInitData() {
        return { startedAt: this.startTime };
      }
    }

    const timeouts = getTimeoutMetadata(InitService);
    expect(timeouts.length).toBe(1);
    expect(timeouts[0].milliseconds).toBe(5000);
    expect(timeouts[0].options.pattern).toBe('init.complete');
  });
});

/**
 * @source docs/api/queue.md#cronexpression-constants
 */
describe('CronExpression Constants (docs/api/queue.md)', () => {
  it('should have valid cron expressions', () => {
    // From docs/api/queue.md: CronExpression Constants table
    expect(CronExpression.EVERY_SECOND).toBe('* * * * * *');
    expect(CronExpression.EVERY_5_SECONDS).toBe('*/5 * * * * *');
    expect(CronExpression.EVERY_MINUTE).toBe('0 * * * * *');
    expect(CronExpression.EVERY_5_MINUTES).toBe('0 */5 * * * *');
    expect(CronExpression.EVERY_HOUR).toBe('0 0 * * * *');
    expect(CronExpression.EVERY_DAY_AT_MIDNIGHT).toBe('0 0 0 * * *');
    expect(CronExpression.EVERY_DAY_AT_NOON).toBe('0 0 12 * * *');
    expect(CronExpression.EVERY_WEEKDAY).toBe('0 0 0 * * 1-5');
    expect(CronExpression.EVERY_WEEK).toBe('0 0 0 * * 0');
    expect(CronExpression.EVERY_MONTH).toBe('0 0 0 1 * *');

    // All should be valid
    expect(isValidCronExpression(CronExpression.EVERY_SECOND)).toBe(true);
    expect(isValidCronExpression(CronExpression.EVERY_HOUR)).toBe(true);
    expect(isValidCronExpression(CronExpression.EVERY_MONTH)).toBe(true);
  });
});

/**
 * @source docs/api/queue.md#message-guards
 */
describe('Message Guards Examples (docs/api/queue.md)', () => {
  it('should use built-in guards', () => {
    // From docs/api/queue.md: Built-in Guards section
    class SecureService {
      // Require authorization token
      @UseMessageGuards(MessageAuthGuard)
      @Subscribe('secure.events')
      async handleSecure(_message: Message<unknown>) {}

      // Require specific service
      @UseMessageGuards(new MessageServiceGuard(['payment-service']))
      @Subscribe('internal.events')
      async handleInternal(_message: Message<unknown>) {}

      // Require header
      @UseMessageGuards(new MessageHeaderGuard('x-api-key'))
      @Subscribe('api.events')
      async handleApi(_message: Message<unknown>) {}

      // Require trace context
      @UseMessageGuards(MessageTraceGuard)
      @Subscribe('traced.events')
      async handleTraced(_message: Message<unknown>) {}
    }

    expect(hasQueueDecorators(SecureService)).toBe(true);
    const subscriptions = getSubscribeMetadata(SecureService);
    expect(subscriptions.length).toBe(4);
  });

  it('should use composite guards', () => {
    // From docs/api/queue.md: Composite Guards section
    class StrictService {
      // All guards must pass
      @UseMessageGuards(
        new MessageAllGuards([MessageAuthGuard, new MessageServiceGuard(['allowed-service'])]),
      )
      @Subscribe('strict.events')
      async handleStrict(_message: Message<unknown>) {}

      // Any guard can pass
      @UseMessageGuards(
        new MessageAnyGuard([new MessageServiceGuard(['internal-service']), MessageAuthGuard]),
      )
      @Subscribe('flexible.events')
      async handleFlexible(_message: Message<unknown>) {}
    }

    expect(hasQueueDecorators(StrictService)).toBe(true);
  });

  it('should create custom guard', () => {
    // From docs/api/queue.md: Custom Guards section
    const customGuard = createMessageGuard((context) => {
      const metadata = context.getMetadata();

      return metadata.headers?.['x-custom'] === 'expected';
    });

    // Verify guard was created
    expect(typeof customGuard.canActivate).toBe('function');
  });
});

/**
 * @source docs/api/queue.md#lifecycle-decorators
 */
describe('Lifecycle Decorators Examples (docs/api/queue.md)', () => {
  it('should define lifecycle handlers', () => {
    // From docs/api/queue.md: Lifecycle Decorators section
    class EventService {
      @OnQueueReady()
      handleReady() {
        // console.log('Queue connected');
      }

      @OnQueueError()
      handleError(_error: Error) {
        // console.error('Queue error:', error);
      }

      @OnMessageReceived()
      handleReceived(_message: Message<unknown>) {
        // console.log(`Received: ${message.id}`);
      }

      @OnMessageProcessed()
      handleProcessed(_message: Message<unknown>) {
        // console.log(`Processed: ${message.id}`);
      }

      @OnMessageFailed()
      handleFailed(_message: Message<unknown>, _error: Error) {
        // console.error(`Failed: ${message.id}`, error);
      }
    }

    // Class should be defined without errors
    expect(EventService).toBeDefined();
  });
});

/**
 * @source docs/api/queue.md#inmemoryqueueadapter
 */
describe('InMemoryQueueAdapter Examples (docs/api/queue.md)', () => {
  let adapter: InMemoryQueueAdapter;

  beforeEach(async () => {
    adapter = new InMemoryQueueAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('should publish and subscribe', async () => {
    // From docs/api/queue.md: InMemoryQueueAdapter section
    const received: Message<unknown>[] = [];

    await adapter.subscribe('events.*', async (message) => {
      received.push(message);
    });

    await adapter.publish('events.created', { id: 1 });

    expect(received.length).toBe(1);
    expect((received[0].data as { id: number }).id).toBe(1);
  });
});

/**
 * @source docs/api/queue.md#cron-parser
 */
describe('Cron Parser Examples (docs/api/queue.md)', () => {
  it('should parse cron expression', () => {
    // From docs/api/queue.md: Cron Parser section
    const schedule = parseCronExpression('0 30 9 * * 1-5');

    expect(schedule.seconds).toEqual([0]);
    expect(schedule.minutes).toEqual([30]);
    expect(schedule.hours).toEqual([9]);
    expect(schedule.daysOfMonth.length).toBe(31);
    expect(schedule.months.length).toBe(12);
    expect(schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('should get next run time', () => {
    // From docs/api/queue.md: Cron Parser section
    const schedule = parseCronExpression('0 0 * * * *'); // Every hour
    const nextRun = getNextRun(schedule);

    expect(nextRun).not.toBeNull();
    expect(nextRun!.getMinutes()).toBe(0);
  });

  it('should validate expressions', () => {
    // From docs/api/queue.md: Cron Parser section
    expect(isValidCronExpression('0 0 * * *')).toBe(true);
    expect(isValidCronExpression('invalid')).toBe(false);
  });
});

/**
 * @source docs/api/queue.md#pattern-matcher
 */
describe('Pattern Matcher Examples (docs/api/queue.md)', () => {
  it('should match with parameter extraction', () => {
    // From docs/api/queue.md: Pattern Matcher section
    const result = matchQueuePattern('orders.{id}.status', 'orders.123.status');

    expect(result.matched).toBe(true);
    expect(result.params).toEqual({ id: '123' });
  });

  it('should perform simple match check', () => {
    // From docs/api/queue.md: Pattern Matcher section
    expect(isQueuePatternMatch('events.*', 'events.user')).toBe(true);
    expect(isQueuePatternMatch('events.*', 'orders.user')).toBe(false);
  });

  it('should create reusable matcher', () => {
    // From docs/api/queue.md: Pattern Matcher section
    const matcher = createQueuePatternMatcher('orders.*.status');

    expect(matcher('orders.123.status').matched).toBe(true);
    expect(matcher('orders.456.status').matched).toBe(true);
    expect(matcher('orders.123.other').matched).toBe(false);
  });
});

/**
 * @source docs/api/queue.md#feature-support-matrix
 */
describe('Feature Support Matrix (docs/api/queue.md)', () => {
  it('should report correct feature support for InMemoryQueueAdapter', () => {
    // From docs/api/queue.md: Feature Support Matrix table
    const adapter = new InMemoryQueueAdapter();

    // Supported
    expect(adapter.supports('pattern-subscriptions')).toBe(true);
    expect(adapter.supports('delayed-messages')).toBe(true);
    expect(adapter.supports('priority')).toBe(true);
    expect(adapter.supports('scheduled-jobs')).toBe(true);

    // Not supported
    expect(adapter.supports('consumer-groups')).toBe(false);
    expect(adapter.supports('dead-letter-queue')).toBe(false);
    expect(adapter.supports('retry')).toBe(false);
  });
});

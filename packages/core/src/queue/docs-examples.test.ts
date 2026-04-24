/**
 * Documentation Examples Tests for Queue Module
 *
 * @source docs:api/queue.md
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

import { UseInterceptors } from '../decorators/decorators';

import { getMessageInterceptors } from './decorators';

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
  type QueueAdapter,
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
  QueueScheduler,
  QueueService,
} from './index';

/**
 * @source docs:api/queue.md#setup
 */
describe('Setup Section Examples (docs/api/queue.md)', () => {
  it('should register controller with queue decorators in module controllers', () => {
    // From docs/api/queue.md: Registering Controllers with Queue Decorators
    class OrderProcessor {
      @Subscribe('orders.created')
      async handleOrderCreated(message: Message<{ orderId: string }>) {
        expect(message.data.orderId).toBeDefined();
      }

      @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.expired' })
      getCleanupData() {
        return { timestamp: Date.now() };
      }
    }

    // Verify decorators are registered and auto-discoverable
    expect(hasQueueDecorators(OrderProcessor)).toBe(true);

    const subscriptions = getSubscribeMetadata(OrderProcessor);
    expect(subscriptions.length).toBe(1);
    expect(subscriptions[0].pattern).toBe('orders.created');

    const cronJobs = getCronMetadata(OrderProcessor);
    expect(cronJobs.length).toBe(1);
  });

  it('should support error handling with manual ack mode', () => {
    // From docs/api/queue.md: Error Handling in Handlers
    class ErrorHandlingProcessor {
      @Subscribe('orders.created', {
        ackMode: 'manual',
        retry: { attempts: 3, backoff: 'exponential', delay: 1000 },
      })
      async handleOrder(message: Message<{ orderId: string }>) {
        try {
          // process order
          await message.ack();
        } catch {
          if (message.attempt && message.attempt >= (message.maxAttempts || 3)) {
            await message.ack();
          } else {
            await message.nack(true);
          }
        }
      }
    }

    const subscriptions = getSubscribeMetadata(ErrorHandlingProcessor);
    expect(subscriptions.length).toBe(1);
    expect(subscriptions[0].options?.ackMode).toBe('manual');
    expect(subscriptions[0].options?.retry?.attempts).toBe(3);
    expect(subscriptions[0].options?.retry?.backoff).toBe('exponential');
    expect(subscriptions[0].options?.retry?.delay).toBe(1000);
  });
});

/**
 * @source docs:api/queue.md#quick-start
 */
describe('Quick Start Example (docs/api/queue.md)', () => {
  it('should define controller with queue decorators', () => {
    // From docs/api/queue.md: Quick Start (queue handlers must be in controllers)
    class EventProcessor {
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
    expect(hasQueueDecorators(EventProcessor)).toBe(true);

    const subscriptions = getSubscribeMetadata(EventProcessor);
    expect(subscriptions.length).toBe(1);
    expect(subscriptions[0].pattern).toBe('orders.created');

    const cronJobs = getCronMetadata(EventProcessor);
    expect(cronJobs.length).toBe(1);
    expect(cronJobs[0].expression).toBe(CronExpression.EVERY_HOUR);
    expect(cronJobs[0].options.pattern).toBe('cleanup.expired');
  });

  it('should define controller with interval decorator', () => {
    // From docs/api/queue.md: Quick Start - Interval example
    class EventProcessor {
      @Subscribe('orders.created')
      async handleOrderCreated(message: Message<{ orderId: number }>) {
        expect(message.data.orderId).toBeDefined();
      }

      @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.expired' })
      getCleanupData() {
        return { timestamp: Date.now() };
      }

      @Interval(30000, { pattern: 'metrics.collect' })
      getMetricsData() {
        return { cpu: process.cpuUsage() };
      }
    }

    expect(hasQueueDecorators(EventProcessor)).toBe(true);

    const intervals = getIntervalMetadata(EventProcessor);
    expect(intervals.length).toBe(1);
    expect(intervals[0].milliseconds).toBe(30000);
    expect(intervals[0].options.pattern).toBe('metrics.collect');
  });
});

/**
 * @source docs:api/queue.md#subscribe-decorator
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
 * @source docs:api/queue.md#scheduling-decorators
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
 * @source docs:api/queue.md#cronexpression-constants
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
 * @source docs:api/queue.md#message-guards
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
 * @source docs:api/queue.md#lifecycle-decorators
 */
describe('Lifecycle Decorators Examples (docs/api/queue.md)', () => {
  it('should define lifecycle handlers on controller', () => {
    // From docs/api/queue.md: Lifecycle Decorators (handlers must be in controllers)
    class EventProcessor {
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

    // Class with lifecycle handlers only; hasQueueDecorators checks Subscribe/Cron/Interval/Timeout only
    expect(EventProcessor).toBeDefined();
  });
});

/**
 * @source docs:api/queue.md#custom-adapter-nats-jetstream
 */
describe('Custom adapter NATS JetStream (docs/api/queue.md)', () => {
  it('should use custom adapter constructor with options', async () => {
    // From docs/api/queue.md: Custom adapter: NATS JetStream
    // Minimal adapter class that implements QueueAdapter for use with queue: { adapter, options }
    /* eslint-disable @typescript-eslint/no-empty-function */
    class NatsJetStreamAdapter implements QueueAdapter {
      readonly name = 'nats-jetstream';
      readonly type = 'jetstream';
      constructor(private opts: { servers: string; streams?: Array<{ name: string; subjects: string[] }> }) {}
      async connect(): Promise<void> {}
      async disconnect(): Promise<void> {}
      isConnected(): boolean {
        return true;
      }
      async publish(): Promise<string> {
        return '';
      }
      async publishBatch(): Promise<string[]> {
        return [];
      }
      async subscribe(): Promise<import('./types').Subscription> {
        return {
          async unsubscribe() {},
          pause() {},
          resume() {},
          pattern: '',
          isActive: true,
        };
      }
      supports(): boolean {
        return false;
      }
      on(): void {}
      off(): void {}
    }
    /* eslint-enable @typescript-eslint/no-empty-function */

    const adapter = new NatsJetStreamAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
    });
    await adapter.connect();
    expect(adapter.name).toBe('nats-jetstream');
    expect(adapter.type).toBe('jetstream');
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
  });
});

/**
 * @source docs:api/queue.md#inmemoryqueueadapter
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
 * @source docs:api/queue.md#cron-parser
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
 * @source docs:api/queue.md#pattern-matcher
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
 * @source docs:api/queue.md#feature-support-matrix
 */
describe('Feature Support Matrix (docs/api/queue.md)', () => {
  it('should report correct feature support for InMemoryQueueAdapter', () => {
    // From docs/api/queue.md: Feature Support Matrix table
    const adapter = new InMemoryQueueAdapter();

    // Supported
    expect(adapter.supports('pattern-subscriptions')).toBe(true);
    expect(adapter.supports('delayed-messages')).toBe(true);
    expect(adapter.supports('priority')).toBe(true);
    // Not supported
    expect(adapter.supports('consumer-groups')).toBe(false);
    expect(adapter.supports('dead-letter-queue')).toBe(false);
    expect(adapter.supports('retry')).toBe(false);
  });
});

/**
 * @source docs:api/queue.md#setup (scheduled-only tip)
 */
describe('Scheduled-only Controllers (docs/api/queue.md)', () => {
  it('should auto-detect queue decorators on controller with only @Interval', () => {
    // From docs/api/queue.md: Scheduled-only Controllers tip
    class ScheduledOnlyController {
      @Interval(60000, { pattern: 'metrics.collect' })
      getMetrics() {
        return { cpu: process.cpuUsage() };
      }
    }

    // No @Subscribe — only scheduling decorators
    expect(hasQueueDecorators(ScheduledOnlyController)).toBe(true);
    expect(getSubscribeMetadata(ScheduledOnlyController).length).toBe(0);
    expect(getIntervalMetadata(ScheduledOnlyController).length).toBe(1);
  });

  it('should auto-detect queue decorators on controller with only @Cron', () => {
    class CronOnlyController {
      @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.expired' })
      getCleanupData() {
        return { timestamp: Date.now() };
      }
    }

    expect(hasQueueDecorators(CronOnlyController)).toBe(true);
    expect(getSubscribeMetadata(CronOnlyController).length).toBe(0);
    expect(getCronMetadata(CronOnlyController).length).toBe(1);
  });

  it('should auto-detect queue decorators on controller with only @Timeout', () => {
    class TimeoutOnlyController {
      @Timeout(5000, { pattern: 'startup.warmup' })
      getWarmupData() {
        return { type: 'warmup' };
      }
    }

    expect(hasQueueDecorators(TimeoutOnlyController)).toBe(true);
    expect(getSubscribeMetadata(TimeoutOnlyController).length).toBe(0);
    expect(getTimeoutMetadata(TimeoutOnlyController).length).toBe(1);
  });
});

/**
 * @source docs:api/queue.md#setup (error handling info)
 */
describe('Scheduled Job Error Handling (docs/api/queue.md)', () => {
  let adapter: InMemoryQueueAdapter;

  beforeEach(async () => {
    adapter = new InMemoryQueueAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('should continue scheduler after handler error via setErrorHandler', async () => {
    // From docs/api/queue.md: Scheduled Job Error Handling info
    const scheduler = new QueueScheduler(adapter);

    const errors: Array<{ name: string; error: unknown }> = [];
    scheduler.setErrorHandler((name: string, error: unknown) => {
      errors.push({ name, error });
    });

    // Add a job that will fail
    scheduler.addIntervalJob('failing-job', 60000, 'test.fail', () => {
      throw new Error('Job failed');
    });

    scheduler.start();

    // executeJob is async fire-and-forget, wait for it
    await new Promise(r => setTimeout(r, 50));

    // Error handler should have been called (immediate execution)
    expect(errors.length).toBe(1);
    expect(errors[0].name).toBe('failing-job');
    expect((errors[0].error as Error).message).toBe('Job failed');

    scheduler.stop();
  });
});

/**
 * @source docs:api/queue.md#dynamic-job-management
 */
describe('Dynamic Job Management (docs/api/queue.md)', () => {
  let queueService: QueueService;

  beforeEach(async () => {
    queueService = new QueueService({ adapter: 'memory' });
    const adapter = new InMemoryQueueAdapter();
    await queueService.initialize(adapter);
    await queueService.start();
  });

  afterEach(async () => {
    await queueService.stop();
  });

  it('should add and get a cron job', () => {
    // From docs/api/queue.md: Dynamic Job Management - addJob (cron)
    queueService.addJob({
      type: 'cron',
      name: 'cleanup',
      expression: '0 * * * *',
      pattern: 'jobs.cleanup',
    });

    const job = queueService.getJob('cleanup');
    expect(job).toBeDefined();
    expect(job!.type).toBe('cron');
    expect(job!.schedule.cron).toBe('0 * * * *');
    expect(job!.paused).toBe(false);
  });

  it('should add and get an interval job', () => {
    // From docs/api/queue.md: Dynamic Job Management - addJob (interval)
    queueService.addJob({
      type: 'interval',
      name: 'heartbeat',
      intervalMs: 5000,
      pattern: 'jobs.heartbeat',
    });

    const job = queueService.getJob('heartbeat');
    expect(job).toBeDefined();
    expect(job!.type).toBe('interval');
    expect(job!.schedule.every).toBe(5000);
  });

  it('should add and get a timeout job', () => {
    // From docs/api/queue.md: Dynamic Job Management - addJob (timeout)
    queueService.addJob({
      type: 'timeout',
      name: 'warmup',
      timeoutMs: 3000,
      pattern: 'jobs.warmup',
    });

    const job = queueService.getJob('warmup');
    expect(job).toBeDefined();
    expect(job!.type).toBe('timeout');
    expect(job!.schedule.timeout).toBe(3000);
  });

  it('should pause and resume a job', () => {
    // From docs/api/queue.md: Dynamic Job Management - pauseJob / resumeJob
    queueService.addJob({
      type: 'interval',
      name: 'metrics',
      intervalMs: 10000,
      pattern: 'jobs.metrics',
    });

    expect(queueService.pauseJob('metrics')).toBe(true);
    expect(queueService.getJob('metrics')!.paused).toBe(true);

    expect(queueService.resumeJob('metrics')).toBe(true);
    expect(queueService.getJob('metrics')!.paused).toBe(false);
  });

  it('should update a cron job expression', () => {
    // From docs/api/queue.md: Dynamic Job Management - updateJob
    queueService.addJob({
      type: 'cron',
      name: 'report',
      expression: '0 0 * * *',
      pattern: 'jobs.report',
    });

    expect(queueService.getJob('report')!.schedule.cron).toBe('0 0 * * *');

    queueService.updateJob({
      type: 'cron',
      name: 'report',
      expression: '0 */2 * * *',
    });

    expect(queueService.getJob('report')!.schedule.cron).toBe('0 */2 * * *');
  });

  it('should list and remove jobs', () => {
    // From docs/api/queue.md: Dynamic Job Management - getJobs / removeJob
    queueService.addJob({
      type: 'cron',
      name: 'job-a',
      expression: '0 * * * *',
      pattern: 'jobs.a',
    });
    queueService.addJob({
      type: 'interval',
      name: 'job-b',
      intervalMs: 5000,
      pattern: 'jobs.b',
    });
    queueService.addJob({
      type: 'timeout',
      name: 'job-c',
      timeoutMs: 1000,
      pattern: 'jobs.c',
    });

    const jobs = queueService.getJobs();
    expect(jobs.length).toBe(3);

    expect(queueService.removeJob('job-b')).toBe(true);
    expect(queueService.hasJob('job-b')).toBe(false);
    expect(queueService.getJobs().length).toBe(2);
  });
});

/**
 * @source docs:api/queue.md#publishing-messages
 */
describe('Publishing Messages (docs/api/queue.md)', () => {
  it('should publish with options via QueueService', async () => {
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    const queueService = new QueueService({ adapter: 'memory' });
    await queueService.initialize(adapter);

    const received: unknown[] = [];
    await adapter.subscribe('orders.created', async (message) => {
      received.push(message.data);
    });

    await queueService.publish('orders.created', { orderId: 1 }, {
      priority: 10,
      messageId: 'custom-id',
      metadata: {
        authorization: 'Bearer token',
        serviceId: 'order-service',
        traceId: 'trace-123',
      },
    });

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ orderId: 1 });

    await queueService.stop();
    await adapter.disconnect();
  });

  it('should batch publish via QueueService', async () => {
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    const queueService = new QueueService({ adapter: 'memory' });
    await queueService.initialize(adapter);

    const received: unknown[] = [];
    await adapter.subscribe('orders.created', async (message) => {
      received.push(message.data);
    });

    await queueService.publishBatch([
      { pattern: 'orders.created', data: { orderId: 1 } },
      { pattern: 'orders.created', data: { orderId: 2 } },
    ]);

    expect(received.length).toBe(2);

    await queueService.stop();
    await adapter.disconnect();
  });
});

/**
 * @source docs:api/queue.md#interceptors
 */
describe('Interceptors on queue handlers (docs/api/queue.md)', () => {
  it('should store interceptor metadata on @Subscribe methods', () => {
    class LoggingInterceptor {
      intercept() {
        return undefined;
      }
    }

    class EventProcessor {
      @Subscribe('events.created')
      @UseInterceptors(LoggingInterceptor)
      handleEvent() {
        // handler
      }
    }

    const interceptors = getMessageInterceptors(
      EventProcessor.prototype,
      'handleEvent',
    );
    expect(interceptors.length).toBe(1);
    expect(interceptors[0]).toBe(LoggingInterceptor);
  });
});

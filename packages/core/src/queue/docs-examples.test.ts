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

import { acknowledgesAutomatically, tracksDelivery } from './ack-mode';
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
  type MessageHandler,
  type QueueAdapter,
  type QueueEvents,
  type SubscribeOptions,
  type Subscription,
  CronExpression,
  parseCronExpression,
  getNextRun,
  isValidCronExpression,
  matchQueuePattern,
  isQueuePatternMatch,
  createQueuePatternMatcher,
  toRedisQueueGlob,
  resolveMaxAttempts,
  retryDelayMs,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  InMemoryQueueAdapter,
  getSubscribeMetadata,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
  getLifecycleHandlers,
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
        ackTimeout: 30_000, // ms — max time a handler may hold a message before redelivery
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
    expect(subscriptions[0].options?.ackTimeout).toBe(30_000);
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
  /**
   * InMemoryQueueAdapter never reports a transport failure of its own, so `onError` — the event
   * behind `@OnQueueError()` — is unreachable through it. This adapter keeps a handle on the
   * `onError` listeners the service registers so the documented wiring can still be exercised
   * in-process, without faking the delivery of the other four events.
   */
  class ErrorReportingAdapter extends InMemoryQueueAdapter {
    private readonly errorListeners = new Set<(error: Error) => void>();

    /** Every pattern the queue service actually subscribed, in order. */
    readonly subscribedPatterns: string[] = [];

    override async subscribe<T>(
      pattern: string,
      handler: MessageHandler<T>,
      options?: SubscribeOptions,
    ): Promise<Subscription> {
      this.subscribedPatterns.push(pattern);

      return await super.subscribe(pattern, handler, options);
    }

    override on<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
      if (event === 'onError') {
        this.errorListeners.add(handler as (error: Error) => void);
      }
      super.on(event, handler);
    }

    override off<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
      if (event === 'onError') {
        this.errorListeners.delete(handler as (error: Error) => void);
      }
      super.off(event, handler);
    }

    /** Simulates the adapter reporting a transport error, exactly as a real backend would. */
    reportError(error: Error): void {
      for (const listener of this.errorListeners) {
        listener(error);
      }
    }
  }

  // From docs/api/queue.md: Lifecycle Decorators — every handler of the documented snippet,
  // recording what it was actually called with. @Subscribe is what makes the class discoverable
  // as a queue controller (hasQueueDecorators ignores lifecycle decorators).
  class EventProcessor {
    readonly handled: string[] = [];
    readonly received: string[] = [];
    readonly processed: string[] = [];
    readonly failed: Array<{ id: string; reason: string }> = [];
    readonly errors: Error[] = [];
    readyCount = 0;

    @Subscribe('events.created')
    async handleEvent(message: Message<{ shouldFail?: boolean }>) {
      this.handled.push(message.id);

      if (message.data.shouldFail) {
        throw new Error('handler exploded');
      }
    }

    @OnQueueReady()
    handleReady() {
      this.readyCount += 1;
    }

    @OnQueueError()
    handleError(error: Error) {
      this.errors.push(error);
    }

    @OnMessageReceived()
    handleReceived(message: Message<unknown>) {
      this.received.push(message.id);
    }

    @OnMessageProcessed()
    handleProcessed(message: Message<unknown>) {
      this.processed.push(message.id);
    }

    @OnMessageFailed()
    handleFailed(message: Message<unknown>, error: Error) {
      this.failed.push({ id: message.id, reason: error.message });
    }
  }

  let adapter: ErrorReportingAdapter;
  let queueService: QueueService;
  let processor: EventProcessor;

  beforeEach(async () => {
    adapter = new ErrorReportingAdapter();
    queueService = new QueueService({ adapter: 'memory' });
    processor = new EventProcessor();

    await queueService.initialize(adapter);
    // The application does exactly this for every controller in a module's `controllers` array.
    await queueService.registerService(processor, EventProcessor);
  });

  afterEach(async () => {
    await queueService.stop();
    await adapter.disconnect();
  });

  it('should register one lifecycle handler per decorator on the controller class', () => {
    expect(getLifecycleHandlers(EventProcessor, 'ON_READY').map(h => h.propertyKey)).toEqual(['handleReady']);
    expect(getLifecycleHandlers(EventProcessor, 'ON_ERROR').map(h => h.propertyKey)).toEqual(['handleError']);
    expect(getLifecycleHandlers(EventProcessor, 'ON_MESSAGE_RECEIVED').map(h => h.propertyKey))
      .toEqual(['handleReceived']);
    expect(getLifecycleHandlers(EventProcessor, 'ON_MESSAGE_PROCESSED').map(h => h.propertyKey))
      .toEqual(['handleProcessed']);
    expect(getLifecycleHandlers(EventProcessor, 'ON_MESSAGE_FAILED').map(h => h.propertyKey))
      .toEqual(['handleFailed']);

    // Discovery precondition: the application only wires controllers that report queue decorators.
    expect(hasQueueDecorators(EventProcessor)).toBe(true);
  });

  it('should invoke @OnQueueReady once the queue service has started', async () => {
    expect(processor.readyCount).toBe(0);

    await queueService.start();

    expect(processor.readyCount).toBe(1);
  });

  it('should invoke @OnMessageReceived and @OnMessageProcessed around a delivered message', async () => {
    await queueService.start();

    const messageId = await queueService.publish('events.created', {}, { messageId: 'msg-ok' });

    expect(messageId).toBe('msg-ok');
    expect(processor.handled).toEqual(['msg-ok']);
    expect(processor.received).toEqual(['msg-ok']);
    expect(processor.processed).toEqual(['msg-ok']);
    expect(processor.failed).toEqual([]);
  });

  it('should invoke @OnMessageFailed with the message and the thrown error', async () => {
    await queueService.start();

    await queueService.publish('events.created', { shouldFail: true }, { messageId: 'msg-bad' });

    expect(processor.received).toEqual(['msg-bad']);
    expect(processor.failed).toEqual([{ id: 'msg-bad', reason: 'handler exploded' }]);
    expect(processor.processed).toEqual([]);
  });

  it('should invoke @OnQueueError when the adapter reports an error', async () => {
    await queueService.start();

    const failure = new Error('connection lost');
    adapter.reportError(failure);

    expect(processor.errors).toHaveLength(1);
    expect(processor.errors[0]).toBe(failure);
  });

  it('should subscribe nothing until a controller instance is registered', async () => {
    // "Lifecycle handlers run only when the class is registered as a controller."
    // Asserted at the adapter, because instance fields cannot express it: registerService binds
    // handlers to the instance it is handed, so an instance the framework never saw is untouchable
    // by construction — `expect(new EventProcessor().received).toEqual([])` cannot fail whatever
    // the framework does. What CAN fail is the subscription: if decorated classes were ever wired
    // by discovery rather than by registration, this service would subscribe 'events.created'.
    const loneAdapter = new ErrorReportingAdapter();
    const loneService = new QueueService({ adapter: 'memory' });

    await loneService.initialize(loneAdapter);
    await loneService.start();

    try {
      expect(loneAdapter.subscribedPatterns).toEqual([]);

      await loneService.publish('events.created', {}, { messageId: 'msg-solo' });

      // The registered service in this suite is a separate instance and must be unaffected.
      expect(processor.handled).toEqual([]);
    } finally {
      await loneService.stop();
    }

    // ...and registration is what creates the subscription.
    expect(adapter.subscribedPatterns).toEqual(['events.created']);
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
      // Mirrors the page: `JOBS` binds the `jobs.created` handler in the same snippet. The
      // declaration and the subscription have to agree — with a real JetStream adapter,
      // declaring only `events.>` beside a `jobs.created` handler refuses to boot.
      streams: [{ name: 'JOBS', subjects: ['jobs.>'] }],
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

  it('should report which day fields were restricted', () => {
    // From docs/api/queue.md: Cron Parser section — the parsed shape
    const schedule = parseCronExpression('0 30 9 * * 1-5');

    expect(schedule.daysOfMonthRestricted).toBe(false);
    expect(schedule.daysOfWeekRestricted).toBe(true);
  });

  it('should match either day field when both are restricted', () => {
    // From docs/api/queue.md: Supported Syntax — `0 0 1 * 1` is the 1st OR any Monday
    const schedule = parseCronExpression('0 0 1 * 1');
    const firstOfMonth = getNextRun(schedule, new Date(2026, 0, 27, 12, 0, 0));
    const monday = getNextRun(schedule, new Date(2026, 0, 1, 12, 0, 0));

    expect(firstOfMonth!.getDate()).toBe(1);
    expect(monday!.getDay()).toBe(1);
    expect(monday!.getDate()).toBe(5);
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
    // In-process and non-persistent, but genuinely honoured — the matrix says ✅.
    expect(adapter.supports('retry')).toBe(true);
    // Not supported
    expect(adapter.supports('consumer-groups')).toBe(false);
    expect(adapter.supports('dead-letter-queue')).toBe(false);
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

/**
 * @source docs:api/queue.md#ackmode-none
 */
describe("ackMode 'none' (docs/api/queue.md)", () => {
  it('delivers the documented fire-and-forget snippet exactly once', async () => {
    // From docs/api/queue.md: `@Subscribe('telemetry.samples', { ackMode: 'none' })` —
    // "if this throws, the sample is gone".
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    let calls = 0;
    const failures: Error[] = [];
    adapter.on('onMessageFailed', (_message, error) => {
      failures.push(error);
    });

    await adapter.subscribe('telemetry.samples', async () => {
      calls += 1;
      throw new Error('write failed');
    }, { ackMode: 'none' });

    await adapter.publish('telemetry.samples', { value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.disconnect();

    expect(calls).toBe(1);
    // Failures stay observable even though the message is not retried.
    expect(failures).toHaveLength(1);
  });

  it('reports the documented inert modes through the shared resolver', async () => {
    // From the docs table: 'none' is the only mode where the broker tracks nothing.
    expect(tracksDelivery({ ackMode: 'none' })).toBe(false);
    expect(tracksDelivery({ ackMode: 'manual' })).toBe(true);
    expect(acknowledgesAutomatically({ ackMode: 'none' })).toBe(false);
    expect(acknowledgesAutomatically({ ackMode: 'auto' })).toBe(true);
  });
});

/**
 * @source docs:api/queue.md#pattern-syntax
 */
describe('Pattern Syntax — the Redis key glob column', () => {
  it('translates each documented pattern to the glob the table promises', () => {
    // The table's fourth column, row by row. A glob is only ever a SUPERSET of the pattern:
    // Redis walks fewer keys, the in-process matcher decides what a handler actually receives.
    expect(toRedisQueueGlob('orders.created')).toBe('orders.created');
    expect(toRedisQueueGlob('orders.*')).toBe('orders.*');
    expect(toRedisQueueGlob('events.#')).toBe('events.*');
    expect(toRedisQueueGlob('orders.{id}')).toBe('orders.*');
  });

  it('rejects a # that is not the final token, on Redis as on NATS', () => {
    // Redis could serve `*.created` — the rejection is about one pattern language across adapters.
    expect(() => toRedisQueueGlob('#.created')).toThrow(/final token/i);
    expect(() => toRedisQueueGlob('events.#.created')).toThrow(/final token/i);
  });

  it('hands the captured {name} values to the handler as message.params', async () => {
    // The worked example under the table, run: `orders.{id}.{event}` delivered
    // `orders.123.created` gives `params.id === '123'` and `params.event === 'created'`.
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    const delivered: Array<Message<unknown>> = [];
    await adapter.subscribe('orders.{id}.{event}', async (message) => {
      delivered.push(message);
    });

    await adapter.publish('orders.123.created', { total: 10 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.disconnect();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.params).toEqual({ id: '123', event: 'created' });
    // "the topic as delivered" — the pattern field is unchanged by the capture.
    expect(delivered[0]!.pattern).toBe('orders.123.created');
    // "A pattern with no {name} gives params === {} rather than undefined."
    expect(matchQueuePattern('orders.*', 'orders.created').params).toEqual({});
  });

  it('reaches a @Subscribe handler on a controller, through QueueService', async () => {
    // The surface the docs actually show. The adapter tests above drive delivery directly;
    // this one goes the whole way — decorator metadata, registerService, the guard and
    // interceptor wrapping in QueueService — because that chain forwards the message by
    // reference and a field added to it is exactly the kind of thing a re-wrap would drop.
    class OrderConsumer {
      readonly seen: Array<Record<string, string>> = [];

      @Subscribe('orders.{id}.{event}')
      async handle(message: Message<{ total: number }>): Promise<void> {
        this.seen.push(message.params);
      }
    }

    const adapter = new InMemoryQueueAdapter();
    const service = new QueueService({ adapter: 'memory' });
    const consumer = new OrderConsumer();

    await service.initialize(adapter);
    await service.registerService(consumer, OrderConsumer);

    await adapter.publish('orders.123.created', { total: 10 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await service.stop();
    await adapter.disconnect();

    expect(consumer.seen).toEqual([{ id: '123', event: 'created' }]);
  });

  it('keeps the captured values off the wire, where a metadata key would sit', async () => {
    // "It is therefore not part of the published envelope and does not travel over the wire —
    // a value in `metadata` would."
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    const delivered: Array<Message<unknown>> = [];
    await adapter.subscribe('orders.{id}', async (message) => {
      delivered.push(message);
    });

    await adapter.publish('orders.123', { total: 10 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.disconnect();

    expect(delivered[0]!.params).toEqual({ id: '123' });
    expect(Object.keys(delivered[0]!.metadata ?? {})).not.toContain('params');
  });
});

/**
 * @source docs:api/queue.md#error-handling-in-handlers
 */
describe('Error Handling in Handlers — the documented recipe, executed', () => {
  it('reaches the terminal nack(false) branch once attempt equals maxAttempts', async () => {
    // The recipe on the page branches on `message.attempt >= (message.maxAttempts || 3)`. With
    // `attempt` permanently undefined that branch was unreachable on this adapter, so the handler
    // took `nack(true)` forever. This runs the recipe's shape and asserts it terminates.
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    const dispositions: Array<'requeue' | 'terminate'> = [];
    const seen: Array<{ attempt?: number; maxAttempts?: number }> = [];

    await adapter.subscribe('orders.created', async (message) => {
      seen.push({ attempt: message.attempt, maxAttempts: message.maxAttempts });

      try {
        throw new Error('order processing failed');
      } catch {
        if (message.attempt && message.attempt >= (message.maxAttempts || 3)) {
          dispositions.push('terminate');
          await message.nack(false);
        } else {
          dispositions.push('requeue');
          await message.nack(true);
        }
      }
    }, { ackMode: 'manual', retry: { attempts: 3, backoff: 'exponential', delay: 1 } });

    await adapter.publish('orders.created', { orderId: 'o-1' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await adapter.disconnect();

    // Two requeues, then the terminal branch — and nothing after it.
    expect(dispositions).toEqual(['requeue', 'requeue', 'terminate']);
    expect(seen).toEqual([
      { attempt: 1, maxAttempts: 3 },
      { attempt: 2, maxAttempts: 3 },
      { attempt: 3, maxAttempts: 3 },
    ]);
  });
});

/**
 * @source docs:api/queue.md#retry
 */
describe('RetryOptions — the documented defaults and formulas', () => {
  it('defaults to a single delivery, so retries stay opt-in', () => {
    expect(resolveMaxAttempts(undefined)).toBe(1);
    expect(resolveMaxAttempts({})).toBe(1);
    expect(DEFAULT_RETRY_ATTEMPTS).toBe(1);
  });

  it('counts total deliveries, not extra ones', () => {
    // The table says `attempts: 3` runs the handler at most three times — the same number the
    // `attempt >= maxAttempts` comparison in the error-handling recipe reaches.
    expect(resolveMaxAttempts({ attempts: 3 })).toBe(3);
  });

  it('refuses to turn a subscription into one that never fires', () => {
    expect(resolveMaxAttempts({ attempts: 0 })).toBe(1);
    expect(resolveMaxAttempts({ attempts: -5 })).toBe(1);
  });

  it('computes each documented backoff formula', () => {
    // fixed -> delay; linear -> delay * n; exponential -> delay * 2^(n-1).
    expect(retryDelayMs({ backoff: 'fixed', delay: 200 }, 3)).toBe(200);

    expect(retryDelayMs({ backoff: 'linear', delay: 200 }, 1)).toBe(200);
    expect(retryDelayMs({ backoff: 'linear', delay: 200 }, 3)).toBe(600);

    expect(retryDelayMs({ backoff: 'exponential', delay: 200 }, 1)).toBe(200);
    expect(retryDelayMs({ backoff: 'exponential', delay: 200 }, 3)).toBe(800);
  });

  it('falls back to fixed, and to a 100 ms base delay', () => {
    expect(retryDelayMs({ attempts: 3 }, 4)).toBe(DEFAULT_RETRY_DELAY_MS);
    expect(DEFAULT_RETRY_DELAY_MS).toBe(100);
  });

  it('asks for no wait when there is no retry to schedule', () => {
    expect(retryDelayMs(undefined, 1)).toBe(0);
  });
});

/**
 * @source docs:api/queue.md#redisqueueadapter
 */
describe('Redis dead-letter cap precedence', () => {
  it('resolves retry.attempts ?? deadLetter.maxRetries ?? 1, in that order', () => {
    // Each position of the chain, asserted on its own. The order mirrors JetStream's
    // `max_deliver` resolution so the same options mean the same thing on both adapters.
    expect(resolveMaxAttempts({ attempts: 3 }, { queue: 'd', maxRetries: 1 })).toBe(3);
    expect(resolveMaxAttempts(undefined, { queue: 'd', maxRetries: 2 })).toBe(2);
    expect(resolveMaxAttempts(undefined, undefined)).toBe(1);
    // A `deadLetter` without `maxRetries` falls through to the default, not to zero attempts.
    expect(resolveMaxAttempts(undefined, { queue: 'd' })).toBe(1);
  });

  it('ignores deadLetter.maxRetries on an adapter that is not given one', () => {
    // The memory adapter reports `supports('dead-letter-queue') === false` and passes no second
    // argument, so the field caps a route that does not exist there.
    expect(resolveMaxAttempts(undefined)).toBe(1);
  });

  it('registers the documented deadLetter snippet as written', () => {
    // The pair from the RedisQueueAdapter section: a producer that dead-letters, and an ordinary
    // `@Subscribe` on the dead-letter pattern. The second decorator is the whole claim — the old
    // implementation wrote to a key no subscription could name.
    class OrderProcessor {
      @Subscribe('orders.created', {
        deadLetter: { queue: 'orders.dead', maxRetries: 3 },
      })
      async handleOrder(message: Message<{ orderId: string }>) {
        expect(message.data.orderId).toBeDefined();
      }

      @Subscribe('orders.dead')
      async handleDeadOrder(message: Message<{ orderId: string }>) {
        expect(message.metadata['dlq.originalPattern']).toBeDefined();
      }
    }

    const subscriptions = getSubscribeMetadata(OrderProcessor);
    expect(subscriptions).toHaveLength(2);

    const source = subscriptions.find((s) => s.pattern === 'orders.created')!;
    expect(source.options?.deadLetter?.queue).toBe('orders.dead');
    expect(source.options?.deadLetter?.maxRetries).toBe(3);

    // The dead-letter destination is reachable by a plain subscription, with no options at all.
    const dead = subscriptions.find((s) => s.pattern === 'orders.dead')!;
    expect(dead.options?.deadLetter).toBeUndefined();
  });
});

/**
 * @source docs:api/queue.md#interval-overlap-and-the-first-run
 */
describe('Interval overlap and the first run', () => {
  it('registers the documented @Interval options as written', () => {
    // The snippet's whole point is that these two options exist and reach the scheduler.
    // `overlapStrategy` was declared for every job type and read only on the cron path, and
    // there was no way to ask for an interval that does not run at boot.
    class ReportsController {
      @Interval(3_600_000, {
        pattern: 'reports.hourly',
        overlapStrategy: 'skip',
        runOnStart: false,
      })
      buildHourly(): { at: number } {
        return { at: 1 };
      }
    }

    const jobs = getIntervalMetadata(ReportsController) ?? [];

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.options.overlapStrategy).toBe('skip');
    expect(jobs[0]?.options.runOnStart).toBe(false);
    expect(jobs[0]?.milliseconds).toBe(3_600_000);
  });

  it('leaves both unset when the decorator does not mention them', () => {
    // Absent, not defaulted at the decorator: the scheduler applies 'skip' and a leading run,
    // so a job that says nothing behaves the way the section describes as the default.
    class PlainController {
      @Interval(1_000, { pattern: 'plain.tick' })
      tick(): { at: number } {
        return { at: 1 };
      }
    }

    const jobs = getIntervalMetadata(PlainController) ?? [];

    expect(jobs[0]?.options.overlapStrategy).toBeUndefined();
    expect(jobs[0]?.options.runOnStart).toBeUndefined();
  });
});

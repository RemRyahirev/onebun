/**
 * QueueServiceProxy — placeholder for DI when the real QueueService is created after setup().
 * When the queue is enabled, the application sets the real QueueService via setDelegate().
 * When the queue is not enabled, any method call throws a clear error.
 */

import type { QueueService } from './queue.service';
import type { QueueScheduler } from './scheduler';
import type { QueueAdapter } from './types';
import type {
  AddJobOptions,
  MessageHandler,
  PublishOptions,
  QueueEvents,
  ScheduledJobInfo,
  SubscribeOptions,
  Subscription,
  QueueFeature,
  UpdateJobOptions,
} from './types';

/**
 * Where the queue is in the application's life, as the application reports it.
 *
 * The three unavailable phases are three different problems and used to share one message that
 * described only the first: an application that HAD configured a queue was told to configure one.
 */
type QueuePhase = 'absent' | 'starting' | 'ready' | 'stopped';

const QUEUE_NOT_ENABLED_MESSAGE =
  'Queue is not enabled. Enable it by any one of: registering a controller with queue decorators '
  + '(@Subscribe, @Cron, @Interval, @Timeout); setting `queue.enabled: true` in application options; '
  + 'or configuring a backend via `queue.adapter`, `queue.options` or `queue.redis`. '
  + 'An explicit `queue.enabled: false` overrides a configured backend and keeps the queue disabled.';

const QUEUE_NOT_READY_MESSAGE =
  'The queue is enabled and still starting: its adapter is connected and its handlers registered '
  + 'after onModuleInit has run. publish() is accepted from onModuleInit and delivered as soon as '
  + 'the queue is up; everything else on QueueService — subscribe, the scheduler, the adapter — '
  + 'has to wait for onApplicationInit.';

const QUEUE_STOPPED_MESSAGE =
  'The queue has stopped: the application is shutting down and its adapter is disconnected. '
  + 'onModuleDestroy runs while the queue is still usable — publish from there rather than from a '
  + 'later teardown path.';

/**
 * A publish issued while the queue was still starting.
 *
 * The id is minted at the call, not at the flush, because the caller is handed it immediately and
 * every adapter honours `options.messageId` — so what it receives is the id the message really
 * ships with rather than a placeholder.
 */
interface PendingPublish {
  pattern: string;
  data: unknown;
  options: PublishOptions;
}

/**
 * Proxy for QueueService used in DI before the real service is created.
 * After initializeQueue(), the application calls setDelegate(realQueueService) when the queue is enabled.
 */
export class QueueServiceProxy {
  private delegate: QueueService | null = null;
  private phase: QueuePhase = 'absent';
  private pendingPublishes: PendingPublish[] = [];

  /**
   * The application has decided this queue WILL run — called before the module tree's
   * `onModuleInit` hooks, which is the window this exists for.
   */
  markStarting(): void {
    if (this.phase === 'absent') {
      this.phase = 'starting';
    }
  }

  setDelegate(service: QueueService | null): void {
    this.delegate = service;

    if (service !== null) {
      this.phase = 'ready';
    } else if (this.phase !== 'absent') {
      this.phase = 'stopped';
    }
  }

  /**
   * Send everything published while the queue was starting, in the order it was published.
   *
   * Called once the handlers are registered, so a message published from `onModuleInit` reaches a
   * subscriber declared in the same application — with an in-memory adapter, publishing any
   * earlier would deliver it to nobody. Failures are returned rather than thrown: the caller is
   * the application's startup path, which has a logger and a decision to make.
   */
  async flushPendingPublishes(): Promise<Error[]> {
    const pending = this.pendingPublishes;
    this.pendingPublishes = [];

    if (this.delegate === null || pending.length === 0) {
      return [];
    }

    const failures: Error[] = [];

    for (const entry of pending) {
      try {
        await this.delegate.publish(entry.pattern, entry.data, entry.options);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return failures;
  }

  /**
   * Why the queue is unavailable right now, in the words the DI path would use.
   *
   * Public so `OneBunApplication.getQueueService()` reports the same thing an injected
   * `QueueService` would: the accessor used to hand back `null` instead, and the caller met a
   * `TypeError` on the next line rather than the explanation that already existed.
   */
  unavailableReason(): string {
    return this.unavailableMessage();
  }

  private requireDelegate(): QueueService {
    if (this.delegate === null) {
      throw new Error(this.unavailableMessage());
    }

    return this.delegate;
  }

  private unavailableMessage(): string {
    if (this.phase === 'starting') {
      return QUEUE_NOT_READY_MESSAGE;
    }

    return this.phase === 'stopped' ? QUEUE_STOPPED_MESSAGE : QUEUE_NOT_ENABLED_MESSAGE;
  }

  getAdapter(): QueueAdapter {
    return this.requireDelegate().getAdapter();
  }

  getScheduler(): QueueScheduler {
    return this.requireDelegate().getScheduler();
  }

  async publish<T>(pattern: string, data: T, options?: PublishOptions): Promise<string> {
    if (this.phase === 'starting') {
      return this.holdUntilReady(pattern, data, options);
    }

    return await this.requireDelegate().publish(pattern, data, options);
  }

  async publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>,
  ): Promise<string[]> {
    if (this.phase === 'starting') {
      return messages.map(
        (message) => this.holdUntilReady(message.pattern, message.data, message.options),
      );
    }

    return await this.requireDelegate().publishBatch(messages);
  }

  /**
   * Take a message the queue cannot send yet, and answer with the id it will be sent under.
   *
   * Resolving now rather than at the flush is deliberate: `onModuleInit` awaits this call, and the
   * flush cannot run until `onModuleInit` returns — a promise held open until then would deadlock
   * startup rather than delay it.
   */
  private holdUntilReady(pattern: string, data: unknown, options?: PublishOptions): string {
    const messageId = options?.messageId ?? crypto.randomUUID();

    this.pendingPublishes.push({ pattern, data, options: { ...options, messageId } });

    return messageId;
  }

  async subscribe<T>(
    pattern: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    return await this.requireDelegate().subscribe(pattern, handler, options);
  }

  addJob(options: AddJobOptions): void {
    this.requireDelegate().addJob(options);
  }

  removeJob(name: string): boolean {
    return this.requireDelegate().removeJob(name);
  }

  getJob(name: string): ScheduledJobInfo | undefined {
    return this.requireDelegate().getJob(name);
  }

  getJobs(): ScheduledJobInfo[] {
    return this.requireDelegate().getJobs();
  }

  hasJob(name: string): boolean {
    return this.requireDelegate().hasJob(name);
  }

  pauseJob(name: string): boolean {
    return this.requireDelegate().pauseJob(name);
  }

  resumeJob(name: string): boolean {
    return this.requireDelegate().resumeJob(name);
  }

  updateJob(options: UpdateJobOptions): boolean {
    return this.requireDelegate().updateJob(options);
  }

  supports(feature: QueueFeature): boolean {
    return this.requireDelegate().supports(feature);
  }

  on<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    return this.requireDelegate().on(event, handler);
  }

  off<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    return this.requireDelegate().off(event, handler);
  }
}

export const QUEUE_NOT_ENABLED_ERROR_MESSAGE = QUEUE_NOT_ENABLED_MESSAGE;
export const QUEUE_NOT_READY_ERROR_MESSAGE = QUEUE_NOT_READY_MESSAGE;
export const QUEUE_STOPPED_ERROR_MESSAGE = QUEUE_STOPPED_MESSAGE;

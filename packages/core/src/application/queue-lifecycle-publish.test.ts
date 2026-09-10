/**
 * Publishing from the module lifecycle hooks.
 *
 * "Announce this instance on boot and on shutdown" is the ordinary way to keep a registry of live
 * nodes, and both ends were broken: on boot the application refused to start, quoting three
 * remedies the user had already applied, and on shutdown the goodbye message vanished into a
 * caught hook error while stop() reported a clean shutdown.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { OnModuleDestroy, OnModuleInit } from '../module/lifecycle';
import type {
  Message,
  PublishOptions,
  QueueAdapter,
} from '../queue/types';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { Subscribe } from '../queue/decorators';
import { QUEUE_NOT_ENABLED_ERROR_MESSAGE, QUEUE_NOT_READY_ERROR_MESSAGE } from '../queue/queue-service-proxy';
import { QueueService } from '../queue/queue.service';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const received: string[] = [];
const lifecycleErrors: string[] = [];

@Service()
class AnnouncerService extends BaseService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly queue: QueueService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.publish('lifecycle.boot', { phase: 'init' });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.publish('lifecycle.shutdown', { phase: 'destroy' });
  }
}

@Controller('/announce')
class AnnounceController extends BaseController {
  @Get('/')
  ping(): { ok: boolean } {
    return { ok: true };
  }

  @Subscribe('lifecycle.*')
  collect(message: Message<{ phase: string }>): void {
    received.push(`${message.pattern}:${message.data.phase}`);
  }
}

@Module({ controllers: [AnnounceController], providers: [AnnouncerService] })
class AnnounceModule {}

@Service()
class NoQueueAnnouncer extends BaseService implements OnModuleInit {
  constructor(private readonly queue: QueueService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.publish('lifecycle.boot', { phase: 'init' });
    } catch (error) {
      lifecycleErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

@Controller('/no-queue')
class NoQueueController extends BaseController {
  @Get('/')
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [NoQueueController], providers: [NoQueueAnnouncer] })
class NoQueueModule {}

@Service()
class SchedulerPeeker extends BaseService implements OnModuleInit {
  constructor(private readonly queue: QueueService) {
    super();
  }

  onModuleInit(): void {
    try {
      this.queue.getScheduler();
    } catch (error) {
      lifecycleErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

@Controller('/peek')
class PeekController extends BaseController {
  @Get('/')
  ping(): { ok: boolean } {
    return { ok: true };
  }

  @Subscribe('peek.*')
  collect(): void {}
}

@Module({ controllers: [PeekController], providers: [SchedulerPeeker] })
class PeekModule {}

describe('publishing from lifecycle hooks', () => {
  let app: OneBunApplication | null;

  function boot(moduleClass: Function, queue?: { enabled: boolean; adapter: 'memory' }): OneBunApplication {
    return new OneBunApplication(moduleClass as new () => object, {
      port: 0,
      host: '127.0.0.1',
      queue,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
  }

  beforeEach(() => {
    received.length = 0;
    lifecycleErrors.length = 0;
    app = null;
  });

  afterEach(async () => {
    await app?.stop();
  });

  test('should deliver a message published from onModuleInit to a subscriber in the same app', async () => {
    app = boot(AnnounceModule, { enabled: true, adapter: 'memory' });

    await app.start();

    expect(received).toContain('lifecycle.boot:init');
  });

  test('should let onModuleDestroy publish while the transport is still open', async () => {
    app = boot(AnnounceModule, { enabled: true, adapter: 'memory' });
    await app.start();

    // Consumers are closed before the destroy hooks run, so the goodbye is observed at the
    // adapter — which is the boundary that matters: it either left the process or it did not.
    const adapter = app.getQueueService()!.getAdapter() as QueueAdapter;
    const publishedDuringShutdown: string[] = [];
    const realPublish = adapter.publish.bind(adapter);
    adapter.publish = async <T>(pattern: string, data: T, options?: PublishOptions) => {
      publishedDuringShutdown.push(pattern);

      return await realPublish(pattern, data, options);
    };

    await app.stop();
    app = null;

    expect(publishedDuringShutdown).toContain('lifecycle.shutdown');
  });

  test('should still say the queue is not enabled when there is no queue at all', async () => {
    app = boot(NoQueueModule);

    await app.start();

    expect(lifecycleErrors).toEqual([QUEUE_NOT_ENABLED_ERROR_MESSAGE]);
  });

  test('should say the queue is still starting for everything that cannot be held', async () => {
    app = boot(PeekModule, { enabled: true, adapter: 'memory' });

    await app.start();

    expect(lifecycleErrors).toEqual([QUEUE_NOT_READY_ERROR_MESSAGE]);
  });
});

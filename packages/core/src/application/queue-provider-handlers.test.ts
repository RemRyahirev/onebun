/**
 * Queue decorators on a `providers` class.
 *
 * Handler discovery walks controllers only. A `@Subscribe`/`@Cron` on a class registered in
 * `providers` is metadata nothing reads, so the handler never runs — and the one line the
 * application printed said there were no handlers at all, three lines below one the user had
 * just written. These cases pin the diagnostic that replaced that silence.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { SyncLogger } from '@onebun/logger';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { Subscribe } from '../queue/decorators';
import { createMockSyncLogger, makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

@Service()
class ProviderConsumer extends BaseService {
  received: unknown[] = [];

  @Subscribe('provider.*')
  handleProviderMessage(data: unknown): void {
    this.received.push(data);
  }
}

@Controller('/probe')
class ProbeController extends BaseController {
  @Get('/')
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController], providers: [ProviderConsumer] })
class ProviderOnlyModule {}

@Controller('/consumer')
class ControllerConsumer extends BaseController {
  @Get('/')
  ping(): { ok: boolean } {
    return { ok: true };
  }

  @Subscribe('controller.*')
  handleControllerMessage(): void {}
}

@Module({ controllers: [ControllerConsumer], providers: [ProviderConsumer] })
class MixedModule {}

describe('queue decorators on a provider', () => {
  let warnings: string[];
  let debugLines: string[];
  let app: OneBunApplication | null;

  function capturingLogger(): SyncLogger {
    const logger: SyncLogger = {
      ...createMockSyncLogger(),
      warn(message: string) {
        warnings.push(message);
      },
      debug(message: string) {
        debugLines.push(message);
      },
      child: () => logger,
    };

    return logger;
  }

  function bootWith(moduleClass: Function, queue?: { enabled?: boolean; adapter?: 'memory' }): OneBunApplication {
    const created = new OneBunApplication(moduleClass as new () => object, {
      port: 0,
      host: '127.0.0.1',
      queue,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });

    // The application builds its logger in the constructor, so this is the only seam between
    // construction and the queue initialization that runs inside start().
    (created as unknown as { logger: SyncLogger }).logger = capturingLogger();

    return created;
  }

  beforeEach(() => {
    warnings = [];
    debugLines = [];
    app = null;
  });

  afterEach(async () => {
    await app?.stop();
  });

  test('should name the class and the handler when the queue is not enabled at all', async () => {
    app = bootWith(ProviderOnlyModule);
    await app.start();

    const warning = warnings.find((line) => line.includes('ProviderConsumer'));

    expect(warning).toBeDefined();
    expect(warning).toContain('handleProviderMessage');
    expect(warning).toContain('controllers');
  });

  test('should stop claiming no handlers were detected when they are on a provider', async () => {
    app = bootWith(ProviderOnlyModule);
    await app.start();

    const notEnabled = debugLines.filter((line) => line.includes('Queue system not enabled'));

    expect(notEnabled.length).toBe(1);
    expect(notEnabled[0]).toContain('providers');
    expect(notEnabled[0]).not.toContain('no handlers detected');
  });

  test('should not pass the provider over in silence when the queue is enabled', async () => {
    app = bootWith(MixedModule, { enabled: true, adapter: 'memory' });
    await app.start();

    expect(warnings.filter((line) => line.includes('ProviderConsumer')).length).toBe(1);
  });

  test('should say nothing about a module whose handlers are all on controllers', async () => {
    app = bootWith(MixedModule, { enabled: true, adapter: 'memory' });
    await app.start();

    expect(warnings.some((line) => line.includes('ControllerConsumer'))).toBe(false);
  });
});

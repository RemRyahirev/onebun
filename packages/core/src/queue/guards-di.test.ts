/**
 * `@UseGuards` on queue consumers: honoured at all, and with the same DI HTTP routes get.
 *
 * Two defects meet here.
 *
 * 1. `@UseGuards` wrote `onebun:http_guards`, a key only HTTP route registration ever read, so
 *    on a `@Subscribe` handler it was a SILENT no-op — no type error, no warning, and the
 *    consumer ran completely unguarded while docs/migration-nestjs.md told NestJS migrants the
 *    decorator "works identically on HTTP routes, WebSocket message handlers, and queue
 *    consumers". Measured before the fix, three `@Subscribe` handlers and one message each:
 *    `{"control":1,"httpGuard":1,"msgGuard":0}` — the deny guard was discarded.
 *
 * 2. `executeMessageGuards` built class guards with a bare `new guard()`, so a guard with a
 *    constructor dependency — or one extending `BaseService` — threw on EVERY message and the
 *    message was dropped with nothing logged at any level.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import type { Message, MessageExecutionContext } from './types';
import type { ExecutionContext } from '../types';

import { LoggerService, type Logger } from '@onebun/logger';

import { OneBunApplication } from '../application/application';
import {
  Controller,
  Module,
  UseGuards,
} from '../decorators/decorators';
import { DependencyResolutionError } from '../errors/dependency-errors';
import { AuthGuard } from '../http-guards/http-guards';
import { Controller as BaseController } from '../module/controller';
import { clearGlobalServicesRegistry } from '../module/module';
import { BaseService, Service } from '../module/service';

import { Subscribe, UseMessageGuards } from './decorators';
import { MessageServiceGuard } from './guards';
import { QueueService } from './queue.service';

// ============================================================================
// Recording logger — the diagnostic assertions need the lines, not silence
// ============================================================================

const logLines: string[] = [];

function makeRecordingLoggerLayer(): Layer.Layer<Logger, never, never> {
  const record = (level: string) => (message: string): Effect.Effect<void> => {
    logLines.push(`${level} ${message}`);

    return Effect.succeed(undefined);
  };

  const logger: Logger = {
    trace: () => Effect.succeed(undefined),
    debug: () => Effect.succeed(undefined),
    info: () => Effect.succeed(undefined),
    warn: record('WARN'),
    error: record('ERROR'),
    fatal: record('FATAL'),
    child: () => logger,
  };

  return Layer.succeed(LoggerService, logger);
}

// ============================================================================
// Fixtures
// ============================================================================

const ran: Record<string, number> = {};
const seen: Record<string, unknown> = {};
/** How many times each guard's canActivate actually ran — zero proves it was skipped. */
const guardCalls: Record<string, number> = {};

class DenyGuard {
  canActivate(): boolean {
    return false;
  }
}

@Service()
class AclService extends BaseService {
  allows(tenant: string): boolean {
    return tenant === 'acme';
  }
}

/** A guard with a constructor dependency — the shape that threw on every message. */
@Service()
class AclGuard {
  constructor(private readonly acl: AclService) {}

  canActivate(ctx: MessageExecutionContext): boolean {
    guardCalls.acl = (guardCalls.acl ?? 0) + 1;

    return this.acl.allows(String(ctx.getMetadata().headers?.tenant ?? ''));
  }
}

/** A guard extending BaseService — needs the ambient init context for `this.config`. */
@Service()
class ConfigReadingGuard extends BaseService {
  canActivate(_ctx: MessageExecutionContext): boolean {
    guardCalls.configReading = (guardCalls.configReading ?? 0) + 1;

    // Reaching `this.config` at all is the point. Zero-argument construction left it — and
    // `this.logger` — undefined, so this line threw a TypeError on every delivered message.
    // (`.get()` is not called: without an envSchema the app's config legitimately throws.)
    return typeof this.config.get === 'function' && typeof this.logger.warn === 'function';
  }
}

class MissingDep {
  greet(): string {
    return 'never registered as a provider';
  }
}

@Service()
class UnresolvableGuard {
  constructor(private readonly missing: MissingDep) {}

  canActivate(): boolean {
    return this.missing.greet().length > 0;
  }
}

class ThrowingGuard {
  canActivate(): boolean {
    throw new Error('guard exploded');
  }
}

@Controller('/guarded-queue')
class GuardedQueueController extends BaseController {
  @Subscribe('q.control')
  async control(): Promise<void> {
    ran.control = (ran.control ?? 0) + 1;
  }

  @UseGuards(DenyGuard)
  @Subscribe('q.deny')
  async deny(): Promise<void> {
    ran.deny = (ran.deny ?? 0) + 1;
  }

  @UseGuards(AclGuard)
  @Subscribe('q.acl')
  async acl(message: Message): Promise<void> {
    ran.acl = (ran.acl ?? 0) + 1;
    seen.acl = message.data;
  }

  // The same two guards under @UseMessageGuards — the decorator the queue path ALREADY read
  // before the fix, so these two isolate the missing-DI half (WI-290) from the
  // ignored-decorator half (WI-285). On unfixed code they throw and the handler never runs.
  @UseMessageGuards(AclGuard)
  @Subscribe('q.acl-msg')
  async aclViaMessageGuards(): Promise<void> {
    ran.aclViaMessageGuards = (ran.aclViaMessageGuards ?? 0) + 1;
  }

  @UseMessageGuards(ConfigReadingGuard)
  @Subscribe('q.config-msg')
  async readsConfigViaMessageGuards(): Promise<void> {
    ran.readsConfigViaMessageGuards = (ran.readsConfigViaMessageGuards ?? 0) + 1;
  }

  @UseGuards(ConfigReadingGuard)
  @Subscribe('q.config')
  async readsConfig(): Promise<void> {
    ran.readsConfig = (ran.readsConfig ?? 0) + 1;
  }

  @UseMessageGuards(new MessageServiceGuard(['payment-service']))
  @Subscribe('q.instance')
  async instance(): Promise<void> {
    ran.instance = (ran.instance ?? 0) + 1;
  }

  @UseGuards(ThrowingGuard)
  @Subscribe('q.throws')
  async throws(): Promise<void> {
    ran.throws = (ran.throws ?? 0) + 1;
  }

  @UseGuards(AuthGuard)
  @Subscribe('q.http-only-guard')
  async httpOnlyGuard(): Promise<void> {
    ran.httpOnlyGuard = (ran.httpOnlyGuard ?? 0) + 1;
  }
}

@Module({ controllers: [GuardedQueueController], providers: [AclService] })
class GuardedQueueModule {}

@Controller('/unresolvable-queue')
class UnresolvableQueueController extends BaseController {
  @UseGuards(UnresolvableGuard)
  @Subscribe('q.unresolvable')
  async handle(): Promise<void> {}
}

@Module({ controllers: [UnresolvableQueueController] })
class UnresolvableQueueModule {}

// ============================================================================

describe('@UseGuards on queue consumers', () => {
  let app: OneBunApplication;
  let queue: QueueService;
  let failures: Array<{ pattern: string; error: string }>;
  let processed: string[];

  beforeEach(async () => {
    for (const key of Object.keys(ran)) {
      delete ran[key];
    }
    for (const key of Object.keys(seen)) {
      delete seen[key];
    }
    for (const key of Object.keys(guardCalls)) {
      delete guardCalls[key];
    }
    logLines.length = 0;
    failures = [];
    processed = [];

    app = new OneBunApplication(GuardedQueueModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      queue: { enabled: true, adapter: 'memory' },
      loggerLayer: makeRecordingLoggerLayer(),
    });
    await app.start();

    queue = app.getQueueService() as QueueService;
    queue.on('onMessageFailed', (message, error) => {
      failures.push({ pattern: message.pattern, error: (error as Error).message });
    });
    queue.on('onMessageProcessed', (message) => {
      processed.push(message.pattern);
    });
  });

  afterEach(async () => {
    await app.stop();
    clearGlobalServicesRegistry();
  });

  /** Publish one message and let the in-memory adapter's dispatch settle. */
  const publish = async (pattern: string, metadata?: Record<string, string>): Promise<void> => {
    await queue.publish(pattern, { hello: pattern }, metadata ? { metadata: { headers: metadata } } : undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  test('an unguarded @Subscribe handler still runs — positive control', async () => {
    await publish('q.control');

    expect(ran.control).toBe(1);
  });

  test('@UseGuards(DenyGuard) stops the handler instead of being silently discarded', async () => {
    // WI-285 regression. Before the fix this counter read 1: the guard was written to a
    // metadata key the queue path never read, so the consumer ran completely unguarded.
    await publish('q.deny');

    expect(ran.deny).toBeUndefined();
  });

  test('a guard with a constructor dependency runs and lets the message through', async () => {
    // WI-290 regression. Before the fix: TypeError "undefined is not an object (evaluating
    // 'this.acl.allows')" on every message, the message dropped, nothing logged.
    await publish('q.acl', { tenant: 'acme' });

    // The guard must have RUN, not merely have been skipped — on unfixed code `@UseGuards`
    // was discarded on the queue path, so the handler ran with canActivate never called.
    expect(guardCalls.acl).toBe(1);
    expect(ran.acl).toBe(1);
    expect(seen.acl).toEqual({ hello: 'q.acl' });
  });

  test('the same guard still denies when its injected service says no', async () => {
    await publish('q.acl', { tenant: 'evil-corp' });

    expect(ran.acl).toBeUndefined();
  });

  test('a guard extending BaseService reads this.config inside canActivate', async () => {
    // The ambient init context is only set around module construction, so zero-argument
    // construction left `this.config` undefined and `this.config.get` threw per message.
    await publish('q.config');

    expect(guardCalls.configReading).toBe(1);
    expect(ran.readsConfig).toBe(1);
  });

  test('@UseMessageGuards + constructor dependency: the handler runs and gets the message', async () => {
    // WI-290 in isolation. `@UseMessageGuards` was already honoured before the fix, so this is
    // purely the DI half: on unfixed code the guard is built with `new AclGuard()` and throws
    // "undefined is not an object (evaluating 'this.acl.allows')" on every message.
    await publish('q.acl-msg', { tenant: 'acme' });

    expect(ran.aclViaMessageGuards).toBe(1);
  });

  test('@UseMessageGuards + BaseService guard: this.config is live inside canActivate', async () => {
    await publish('q.config-msg');

    expect(ran.readsConfigViaMessageGuards).toBe(1);
  });

  test('an INSTANCE guard is passed through unchanged', async () => {
    // docs/api/queue.md shows `new MessageServiceGuard(['payment-service'])`. Resolution must
    // not reconstruct it — the caller owns its lifetime and its constructor arguments.
    // PINS PRESERVED BEHAVIOUR: this one passes before the change too, deliberately. Its job
    // is to prove the new resolver did not break instance guards, not to reproduce a defect.
    await publish('q.instance');
    expect(ran.instance).toBeUndefined();

    await queue.publish('q.instance', {}, { metadata: { serviceId: 'payment-service' } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ran.instance).toBe(1);
  });

  test('a guard that throws denies the message and the framework itself logs it', async () => {
    await publish('q.throws');

    expect(ran.throws).toBeUndefined();

    const errorLine = logLines.find((line) => line.startsWith('ERROR') && line.includes('ThrowingGuard'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain('q.throws');
    expect(errorLine).toContain('guard exploded');
  });

  test('a denial is logged with the guard, the pattern and the message id', async () => {
    await publish('q.deny');

    const warnLine = logLines.find((line) => line.startsWith('WARN') && line.includes('q.deny'));
    expect(warnLine).toBeDefined();
    expect(warnLine).toContain('GuardedQueueController.deny');
    expect(warnLine).toMatch(/message \S+/);
  });

  test('a denied message is nacked, not silently swallowed', async () => {
    // Denial semantics: nack(requeue: false). The message dead-letters on adapters that have
    // a DLQ and raises onMessageFailed everywhere, so it never looks like a success.
    await publish('q.deny');

    expect(failures.map((f) => f.pattern)).toContain('q.deny');
    expect(processed).not.toContain('q.deny');
  });

  test('an HTTP-only guard on a queue handler denies rather than passing', async () => {
    // A guard written for a request must not fall through on a transport it cannot read.
    await publish('q.http-only-guard');

    expect(ran.httpOnlyGuard).toBeUndefined();
  });
});

describe('queue guard dependency resolution failures', () => {
  afterEach(() => {
    clearGlobalServicesRegistry();
  });

  test('an unresolvable guard dependency fails the application at STARTUP', async () => {
    // Same rule docs/api/guards.md already states for HTTP guards: fail at boot naming the
    // guard, rather than constructing it with `undefined` and throwing per message.
    const app = new OneBunApplication(UnresolvableQueueModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      queue: { enabled: true, adapter: 'memory' },
      loggerLayer: makeRecordingLoggerLayer(),
    });

    let caught: unknown;
    try {
      await app.start();
    } catch (error) {
      caught = error;
    } finally {
      await app.stop().catch(() => undefined);
    }

    expect(caught).toBeInstanceOf(DependencyResolutionError);
    expect((caught as Error).message).toContain('UnresolvableGuard');
    expect((caught as Error).message).toContain('MissingDep');
  });
});

describe('guard narrowing across transports', () => {
  test('AuthGuard denies a queue context instead of throwing on getRequest()', () => {
    const queueContext = {
      type: 'queue',
      getMessage: () => undefined,
      getMetadata: () => ({}),
      getPattern: () => 'q.x',
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;

    expect(new AuthGuard().canActivate(queueContext)).toBe(false);
  });
});

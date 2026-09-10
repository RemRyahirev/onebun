/**
 * Documentation Examples Tests for @onebun/core — module system.
 *
 * Sections of the two pages below that `packages/core/src/docs-examples.test.ts` does not name
 * are pinned here: the DI wiring, the lifecycle hooks, the logger/config a service reads through
 * `BaseService`, and the metadata the decorators register.
 *
 * @source docs:api/services.md
 * @source docs:architecture.md
 */

import { trace as otelTrace } from '@opentelemetry/api';
import {
  describe,
  it,
  expect,
} from 'bun:test';
import {
  Effect,
  Layer,
  pipe,
} from 'effect';

import type { TracerProvider } from '@opentelemetry/api';

// Through the public specifier: the documentation tells readers to import all of these from
// '@onebun/core', so a symbol missing from the barrel has to fail here.
import type {
  OneBunRequest,
  OneBunResponse,
  OnModuleDestroy,
  OnModuleInit,
} from '@onebun/core';
import {
  BaseController,
  BaseMiddleware,
  BaseService,
  Controller,
  createServiceClient,
  createServiceDefinition,
  DependencyResolutionError,
  Env,
  Get,
  getConfig,
  getConstructorParamTypes,
  getControllerMetadata,
  HttpMethod,
  Module,
  OneBunApplication,
  OneBunModule,
  Param,
  ParamType,
  Service,
  UseMiddleware,
} from '@onebun/core';
import { TypedEnv } from '@onebun/envs';
import type {
  LogEntry,
  Logger,
  LogTransport,
} from '@onebun/logger';
import { LogLevel, makeLogger } from '@onebun/logger';
import { Span } from '@onebun/trace';

import { createMockConfig } from '../testing/test-utils';

// `createGlobalScope` is deliberately NOT on the public barrel — it is the framework's own
// per-application DI scope. A test that omitted it would share the process-default scope with
// every other test file in the run.
import { createGlobalScope } from './module';

/**
 * A real logger (not the silent mock) whose entries are captured, so "this.logger is available"
 * and "the context is merged" are checkable rather than assumed.
 */
function makeCapturingLoggerLayer(entries: LogEntry[]): Layer.Layer<Logger> {
  const transport: LogTransport = {
    log: (_formatted: string, entry: LogEntry) => Effect.sync(() => {
      entries.push(entry);
    }),
  };

  return makeLogger({
    minLevel: LogLevel.Trace,
    formatter: { format: () => '' },
    transport,
  });
}

interface BootedModule {
  module: OneBunModule;
  entries: LogEntry[];
}

/**
 * Build and initialize one module tree the way the framework does: services constructed with the
 * ambient init context, `onModuleInit` run in dependency order, controllers created.
 */
async function bootModule(
  moduleClass: Function,
  configValues: Record<string, unknown> = {},
): Promise<BootedModule> {
  const entries: LogEntry[] = [];
  const module = new OneBunModule(
    moduleClass,
    makeCapturingLoggerLayer(entries) as unknown as Layer.Layer<never, never, unknown>,
    createMockConfig(configValues),
    undefined,
    undefined,
    createGlobalScope(),
  );

  await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

  return { module, entries };
}

/** The same construction without `setup()`, for the cases that must observe the throw. */
function buildModule(moduleClass: Function, configValues: Record<string, unknown> = {}): OneBunModule {
  return new OneBunModule(
    moduleClass,
    makeCapturingLoggerLayer([]) as unknown as Layer.Layer<never, never, unknown>,
    createMockConfig(configValues),
    undefined,
    undefined,
    createGlobalScope(),
  );
}

/** Put an environment variable back exactly as it was, absence included. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];

    return;
  }

  process.env[name] = value;
}

/**
 * Register a fake global TracerProvider so span names become observable in-process.
 *
 * Importing '@onebun/trace' already registers a real provider at module load, and the
 * OpenTelemetry global refuses a second registration — hence the disable/register/restore
 * dance. The captured provider is the previous PROXY, whose delegate survives `disable()`,
 * so re-registering it puts the original tracer back for every later test in the process.
 */
async function withRecordedSpans(run: () => Promise<void>): Promise<string[]> {
  const names: string[] = [];
  const fakeSpan = {
    setAttribute: () => fakeSpan,
    setAttributes: () => fakeSpan,
    setStatus: () => fakeSpan,
    addEvent: () => fakeSpan,
    recordException: () => undefined,
    end: () => undefined,
  };
  const provider = {
    getTracer: () => ({
      startSpan: () => fakeSpan,
      startActiveSpan(name: string, ...rest: unknown[]) {
        names.push(name);
        const fn = rest[rest.length - 1] as (span: typeof fakeSpan) => unknown;

        return fn(fakeSpan);
      },
    }),
  };

  const previousProvider = otelTrace.getTracerProvider();
  otelTrace.disable();
  otelTrace.setGlobalTracerProvider(provider as unknown as TracerProvider);
  try {
    await run();
  } finally {
    otelTrace.disable();
    otelTrace.setGlobalTracerProvider(previousProvider);
  }

  return names;
}

describe('Services (docs/api/services.md)', () => {
  /**
   * @source docs:api/services.md#basic-service
   */
  it('should run a @Service() counter built by the framework, with this.logger already set', async () => {
    @Service()
    class CounterService extends BaseService {
      private count = 0;

      increment(): number {
        this.count++;
        this.logger.debug('Counter incremented', { count: this.count });

        return this.count;
      }

      decrement(): number {
        this.count--;

        return this.count;
      }

      getValue(): number {
        return this.count;
      }
    }

    @Module({ providers: [CounterService] })
    class CounterModule {}

    const { module, entries } = await bootModule(CounterModule);
    const counter = module.getServiceByClass(CounterService)!;

    expect(counter.increment()).toBe(1);
    expect(counter.increment()).toBe(2);
    expect(counter.decrement()).toBe(1);
    expect(counter.getValue()).toBe(1);

    // The tip above the snippet: logger is injected before the constructor runs. Without the
    // ambient init context the first increment() would throw on `this.logger`.
    const counterLogs = entries.filter((entry) => entry.message === 'Counter incremented');
    expect(counterLogs.map((entry) => entry.context?.count)).toEqual([1, 2]);
    expect(counterLogs[0]?.context?.className).toBe('CounterService');
  });

  /**
   * @source docs:api/services.md#service-with-dependencies
   */
  it('should inject both constructor dependencies and let the service reach the cache before the repository', async () => {
    interface User {
      id: string;
      name: string;
    }

    // Stands in for CacheService from '@onebun/cache': @onebun/core cannot depend on it, and the
    // real one is pinned by that package's own docs-examples test.
    @Service()
    class DepsCacheService extends BaseService {
      readonly setCalls: Array<{ key: string; ttl?: number }> = [];
      private readonly store = new Map<string, unknown>();

      async get<T>(key: string): Promise<T | undefined> {
        return await Promise.resolve(this.store.get(key) as T | undefined);
      }

      async set(key: string, value: unknown, options?: { ttl?: number }): Promise<void> {
        this.setCalls.push({ key, ttl: options?.ttl });
        this.store.set(key, value);

        return await Promise.resolve();
      }
    }

    @Service()
    class DepsUserRepository extends BaseService {
      readonly reads: string[] = [];
      private readonly rows = new Map<string, User>([['1', { id: '1', name: 'Ada' }]]);

      async findById(id: string): Promise<User | null> {
        this.reads.push(id);

        return await Promise.resolve(this.rows.get(id) ?? null);
      }
    }

    @Service()
    class DepsUserService extends BaseService {
      // `public` only so the test can assert what was injected; the docs use `private`.
      constructor(
        public cacheService: DepsCacheService,
        public repository: DepsUserRepository,
      ) {
        super();
      }

      async findById(id: string): Promise<User | null> {
        const cacheKey = `user:${id}`;
        const cached = await this.cacheService.get<User>(cacheKey);

        if (cached) {
          this.logger.debug('User found in cache', { id });

          return cached;
        }

        const user = await this.repository.findById(id);

        if (user) {
          await this.cacheService.set(cacheKey, user, { ttl: 300 });
        }

        return user;
      }
    }

    @Module({ providers: [DepsCacheService, DepsUserRepository, DepsUserService] })
    class DepsUserModule {}

    const { module, entries } = await bootModule(DepsUserModule);
    const service = module.getServiceByClass(DepsUserService)!;

    // Constructor parameters are resolved positionally to the module's own instances.
    expect(service.cacheService).toBe(module.getServiceByClass(DepsCacheService)!);
    expect(service.repository).toBe(module.getServiceByClass(DepsUserRepository)!);

    expect(await service.findById('1')).toEqual({ id: '1', name: 'Ada' });
    expect(service.repository.reads).toEqual(['1']);
    expect(service.cacheService.setCalls).toEqual([{ key: 'user:1', ttl: 300 }]);

    // Second call is served from the cache — the repository is not touched again.
    expect(await service.findById('1')).toEqual({ id: '1', name: 'Ada' });
    expect(service.repository.reads).toEqual(['1']);
    expect(entries.filter((entry) => entry.message === 'User found in cache')).toHaveLength(1);

    expect(await service.findById('missing')).toBeNull();
  });

  /**
   * @source docs:api/services.md#service-registration
   */
  it('should inject a provider into another provider of the same module without listing it in exports', async () => {
    @Service()
    class RegistrationRepository extends BaseService {
      find(): string {
        return 'row';
      }
    }

    @Service()
    class RegistrationService extends BaseService {
      constructor(public repository: RegistrationRepository) {
        super();
      }
    }

    // No `exports` at all — the page says it is only needed for cross-module injection.
    @Module({ providers: [RegistrationService, RegistrationRepository] })
    class RegistrationModule {}

    const { module } = await bootModule(RegistrationModule);

    expect(module.getServiceByClass(RegistrationService)!.repository)
      .toBe(module.getServiceByClass(RegistrationRepository)!);
    expect(module.getServiceByClass(RegistrationService)!.repository.find()).toBe('row');
  });

  /**
   * @source docs:api/services.md#service-registration
   */
  it('should hand an exported service to an importing module, and refuse an unexported one', async () => {
    @Service()
    class ExportedCacheService extends BaseService {
      readonly kind = 'exported';
    }

    @Module({
      providers: [ExportedCacheService],
      exports: [ExportedCacheService],
    })
    class ExportingCacheModule {}

    @Service()
    class ImportingUserService extends BaseService {
      constructor(public cacheService: ExportedCacheService) {
        super();
      }
    }

    @Module({
      imports: [ExportingCacheModule],
      providers: [ImportingUserService],
    })
    class ImportingUserModule {}

    const { module } = await bootModule(ImportingUserModule);
    expect(module.getServiceByClass(ImportingUserService)!.cacheService.kind).toBe('exported');

    // Same wiring, minus the exports array.
    @Service()
    class UnexportedCacheService extends BaseService {
      readonly kind = 'hidden';
    }

    @Module({ providers: [UnexportedCacheService] })
    class HidingCacheModule {}

    @Service()
    class BlockedUserService extends BaseService {
      constructor(public cacheService: UnexportedCacheService) {
        super();
      }
    }

    @Module({
      imports: [HidingCacheModule],
      providers: [BlockedUserService],
    })
    class BlockedUserModule {}

    expect(() => buildModule(BlockedUserModule)).toThrow(DependencyResolutionError);
    expect(() => buildModule(BlockedUserModule)).toThrow(
      /Could not resolve dependency UnexportedCacheService for service BlockedUserService/,
    );
    expect(() => buildModule(BlockedUserModule)).toThrow(
      /UnexportedCacheService exists in HidingCacheModule but is not exported/,
    );
  });

  /**
   * @source docs:api/services.md#accessing-logger
   */
  it('should write the info and error entries the EmailService example logs, with their context', async () => {
    @Service()
    class EmailService extends BaseService {
      smtp: { send(message: { to: string; subject: string; body: string }): Promise<void> } = {
        send: async () => await Promise.resolve(),
      };

      async send(to: string, subject: string, body: string): Promise<boolean> {
        this.logger.info('Sending email', { to, subject });

        try {
          await this.smtp.send({ to, subject, body });
          this.logger.info('Email sent successfully', { to });

          return true;
        } catch (error) {
          this.logger.error('Failed to send email', {
            to,
            error: error instanceof Error ? error.message : String(error),
          });

          return false;
        }
      }
    }

    @Module({ providers: [EmailService] })
    class EmailModule {}

    const { module, entries } = await bootModule(EmailModule);
    const emails = module.getServiceByClass(EmailService)!;

    expect(await emails.send('ada@example.com', 'Hi', 'body')).toBe(true);

    // `className` is what the service's own child logger stamps; the module's own bootstrap
    // debug lines share the transport and are filtered out by it.
    const own = entries.filter((entry) => entry.context?.className === 'EmailService');
    expect(own.map((entry) => entry.message)).toEqual(['Sending email', 'Email sent successfully']);
    expect(own[0]?.level).toBe(LogLevel.Info);
    expect(own[0]?.context).toMatchObject({ to: 'ada@example.com', subject: 'Hi' });
    expect(own[1]?.context).toMatchObject({ to: 'ada@example.com' });

    entries.length = 0;
    // Substituted on the INSTANCE — mock.module is process-global and would poison the run.
    emails.smtp = { send: async () => await Promise.reject(new Error('smtp down')) };

    expect(await emails.send('ada@example.com', 'Hi', 'body')).toBe(false);
    const failure = entries.find((entry) => entry.message === 'Failed to send email')!;
    expect(failure.level).toBe(LogLevel.Error);
    expect(failure.context).toMatchObject({ to: 'ada@example.com', error: 'smtp down' });
  });

  /**
   * @source docs:api/services.md#logging-with-context
   */
  it('should merge a context object, attach an Error argument and keep extra arguments aside', async () => {
    @Service()
    class ContextLoggingService extends BaseService {
      logAll(): void {
        this.logger.info('User action', {
          userId: 'u-1',
          action: 'login',
          ip: '10.0.0.7',
        });

        this.logger.error('Operation failed', new Error('Something went wrong'));

        const data = { id: 'p-1' };
        this.logger.debug('Processing', data, { step: 1 }, 'extra info');
      }
    }

    @Module({ providers: [ContextLoggingService] })
    class ContextLoggingModule {}

    const { module, entries } = await bootModule(ContextLoggingModule);
    entries.length = 0;
    module.getServiceByClass(ContextLoggingService)!.logAll();

    const action = entries.find((entry) => entry.message === 'User action')!;
    expect(action.context).toMatchObject({
      userId: 'u-1',
      action: 'login',
      ip: '10.0.0.7',
    });

    const failed = entries.find((entry) => entry.message === 'Operation failed')!;
    expect(failed.error?.message).toBe('Something went wrong');
    expect(failed.level).toBe(LogLevel.Error);

    // Plain objects are merged into the context; anything else is kept verbatim.
    const processing = entries.find((entry) => entry.message === 'Processing')!;
    expect(processing.context).toMatchObject({ id: 'p-1', step: 1 });
    expect(processing.context?.__additionalData).toEqual(['extra info']);
  });

  /**
   * @source docs:api/services.md#accessing-configuration
   */
  it('should let a service read configuration in its constructor, right after super()', async () => {
    @Service()
    class ConfigReadingDatabaseService extends BaseService {
      readonly connectionUrl: string;
      readonly maxConnections: number;

      constructor() {
        super();

        // The casts stand in for the module augmentation the page assumes; the VALUES are what
        // this pins — an uninitialized `this.config` would throw here instead.
        this.connectionUrl = this.config.get('database.url') as string;
        this.maxConnections = this.config.get('database.maxConnections') as number;
      }

      async connect(): Promise<void> {
        this.logger.info('Connecting to database', { maxConnections: this.maxConnections });

        return await Promise.resolve();
      }
    }

    @Module({ providers: [ConfigReadingDatabaseService] })
    class ConfigReadingModule {}

    const { module, entries } = await bootModule(ConfigReadingModule, {
      /* eslint-disable @typescript-eslint/naming-convention -- config paths, not identifiers */
      'database.url': 'postgres://localhost:5432/app',
      'database.maxConnections': 25,
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    const database = module.getServiceByClass(ConfigReadingDatabaseService)!;
    expect(database.connectionUrl).toBe('postgres://localhost:5432/app');
    expect(database.maxConnections).toBe(25);

    await database.connect();
    expect(entries.find((entry) => entry.message === 'Connecting to database')?.context)
      .toMatchObject({ maxConnections: 25 });
  });

  /**
   * @source docs:api/services.md#service-with-tracing
   */
  it('should open one span per @Span()-decorated call and still return the method result', async () => {
    interface Order {
      id: string;
    }

    @Service()
    class TracedOrderService extends BaseService {
      @Span('create-order')
      async createOrder(data: { customerId: string }): Promise<Order> {
        this.logger.info('Creating order', { customerId: data.customerId });

        return await Promise.resolve({ id: `order-${data.customerId}` });
      }

      @Span('process-payment')
      async processPayment(orderId: string, amount: number): Promise<{ orderId: string; amount: number }> {
        return await Promise.resolve({ orderId, amount });
      }

      @Span() // Uses the default name
      async validateOrder(order: Order): Promise<boolean> {
        return await Promise.resolve(order.id.length > 0);
      }
    }

    @Module({ providers: [TracedOrderService] })
    class TracedOrderModule {}

    const { module } = await bootModule(TracedOrderModule);
    const orders = module.getServiceByClass(TracedOrderService)!;

    const spanNames = await withRecordedSpans(async () => {
      expect(await orders.createOrder({ customerId: 'c-1' })).toEqual({ id: 'order-c-1' });
      expect(await orders.processPayment('order-c-1', 500)).toEqual({ orderId: 'order-c-1', amount: 500 });
      expect(await orders.validateOrder({ id: 'order-c-1' })).toBe(true);
    });

    // The bare `@Span()` resolves to `ClassName.methodName`, NOT the bare method name the
    // comment in the snippet claims.
    expect(spanNames).toEqual(['create-order', 'process-payment', 'TracedOrderService.validateOrder']);
  });

  /**
   * @source docs:api/services.md#bridge-effect-to-promise
   */
  it('should expose an Effect pipeline as a promise through runEffect, retries included', async () => {
    interface Data {
      id: string;
    }

    class FetchError {
      readonly _tag = 'FetchError';

      constructor(public readonly message: string) {}
    }

    @Service()
    class BridgeDataService extends BaseService {
      attempts = 0;
      failuresBeforeSuccess = 0;

      private fetchDataEffect(id: string): Effect.Effect<Data, FetchError, never> {
        return pipe(
          Effect.tryPromise({
            try: async () => {
              this.attempts++;
              if (this.attempts <= this.failuresBeforeSuccess) {
                throw new Error('upstream down');
              }

              return await Promise.resolve({ id });
            },
            catch: (e) => new FetchError(String(e)),
          }),
          Effect.tap(() => Effect.sync(() => this.logger.debug('Data fetched', { id }))),
        );
      }

      async fetchData(id: string): Promise<Data> {
        const effect = pipe(
          this.fetchDataEffect(id),
          // The documented `delay: '1 second'` is dropped so the test does not sleep.
          Effect.retry({ times: 3 }),
        );

        // The declared parameter is `Effect.Effect<never, never, A>` (legacy argument order),
        // so the snippet's bare `this.runEffect(effect)` needs this cast to compile.
        return await this.runEffect(effect as unknown as Effect.Effect<never, never, Data>);
      }
    }

    @Module({ providers: [BridgeDataService] })
    class BridgeDataModule {}

    const { module, entries } = await bootModule(BridgeDataModule);
    const service = module.getServiceByClass(BridgeDataService)!;

    expect(await service.fetchData('42')).toEqual({ id: '42' });
    expect(service.attempts).toBe(1);
    expect(entries.some((entry) => entry.message === 'Data fetched')).toBe(true);

    service.attempts = 0;
    service.failuresBeforeSuccess = 2;
    expect(await service.fetchData('43')).toEqual({ id: '43' });
    expect(service.attempts).toBe(3);

    // Exhausting the retries surfaces as a rejected promise, formatted by BaseService.
    service.attempts = 0;
    service.failuresBeforeSuccess = 99;
    await expect(service.fetchData('44')).rejects.toThrow(/upstream down/);
  });

  /**
   * @source docs:api/services.md#repository-pattern
   */
  it('should wire repository, cache and event services into the service that owns the business rules', async () => {
    interface User {
      id: string;
      email: string;
      password: string;
    }

    @Service()
    class PatternUserRepository extends BaseService {
      readonly rows = new Map<string, User>();

      async findByEmail(email: string): Promise<User | null> {
        for (const row of this.rows.values()) {
          if (row.email === email) {
            return await Promise.resolve(row);
          }
        }

        return await Promise.resolve(null);
      }

      async create(data: Omit<User, 'id'>): Promise<User> {
        const user = { id: `u-${this.rows.size + 1}`, ...data };
        this.rows.set(user.id, user);

        return await Promise.resolve(user);
      }
    }

    @Service()
    class PatternEventService extends BaseService {
      readonly emitted: Array<{ name: string; payload: unknown }> = [];

      async emit(name: string, payload: unknown): Promise<void> {
        this.emitted.push({ name, payload });

        return await Promise.resolve();
      }
    }

    @Service()
    class PatternUserService extends BaseService {
      constructor(
        public repository: PatternUserRepository,
        public eventService: PatternEventService,
      ) {
        super();
      }

      async createUser(data: { email: string; password: string }): Promise<User> {
        const existingUser = await this.repository.findByEmail(data.email);
        if (existingUser) {
          throw new Error('Email already exists');
        }

        const user = await this.repository.create({
          ...data,
          password: `hashed:${data.password}`,
        });

        await this.eventService.emit('user.created', { userId: user.id });
        this.logger.info('User created', { userId: user.id });

        return user;
      }
    }

    @Module({ providers: [PatternUserRepository, PatternEventService, PatternUserService] })
    class PatternUserModule {}

    const { module, entries } = await bootModule(PatternUserModule);
    const service = module.getServiceByClass(PatternUserService)!;

    expect(service.repository).toBe(module.getServiceByClass(PatternUserRepository)!);
    expect(service.eventService).toBe(module.getServiceByClass(PatternEventService)!);

    const created = await service.createUser({ email: 'ada@example.com', password: 'secret' });
    expect(created).toEqual({ id: 'u-1', email: 'ada@example.com', password: 'hashed:secret' });
    expect(service.eventService.emitted).toEqual([{ name: 'user.created', payload: { userId: 'u-1' } }]);
    expect(entries.find((entry) => entry.message === 'User created')?.context)
      .toMatchObject({ userId: 'u-1' });

    await expect(service.createUser({ email: 'ada@example.com', password: 'other' }))
      .rejects.toThrow('Email already exists');
    expect(service.repository.rows.size).toBe(1);
  });

  /**
   * @source docs:api/services.md#complete-service-example
   */
  it('should paginate, cache, reject duplicates and invalidate on write, as the complete example claims', async () => {
    interface User {
      id: string;
      name: string;
      email: string;
      createdAt: Date;
    }

    // Stands in for CacheService from '@onebun/cache' — see the note on #service-with-dependencies.
    @Service()
    class CompleteCacheService extends BaseService {
      readonly deleted: string[] = [];
      private readonly store = new Map<string, unknown>();

      async get<T>(key: string): Promise<T | undefined> {
        return await Promise.resolve(this.store.get(key) as T | undefined);
      }

      async set(key: string, value: unknown, _options?: { ttl?: number }): Promise<void> {
        this.store.set(key, value);

        return await Promise.resolve();
      }

      async delete(key: string): Promise<void> {
        this.deleted.push(key);
        this.store.delete(key);

        return await Promise.resolve();
      }
    }

    @Service()
    class CompleteUserService extends BaseService {
      private users = new Map<string, User>();

      constructor(public cacheService: CompleteCacheService) {
        super();
      }

      @Span('user-find-all')
      async findAll(options?: { page?: number; limit?: number }): Promise<{
        items: User[];
        total: number;
        page: number;
        limit: number;
      }> {
        const page = options?.page || 1;
        const limit = options?.limit || 10;
        const offset = (page - 1) * limit;

        const allUsers = Array.from(this.users.values());

        return await Promise.resolve({
          items: allUsers.slice(offset, offset + limit),
          total: allUsers.length,
          page,
          limit,
        });
      }

      @Span('user-find-by-id')
      async findById(id: string): Promise<User | null> {
        const cacheKey = `user:${id}`;
        const cached = await this.cacheService.get<User>(cacheKey);

        if (cached) {
          this.logger.trace('User cache hit', { id });

          return cached;
        }

        this.logger.trace('User cache miss', { id });
        const user = this.users.get(id) || null;

        if (user) {
          await this.cacheService.set(cacheKey, user, { ttl: 300 });
        }

        return user;
      }

      @Span('user-create')
      async create(data: { name: string; email: string }): Promise<User> {
        const existingUser = await this.findByEmail(data.email);
        if (existingUser) {
          this.logger.warn('Duplicate email attempt', { email: data.email });
          throw new Error('Email already exists');
        }

        const user: User = {
          id: `u-${this.users.size + 1}`,
          name: data.name,
          email: data.email,
          createdAt: new Date(),
        };

        this.users.set(user.id, user);
        this.logger.info('User created', { userId: user.id, email: user.email });

        return user;
      }

      @Span('user-update')
      async update(id: string, data: { name?: string }): Promise<User | null> {
        const user = this.users.get(id);

        if (!user) {
          this.logger.warn('User not found for update', { id });

          return null;
        }

        const updatedUser = { ...user, ...data };
        this.users.set(id, updatedUser);
        await this.cacheService.delete(`user:${id}`);

        return updatedUser;
      }

      @Span('user-delete')
      async delete(id: string): Promise<boolean> {
        const deleted = this.users.delete(id);

        if (deleted) {
          await this.cacheService.delete(`user:${id}`);
        }

        return deleted;
      }

      private async findByEmail(email: string): Promise<User | null> {
        for (const user of this.users.values()) {
          if (user.email === email) {
            return await Promise.resolve(user);
          }
        }

        return await Promise.resolve(null);
      }
    }

    @Module({ providers: [CompleteCacheService, CompleteUserService] })
    class CompleteUserModule {}

    const { module, entries } = await bootModule(CompleteUserModule);
    const users = module.getServiceByClass(CompleteUserService)!;

    const ada = await users.create({ name: 'Ada', email: 'ada@example.com' });
    const alan = await users.create({ name: 'Alan', email: 'alan@example.com' });
    const grace = await users.create({ name: 'Grace', email: 'grace@example.com' });
    expect(entries.filter((entry) => entry.message === 'User created')).toHaveLength(3);

    await expect(users.create({ name: 'Ada again', email: 'ada@example.com' }))
      .rejects.toThrow('Email already exists');
    expect(entries.find((entry) => entry.message === 'Duplicate email attempt')?.context)
      .toMatchObject({ email: 'ada@example.com' });

    // Pagination: page 2 of size 2 is the third row only, `total` counts everything.
    expect(await users.findAll({ page: 2, limit: 2 })).toEqual({
      items: [grace],
      total: 3,
      page: 2,
      limit: 2,
    });
    expect((await users.findAll()).limit).toBe(10);

    // First read is a miss and populates the cache; the second is served from it.
    expect(await users.findById(ada.id)).toEqual(ada);
    expect(entries.some((entry) => entry.message === 'User cache miss')).toBe(true);
    expect(await users.findById(ada.id)).toEqual(ada);
    expect(entries.filter((entry) => entry.message === 'User cache hit')).toHaveLength(1);

    // Update returns the merged record and drops the cache entry for that key.
    expect(await users.update(alan.id, { name: 'Alan Turing' })).toEqual({ ...alan, name: 'Alan Turing' });
    expect(users.cacheService.deleted).toEqual([`user:${alan.id}`]);
    expect(await users.update('nobody', { name: 'x' })).toBeNull();

    expect(await users.delete(ada.id)).toBe(true);
    expect(await users.delete(ada.id)).toBe(false);
    expect(users.cacheService.deleted).toEqual([`user:${alan.id}`, `user:${ada.id}`]);
  });
});

describe('Architecture (docs/architecture.md)', () => {
  /**
   * @source docs:architecture.md#auto-detection-algorithm
   */
  it('should read design:paramtypes, which only decorated classes carry, and resolve from it', async () => {
    @Service()
    class AutoDetectMailer extends BaseService {
      readonly kind = 'mailer';
    }

    @Service()
    class AutoDetectNotifier extends BaseService {
      constructor(public mailer: AutoDetectMailer) {
        super();
      }
    }

    // Same constructor, no decorator: TypeScript emits no metadata for it.
    class UndecoratedNotifier {
      constructor(public mailer: AutoDetectMailer) {}
    }

    const globalReflect = globalThis.Reflect as unknown as {
      getMetadata?(key: string, target: object): unknown;
    };
    expect(globalReflect.getMetadata?.('design:paramtypes', AutoDetectNotifier))
      .toEqual([AutoDetectMailer]);
    expect(globalReflect.getMetadata?.('design:paramtypes', UndecoratedNotifier)).toBeUndefined();

    // What the framework actually resolves from that metadata.
    expect(getConstructorParamTypes(AutoDetectNotifier)).toEqual([AutoDetectMailer]);
    expect(getConstructorParamTypes(UndecoratedNotifier)).toBeUndefined();

    @Module({ providers: [AutoDetectMailer, AutoDetectNotifier] })
    class AutoDetectModule {}

    const { module } = await bootModule(AutoDetectModule);
    expect(module.getServiceByClass(AutoDetectNotifier)!.mailer)
      .toBe(module.getServiceByClass(AutoDetectMailer)!);
  });

  /**
   * @source docs:architecture.md#using-effectjs-in-services
   */
  it('should let one service expose a promise API, an Effect API and a retrying bridge over both', async () => {
    interface Data {
      id: string;
    }

    class FetchError {
      readonly _tag = 'FetchError';

      constructor(public readonly cause: unknown) {}
    }

    @Service()
    class MixedDataService extends BaseService {
      attempts = 0;
      failuresBeforeSuccess = 0;

      // The snippet's endpoint is the literal '/api/data'; here it comes from `this.config`,
      // read in a field initializer, so the service under test is the one the framework built
      // and injected rather than a bare `new`.
      private readonly endpoint = this.config.get('api.dataUrl') as string;

      // Stands in for the snippet's global `fetch` — a doc example may call the network,
      // a test may not.
      async load(): Promise<Data> {
        this.attempts++;
        if (this.attempts <= this.failuresBeforeSuccess) {
          throw new Error('upstream down');
        }

        return await Promise.resolve({ id: this.endpoint });
      }

      async fetchData(): Promise<Data> {
        return await this.load();
      }

      fetchDataEffect(): Effect.Effect<Data, FetchError, never> {
        return pipe(
          Effect.tryPromise({
            try: async () => await this.load(),
            catch: (e) => new FetchError(e),
          }),
          // Not in the snippet: the one observable proof that the pipeline ran INSIDE a
          // framework-built service, through the child logger it was given.
          Effect.tap((data) => Effect.sync(() => this.logger.debug('Data fetched', { id: data.id }))),
        );
      }

      async fetchWithRetry(): Promise<Data> {
        const effect = pipe(
          this.fetchDataEffect(),
          Effect.retry({ times: 3 }),
        );

        return await Effect.runPromise(effect);
      }
    }

    @Module({ providers: [MixedDataService] })
    class MixedDataModule {}

    const { module, entries } = await bootModule(MixedDataModule, {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- config path, not an identifier
      'api.dataUrl': '/api/data',
    });
    const service = module.getServiceByClass(MixedDataService)!;

    // The promise-based half returns what the constructor read from the injected config.
    expect(await service.fetchData()).toEqual({ id: '/api/data' });

    // The Effect-typed method is a description: nothing ran until it was executed.
    service.attempts = 0;
    entries.length = 0;
    const effect = service.fetchDataEffect();
    expect(service.attempts).toBe(0);
    expect(await Effect.runPromise(effect)).toEqual({ id: '/api/data' });
    expect(service.attempts).toBe(1);

    // Running it logged exactly once, through the child logger the framework stamped with the
    // service class name.
    expect(entries.map((entry) => [entry.message, entry.context?.className, entry.context?.id]))
      .toEqual([['Data fetched', 'MixedDataService', '/api/data']]);

    service.attempts = 0;
    service.failuresBeforeSuccess = 2;
    expect(await service.fetchWithRetry()).toEqual({ id: '/api/data' });
    expect(service.attempts).toBe(3);

    // `Effect.tap` sits after the failing step, so the two failed attempts logged nothing.
    expect(entries.filter((entry) => entry.message === 'Data fetched')).toHaveLength(2);
  });

  /**
   * @source docs:architecture.md#lifecycle-hooks
   */
  it('should open the connection in onModuleInit and close it in onModuleDestroy', async () => {
    const events: string[] = [];

    @Service()
    class LifecycleDatabaseService extends BaseService
      implements OnModuleInit, OnModuleDestroy {
      connection: { url: string; open: boolean } | null = null;

      async onModuleInit(): Promise<void> {
        this.connection = { url: this.config.get('database.url') as string, open: true };
        events.push('init');
        this.logger.info('Database connected');

        return await Promise.resolve();
      }

      async onModuleDestroy(): Promise<void> {
        if (this.connection) {
          this.connection.open = false;
        }
        events.push('destroy');
        this.logger.info('Database disconnected');

        return await Promise.resolve();
      }
    }

    @Module({ providers: [LifecycleDatabaseService] })
    class LifecycleModule {}

    const { module, entries } = await bootModule(LifecycleModule, {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- config path, not an identifier
      'database.url': 'postgres://localhost:5432/lifecycle',
    });
    const database = module.getServiceByClass(LifecycleDatabaseService)!;

    // setup() ran the hook: the connection exists and carries the configured URL.
    expect(events).toEqual(['init']);
    expect(database.connection).toEqual({ url: 'postgres://localhost:5432/lifecycle', open: true });
    expect(entries.some((entry) => entry.message === 'Database connected')).toBe(true);

    await module.callOnModuleDestroy();

    expect(events).toEqual(['init', 'destroy']);
    expect(database.connection?.open).toBe(false);
    expect(entries.some((entry) => entry.message === 'Database disconnected')).toBe(true);
  });

  /**
   * @source docs:architecture.md#metadata-storage
   */
  it('should register the documented ControllerMetadata for the decorated routes', () => {
    class MetadataAuditMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        return await next();
      }
    }

    @Controller('/users')
    class MetadataUserController extends BaseController {
      @Get('/')
      findAll(): unknown[] {
        return [];
      }

      @Get('/:id')
      findOne(@Param('id') id: string): { id: string } {
        return { id };
      }

      // Not in the documented literal, and there on purpose: an empty `middleware` is the value
      // a decorator that records NOTHING would also produce, so the empty list below only means
      // something next to a route whose middleware really was stored.
      @Get('/audit')
      @UseMiddleware(MetadataAuditMiddleware)
      audit(): unknown[] {
        return [];
      }
    }

    const metadata = getControllerMetadata(MetadataUserController)!;
    expect(metadata.path).toBe('/users');

    // The documented literal prints `params: []` and `middleware: []` on the first route, so
    // both fields have to be materialized as empty arrays. No `?? []` here: the fallback would
    // accept a route that stored nothing at all, which is exactly the regression to catch.
    const findAll = metadata.routes.find((route) => route.handler === 'findAll')!;
    expect(findAll.path).toBe('/');
    expect(findAll.method).toBe(HttpMethod.GET);
    expect(findAll.params).toEqual([]);
    expect(findAll.middleware).toEqual([]);

    const findOne = metadata.routes.find((route) => route.handler === 'findOne')!;
    expect(findOne.path).toBe('/:id');
    expect(findOne.method).toBe(HttpMethod.GET);
    expect(findOne.params?.[0]?.type).toBe(ParamType.PATH);
    expect(findOne.params?.[0]?.name).toBe('id');
    expect(findOne.params?.[0]?.index).toBe(0);

    // The other half of the pair: what `middleware` holds when the route has some.
    const audit = metadata.routes.find((route) => route.handler === 'audit')!;
    expect(audit.middleware).toEqual([MetadataAuditMiddleware]);
  });

  /**
   * @source docs:architecture.md#baseservice-features
   */
  it('should run onModuleInit for a standalone provider nothing injects', async () => {
    const started: string[] = [];

    @Service()
    class StandaloneSchedulerService extends BaseService implements OnModuleInit {
      // A field initializer runs right after super() and BEFORE the framework's
      // `initializeService()` fallback, so this value can only arrive through the ambient init
      // context the section describes. Asserting `this.config !== undefined` instead would stay
      // green with that context removed, because the fallback still fills the field in time for
      // the hook.
      readonly cron = this.config.get('scheduler.cron') as string;

      async onModuleInit(): Promise<void> {
        this.logger.info('Scheduler started', { cron: this.cron });
        started.push('scheduler');

        return await Promise.resolve();
      }
    }

    // No controller and no other service references it.
    @Module({ providers: [StandaloneSchedulerService] })
    class StandaloneModule {}

    const { module, entries } = await bootModule(StandaloneModule, {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- config path, not an identifier
      'scheduler.cron': '*/5 * * * *',
    });
    const scheduler = module.getServiceByClass(StandaloneSchedulerService)!;

    expect(started).toEqual(['scheduler']);
    expect(scheduler.cron).toBe('*/5 * * * *');

    // The hook wrote through the service's OWN child logger: `className` is what the framework
    // stamps on it, `cron` is the configured value read after super().
    expect(entries.find((entry) => entry.message === 'Scheduler started')?.context)
      .toEqual({ className: 'StandaloneSchedulerService', cron: '*/5 * * * *' });
  });

  /**
   * @source docs:architecture.md#baseservice-features
   */
  it('should complete a dependency onModuleInit before the dependent one starts', async () => {
    const order: string[] = [];

    @Service()
    class InnerInitService extends BaseService implements OnModuleInit {
      ready = false;

      async onModuleInit(): Promise<void> {
        order.push('inner:start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        this.ready = true;
        order.push('inner:end');
      }
    }

    @Service()
    class OuterInitService extends BaseService implements OnModuleInit {
      innerWasReady = false;

      constructor(private inner: InnerInitService) {
        super();
      }

      async onModuleInit(): Promise<void> {
        order.push('outer:start');
        this.innerWasReady = this.inner.ready;
        order.push('outer:end');

        return await Promise.resolve();
      }
    }

    @Module({ providers: [InnerInitService, OuterInitService] })
    class InitOrderModule {}

    const { module } = await bootModule(InitOrderModule);

    expect(order).toEqual(['inner:start', 'inner:end', 'outer:start', 'outer:end']);
    expect(module.getServiceByClass(OuterInitService)!.innerWasReady).toBe(true);
  });

  /**
   * @source docs:architecture.md#service-layer-pattern
   */
  it('should serve findById from the cache and fall back to the repository, caching with ttl 300', async () => {
    interface User {
      id: string;
      name: string;
    }

    @Service()
    class LayerCacheService extends BaseService {
      readonly setCalls: Array<[string, unknown, { ttl?: number } | undefined]> = [];
      private readonly store = new Map<string, unknown>();

      async get(key: string): Promise<User | null> {
        return await Promise.resolve((this.store.get(key) as User | undefined) ?? null);
      }

      async set(key: string, value: unknown, options?: { ttl?: number }): Promise<void> {
        this.setCalls.push([key, value, options]);
        this.store.set(key, value);

        return await Promise.resolve();
      }
    }

    @Service()
    class LayerUserRepository extends BaseService {
      calls = 0;

      async findById(id: string): Promise<User | null> {
        this.calls++;

        return await Promise.resolve(id === '1' ? { id: '1', name: 'Ada' } : null);
      }
    }

    @Service()
    class LayerUserService extends BaseService {
      constructor(
        public repository: LayerUserRepository,
        public cacheService: LayerCacheService,
      ) {
        super();
      }

      async findById(id: string): Promise<User | null> {
        const cached = await this.cacheService.get(`user:${id}`);
        if (cached) {
          return cached;
        }

        const user = await this.repository.findById(id);

        if (user) {
          await this.cacheService.set(`user:${id}`, user, { ttl: 300 });
        }

        return user;
      }
    }

    @Module({ providers: [LayerCacheService, LayerUserRepository, LayerUserService] })
    class LayerUserModule {}

    const { module } = await bootModule(LayerUserModule);
    const service = module.getServiceByClass(LayerUserService)!;

    expect(await service.findById('1')).toEqual({ id: '1', name: 'Ada' });
    expect(service.repository.calls).toBe(1);
    expect(service.cacheService.setCalls).toEqual([['user:1', { id: '1', name: 'Ada' }, { ttl: 300 }]]);

    expect(await service.findById('1')).toEqual({ id: '1', name: 'Ada' });
    expect(service.repository.calls).toBe(1);

    // A miss that the repository cannot satisfy is never cached.
    expect(await service.findById('2')).toBeNull();
    expect(service.cacheService.setCalls).toHaveLength(1);
  });

  /**
   * @source docs:architecture.md#schema-definition
   */
  it('should apply the defaults, the env override and the array separator of the documented schema', () => {
    const envSchema = {
      server: {
        port: Env.number({ default: 3000 }),
        host: Env.string({ default: '0.0.0.0' }),
      },
      database: {
        url: Env.string({ env: 'DATABASE_URL', sensitive: true }),
        maxConnections: Env.number({ default: 10 }),
      },
      features: {
        enableCache: Env.boolean({ default: true }),
        allowedOrigins: Env.array({ separator: ',' }),
      },
    };

    const previous = {
      databaseUrl: process.env.DATABASE_URL,
      allowedOrigins: process.env.FEATURES_ALLOWEDORIGINS,
      serverPort: process.env.SERVER_PORT,
    };

    process.env.DATABASE_URL = 'postgres://localhost:5432/docs';
    // The derived name uppercases the path and turns the dot into `_`; it does NOT split the
    // camelCase word, so it is FEATURES_ALLOWEDORIGINS, not FEATURES_ALLOWED_ORIGINS.
    process.env.FEATURES_ALLOWEDORIGINS = 'https://a.example,https://b.example';
    delete process.env.SERVER_PORT;

    try {
      // `loadDotEnv: false` keeps the repository's own .env out of the assertion.
      const config = getConfig<{
        server: { port: number; host: string };
        database: { url: string; maxConnections: number };
        features: { enableCache: boolean; allowedOrigins: string[] };
      }>(envSchema, { loadDotEnv: false });

      // Defaults are typed, not strings.
      expect(config.get('server.port')).toBe(3000);
      expect(config.get('server.host')).toBe('0.0.0.0');
      expect(config.get('database.maxConnections')).toBe(10);
      expect(config.get('features.enableCache')).toBe(true);

      // `separator: ','` splits the raw string into an array.
      expect(config.get('features.allowedOrigins')).toEqual(['https://a.example', 'https://b.example']);

      // `env: 'DATABASE_URL'` picked the variable, and `sensitive: true` wrapped the value:
      // it prints masked and unwraps through `.value`.
      const url = config.get('database.url') as unknown as { value: string };
      expect(String(url)).toBe('***');
      expect(url.value).toBe('postgres://localhost:5432/docs');
    } finally {
      // Assigning `undefined` would store the STRING "undefined" for every later test.
      restoreEnv('DATABASE_URL', previous.databaseUrl);
      restoreEnv('FEATURES_ALLOWEDORIGINS', previous.allowedOrigins);
      restoreEnv('SERVER_PORT', previous.serverPort);
    }
  });

  /**
   * @source docs:architecture.md#logging
   */
  it('should carry the parent context into a child logger', async () => {
    @Service()
    class ChildLoggingService extends BaseService {
      logBoth(): void {
        this.logger.info('User created', { userId: 'u-9' });

        const childLogger = this.logger.child({ requestId: '123' });
        childLogger.warn('Slow request');
      }
    }

    @Module({ providers: [ChildLoggingService] })
    class ChildLoggingModule {}

    const { module, entries } = await bootModule(ChildLoggingModule);
    entries.length = 0;
    module.getServiceByClass(ChildLoggingService)!.logBoth();

    const created = entries.find((entry) => entry.message === 'User created')!;
    expect(created.level).toBe(LogLevel.Info);
    expect(created.context).toMatchObject({ className: 'ChildLoggingService', userId: 'u-9' });
    expect(created.context?.requestId).toBeUndefined();

    // The child adds requestId and INHERITS the service's className.
    const slow = entries.find((entry) => entry.message === 'Slow request')!;
    expect(slow.level).toBe(LogLevel.Warning);
    expect(slow.context).toMatchObject({ className: 'ChildLoggingService', requestId: '123' });
  });

  /**
   * @source docs:architecture.md#single-process-multiple-services
   */
  it('should run two modules as two listeners in one process', async () => {
    @Controller('/whoami')
    class UsersWhoamiController extends BaseController {
      @Get('/')
      whoami(): { service: string } {
        return { service: 'users' };
      }
    }

    @Controller('/whoami')
    class OrdersWhoamiController extends BaseController {
      @Get('/')
      whoami(): { service: string } {
        return { service: 'orders' };
      }
    }

    @Module({ controllers: [UsersWhoamiController] })
    class MultiUsersModule {}

    @Module({ controllers: [OrdersWhoamiController] })
    class MultiOrdersModule {}

    TypedEnv.clear();

    // `port: 0` stands in for the documented 3001/3002 so the suite never fights for a port.
    const multiApp = new OneBunApplication({
      services: {
        users: { module: MultiUsersModule, port: 0 },
        orders: {
          module: MultiOrdersModule,
          port: 0,
          envOverrides: { DB_NAME: { value: 'orders_db' } },
        },
      },
      envSchema: {
        db: { name: Env.string({ env: 'DB_NAME', default: 'shared_db' }) },
      },
      // prom-client's registry is process-global, so a second application in the same run
      // fails its default-metric registration; nothing on this page depends on it.
      metrics: { enabled: false },
      tracing: { enabled: false },
    });

    try {
      await multiApp.start();

      expect(multiApp.getRunningServices()).toEqual(['users', 'orders']);

      // The shared `envSchema` reaches every child.
      expect(multiApp.getApplication('users')!.getConfig().get('db.name')).toBe('shared_db');

      // The page's `envOverrides: { DB_NAME: ... }` reaches the second service. It used not to:
      // every application called `TypedEnv.create(schema, options)` on one process-wide cache key,
      // so the first child's ConfigProxy was handed to every later one and its `valueOverrides`
      // were dropped. The cache now keys on the schema and the options that shape the load.
      expect(multiApp.getApplication('orders')!.getConfig().get('db.name')).toBe('orders_db');

      const usersUrl = multiApp.getServiceUrl('users');
      const ordersUrl = multiApp.getServiceUrl('orders');
      expect(usersUrl).not.toBe(ordersUrl);

      expect(await fetch(`${usersUrl}/whoami`).then(async (res) => await res.json()))
        .toEqual({ success: true, result: { service: 'users' } });
      expect(await fetch(`${ordersUrl}/whoami`).then(async (res) => await res.json()))
        .toEqual({ success: true, result: { service: 'orders' } });
    } finally {
      await multiApp.stop();
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:architecture.md#service-communication
   */
  it('should call the running service through a client generated from its module definition', async () => {
    @Controller('/users')
    class DefinitionUsersController extends BaseController {
      @Get('/:id')
      findById(@Param('id') id: string): { id: string; name: string } {
        return { id, name: 'Ada' };
      }
    }

    @Module({ controllers: [DefinitionUsersController] })
    class DefinitionUsersModule {}

    TypedEnv.clear();

    const app = new OneBunApplication(DefinitionUsersModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const usersServiceDefinition = createServiceDefinition(DefinitionUsersModule);

      // The controller key is the controller CLASS name, and the option is `url`.
      expect([...usersServiceDefinition._controllers.keys()]).toEqual(['DefinitionUsersController']);

      const usersClient = createServiceClient(usersServiceDefinition, {
        url: app.getHttpUrl(),
      });

      const response = await usersClient.DefinitionUsersController.findById('123') as {
        success: boolean;
        result: { success: boolean; result: { id: string; name: string } };
      };

      // Two envelopes: the client wraps the transport result, and `result` is the server's own
      // `{ success, result }` body verbatim.
      expect(response.success).toBe(true);
      expect(response.result).toEqual({ success: true, result: { id: '123', name: 'Ada' } });
    } finally {
      await app.stop();
      TypedEnv.clear();
    }
  });
});

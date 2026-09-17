import {
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

import type { OneBunRequest, OneBunResponse } from '../types';

import { Controller, Middleware } from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseMiddleware } from '../module/middleware';
import { BaseService, Service } from '../module/service';

import {
  createTestController,
  createTestMiddleware,
  createTestService,
} from './service-helpers';

// ============================================================================
// Test fixtures
// ============================================================================

@Service()
class TestService extends BaseService {
  getValue(): string {
    return 'service-value';
  }
}

@Service()
class ServiceWithDeps extends BaseService {
  constructor(private readonly dep: { name: string }) {
    super();
  }

  getDep(): string {
    return this.dep.name;
  }
}

@Controller('/test')
class TestController extends BaseController {
  handle(): string {
    return 'controller-value';
  }
}

@Controller('/test-deps')
class ControllerWithDeps extends BaseController {
  constructor(private readonly dep: { name: string }) {
    super();
  }

  getDep(): string {
    return this.dep.name;
  }
}

async function nextOk(): Promise<OneBunResponse> {
  return new Response('ok', { status: 200 });
}

function probeRequest(): OneBunRequest {
  return new Request('http://localhost/probe') as unknown as OneBunRequest;
}

/** Reads config where every middleware in the documentation reads it: in `use()`. */
@Middleware()
class AdminAuthMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    // Deliberately NOT defensive: a `try { … } catch` here takes its catch branch when
    // `this.config` is undefined, which is how four suites passed against the defect.
    const expected = this.config.get('admin.token');

    if (req.headers.get('x-admin-token') !== expected) {
      this.logger.warn('rejected an unauthenticated admin request');

      return new Response('Unauthorized', { status: 401 });
    }

    return await next();
  }
}

/** Reads config in the constructor — legal because the framework sets the context before `new`. */
@Middleware()
class ConstructorReadingMiddleware extends BaseMiddleware {
  private readonly token: string;

  constructor(private readonly dep: { name: string }) {
    super();
    this.token = String(this.config.get('admin.token'));
  }

  async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    this.logger.info(`serving with ${this.token} from ${this.dep.name}`);

    return await next();
  }
}

/** The same shape one level up: a service reading its configuration right after `super()`. */
@Service()
class ConstructorReadingService extends BaseService {
  readonly url: string;

  constructor() {
    super();
    this.url = String(this.config.get('database.url'));
  }
}

/** Extends nothing the framework knows: there is no slot for `config` to land in. */
class PlainCollaborator {
  ping(): string {
    return 'pong';
  }
}

// ============================================================================
// createTestService
// ============================================================================

describe('createTestService', () => {
  test('creates service instance with mock logger and config', () => {
    const { instance, logger, config } = createTestService(TestService);

    expect(instance).toBeInstanceOf(TestService);
    expect(instance.getValue()).toBe('service-value');
    expect(logger).toBeDefined();
    expect(config).toBeDefined();
    expect(config.isInitialized).toBe(true);
  });

  test('config.get returns provided config values', () => {
    const { config } = createTestService(TestService, {
      /* eslint-disable @typescript-eslint/naming-convention */
      config: { 'app.name': 'my-app', 'server.port': 3000 },
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    expect(config.get('app.name')).toBe('my-app');
    expect(config.get('server.port')).toBe(3000);
  });

  test('passes constructor dependencies', () => {
    const { instance } = createTestService(ServiceWithDeps, {
      deps: [{ name: 'test-dep' }],
    });

    expect(instance.getDep()).toBe('test-dep');
  });

  test('logger methods are mock functions with .mock.calls', () => {
    const { logger } = createTestService(TestService);

    // initializeService calls logger.child() and then debug() internally,
    // so we track calls made after initialization
    const debugCallsBefore = (logger.debug as ReturnType<typeof mock>).mock.calls.length;

    logger.info('test message');
    logger.warn('warning');
    logger.debug('debug');

    expect((logger.info as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.warn as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.debug as ReturnType<typeof mock>).mock.calls.length - debugCallsBefore).toBe(1);
    expect((logger.error as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    expect((logger.trace as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    expect((logger.fatal as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
  });

  test('initializes service via initializeService', () => {
    const { instance } = createTestService(TestService);

    // After initializeService, the service should have logger and config set
    // We verify this indirectly — the service was created and initialized without errors
    expect(instance).toBeInstanceOf(TestService);
  });
});

// ============================================================================
// createTestController
// ============================================================================

describe('createTestController', () => {
  test('creates controller instance with mock logger and config', () => {
    const { instance, logger, config } = createTestController(TestController);

    expect(instance).toBeInstanceOf(TestController);
    expect(instance.handle()).toBe('controller-value');
    expect(logger).toBeDefined();
    expect(config).toBeDefined();
    expect(config.isInitialized).toBe(true);
  });

  test('config.get returns provided config values', () => {
    const { config } = createTestController(TestController, {
      /* eslint-disable @typescript-eslint/naming-convention */
      config: { 'app.name': 'my-app', 'server.port': 3000 },
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    expect(config.get('app.name')).toBe('my-app');
    expect(config.get('server.port')).toBe(3000);
  });

  test('passes constructor dependencies', () => {
    const { instance } = createTestController(ControllerWithDeps, {
      deps: [{ name: 'test-dep' }],
    });

    expect(instance.getDep()).toBe('test-dep');
  });

  test('logger methods are mock functions with .mock.calls', () => {
    const { logger } = createTestController(TestController);

    logger.info('test message');
    logger.error('error');

    expect((logger.info as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.error as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.warn as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
  });

  test('initializes controller via initializeController', () => {
    const { instance } = createTestController(TestController);

    expect(instance).toBeInstanceOf(TestController);
  });
});

// ============================================================================
// createTestMiddleware
// ============================================================================

describe('createTestMiddleware', () => {
  test('the configuration passed to the helper reaches the instance', async () => {
    const { instance } = createTestMiddleware(AdminAuthMiddleware, {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      config: { 'admin.token': 'let-me-in' },
    });

    const authorized = new Request('http://localhost/admin', {
      headers: new Headers([['x-admin-token', 'let-me-in']]),
    }) as unknown as OneBunRequest;
    const allowed = await instance.use(authorized, nextOk);
    const refused = await instance.use(probeRequest(), nextOk);

    // Asserted through the middleware, not on the returned `config`: the helper used to hand
    // back a populated mock config while the instance held `undefined`.
    expect(allowed.status).toBe(200);
    expect(refused.status).toBe(401);
  });

  test('the middleware logs to the logger the helper hands back', async () => {
    const { instance, logger } = createTestMiddleware(AdminAuthMiddleware, {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      config: { 'admin.token': 'let-me-in' },
    });

    await instance.use(probeRequest(), nextOk);

    const warnings = (logger.warn as ReturnType<typeof mock>).mock.calls;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[0]).toBe('rejected an unauthenticated admin request');
  });

  test('config is readable in the constructor, as it is under the framework', () => {
    // The ambient init context is set before `new`, so `this.config` is live on the line
    // after `super()` — a helper that only initialises afterwards cannot build this class.
    const { instance } = createTestMiddleware(ConstructorReadingMiddleware, {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      config: { 'admin.token': 'from-constructor' },
      deps: [{ name: 'injected-dep' }],
    });

    expect(instance).toBeInstanceOf(ConstructorReadingMiddleware);
  });

  test('passes constructor dependencies', async () => {
    const { instance, logger } = createTestMiddleware(ConstructorReadingMiddleware, {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      config: { 'admin.token': 'tok' },
      deps: [{ name: 'injected-dep' }],
    });

    await instance.use(probeRequest(), nextOk);

    expect((logger.info as ReturnType<typeof mock>).mock.calls[0]?.[0])
      .toBe('serving with tok from injected-dep');
  });
});

// ============================================================================
// Shared behaviour
// ============================================================================

describe('test instance builders', () => {
  test('a service can read its configuration in the constructor too', () => {
    const { instance } = createTestService(ConstructorReadingService, {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      config: { 'database.url': 'postgres://localhost/test' },
    });

    expect(instance.url).toBe('postgres://localhost/test');
  });

  test('refuses a config option nothing on the instance can receive', () => {
    expect(() => createTestService(PlainCollaborator, {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      config: { 'admin.token': 'nowhere-to-go' },
    })).toThrow(/was given a `config` option/);
  });

  test('still builds a plain class when no config is asked for', () => {
    const { instance } = createTestService(PlainCollaborator, { deps: [] });

    expect(instance.ping()).toBe('pong');
  });
});

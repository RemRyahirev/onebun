import { mock } from 'bun:test';

import type { IConfig, OneBunAppConfig } from '../module/config.interface';

import type { SyncLogger } from '@onebun/logger';


import { createMockConfig } from './test-utils';

export interface TestInstanceResult<T> {
  instance: T;
  logger: SyncLogger;
  config: IConfig<OneBunAppConfig>;
}

interface CreateTestOptions {
  config?: Record<string, unknown>;
  deps?: unknown[];
}

/**
 * The ambient-init statics every framework base class exposes.
 *
 * Reached through the class under test rather than by importing the base classes: the statics are
 * inherited, and each one writes the slot its own base reads, so `MyMiddleware.setInitContext(…)`
 * lands exactly where `BaseMiddleware`'s constructor looks. That also means a base class added
 * later needs nothing here.
 */
interface AmbientInitializable {
  setInitContext?: (logger: SyncLogger, config: IConfig<OneBunAppConfig>) => void;
  clearInitContext?: () => void;
}

/**
 * The post-construction fallback each base class exposes, under the name it chose.
 *
 * `OneBunModule` calls whichever of these exists after DI construction, so the helpers do too —
 * it is what initialises a class that implements the method without extending the base.
 */
const FALLBACK_INITIALIZERS = [
  'initializeService',
  'initializeController',
  'initializeMiddleware',
  'initializeInterceptor',
  '_initializeBase',
] as const;

function createMockableSyncLogger(): SyncLogger {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noOp = () => {};
  const logger: SyncLogger = {
    trace: mock(noOp),
    debug: mock(noOp),
    info: mock(noOp),
    warn: mock(noOp),
    error: mock(noOp),
    fatal: mock(noOp),
    child: mock(() => logger),
  };

  return logger;
}

/**
 * Build an instance the way the framework builds one, whatever kind it is.
 *
 * Two steps, and the first is the one a test helper is tempted to skip: the ambient init context
 * is set BEFORE `new`, because `BaseService`/`Controller`/`BaseMiddleware` read it in their own
 * constructors — that is what makes `this.config` legal on the line after `super()`, which the
 * documentation shows and applications rely on. A helper that only initialises afterwards cannot
 * construct such a class at all.
 *
 * The fallback then covers a class that implements `initialize*` without extending the base.
 * Both are no-ops for the other case, exactly as in `OneBunModule`.
 */
function createTestInstance<T>(
  targetClass: new (...args: never[]) => T,
  options: CreateTestOptions | undefined,
  helperName: string,
): TestInstanceResult<T> {
  const logger = createMockableSyncLogger();
  const config = createMockConfig(options?.config ?? {});
  const deps = options?.deps ?? [];
  const ambient = targetClass as unknown as AmbientInitializable;
  const hasAmbientContext = typeof ambient.setInitContext === 'function';

  if (hasAmbientContext) {
    ambient.setInitContext?.(logger, config);
  }

  let instance: T;

  try {
    instance = new targetClass(...deps as never[]);
  } finally {
    if (hasAmbientContext) {
      ambient.clearInitContext?.();
    }
  }

  const record = instance as Record<string, unknown>;
  const fallback = FALLBACK_INITIALIZERS.find((name) => typeof record[name] === 'function');

  if (fallback) {
    (record[fallback] as (...args: unknown[]) => void).call(instance, logger, config);
  }

  if (!hasAmbientContext && !fallback && options?.config !== undefined) {
    // Refuse the option rather than storing it on a config the instance never sees. The silent
    // version of this is what let middleware suites pass for months with `this.config` undefined.
    throw new Error(
      `${helperName}(${targetClass.name}) was given a \`config\` option, but ${targetClass.name} `
      + 'extends none of the framework base classes and exposes no initialize* method, so nothing '
      + 'would receive it. Extend BaseService / BaseController / BaseMiddleware / BaseInterceptor, '
      + 'or pass the configuration through `deps`.',
    );
  }

  return { instance, logger, config };
}

/**
 * Build a service with a mock logger and mock config, initialised as the framework would.
 *
 * @see docs:testing.md
 */
export function createTestService<T>(
  serviceClass: new (...args: never[]) => T,
  options?: CreateTestOptions,
): TestInstanceResult<T> {
  return createTestInstance(serviceClass, options, 'createTestService');
}

/**
 * Build a controller with a mock logger and mock config, initialised as the framework would.
 *
 * @see docs:testing.md
 */
export function createTestController<T>(
  controllerClass: new (...args: never[]) => T,
  options?: CreateTestOptions,
): TestInstanceResult<T> {
  return createTestInstance(controllerClass, options, 'createTestController');
}

/**
 * Build a middleware with a mock logger and mock config, initialised as the framework would.
 *
 * The third of the three kinds, and until 0.8.1 the one with no helper: a middleware built with
 * `createTestService` had `this.config` and `this.logger` undefined, and the `config` option went
 * to a mock the instance never received. A middleware that reads config defensively hid that —
 * every read took its catch branch, so the suite asserted the fallback behaviour and passed.
 *
 * @example
 * ```typescript
 * const { instance, logger } = createTestMiddleware(AdminAuthMiddleware, {
 *   deps: [mockAuthService],
 *   config: { 'admin.token': 'secret' },
 * });
 *
 * const response = await instance.use(request, next);
 * ```
 *
 * @see docs:testing.md
 */
export function createTestMiddleware<T>(
  middlewareClass: new (...args: never[]) => T,
  options?: CreateTestOptions,
): TestInstanceResult<T> {
  return createTestInstance(middlewareClass, options, 'createTestMiddleware');
}

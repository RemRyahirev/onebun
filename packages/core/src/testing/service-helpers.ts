import { mock } from 'bun:test';

import type { SyncLogger } from '@onebun/logger';

import type { IConfig, OneBunAppConfig } from '../module/config.interface';

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

export function createTestService<T>(
  serviceClass: new (...args: never[]) => T,
  options?: CreateTestOptions,
): TestInstanceResult<T> {
  const logger = createMockableSyncLogger();
  const config = createMockConfig(options?.config ?? {});
  const deps = options?.deps ?? [];

  const instance = new serviceClass(...deps as never[]);

  if (typeof (instance as Record<string, unknown>).initializeService === 'function') {
    (instance as Record<string, (...args: unknown[]) => void>).initializeService(logger, config);
  }

  return { instance, logger, config };
}

export function createTestController<T>(
  controllerClass: new (...args: never[]) => T,
  options?: CreateTestOptions,
): TestInstanceResult<T> {
  const logger = createMockableSyncLogger();
  const config = createMockConfig(options?.config ?? {});
  const deps = options?.deps ?? [];

  const instance = new controllerClass(...deps as never[]);

  if (typeof (instance as Record<string, unknown>).initializeController === 'function') {
    (instance as Record<string, (...args: unknown[]) => void>).initializeController(logger, config);
  }

  return { instance, logger, config };
}

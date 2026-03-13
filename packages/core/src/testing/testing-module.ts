/**
 * TestingModule — lightweight harness for testing OneBun controllers and services
 * without the full application startup overhead.
 *
 * Usage:
 * ```typescript
 * const module = await TestingModule
 *   .create({ controllers: [UserController], providers: [UserService] })
 *   .overrideProvider(UserService).useValue(mockUserService)
 *   .compile();
 *
 * const response = await module.inject('GET', '/users/1');
 * expect(response.ok).toBe(true);
 *
 * await module.close();
 * ```
 */

import type { OneBunApplication } from '../application/application';
import type { HttpMethod, OneBunResponse } from '../types';
import type { Context } from 'effect';

import { Module } from '../decorators/decorators';
import { getServiceTag } from '../module/service';

import { makeMockLoggerLayer } from './test-utils';

// Re-export for convenience
export { makeMockLoggerLayer };

// ============================================================================
// Types
// ============================================================================

interface TestingModuleCreateOptions {
  /** Module classes to import (already decorated with @Module) */
  imports?: Function[];
  /** Controller classes to include */
  controllers?: Function[];
  /** Service/provider classes to include */
  providers?: Function[];
}

interface InjectOptions {
  /** Request body (will be JSON-serialised) */
  body?: unknown;
  /** Extra headers */
  headers?: Record<string, string>;
  /** Query parameters */
  query?: Record<string, string>;
}

type OverrideBuilder = {
  /** Replace the service with a plain value / mock instance */
  useValue(val: unknown): TestingModule;
  /** Replace the service with an instance of the given class */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useClass(cls: new (...args: any[]) => unknown): TestingModule;
};

// ============================================================================
// CompiledTestingModule
// ============================================================================

/**
 * Result of `TestingModule.compile()`.
 * Provides `inject()` for HTTP calls and `get()` for service access.
 * Call `close()` when done to release the underlying server.
 */
export class CompiledTestingModule {
  constructor(
    private readonly app: OneBunApplication,
    private readonly port: number,
  ) {}

  /**
   * Get a service instance by its class constructor.
   * Useful for asserting service state after a request.
   *
   * @param serviceClass - The `@Service()`-decorated class
   * @returns The service instance registered in the module
   * @throws If the service is not found
   */
  get<T>(serviceClass: new (...args: unknown[]) => T): T {
    return this.app.getService(serviceClass) as T;
  }

  /**
   * Send a fake HTTP request to the testing application.
   * No real network call is made — the request goes through the full
   * middleware → guards → filters → handler pipeline.
   *
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param path - URL path (e.g. '/users/1')
   * @param options - Optional body, headers, query params
   */
  async inject(
    method: HttpMethod | string,
    path: string,
    options?: InjectOptions,
  ): Promise<OneBunResponse> {
    let url = `http://localhost:${this.port}${path}`;

    if (options?.query && Object.keys(options.query).length > 0) {
      const qs = new URLSearchParams(options.query).toString();
      url = `${url}?${qs}`;
    }

    const headers = new Headers(options?.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    // Use the native undici fetch to bypass any global `fetch` mock that may be set by
    // other concurrent test files. This ensures real network calls reach the test server.
     
    const nativeFetch = (require('undici') as { fetch: typeof fetch }).fetch ?? globalThis.fetch;

    return await nativeFetch(url, {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    }) as OneBunResponse;
  }

  /**
   * Stop the test server and release resources.
   * Call this in `afterEach` / `afterAll` to prevent port leaks.
   */
  async close(): Promise<void> {
    await this.app.stop?.({ closeSharedRedis: false });
  }
}

// ============================================================================
// TestingModule
// ============================================================================

/**
 * Fluent builder for creating isolated test environments for OneBun modules.
 *
 * @example Basic usage
 * ```typescript
 * describe('UserController', () => {
 *   let module: CompiledTestingModule;
 *
 *   beforeEach(async () => {
 *     module = await TestingModule
 *       .create({ controllers: [UserController], providers: [UserService] })
 *       .compile();
 *   });
 *
 *   afterEach(() => module.close());
 *
 *   it('returns 200 for GET /users', async () => {
 *     const res = await module.inject('GET', '/users');
 *     expect(res.ok).toBe(true);
 *   });
 * });
 * ```
 *
 * @example With provider overrides
 * ```typescript
 * const mockService = { getUser: () => ({ id: 1, name: 'Test' }) };
 *
 * module = await TestingModule
 *   .create({ controllers: [UserController], providers: [UserService] })
 *   .overrideProvider(UserService).useValue(mockService)
 *   .compile();
 * ```
 */
export class TestingModule {
  private readonly options: TestingModuleCreateOptions;
  private readonly overrides: Array<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tag: Context.Tag<any, any>;
    value: unknown;
  }> = [];

  private constructor(options: TestingModuleCreateOptions) {
    this.options = options;
  }

  /**
   * Create a new TestingModule builder.
   *
   * @param options - Module options (controllers, providers, imports)
   */
  static create(options: TestingModuleCreateOptions): TestingModule {
    return new TestingModule(options);
  }

  /**
   * Override a provider with a mock value or class.
   * Overrides are applied before `setup()` so controllers receive mocks at construction time.
   *
   * @param serviceClass - The `@Service()`-decorated class to override
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrideProvider<T>(serviceClass: new (...args: any[]) => T): OverrideBuilder {
    return {
      useValue: (val: unknown): TestingModule => {
        this.overrides.push({ tag: getServiceTag(serviceClass), value: val });

        return this;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useClass: (cls: new (...args: any[]) => unknown): TestingModule => {
        this.overrides.push({ tag: getServiceTag(serviceClass), value: new cls() });

        return this;
      },
    };
  }

  /**
   * Compile the testing module and start the test server.
   * Returns a `CompiledTestingModule` with `inject()` and `get()` methods.
   *
   * @returns Compiled module ready for testing
   */
  async compile(): Promise<CompiledTestingModule> {
    // Lazily import to avoid circular dependencies at module parse time
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { OneBunApplication } = await import('../application/application');

    // Build a synthetic module class from the provided options
    const { controllers = [], providers = [], imports = [] } = this.options;

    class _TestingAppModule {}
    Module({
      controllers,
      providers: providers as unknown[],
      imports,
    })(_TestingAppModule);

    // Create the application with:
    // - port 0 → OS picks a free port
    // - silent logger
    // - test provider overrides injected before setup()
    const app = new OneBunApplication(_TestingAppModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as import('effect').Layer.Layer<import('@onebun/logger').Logger>,
      gracefulShutdown: false,
      _testProviders: this.overrides,
    });

    await app.start();

    return new CompiledTestingModule(app, app.getPort());
  }
}

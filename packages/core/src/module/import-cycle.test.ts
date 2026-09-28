/**
 * A module that imports itself — directly, or through the modules it imports — fails the boot
 * with an error that names the import path.
 *
 * Each imported module is built before its importer, and a module is published as "already
 * built" only when its own build finishes. So a module met again while it is still being built
 * was built again from scratch, forever: `@Module({ imports: [SelfModule] }) class SelfModule {}`
 * typechecks, and start() died with `RangeError: Maximum call stack size exceeded`, which names
 * no module (WI-408).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { Layer } from 'effect';

import { OneBunApplication } from '../application/application';
import {
  clearGlobalModules,
  Global,
  Module,
} from '../decorators/decorators';
import { OneBunBootstrapError } from '../errors/dependency-errors';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { createGlobalScope, OneBunModule } from './module';
import { Service } from './service';

/** What the boot threw, or `undefined` when it did not throw. */
function buildError(rootModule: Function): unknown {
  try {
    new OneBunModule(
      rootModule,
      makeMockLoggerLayer() as Layer.Layer<never, never, unknown>,
      undefined,
      undefined,
      undefined,
      createGlobalScope(),
    );
  } catch (error) {
    return error;
  }

  return undefined;
}

/** What `start()` rejected with, or `undefined` when it booted (the app is stopped either way). */
async function startError(rootModule: new () => object): Promise<unknown> {
  const app = new OneBunApplication(rootModule, {
    port: 0,
    gracefulShutdown: false,
    metrics: { enabled: false },
    loggerLayer: makeMockLoggerLayer(),
  });

  try {
    await app.start();
  } catch (error) {
    return error;
  }
  await app.stop();

  return undefined;
}

/** The error must be the cycle report, never the stack overflow it replaces. */
function expectCycleError(error: unknown, path: string): void {
  expect(error).toBeInstanceOf(OneBunBootstrapError);
  expect(error).not.toBeInstanceOf(RangeError);
  expect((error as Error).name).toBe('OneBunModuleImportCycleError');
  expect((error as Error).message).toStartWith(`Module import cycle: ${path}`);
}

describe('module import cycles (WI-408)', () => {
  beforeEach(() => {
    clearGlobalModules();
  });

  afterEach(() => {
    clearGlobalModules();
  });

  test('a module that imports itself fails start() naming the module, not with a RangeError', async () => {
    @Module({ imports: [SelfModule] })
    class SelfModule {}

    const error = await startError(SelfModule);

    expectCycleError(error, 'SelfModule -> SelfModule.');
    expect((error as Error).message).toEndWith('Remove SelfModule from its own imports.');
  });

  test('a two-module cycle built with Module() as a function names both modules in path order', async () => {
    class OrdersModule {}
    class BillingModule {}
    Module({ imports: [BillingModule] })(OrdersModule);
    Module({ imports: [OrdersModule] })(BillingModule);

    @Module({ imports: [OrdersModule] })
    class AppModule {}

    const error = await startError(AppModule);

    expectCycleError(error, 'OrdersModule -> BillingModule -> OrdersModule');
    // The route from the root, so the reader knows how the application reached the cycle
    expect((error as Error).message).toContain(
      '(import path from the root: AppModule -> OrdersModule -> BillingModule -> OrdersModule)',
    );
    expect((error as Error).message).toContain('Move what the modules on the cycle share into a module');
  });

  test('a cycle through the root module starts at the root and has no separate route', () => {
    class LoopRoot {}
    class LoopLeaf {}
    Module({ imports: [LoopLeaf] })(LoopRoot);
    Module({ imports: [LoopRoot] })(LoopLeaf);

    const error = buildError(LoopRoot);

    expectCycleError(error, 'LoopRoot -> LoopLeaf -> LoopRoot.');
    expect((error as Error).message).not.toContain('import path from the root');
  });

  test('a longer cycle below the root lists every module on it, in import order', () => {
    class Entry {}
    class First {}
    class Second {}
    class Third {}
    Module({ imports: [First] })(Entry);
    Module({ imports: [Second] })(First);
    Module({ imports: [Third] })(Second);
    Module({ imports: [First] })(Third);

    const error = buildError(Entry);

    expectCycleError(error, 'First -> Second -> Third -> First');
    expect((error as Error).message).toContain('Entry -> First -> Second -> Third -> First');
  });

  test('a @Global() module that imports itself is reported, although the root builds it ahead of the imports', () => {
    @Global()
    @Module({ imports: [SelfGlobal] })
    class SelfGlobal {}

    @Module({ imports: [SelfGlobal] })
    class GlobalRoot {}

    const error = buildError(GlobalRoot);

    expectCycleError(error, 'SelfGlobal -> SelfGlobal');
    expect((error as Error).message).toContain('GlobalRoot -> SelfGlobal -> SelfGlobal');
  });

  test('a cycle through a @Global() module names the real imports, not the root\'s shortcut to the global', () => {
    // The root builds CoreModule before its import loop, although only FeatureModule imports it.
    // Reporting that shortcut would print `ShortcutRoot -> CoreModule`, an import nobody wrote.
    class ShortcutRoot {}
    class FeatureModule {}
    class CoreModule {}
    Module({ imports: [FeatureModule] })(ShortcutRoot);
    Module({ imports: [CoreModule] })(FeatureModule);
    Module({ imports: [ShortcutRoot] })(CoreModule);
    Global()(CoreModule);

    const error = buildError(ShortcutRoot);

    expectCycleError(error, 'ShortcutRoot -> FeatureModule -> CoreModule -> ShortcutRoot.');
  });

  test('a @Global() root reached again through its own imports is reported before a second copy is built', () => {
    // The root's global pre-pass finds the root itself among the globals its imports reach.
    class GlobalLoopRoot {}
    class Loopback {}
    Module({ imports: [Loopback] })(GlobalLoopRoot);
    Module({ imports: [GlobalLoopRoot] })(Loopback);
    Global()(GlobalLoopRoot);

    const error = buildError(GlobalLoopRoot);

    expectCycleError(error, 'GlobalLoopRoot -> Loopback -> GlobalLoopRoot.');
  });

  test('the route to a cycle below a @Global() module goes through the module that imports the global', () => {
    class RouteRoot {}
    class RouteFeature {}
    class RouteCore {}
    class Spinner {}
    Module({ imports: [RouteFeature] })(RouteRoot);
    Module({ imports: [RouteCore] })(RouteFeature);
    Module({ imports: [Spinner] })(RouteCore);
    Module({ imports: [Spinner] })(Spinner);
    Global()(RouteCore);

    const error = buildError(RouteRoot);

    expectCycleError(error, 'Spinner -> Spinner');
    expect((error as Error).message).toContain('RouteRoot -> RouteFeature -> RouteCore -> Spinner -> Spinner');
  });

  test('a module reached twice without a cycle is built once and boots', () => {
    let constructed = 0;

    @Service()
    class SharedService {
      constructor() {
        constructed++;
      }
    }

    @Module({ providers: [SharedService], exports: [SharedService] })
    class SharedModule {}

    @Module({ imports: [SharedModule] })
    class LeftModule {}

    // Imports a module that finished building earlier, and the shared one again
    @Module({ imports: [SharedModule, LeftModule] })
    class RightModule {}

    @Module({ imports: [LeftModule, RightModule, SharedModule] })
    class DiamondRoot {}

    expect(buildError(DiamondRoot)).toBeUndefined();
    expect(constructed).toBe(1);
  });
});

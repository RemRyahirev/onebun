/**
 * `CacheInterceptor` applied the way the documentation says to apply it.
 *
 * Driven through a real application rather than by constructing the interceptor by hand: the
 * defect was that dependency injection never happened, so any test that passed a `CacheService`
 * to the constructor itself would have been green throughout.
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import {
  BaseController,
  Controller,
  Get,
  Module,
  OneBunApplication,
  UseInterceptors,
} from '@onebun/core';

import { CacheInterceptor } from '../src/cache-interceptor';
import { CacheModule } from '../src/cache.module';
import { CacheService } from '../src/cache.service';

const OK = 200;

/** Incremented by the handler, so a served-from-cache response is distinguishable from a re-run. */
let handlerCalls = 0;

@UseInterceptors(CacheInterceptor)
@Controller('/api/data')
class DataController extends BaseController {
  @Get('/items')
  getItems() {
    handlerCalls += 1;

    return { items: ['a', 'b'], call: handlerCalls };
  }
}

@Module({
  imports: [CacheModule],
  controllers: [DataController],
})
class DataModule {}

/**
 * @source docs:api/interceptors.md#cacheinterceptor
 */
describe('CacheInterceptor', () => {
  let app: OneBunApplication | undefined;

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    handlerCalls = 0;
  });

  async function startApp(): Promise<string> {
    app = new OneBunApplication(DataModule, {
      port: 0,
      metrics: { enabled: false },
      docs: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();

    return `http://127.0.0.1:${app.getPort()}`;
  }

  it('serves the second GET from cache', async () => {
    // The documented recipe verbatim: `@UseInterceptors(CacheInterceptor)` on the controller,
    // `CacheModule` in imports. It answered HTTP 500 on every request, because the class carried
    // no decorator, so TypeScript emitted no `design:paramtypes`, so `resolveInterceptors`
    // constructed it with no arguments and `this.cacheService` was `undefined`.
    const base = await startApp();

    const first = await fetch(`${base}/api/data/items`);
    const firstBody = await first.json() as { result: { call: number } };

    expect(first.status).toBe(OK);
    expect(firstBody.result.call).toBe(1);

    const second = await fetch(`${base}/api/data/items`);
    const secondBody = await second.json() as { result: { call: number } };

    expect(second.status).toBe(OK);
    // Same payload, and the handler did NOT run again — asserted on a counter rather than on
    // response equality, which would hold for a cache that never worked.
    expect(secondBody.result.call).toBe(1);
    expect(handlerCalls).toBe(1);
  });

  it('receives a real CacheService through the module, not undefined', async () => {
    // The regression guard for the decorator itself. Removing it again puts `undefined` here,
    // and this fails before any request is made.
    const base = await startApp();
    await fetch(`${base}/api/data/items`);

    const service = app!.getService(CacheService);

    expect(service).toBeInstanceOf(CacheService);
    // The interceptor wrote through the same service the application resolves, so the entry it
    // cached is visible here. Asserted on the exact key the interceptor builds — anything else
    // would mean it cached into an instance of its own, which is what an uninjected constructor
    // would have produced if it had not thrown outright.
    expect(await service.has('interceptor:GET:/api/data/items')).toBe(true);
  });

  it('does not cache a non-GET request', async () => {
    const base = await startApp();

    await fetch(`${base}/api/data/items`);
    const beforeMutation = handlerCalls;
    // A method the controller does not declare: it must not be served from the GET's cache.
    const post = await fetch(`${base}/api/data/items`, { method: 'POST' });

    expect(post.status).not.toBe(OK);
    expect(handlerCalls).toBe(beforeMutation);
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { ApplicationOptions, HttpMethod } from '../types';

import {
  All,
  Controller,
  Get,
  getControllerMetadata,
  Module,
  Param,
  Post,
} from '../decorators/decorators';
import { OneBunBootstrapError } from '../errors/dependency-errors';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

// ============================================================================
// Fixtures
// ============================================================================

@Controller('/api')
class CatchAllController extends BaseController {
  @Get('/ping')
  ping() {
    return { handler: 'ping' };
  }

  @All('/proxy/:id')
  proxy(@Param('id') id: string) {
    return { handler: 'all', id };
  }
}

@Module({ controllers: [CatchAllController] })
class CatchAllModule {}

// `@All` declared BEFORE the concrete verb — precedence must not depend on this order.
@Controller('/pre')
class AllFirstController extends BaseController {
  @All('/mixed')
  viaAll() {
    return { handler: 'all' };
  }

  @Get('/mixed')
  viaGet() {
    return { handler: 'get' };
  }
}

// `@All` declared AFTER the concrete verbs — the shared-object write order that used
// to decide the winner.
@Controller('/post')
class AllLastController extends BaseController {
  @Get('/mixed')
  viaGet() {
    return { handler: 'get' };
  }

  @Post('/mixed')
  viaPost() {
    return { handler: 'post' };
  }

  @All('/mixed')
  viaAll() {
    return { handler: 'all' };
  }
}

@Module({ controllers: [AllFirstController, AllLastController] })
class PrecedenceModule {}

@Controller('/bad')
class UnsupportedVerbController extends BaseController {
  @Get('/thing')
  thing() {
    return { handler: 'get' };
  }
}

@Module({ controllers: [UnsupportedVerbController] })
class UnsupportedVerbModule {}

// ============================================================================
// Harness
// ============================================================================

function createApp(
  moduleClass: new (...args: unknown[]) => object,
  options?: Partial<ApplicationOptions>,
): OneBunApplication {
  return new OneBunApplication(moduleClass, {
    port: 0,
    metrics: { enabled: false },
    gracefulShutdown: false,
    docs: { enabled: false },
    ...options,
    loggerLayer: makeMockLoggerLayer(),
  });
}

describe('@All() catch-all routes', () => {
  let app: OneBunApplication | null = null;
  let originalServe: typeof Bun.serve;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let servedOptions: any = null;

  beforeEach(() => {
    servedOptions = null;
    originalServe = Bun.serve;
    // Wrap, not replace: the real server still comes up so requests can be measured,
    // while the options object handed to Bun stays inspectable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Bun as any).serve = (options: any) => {
      servedOptions = options;

      return originalServe(options);
    };
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Bun as any).serve = originalServe;
    if (app) {
      await app.stop();
      app = null;
    }
  });

  async function call(path: string, method: string): Promise<Response> {
    return await fetch(`http://localhost:${app!.getPort()}${path}`, { method });
  }

  test('should start an application that declares an @All() route', async () => {
    app = createApp(CatchAllModule);

    await expect(app.start()).resolves.toBeUndefined();
  });

  test('should not hand Bun an ALL method key', async () => {
    app = createApp(CatchAllModule);
    await app.start();

    const routes = servedOptions.routes as Record<string, unknown>;
    for (const [path, value] of Object.entries(routes)) {
      if (typeof value === 'object' && value !== null) {
        expect(Object.keys(value)).not.toContain('ALL');
      }
      expect(path).toBeString();
    }
    // The @All path itself is registered as a bare function, not a method map.
    expect(typeof routes['/api/proxy/:id']).toBe('function');
  });

  test('should route every standard verb to the @All() handler', async () => {
    app = createApp(CatchAllModule);
    await app.start();

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await call('/api/proxy/42', method);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        result: { handler: 'all', id: '42' },
      });
    }
  });

  test('should route non-standard verbs to the @All() handler', async () => {
    app = createApp(CatchAllModule);
    await app.start();

    // WebDAV, cache-purge and the QUERY method: a fixed verb expansion would 404 here.
    for (const method of ['PROPFIND', 'PURGE', 'LOCK', 'QUERY']) {
      const response = await call('/api/proxy/7', method);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        result: { handler: 'all', id: '7' },
      });
    }
  });

  test('should keep the trailing-slash variant of an @All() path', async () => {
    app = createApp(CatchAllModule);
    await app.start();

    const response = await call('/api/proxy/9/', 'DELETE');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      result: { handler: 'all', id: '9' },
    });
  });

  test('should not let @All() leak onto sibling paths of the same controller', async () => {
    app = createApp(CatchAllModule);
    await app.start();

    const ok = await call('/api/ping', 'GET');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ success: true, result: { handler: 'ping' } });

    // /api/ping carries no @All, so it keeps the method-map form and must NOT
    // become a catch-all just because a sibling path did. A declared path answers 405 for a verb
    // it does not declare — that is the point of the method map — while a verb outside the
    // standard set still falls through to the fallback's 404.
    expect(typeof (servedOptions.routes as Record<string, unknown>)['/api/ping']).toBe('object');
    expect((await call('/api/ping', 'POST')).status).toBe(405);
    expect((await call('/api/ping', 'PROPFIND')).status).toBe(404);
  });

  describe('precedence', () => {
    test('should give an explicitly declared verb priority over @All() (@All declared first)', async () => {
      app = createApp(PrecedenceModule);
      await app.start();

      const get = await call('/pre/mixed', 'GET');
      expect(await get.json()).toEqual({ success: true, result: { handler: 'get' } });

      const post = await call('/pre/mixed', 'POST');
      expect(await post.json()).toEqual({ success: true, result: { handler: 'all' } });
    });

    test('should give an explicitly declared verb priority over @All() (@All declared last)', async () => {
      app = createApp(PrecedenceModule);
      await app.start();

      const get = await call('/post/mixed', 'GET');
      expect(await get.json()).toEqual({ success: true, result: { handler: 'get' } });

      const post = await call('/post/mixed', 'POST');
      expect(await post.json()).toEqual({ success: true, result: { handler: 'post' } });

      const put = await call('/post/mixed', 'PUT');
      expect(await put.json()).toEqual({ success: true, result: { handler: 'all' } });
    });
  });

  describe('CORS preflight ownership', () => {
    test('should let the CORS middleware answer preflight on an @All() path', async () => {
      app = createApp(CatchAllModule, { cors: true });
      await app.start();

      const response = await fetch(`http://localhost:${app.getPort()}/api/proxy/1`, {
        method: 'OPTIONS',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Origin: 'https://front.example',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Access-Control-Request-Method': 'POST',
        },
      });

      // 204 + preflight headers means CorsMiddleware short-circuited before the
      // @All handler ran — the handler would have answered 200 with a JSON body.
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-methods')).toBeString();
      expect(await response.text()).toBe('');
    });

    test('should let the @All() handler answer OPTIONS when CORS is not configured', async () => {
      app = createApp(CatchAllModule);
      await app.start();

      const response = await call('/api/proxy/1', 'OPTIONS');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        result: { handler: 'all', id: '1' },
      });
    });
  });

  describe('diagnostics', () => {
    test('should reject a verb Bun cannot express with a named OneBunBootstrapError', async () => {
      const metadata = getControllerMetadata(UnsupportedVerbController)!;
      const route = metadata.routes.find((r) => r.handler === 'thing')!;
      const original = route.method;
      // Reach the guard the way a hand-rolled decorator or a cast would.
      route.method = 'PROPFIND' as HttpMethod;

      try {
        const failing = createApp(UnsupportedVerbModule);
        await expect(failing.start()).rejects.toThrow(OneBunBootstrapError);

        const error = await failing.start().then(
          () => null,
          (e: unknown) => e as Error,
        );
        expect(error).toBeInstanceOf(OneBunBootstrapError);
        // The message must name all three, or nobody can find the offending route.
        expect(error!.message).toContain('UnsupportedVerbController');
        expect(error!.message).toContain('thing()');
        expect(error!.message).toContain('@PROPFIND()');
        expect(error!.message).toContain('PROPFIND /bad/thing');
      } finally {
        route.method = original;
      }
    });
  });
});

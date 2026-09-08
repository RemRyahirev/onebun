import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  Controller,
  Get,
  Options,
  Param,
  Post,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { TestingModule, type CompiledTestingModule } from '../testing/testing-module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = { result: any };

// ============================================================================
// Test fixtures — controllers with deliberately "wrong" declaration order
// to prove that route specificity works regardless of registration order.
// ============================================================================

// --- Static vs Parametric ---
@Controller('/users')
class StaticVsParamController extends BaseController {
  @Get('/:id')
  getById(@Param('id') id: string) {
    return { handler: 'parametric', id };
  }

  @Get('/me')
  getMe() {
    return { handler: 'static', id: 'me' };
  }
}

// --- Depth specificity ---
@Controller('/depth')
class DepthController extends BaseController {
  @Get('/:id')
  getUser(@Param('id') id: string) {
    return { handler: 'user', id };
  }

  @Get('/:id/posts')
  getUserPosts(@Param('id') id: string) {
    return { handler: 'user-posts', id };
  }
}

// --- Static vs Wildcard ---
@Controller('/api')
class StaticVsWildcardController extends BaseController {
  @Get('/*')
  catchAll() {
    return { handler: 'wildcard' };
  }

  @Get('/health')
  health() {
    return { handler: 'static' };
  }
}

// --- Parametric vs Wildcard ---
@Controller('/items')
class ParamVsWildcardController extends BaseController {
  @Get('/*')
  catchAll() {
    return { handler: 'wildcard' };
  }

  @Get('/:id')
  getById(@Param('id') id: string) {
    return { handler: 'parametric', id };
  }
}

// --- Method routing ---
@Controller('/resources')
class MethodRoutingController extends BaseController {
  @Get('/:id')
  getResource(@Param('id') id: string) {
    return { method: 'GET', id };
  }

  @Post('/:id')
  updateResource(@Param('id') id: string) {
    return { method: 'POST', id };
  }
}

// --- Nested parameters ---
@Controller('/orgs')
class NestedParamsController extends BaseController {
  @Get('/:orgId/users/:userId')
  getOrgUser(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    return { orgId, userId };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Route specificity', () => {
  describe('static vs parametric', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [StaticVsParamController],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    test('static /users/me wins over parametric /users/:id', async () => {
      const res = await module.inject('GET', '/users/me');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'static', id: 'me' });
    });

    test('parametric /users/:id still works for non-static segments', async () => {
      const res = await module.inject('GET', '/users/123');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'parametric', id: '123' });
    });
  });

  describe('depth specificity', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [DepthController],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    test('shallow route /depth/:id matches single-segment path', async () => {
      const res = await module.inject('GET', '/depth/42');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'user', id: '42' });
    });

    test('deeper route /depth/:id/posts matches two-segment path', async () => {
      const res = await module.inject('GET', '/depth/42/posts');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'user-posts', id: '42' });
    });
  });

  describe('static vs wildcard', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [StaticVsWildcardController],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    test('static /api/health wins over wildcard /api/*', async () => {
      const res = await module.inject('GET', '/api/health');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'static' });
    });

    test('wildcard /api/* catches non-static paths', async () => {
      const res = await module.inject('GET', '/api/anything');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'wildcard' });
    });
  });

  describe('parametric vs wildcard', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [ParamVsWildcardController],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    test('parametric /items/:id wins over wildcard /items/* for single segment', async () => {
      const res = await module.inject('GET', '/items/42');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'parametric', id: '42' });
    });

    test('wildcard /items/* catches multi-segment paths', async () => {
      const res = await module.inject('GET', '/items/42/extra/path');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ handler: 'wildcard' });
    });
  });

  describe('method routing on same path', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [MethodRoutingController],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    test('GET /resources/:id dispatches to GET handler', async () => {
      const res = await module.inject('GET', '/resources/1');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ method: 'GET', id: '1' });
    });

    test('POST /resources/:id dispatches to POST handler', async () => {
      const res = await module.inject('POST', '/resources/1');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ method: 'POST', id: '1' });
    });
  });

  describe('nested parameters', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [NestedParamsController],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    test('both :orgId and :userId are correctly parsed', async () => {
      const res = await module.inject('GET', '/orgs/acme/users/42');
      const body = await res.json() as JsonBody;

      expect(res.status).toBe(200);
      expect(body.result).toEqual({ orgId: 'acme', userId: '42' });
    });
  });
});

// ============================================================================
// Path composition — a controller path of '/' must not double the separator
// ============================================================================

/** `@Controller('/')` is the spelling that produced `//health`, matching nothing. */
@Controller('/')
class RootPathController extends BaseController {
  @Get('/health')
  health() {
    return { handler: 'health' };
  }

  @Options('/*')
  anyPath() {
    return { handler: 'wildcard' };
  }
}

describe('route path composition', () => {
  let module: CompiledTestingModule;

  afterEach(async () => {
    await module.close();
  });

  test('a controller path of "/" does not double the separator', async () => {
    // `@Controller('/') + @Get('/health')` composed to `//health`, which matches NOTHING —
    // not `/health`, not `//health`. A whole controller silently disappeared, and the startup
    // log printed the broken path, confirming the wrong route to the developer.
    module = await TestingModule.create({ controllers: [RootPathController] }).compile();

    const response = await module.inject('GET', '/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { handler: 'health' } });
  });

  test('a root wildcard matches nested paths', async () => {
    // Reported as "a bare root wildcard does not match nested paths in OneBun/Bun's router".
    // Raw `Bun.serve({ routes: { '/*': { OPTIONS } } })` matches them fine — the failure was
    // `@Controller('/') + @Options('/*')` composing to `//*`.
    module = await TestingModule.create({ controllers: [RootPathController] }).compile();

    for (const path of ['/api/x', '/api/projects/demo/work-items', '/nothing']) {
      const response = await module.inject('OPTIONS', path);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: { handler: 'wildcard' } });
    }
  });

  test('composes with basePath without doubling either separator', async () => {
    module = await TestingModule.create({ controllers: [RootPathController] })
      .setOptions({ basePath: '/api' })
      .compile();

    const prefixed = await module.inject('GET', '/api/health');
    const unprefixed = await module.inject('GET', '/health');

    expect(prefixed.status).toBe(200);
    // The prefix is not optional: an unprefixed path must not also match.
    expect(unprefixed.status).toBe(404);
  });

  test('an empty controller path behaves identically', async () => {
    // `@Controller()` already worked; the two spellings must not diverge.
    @Controller()
    class EmptyPathController extends BaseController {
      @Get('/ping')
      ping() {
        return { handler: 'ping' };
      }
    }

    module = await TestingModule.create({ controllers: [EmptyPathController] }).compile();

    const response = await module.inject('GET', '/ping');

    expect(response.status).toBe(200);
  });
});

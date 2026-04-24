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

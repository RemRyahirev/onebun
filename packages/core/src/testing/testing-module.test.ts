import { type } from 'arktype';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { HttpStatusCode } from '@onebun/requests';

import { OneBunApplication } from '../application/application';
import {
  ApiResponse,
  Controller,
  Get,
  Module,
  Post,
  Body,
  Param,
  Query,
  UseFilters,
  UseGuards,
} from '../decorators/decorators';
import { createExceptionFilter } from '../exception-filters/exception-filters';
import { HttpException } from '../exception-filters/http-exception';
import { createHttpGuard } from '../http-guards/http-guards';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';


import { TestingModule, type CompiledTestingModule } from './testing-module';

// ============================================================================
// Test fixtures
// ============================================================================

@Service()
class GreetingService extends BaseService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

@Controller('/greet')
class GreetController extends BaseController {
  constructor(private readonly greetingService: GreetingService) {
    super();
  }

  @Get('/:name')
  getGreeting(@Param('name') name: string) {
    return { message: this.greetingService.greet(name) };
  }

  @Post('/echo')
  echo(@Body() body: unknown) {
    return body;
  }
}

@Module({
  controllers: [GreetController],
  providers: [GreetingService],
})
class GreetModule {}

// ============================================================================
// Tests
// ============================================================================

describe('TestingModule', () => {
  describe('compile()', () => {
    it('starts the application on a random port', async () => {
      const module = await TestingModule.create({
        imports: [],
        controllers: [GreetController],
        providers: [GreetingService],
      }).compile();

      try {
        const response = await module.inject('GET', '/greet/world');
        expect(response.status).toBe(200);
      } finally {
        await module.close();
      }
    });

    it('works with a pre-decorated module via imports', async () => {
      const module = await TestingModule.create({
        imports: [GreetModule],
      }).compile();

      try {
        const response = await module.inject('GET', '/greet/test');
        expect(response.status).toBe(200);
      } finally {
        await module.close();
      }
    });
  });

  describe('inject()', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [GreetController],
        providers: [GreetingService],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    it('GET request returns JSON body from controller', async () => {
      const response = await module.inject('GET', '/greet/alice');
      const body = await response.json() as { result: { message: string } };

      expect(body.result.message).toBe('Hello, alice!');
    });

    it('POST request passes body to handler', async () => {
      const response = await module.inject('POST', '/greet/echo', { body: { ping: 'pong' } });
      const body = await response.json() as { result: { ping: string } };

      expect(body.result.ping).toBe('pong');
    });

    it('returns 404 for unknown routes', async () => {
      const response = await module.inject('GET', '/unknown/path');

      expect(response.status).toBe(404);
    });

    it('supports query parameters', async () => {
      const response = await module.inject('GET', '/greet/world', { query: { lang: 'en' } });
      // Just verifies the request doesn't crash (query is ignored by this handler)
      expect(response.status).toBe(200);
    });
  });

  describe('get()', () => {
    it('retrieves a service instance by class', async () => {
      const module = await TestingModule.create({
        controllers: [GreetController],
        providers: [GreetingService],
      }).compile();

      try {
        const service = module.get(GreetingService);
        expect(service).toBeInstanceOf(GreetingService);
        expect(service.greet('test')).toBe('Hello, test!');
      } finally {
        await module.close();
      }
    });
  });

  describe('setOptions()', () => {
    it('passes options to the application', async () => {
      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .setOptions({ basePath: '/api' })
        .compile();

      try {
        // Without basePath prefix the route should not match
        const notFound = await module.inject('GET', '/greet/world');
        expect(notFound.status).toBe(404);

        // With basePath prefix the route should match
        const found = await module.inject('GET', '/api/greet/world');
        expect(found.status).toBe(200);
      } finally {
        await module.close();
      }
    });
  });

  describe('getApp()', () => {
    it('returns an OneBunApplication instance', async () => {
      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .compile();

      try {
        expect(module.getApp()).toBeInstanceOf(OneBunApplication);
      } finally {
        await module.close();
      }
    });
  });

  describe('getPort()', () => {
    it('returns a port greater than 0', async () => {
      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .compile();

      try {
        expect(module.getPort()).toBeGreaterThan(0);
      } finally {
        await module.close();
      }
    });
  });

  describe('getConfig()', () => {
    it('returns config object when envSchema is provided', async () => {
      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .setOptions({ envSchema: {} })
        .compile();

      try {
        const config = module.getConfig();
        expect(config).toBeDefined();
        expect(typeof config.get).toBe('function');
      } finally {
        await module.close();
      }
    });
  });

  describe('overrideProvider()', () => {
    it('useValue() replaces service so controller uses mock', async () => {
      const mockService = {
        greet: (_name: string) => 'Mocked greeting!',
      };

      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .overrideProvider(GreetingService).useValue(mockService)
        .compile();

      try {
        const response = await module.inject('GET', '/greet/anyone');
        const body = await response.json() as { result: { message: string } };

        expect(body.result.message).toBe('Mocked greeting!');
      } finally {
        await module.close();
      }
    });

    it('useClass() replaces service with instance of provided class', async () => {
      @Service()
      class MockGreetingService extends BaseService {
        greet(_name: string): string {
          return 'Class mock!';
        }
      }

      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .overrideProvider(GreetingService).useClass(MockGreetingService)
        .compile();

      try {
        const response = await module.inject('GET', '/greet/anyone');
        const body = await response.json() as { result: { message: string } };

        expect(body.result.message).toBe('Class mock!');
      } finally {
        await module.close();
      }
    });
  });

  describe('overrideProvider() reach', () => {
    /**
     * Overrides used to be applied by patching the ROOT module after the whole tree had
     * been built, which reached root-module controllers only. A service — or anything
     * inside an imported module — silently kept the real instance: the mock was not
     * rejected, it was IGNORED, which is the mode that lets a real DI bug ship green.
     */
    @Service()
    class ReachDep extends BaseService {
      who(): string {
        return 'REAL';
      }
    }

    @Service()
    class ReachConsumer extends BaseService {
      constructor(private dep: ReachDep) {
        super();
      }

      saw(): string {
        return this.dep.who();
      }
    }

    @Module({ providers: [ReachDep, ReachConsumer], exports: [ReachDep, ReachConsumer] })
    class ReachInnerModule {}

    it('reaches a SERVICE, not only a controller (previously saw REAL)', async () => {
      const module = await TestingModule
        .create({ providers: [ReachDep, ReachConsumer] })
        .overrideProvider(ReachDep).useValue({ who: () => 'MOCK' })
        .compile();

      try {
        expect(module.get(ReachConsumer).saw()).toBe('MOCK');
      } finally {
        await module.close();
      }
    });

    it('reaches a service inside an IMPORTED module that provides the overridden class', async () => {
      // Pre-fix baseline was a silent REAL here, not a throw — the mock was accepted and
      // then quietly bypassed by the imported module's own provider.
      const module = await TestingModule
        .create({ imports: [ReachInnerModule] })
        .overrideProvider(ReachDep).useValue({ who: () => 'MOCK' })
        .compile();

      try {
        expect(module.get(ReachConsumer).saw()).toBe('MOCK');
        expect((module.get(ReachDep) as { who(): string }).who()).toBe('MOCK');
      } finally {
        await module.close();
      }
    });

    it('still throws when the overridden class is provided NOWHERE', async () => {
      @Service()
      class Unprovided extends BaseService {
        value(): string {
          return 'x';
        }
      }

      @Service()
      class NeedsUnprovided extends BaseService {
        constructor(private dep: Unprovided) {
          super();
        }

        value(): string {
          return this.dep.value();
        }
      }

      // Only NeedsUnprovided is a provider; Unprovided is not, and no override is set for
      // it — the resolution error must survive, it is the loud mode worth keeping.
      let error: unknown;
      try {
        await TestingModule.create({ providers: [NeedsUnprovided] }).compile();
      } catch (thrown) {
        error = thrown;
      }

      expect((error as Error | undefined)?.message).toContain('Could not resolve dependency');
    });

    it('useClass() reaches an imported module and fires lifecycle hooks exactly once', async () => {
      let inits = 0;

      @Service()
      class HookedMock extends BaseService {
        async onApplicationInit(): Promise<void> {
          inits++;
        }

        who(): string {
          return 'CLASS-MOCK';
        }
      }

      const module = await TestingModule
        .create({ imports: [ReachInnerModule] })
        .overrideProvider(ReachDep).useClass(HookedMock)
        .compile();

      try {
        expect(module.get(ReachConsumer).saw()).toBe('CLASS-MOCK');
        // Seeding the override into every module makes an undeduplicated lifecycle
        // recursion fire this once per module.
        expect(inits).toBe(1);
      } finally {
        await module.close();
      }
    });

    it('two compiled modules in one file each see their own configuration', async () => {
      const first = await TestingModule
        .create({ imports: [ReachInnerModule] })
        .overrideProvider(ReachDep).useValue({ who: () => 'FIRST' })
        .compile();

      let firstSaw: string;
      try {
        firstSaw = first.get(ReachConsumer).saw();
      } finally {
        await first.close();
      }

      const second = await TestingModule
        .create({ imports: [ReachInnerModule] })
        .overrideProvider(ReachDep).useValue({ who: () => 'SECOND' })
        .compile();

      let secondSaw: string;
      try {
        secondSaw = second.get(ReachConsumer).saw();
      } finally {
        await second.close();
      }

      expect(firstSaw).toBe('FIRST');
      expect(secondSaw).toBe('SECOND');
    });

    it('a mock is not retained by a later TestingModule that sets no override', async () => {
      const mocked = await TestingModule
        .create({ imports: [ReachInnerModule] })
        .overrideProvider(ReachDep).useValue({ who: () => 'MOCK' })
        .compile();

      try {
        expect(mocked.get(ReachConsumer).saw()).toBe('MOCK');
      } finally {
        await mocked.close();
      }

      const clean = await TestingModule.create({ imports: [ReachInnerModule] }).compile();

      try {
        expect(clean.get(ReachConsumer).saw()).toBe('REAL');
      } finally {
        await clean.close();
      }
    });
  });
});

// ============================================================================
// Regression: fast path response wrapping
// ============================================================================

@Controller('/items')
class NoParamController extends BaseController {
  @Get('/')
  findAll() {
    return [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }];
  }
}

describe('fast path (no param decorators, no response schema)', () => {
  it('returns a proper JSON response with success envelope', async () => {
    const module = await TestingModule.create({
      controllers: [NoParamController],
    }).compile();

    try {
      const response = await module.inject('GET', '/items');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const body = await response.json() as { success: boolean; result: unknown[] };
      expect(body.success).toBe(true);
      expect(body.result).toEqual([
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ]);
    } finally {
      await module.close();
    }
  });
});

// ============================================================================
// Regression: response validation with optional undefined fields
// ============================================================================

/* eslint-disable @typescript-eslint/naming-convention */
const optionalFieldSchema = type({ name: 'string', 'age?': 'number > 0' });
/* eslint-enable @typescript-eslint/naming-convention */

@Controller('/validated')
class OptionalFieldController extends BaseController {
  @Get('/')
  @ApiResponse(200, { schema: optionalFieldSchema.array() })
  findAll() {
    return [{ name: 'Alice', age: undefined }];
  }
}

describe('response validation with optional undefined fields', () => {
  it('passes validation when optional field has undefined value', async () => {
    const module = await TestingModule.create({
      controllers: [OptionalFieldController],
    }).compile();

    try {
      const response = await module.inject('GET', '/validated');

      expect(response.status).toBe(200);

      const body = await response.json() as { success: boolean; result: Array<{ name: string }> };
      expect(body.success).toBe(true);
      expect(body.result[0].name).toBe('Alice');
      expect('age' in body.result[0]).toBe(false);
    } finally {
      await module.close();
    }
  });
});

// ============================================================================
// Regression: exception filters apply on BOTH execution paths
//
// A handler with no decorated parameters takes the inline fast path, which had no
// try at all — `throw new HttpException(404)` left the framework as a bare 500
// text/plain, while the SAME throw from a handler declaring `@Query('q')` produced
// a correct 404 JSON envelope. Adding or removing a parameter decorator silently
// changed a handler's error semantics.
// ============================================================================

@Controller('/errs')
class ZeroParamThrowController extends BaseController {
  @Get('/http')
  http(): unknown {
    throw new HttpException(HttpStatusCode.NOT_FOUND, 'gone');
  }

  @Get('/plain')
  plain(): unknown {
    throw new Error('boom');
  }

  @Get('/coded')
  coded(): unknown {
    throw Object.assign(new Error('control plane unreachable'), { code: 'ECONNREFUSED' });
  }
}

@Controller('/errs-param')
class ParamThrowController extends BaseController {
  @Get('/http')
  http(@Query('q') _q?: string): unknown {
    throw new HttpException(HttpStatusCode.NOT_FOUND, 'gone');
  }

  @Get('/plain')
  plain(@Query('q') _q?: string): unknown {
    throw new Error('boom');
  }

  @Get('/coded')
  coded(@Query('q') _q?: string): unknown {
    throw Object.assign(new Error('control plane unreachable'), { code: 'ECONNREFUSED' });
  }
}

interface ErrorBody {
  success: boolean;
  error: string;
  code: number;
  details?: { stack?: string; originalErrorName?: string; originalCode?: unknown };
}

/**
 * The parity comparison drops `details.stack`. Two paths that both filter correctly
 * still produce different stacks by construction — one frame is the fast arm, the
 * other is `executeHandler` — so a byte-equal stack would mean the paths had been
 * collapsed, which is the thing the fast path exists to avoid.
 */
function withoutStack(body: ErrorBody): ErrorBody {
  if (!body.details) {
    return body;
  }
  const { stack: _stack, ...details } = body.details;

  return { ...body, details };
}

describe('fast path — exception filters', () => {
  async function get(controllers: unknown[], path: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const module = await TestingModule.create({ controllers: controllers as any }).compile();
    try {
      const response = await module.inject('GET', path);

      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.json() as ErrorBody,
      };
    } finally {
      await module.close();
    }
  }

  it('filters an HttpException thrown from a zero-parameter handler', async () => {
    const res = await get([ZeroParamThrowController], '/errs/http');

    expect(res.status).toBe(404);
    expect(res.contentType).toContain('application/json');
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('gone');
    expect(res.body.code).toBe(404);
  });

  it('filters a plain Error thrown from a zero-parameter handler', async () => {
    const res = await get([ZeroParamThrowController], '/errs/plain');

    expect(res.status).toBe(500);
    expect(res.contentType).toContain('application/json');
    expect(res.body.success).toBe(false);
    // The filter ran — and an unhandled error answers with the fixed string rather than
    // with whatever the thrower wrote.
    expect(res.body.error).toBe('Internal Server Error');
  });

  it('does not let a non-numeric error code crash the filter', async () => {
    // `Number('ECONNREFUSED')` is NaN, and `new Response(body, { status: NaN })`
    // throws RangeError from inside the filter — the filter failed while handling
    // the failure, and the original error escaped as a bare 500.
    const res = await get([ZeroParamThrowController], '/errs/coded');

    expect(res.status).toBe(500);
    expect(res.contentType).toContain('application/json');
    expect(res.body.error).toBe('Internal Server Error');
  });

  // The anti-drift guard. Five separate call sites apply filters; a cross product is
  // the only shape that cannot be satisfied by fixing one of them.
  for (const route of ['http', 'plain', 'coded'] as const) {
    it(`answers /${route} identically with and without a parameter decorator`, async () => {
      const zero = await get([ZeroParamThrowController], `/errs/${route}`);
      const param = await get([ParamThrowController], `/errs-param/${route}`);

      expect(zero.status).toBe(param.status);
      expect(zero.contentType).toBe(param.contentType);
      expect(withoutStack(zero.body)).toEqual(withoutStack(param.body));
    });
  }
});

const throwingGuard = createHttpGuard(() => {
  throw new HttpException(HttpStatusCode.UNAUTHORIZED, 'token expired');
});

const denyingGuard = createHttpGuard(() => false);

const customFilter = createExceptionFilter(() => new Response(
  JSON.stringify({ handled: 'by-custom-filter' }),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { status: 418, headers: { 'Content-Type': 'application/json' } },
));

const throwingFilter = createExceptionFilter(() => {
  throw new Error('the filter itself is buggy');
});

@Controller('/guarded')
class ThrowingGuardController extends BaseController {
  @Get('/zero')
  @UseGuards(throwingGuard)
  zero(): unknown {
    return { never: true };
  }

  @Get('/param')
  @UseGuards(throwingGuard)
  param(@Query('q') _q?: string): unknown {
    return { never: true };
  }

  @Get('/denied')
  @UseGuards(denyingGuard)
  denied(): unknown {
    return { never: true };
  }
}

@Controller('/filtered')
class FilteredController extends BaseController {
  @Get('/custom')
  @UseFilters(customFilter)
  custom(): unknown {
    throw new HttpException(HttpStatusCode.NOT_FOUND, 'gone');
  }

  @Get('/buggy')
  @UseFilters(throwingFilter)
  buggy(): unknown {
    throw new HttpException(HttpStatusCode.NOT_FOUND, 'gone');
  }
}

let probeArgs: unknown[] = [];

@Controller('/probe')
class FastPathProbeController extends BaseController {
  @Get('/args')
  args(...rest: unknown[]): unknown {
    probeArgs = rest;

    return { ok: true };
  }
}

describe('exception filters — guards, interceptors and custom filters', () => {
  async function get(
    controllers: unknown[],
    path: string,
    options?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = TestingModule.create({ controllers: controllers as any });
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder.setOptions(options as any);
    }
    const module = await builder.compile();
    try {
      const response = await module.inject('GET', path, headers ? { headers } : undefined);

      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        cors: response.headers.get('access-control-allow-origin'),
        body: await response.json() as ErrorBody & { handled?: string },
      };
    } finally {
      await module.close();
    }
  }

  it('filters a guard that throws, on both paths', async () => {
    const zero = await get([ThrowingGuardController], '/guarded/zero');
    const param = await get([ThrowingGuardController], '/guarded/param');

    expect(zero.status).toBe(401);
    expect(zero.body.error).toBe('token expired');
    expect(param.status).toBe(401);
    expect(param.body.error).toBe('token expired');
  });

  it('leaves a guard that returns false on its fixed Forbidden contract', async () => {
    // Deliberately NOT routed through filters: a route-level @UseFilters must not be
    // able to silently override the 403 a denying guard promises.
    const res = await get([ThrowingGuardController], '/guarded/denied');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.code).toBe(403);
  });

  it('runs @UseFilters on a zero-parameter route', async () => {
    // The defect proper: routeMeta.filters was populated and never read on this path.
    const res = await get([FilteredController], '/filtered/custom');

    expect(res.status).toBe(418);
    expect(res.body.handled).toBe('by-custom-filter');
  });

  it('falls back to the default filter when a custom filter throws', async () => {
    const res = await get([FilteredController], '/filtered/buggy');

    expect(res.status).toBe(404);
    expect(res.contentType).toContain('application/json');
    expect(res.body.error).toBe('gone');
  });

  it('keeps CORS headers on a filtered error response', async () => {
    // The regression guard for filtering above the middleware chain: CorsMiddleware
    // sets its headers AFTER await next(), so a filter applied higher up would unwind
    // past it and strip them from every error response.
    const res = await get(
      [ZeroParamThrowController],
      '/errs/http',
      { cors: { origin: 'https://app.example.com' } },
      // A configured (non-wildcard) origin is echoed only for a request that carries one.
      { origin: 'https://app.example.com' },
    );

    expect(res.status).toBe(404);
    expect(res.cors).toBe('https://app.example.com');
  });

  it('still takes the fast path for a zero-parameter handler', async () => {
    // Structural, not timing-based. The fast arm calls boundHandler(req) — one arg,
    // the request. executeHandler calls boundHandler(...args), which for a handler
    // with no parameter decorators is zero args. A collapse of the two arms flips this.
    probeArgs = [];
    const res = await get([FastPathProbeController], '/probe/args');

    expect(res.status).toBe(200);
    expect(probeArgs.length).toBe(1);
    expect(typeof (probeArgs[0] as { url?: unknown }).url).toBe('string');
  });
});

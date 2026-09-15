/**
 * `createHttpParamDecorator`: a handler argument produced by a user-supplied extractor.
 *
 * Driven through a real server rather than through the metadata, because the thing worth pinning
 * is that the value reaches the handler — the metadata is only how it gets there.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import type { OneBunRequest } from '../types';

import { OneBunApplication } from '../application/application';
import { Controller as ControllerBase } from '../module/controller';
import { BaseMiddleware } from '../module/middleware';
import { getRequestContext, updateRequestContext } from '../request-context';
import { makeMockLoggerLayer } from '../testing/test-utils';

import {
  Controller,
  createHttpParamDecorator,
  Get,
  Middleware,
  Module,
  Param,
  Query,
} from './decorators';
declare module '../request-context' {
  interface RequestContext {
    paramUser?: { id: string };
  }
}

/** Reads per-request state a middleware produced — the case this factory exists for. */
const CurrentUser = createHttpParamDecorator(() => getRequestContext()?.paramUser);

/** Reads straight off the request. Buildable with `@Req()` too, which is the point of the docs. */
const UserAgent = createHttpParamDecorator((ctx) => ctx.getRequest().headers.get('user-agent') ?? 'none');

/** Per-use arguments by closure, with no `data` parameter on the factory. */
const Header = (name: string) => createHttpParamDecorator(
  (ctx) => ctx.getRequest().headers.get(name) ?? undefined,
)();

let extractorCalls = 0;
const Counted = createHttpParamDecorator(() => {
  extractorCalls += 1;

  return extractorCalls;
});

/** Stands in for an auth middleware: it writes the per-request state the extractor reads. */
@Middleware()
class UserMiddleware extends BaseMiddleware {
  async use(_req: OneBunRequest, next: () => Promise<Response>): Promise<Response> {
    updateRequestContext({ paramUser: { id: 'u-42' } });

    return await next();
  }
}

@Controller('/custom')
class CustomController extends ControllerBase {
  @Get('/user')
  user(@CurrentUser() user: { id: string } | undefined) {
    return { user: user ?? null };
  }

  @Get('/ua')
  ua(@UserAgent() agent: string) {
    return { agent };
  }

  @Get('/mixed/:id')
  mixed(
    @Param('id') id: string,
    @CurrentUser() user: { id: string } | undefined,
    @Query('q') q?: string,
  ) {
    return { id, user: user?.id ?? null, q: q ?? null };
  }

  @Get('/named')
  named(@Header('x-tenant') tenant: string | undefined) {
    return { tenant: tenant ?? null };
  }

  @Get('/twice')
  twice(@Counted() a: number, @Counted() b: number) {
    return { a, b };
  }
}

@Module({ controllers: [CustomController] })
class CustomModule {}

describe('createHttpParamDecorator', () => {
  /*
   * Every case below is the documented behaviour of
   * docs/api/decorators.md#createhttpparamdecorator, driven end to end.
   */
  let app: OneBunApplication;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(CustomModule, { port: 0, loggerLayer: makeMockLoggerLayer() });
    await app.start();
    base = `http://localhost:${app.getPort()}`;
  });

  afterAll(async () => {
    await app.stop();
  });

  const call = async (path: string, headers?: Record<string, string>): Promise<Record<string, unknown>> => {
    const response = await fetch(`${base}${path}`, { headers });

    return (await response.json() as { result: Record<string, unknown> }).result;
  };

  /**
   * @source docs:api/decorators.md#createhttpparamdecorator
   */
  it('should extract a value straight off the request', async () => {
    const body = await call('/custom/ua', { 'user-agent': 'test-agent/1.0' });

    expect(body.agent).toBe('test-agent/1.0');
  });

  /**
   * @source docs:api/decorators.md#createhttpparamdecorator
   */
  it('should extract per-request state a middleware produced, which @Req() cannot reach', async () => {
    // The motivating case. Stands in for a middleware by writing the context from a global
    // middleware-equivalent: the server's own request scope is what both would share.
    const withUser = new OneBunApplication(CustomModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer(),
      middleware: [UserMiddleware],
    });

    await withUser.start();
    try {
      const response = await fetch(`http://localhost:${withUser.getPort()}/custom/user`);
      const body = (await response.json() as { result: { user: { id: string } | null } }).result;

      expect(body.user).toEqual({ id: 'u-42' });
    } finally {
      await withUser.stop();
    }
  });

  /**
   * @source docs:api/decorators.md#createhttpparamdecorator
   */
  it('should answer with the extractor value even when there is nothing to extract', async () => {
    // No middleware wrote a user on this app: the extractor returns undefined and the parameter
    // is never "required", so the request succeeds rather than answering 400.
    const body = await call('/custom/user');

    expect(body.user).toBeNull();
  });

  /**
   * @source docs:api/decorators.md#createhttpparamdecorator
   */
  it('should keep its slot among ordinary parameter decorators', async () => {
    const body = await call('/custom/mixed/7?q=hello');

    expect(body.id).toBe('7');
    expect(body.q).toBe('hello');
    expect(body.user).toBeNull();
  });

  /**
   * @source docs:api/decorators.md#createhttpparamdecorator
   */
  it('should support per-use arguments through a closure', async () => {
    const body = await call('/custom/named', { 'x-tenant': 'acme' });

    expect(body.tenant).toBe('acme');
  });

  /**
   * @source docs:api/decorators.md#createhttpparamdecorator
   */
  it('should run the extractor once per decorated parameter per request', async () => {
    extractorCalls = 0;

    const body = await call('/custom/twice');

    expect(body.a).toBe(1);
    expect(body.b).toBe(2);
    expect(extractorCalls).toBe(2);
  });

});

/**
 * CORS preflight answered before routing.
 *
 * Driven through `TestingModule`, which starts a real `Bun.serve` and calls it over loopback.
 * The mock router in `application.test.ts` has no wildcard support and never reaches the
 * `fetch` fallback, so a test written there would exercise the mock rather than the fix.
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import type { OneBunRequest, OneBunResponse } from '../types';

import {
  Controller,
  Get,
  Options,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { CorsMiddleware } from '../security/cors-middleware';
import { TestingModule, type CompiledTestingModule } from '../testing/testing-module';
import { BaseWebSocketGateway } from '../websocket/ws-base-gateway';
import { OnConnect, WebSocketGateway } from '../websocket/ws-decorators';

const NO_CONTENT = 204;
const NOT_FOUND = 404;
const OK = 200;

const ORIGIN = 'https://app.example.com';

@Controller('/api')
class GetOnlyController extends BaseController {
  @Get('/items')
  list() {
    return { items: [] };
  }
}

/** Run `body` against a compiled module and always close it. */
async function withModule(
  module: Promise<CompiledTestingModule>,
  body: (compiled: CompiledTestingModule) => Promise<void>,
): Promise<void> {
  const compiled = await module;

  try {
    await body(compiled);
  } finally {
    await compiled.close();
  }
}

/** The two headers a browser sends on every real preflight. */
function preflightHeaders(method = 'GET'): Record<string, string> {
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Origin': ORIGIN,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Access-Control-Request-Method': method,
  };
}

describe('CORS preflight before routing', () => {
  it('answers a preflight to a path whose controller declares only GET', async () => {
    // The reported bug: the browser blocked every cross-origin request carrying Authorization
    // or a JSON content type, because the preflight came back 404 with no CORS headers.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({
          cors: {
            origin: ORIGIN,
            allowedHeaders: ['Content-Type', 'Authorization'],
            maxAge: 600,
          },
        })
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

        expect(response.status).toBe(NO_CONTENT);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
        expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
        expect(response.headers.get('access-control-max-age')).toBe('600');
      },
    );
  });

  it('answers a preflight to a path that does not exist at all', async () => {
    // Same code path — nothing matched — and the browser needs the same answer.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ cors: { origin: ORIGIN } })
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/nothing/here', { headers: preflightHeaders() });

        expect(response.status).toBe(NO_CONTENT);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      },
    );
  });

  it('leaves a non-preflight OPTIONS with its honest 404', async () => {
    // Gated on `Access-Control-Request-Method`, which the Fetch spec requires on a real
    // preflight. A bare `curl -X OPTIONS` is API probing and gets the truth.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ cors: { origin: ORIGIN } })
        .compile(),
      async (module) => {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await module.inject('OPTIONS', '/api/items', { headers: { 'Origin': ORIGIN } });

        expect(response.status).toBe(NOT_FOUND);
        // A 404, and NOT a preflight answer: the short-circuit did not fire, so none of the
        // preflight-only headers are here. The grant header alone no longer pins that — since
        // the fallback runs the global chain, an ordinary cross-origin 404 carries it exactly as
        // a routed response does. `access-control-allow-methods` is set by the preflight branch
        // only, so it is what tells the two apart.
        expect(response.headers.get('access-control-allow-methods')).toBeNull();
        expect(response.headers.get('access-control-max-age')).toBeNull();
      },
    );
  });

  it('does not answer preflights when cors is not configured', async () => {
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] }).compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

        expect(response.status).toBe(NOT_FOUND);
      },
    );
  });

  it('answers a disallowed origin without granting it', async () => {
    // 204 with no ACAO. The browser blocks the request, which is the correct outcome — but the
    // decision is the browser's to make from a well-formed preflight response.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ cors: { origin: 'https://allowed.example.com' } })
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

        expect(response.status).toBe(NO_CONTENT);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      },
    );
  });

  it('gives an explicit @Options route the non-preflight OPTIONS, and CORS the preflight', async () => {
    // Two different requests that share a verb, and the split is the `Access-Control-Request-
    // Method` header. API discovery reaches the route the author declared. A browser preflight
    // is answered by CORS, because a preflight response that does not carry the grant is a
    // blocked request whatever its status — `preflightContinue: true` is how an author takes
    // that over deliberately.
    @Controller('/api')
    class ExplicitOptionsController extends BaseController {
      @Get('/thing')
      get() {
        return { ok: true };
      }

      @Options('/thing')
      describe() {
        return { handledBy: 'controller' };
      }
    }

    await withModule(
      TestingModule.create({ controllers: [ExplicitOptionsController] })
        .setOptions({ cors: { origin: ORIGIN } })
        .compile(),
      async (module) => {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const probe = await module.inject('OPTIONS', '/api/thing', { headers: { 'Origin': ORIGIN } });

        expect(probe.status).toBe(OK);
        expect(await probe.json()).toMatchObject({ result: { handledBy: 'controller' } });
        // It is still a cross-origin response, so it still carries the grant.
        expect(probe.headers.get('access-control-allow-origin')).toBe(ORIGIN);

        const preflight = await module.inject('OPTIONS', '/api/thing', { headers: preflightHeaders() });

        expect(preflight.status).toBe(NO_CONTENT);
      },
    );
  });

  it('never lets the fallback shadow a declared route', async () => {
    // The pre-routing short-circuit lives in the `fetch` fallback, which Bun only reaches when
    // its own router matched nothing. A declared route is therefore unreachable BY the
    // short-circuit by construction — precedence needs no ordering rule that could drift.
    @Controller('/api')
    class OptionsOnlyController extends BaseController {
      @Options('/described')
      describe() {
        return { handledBy: 'controller' };
      }
    }

    await withModule(
      TestingModule.create({ controllers: [OptionsOnlyController] })
        // No cors at all: nothing can short-circuit, and the route must still answer.
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/described', { headers: preflightHeaders() });

        expect(response.status).toBe(OK);
        expect(await response.json()).toMatchObject({ result: { handledBy: 'controller' } });
      },
    );
  });

  it('still attaches CORS headers to a real request', async () => {
    // The routed path is untouched: the short-circuit only fires where nothing matched.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ cors: { origin: ORIGIN } })
        .compile(),
      async (module) => {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await module.inject('GET', '/api/items', { headers: { 'Origin': ORIGIN } });

        expect(response.status).toBe(OK);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      },
    );
  });
});

describe('CORS preflight interactions', () => {
  it('is not spent against the rate limit', async () => {
    // A preflight carries no credentials and is not a request the user made. Rate limiting must
    // never see it — and on the routed path it already never does, because CORS sits first in
    // the chain and returns without calling next(). This makes the two paths consistent.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({
          cors: { origin: ORIGIN },
          rateLimit: { windowMs: 60_000, max: 1 },
        })
        .compile(),
      async (module) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const preflight = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

          expect(preflight.status).toBe(NO_CONTENT);
        }

        // The budget of one is still intact for the request that actually counts.
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const real = await module.inject('GET', '/api/items', { headers: { 'Origin': ORIGIN } });

        expect(real.status).toBe(OK);
      },
    );
  });

  it('skips the short-circuit under preflightContinue', async () => {
    // The option exists so a downstream handler produces the preflight response. Short-circuiting
    // would take that away, so the behaviour is left exactly as it was.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ cors: { origin: ORIGIN, preflightContinue: true } })
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

        // `preflightContinue` means a downstream handler produces the preflight response, and
        // here the downstream handler is the fallback: a 404, decorated by the CORS middleware in
        // the global chain on its way out. The short-circuit would have answered 204 instead, so
        // the status is what pins the guard — the decoration no longer distinguishes them, since
        // every fallback response travels that chain now.
        expect(response.status).toBe(NOT_FOUND);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      },
    );
  });

  it('works when CORS is supplied by hand as middleware', async () => {
    // `CorsMiddleware.configure()` returns an anonymous subclass, so the short-circuit detects
    // it by prototype rather than by identity — which is also what makes this spelling work.
    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ middleware: [CorsMiddleware.configure({ origin: ORIGIN })] })
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

        expect(response.status).toBe(NO_CONTENT);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      },
    );
  });

  it('does not throw for a subclass that reads request fields the fallback lacks', async () => {
    // The fallback `req` is a plain `Request`; `OneBunRequest` carries `params` and `cookies`.
    // A subclass overriding use() and reading either would throw on undefined, so both are
    // supplied rather than cast away.
    class ParamReadingCors extends CorsMiddleware {
      constructor() {
        super({ origin: ORIGIN });
      }

      override async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        // Would be a TypeError if the short-circuit handed over a bare Request.
        const seen = Object.keys(req.params).length + req.cookies.size;
        const response = await super.use(req, next);
        response.headers.set('x-fields-read', String(seen));

        return response;
      }
    }

    await withModule(
      TestingModule.create({ controllers: [GetOnlyController] })
        .setOptions({ middleware: [ParamReadingCors] })
        .compile(),
      async (module) => {
        const response = await module.inject('OPTIONS', '/api/items', { headers: preflightHeaders() });

        expect(response.status).toBe(NO_CONTENT);
        expect(response.headers.get('x-fields-read')).toBe('0');
      },
    );
  });
});

describe('CORS preflight and the WebSocket fallback', () => {
  @WebSocketGateway({ path: '/ws' })
  class SilentGateway extends BaseWebSocketGateway {
    @OnConnect()
    onConnect() {
      return { event: 'welcome', data: {} };
    }
  }

  it('answers a Socket.IO-path preflight instead of failing the upgrade', async () => {
    // `isSocketIoPath` is method-agnostic, so a cross-origin OPTIONS to /socket.io used to enter
    // handleUpgrade(), fail to upgrade, and come back 400 with no CORS headers. That is why the
    // short-circuit sits BEFORE the WebSocket block rather than after it — placing it after
    // would leave the bug alive for every Socket.IO application.
    await withModule(
      // Gateways live in `controllers`, not `providers` — put here they are never registered,
      // `hasWebSocketGateways` stays false, and the WebSocket block this case exists to get past
      // is skipped entirely.
      TestingModule.create({ controllers: [GetOnlyController, SilentGateway] })
        .setOptions({
          cors: { origin: ORIGIN },
          websocket: { socketio: { enabled: true } },
        })
        .compile(),
      async (module) => {
        const response = await module.inject(
          'OPTIONS',
          '/socket.io/?EIO=4&transport=polling',
          { headers: preflightHeaders() },
        );

        expect(response.status).toBe(NO_CONTENT);
        expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      },
    );
  });
});

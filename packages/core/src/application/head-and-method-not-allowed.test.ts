/**
 * HEAD, and the difference between a wrong verb and a wrong path.
 *
 * Route registration wrote exactly the declared verb into Bun's routes table. Nothing derived a
 * HEAD sibling from a GET — Bun does not either — so every load-balancer and uptime probe, which
 * conventionally use HEAD, reported the service down. And a request with a verb the path does not
 * declare fell through to the same 404 an unknown path gets, which sends the developer hunting for
 * a route that is right there.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  Controller,
  Get,
  Head,
  Module,
  Post,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const HTTP_OK = 200;
const METHOD_NOT_ALLOWED = 405;
const NOT_FOUND = 404;
const NO_CONTENT = 204;

@Controller('/api')
class ProbeController extends BaseController {
  @Get('/ping')
  ping(): { ok: boolean } {
    return { ok: true };
  }

  @Post('/submit')
  submit(): { received: boolean } {
    return { received: true };
  }

  @Get('/explicit-head')
  explicitGet(): { via: string } {
    return { via: 'get' };
  }

  @Head('/explicit-head')
  explicitHead(): Response {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return new Response(null, { status: NO_CONTENT, headers: { 'x-explicit-head': 'yes' } });
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('HEAD and 405', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(ProbeModule, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app.stop();
  });

  test('should answer HEAD on a route that declares only GET, with no body', async () => {
    const head = await fetch(`${base}/api/ping`, { method: 'HEAD' });
    const get = await fetch(`${base}/api/ping`);

    expect(head.status).toBe(HTTP_OK);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(await head.text()).toBe('');
  });

  test('should let an explicit @Head win over the derived one', async () => {
    const head = await fetch(`${base}/api/explicit-head`, { method: 'HEAD' });

    expect(head.status).toBe(NO_CONTENT);
    expect(head.headers.get('x-explicit-head')).toBe('yes');
  });

  test('should answer 405 with Allow for a verb the path does not declare', async () => {
    const response = await fetch(`${base}/api/ping`, { method: 'POST' });

    expect(response.status).toBe(METHOD_NOT_ALLOWED);

    const allow = response.headers.get('allow') ?? '';

    expect(allow).toContain('GET');
    expect(allow).toContain('HEAD');
    expect(allow).not.toContain('POST');
  });

  test('should list only the verbs the path itself declares', async () => {
    const response = await fetch(`${base}/api/submit`);
    const allow = response.headers.get('allow') ?? '';

    expect(response.status).toBe(METHOD_NOT_ALLOWED);
    expect(allow).toContain('POST');
    expect(allow).not.toContain('GET');
  });

  test('should keep 404 for a path that does not exist', async () => {
    const response = await fetch(`${base}/api/nothing-here`, { method: 'POST' });

    expect(response.status).toBe(NOT_FOUND);
    expect(response.headers.get('allow')).toBeNull();
  });
});

describe('405 registration leaves the CORS preflight alone', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;
  const origin = 'https://app.example.com';

  beforeAll(async () => {
    app = new OneBunApplication(ProbeModule, {
      port: 0,
      host: '127.0.0.1',
      cors: { origin: [origin] },
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app.stop();
  });

  test('should still answer a preflight on a routed path', async () => {
    const response = await fetch(`${base}/api/ping`, {
      method: 'OPTIONS',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Origin': origin,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Access-Control-Request-Method': 'GET',
      },
    });

    // Not a 405: with `cors` configured the OPTIONS verb is left to the preflight short-circuit.
    expect(response.status).not.toBe(METHOD_NOT_ALLOWED);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  });
});

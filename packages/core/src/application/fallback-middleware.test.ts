/**
 * What the `Bun.serve` fallback does with the global middleware chain.
 *
 * Global middleware was merged into per-route handlers only, so everything the fallback answered
 * — static files and unmatched paths — was a bare `new Response(...)`: `security: true` put its
 * headers on controller routes and not on the SPA those routes serve, and `rateLimit` bounded only
 * the paths that happened to match a controller, so hammering nonexistent ones was unmetered.
 */

import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

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
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const STATIC_ROOT = path.join(import.meta.dir, '.test-fallback-static');
const RATE_LIMIT_MAX = 3;

@Controller('/api')
class FallbackController extends BaseController {
  @Get('/ping')
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [FallbackController] })
class FallbackModule {}

describe('the fallback runs the global middleware chain', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(path.join(STATIC_ROOT, 'index.html'), '<!doctype html><title>spa</title>');

    // No rate limit here: the header cases share one bucket with each other, and a 429 answered
    // by the limiter never reaches SecurityHeaders — the limiter returns without calling next(),
    // and the security middleware sits behind it in the chain. The budget case gets its own app.
    app = new OneBunApplication(FallbackModule, {
      port: 0,
      host: '127.0.0.1',
      security: true,
      static: { root: STATIC_ROOT },
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
    rmSync(STATIC_ROOT, { recursive: true, force: true });
  });

  /** The security headers a matched route carries, as the comparison baseline. */
  async function securityHeadersOf(url: string): Promise<Record<string, string | null>> {
    const response = await fetch(url);

    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-frame-options': response.headers.get('x-frame-options'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'content-security-policy': response.headers.get('content-security-policy'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-content-type-options': response.headers.get('x-content-type-options'),
    };
  }

  test('should put the same security headers on a static file as on a matched route', async () => {
    const routed = await securityHeadersOf(`${base}/api/ping`);
    const staticFile = await securityHeadersOf(`${base}/index.html`);

    expect(routed['x-frame-options']).not.toBeNull();
    expect(staticFile).toEqual(routed);
  });

  test('should put the same security headers on an unmatched path as on a matched route', async () => {
    const routed = await securityHeadersOf(`${base}/api/ping`);
    const missing = await securityHeadersOf(`${base}/nope`);

    expect(missing).toEqual(routed);
  });

});

describe('unmatched paths consume the rate-limit budget', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(FallbackModule, {
      port: 0,
      host: '127.0.0.1',
      rateLimit: { max: RATE_LIMIT_MAX, windowMs: 60_000 },
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

  test('should return 429 once an unmatched path has exhausted the budget', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < RATE_LIMIT_MAX + 2; attempt += 1) {
      const response = await fetch(`${base}/unmatched-${attempt}`);
      statuses.push(response.status);
    }

    // Unmetered before: every one of these was a 404 and the bucket never moved, so `max` did
    // not bound request volume — only volume on paths that happened to match a controller.
    expect(statuses.slice(0, RATE_LIMIT_MAX)).toEqual(Array(RATE_LIMIT_MAX).fill(404));
    expect(statuses.slice(RATE_LIMIT_MAX)).toEqual([429, 429]);
  });
});

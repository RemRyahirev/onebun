/**
 * A controller that returns an `@onebun/requests` success envelope as it is.
 *
 * The envelope carries the upstream's response headers (`SuccessResponse.headers`). The framework
 * serializes whatever a handler returns — the full arm sends an object with a `success` key as it
 * is, the fast arm wraps it into `result` — so an enumerable `headers` would have sent the
 * upstream's `set-cookie`, `server` and every other header to this controller's own caller, in the
 * body. The property is non-enumerable; this pins that no dispatch arm serializes it.
 */

import { type as arktype } from 'arktype';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  createHttpClient,
  type ApiResponse,
  type HttpClient,
} from '@onebun/requests';

import {
  ApiResponse as ApiResponseSchema,
  Controller,
  Get,
  Module,
  Query,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const UPSTREAM_BODY = { value: 1 };

let upstreamClient: HttpClient;
const seen: ApiResponse<typeof UPSTREAM_BODY>[] = [];

const relay = async (): Promise<ApiResponse<typeof UPSTREAM_BODY>> => {
  const envelope = await upstreamClient.get<typeof UPSTREAM_BODY>('/probe');
  seen.push(envelope);

  return envelope;
};

@Controller('/relay')
class RelayController extends BaseController {
  /** No decorated parameter and no response schema: the fast arm, which wraps the value. */
  @Get('/plain')
  async plain(): Promise<ApiResponse<typeof UPSTREAM_BODY>> {
    return await relay();
  }

  /** One decorated parameter: the full arm, which sends a `success`-keyed object as it is. */
  @Get('/query')
  async withQuery(@Query('q') _q?: string): Promise<ApiResponse<typeof UPSTREAM_BODY>> {
    return await relay();
  }

  /** A declared schema: the full arm, which copies the value before validating it. */
  @Get('/schema')
  @ApiResponseSchema(200, { schema: arktype({ success: 'boolean' }), description: 'relayed envelope' })
  async withSchema(): Promise<ApiResponse<typeof UPSTREAM_BODY>> {
    return await relay();
  }
}

@Module({ controllers: [RelayController] })
class RelayModule {}

describe('a controller returning a client success envelope verbatim', () => {
  let upstream: ReturnType<typeof Bun.serve>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => Response.json(UPSTREAM_BODY, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'x-probe': 'present', 'set-cookie': 'upstream-session=secret' },
      }),
    });
    upstreamClient = createHttpClient({ baseUrl: `http://127.0.0.1:${upstream.port}`, retries: { max: 0 } });

    app = new OneBunApplication(RelayModule, {
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
    upstream.stop(true);
  });

  const fetchRelay = async (path: string): Promise<{ status: number; body: string; envelope: unknown }> => {
    seen.length = 0;
    const response = await fetch(`${base}/relay${path}`);
    const body = await response.text();

    // Not vacuous: the envelope the handler returned did carry the upstream headers
    expect(seen).toHaveLength(1);
    expect(seen[0]?.success && seen[0].headers?.['x-probe']).toBe('present');
    expect(response.headers.get('set-cookie')).toBeNull();

    return { status: response.status, body, envelope: JSON.parse(body) };
  };

  test('should not serialize the upstream headers on a route with no decorated parameters', async () => {
    const { status, body, envelope } = await fetchRelay('/plain');

    expect(status).toBe(200);
    expect(body).not.toContain('x-probe');
    expect(body).not.toContain('upstream-session');
    expect(body).not.toContain('"headers"');
    // The fast arm wraps the returned envelope into its own
    expect(envelope).toEqual({
      success: true,
      result: {
        success: true,
        result: UPSTREAM_BODY,
        statusCode: 200,
        retryCount: 0,
      },
    });
  });

  test('should not serialize the upstream headers on a route with a decorated @Query()', async () => {
    const { status, body, envelope } = await fetchRelay('/query?q=1');

    expect(status).toBe(200);
    expect(body).not.toContain('x-probe');
    expect(body).not.toContain('upstream-session');
    expect(body).not.toContain('"headers"');
    // The full arm sends a `success`-keyed value as it is
    expect(envelope).toEqual({
      success: true,
      result: UPSTREAM_BODY,
      statusCode: 200,
      retryCount: 0,
    });
  });

  test('should not serialize the upstream headers on a route with a declared response schema', async () => {
    const { status, body } = await fetchRelay('/schema');

    expect(status).toBe(200);
    expect(body).not.toContain('x-probe');
    expect(body).not.toContain('"headers"');
  });
});

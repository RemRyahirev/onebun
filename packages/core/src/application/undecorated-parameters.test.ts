/**
 * A handler parameter with no param decorator.
 *
 * What it receives depends on which dispatch arm the route lands in: a route with no decorated
 * parameter and no response schema is called as `boundHandler(req)`, so parameter 0 IS the
 * request; every other route gets an argument array with only the decorated positions filled, so
 * the same parameter is `undefined`. One `@Query()` flips it, silently, in both directions — and
 * a handler copy-pasted between two controllers worked in one and threw in the other.
 *
 * The two arms are a measured optimisation and stay. The silence does not.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { SyncLogger } from '@onebun/logger';

import {
  Controller,
  Get,
  Module,
  Param,
  Query,
  Req,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { createMockSyncLogger, makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const seen: Record<string, string> = {};

@Controller('/undecorated')
class UndecoratedController extends BaseController {
  /** Fast arm: no decorated parameter, no response schema. */
  @Get('/fast')
  fast(plain: unknown): { arg0: string } {
    seen.fast = typeof plain;

    return { arg0: typeof plain };
  }

  /** Full arm: one decorated parameter drags the whole handler onto the other path. */
  @Get('/full')
  full(@Query('q') _q: string, plain: unknown): { arg1: string } {
    seen.full = typeof plain;

    return { arg1: typeof plain };
  }
}

@Controller('/decorated')
class DecoratedController extends BaseController {
  @Get('/none')
  none(): { ok: boolean } {
    return { ok: true };
  }

  @Get('/all/:id')
  all(@Param('id') id: string, @Query('q') q: string, @Req() req: Request): { id: string; q: string; url: string } {
    return { id, q, url: req.url };
  }

  /** `Function.length` stops at the defaulted parameter, so nothing after it is counted. */
  @Get('/defaulted')
  defaulted(@Query('q') q = 'fallback'): { q: string } {
    return { q };
  }
}

@Module({ controllers: [UndecoratedController] })
class UndecoratedModule {}

@Module({ controllers: [DecoratedController] })
class DecoratedModule {}

describe('undecorated handler parameters are reported at startup', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let warnings: string[];

  function boot(moduleClass: Function): OneBunApplication {
    const created = new OneBunApplication(moduleClass as new () => object, {
      port: 0,
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });

    const capturing: SyncLogger = {
      ...createMockSyncLogger(),
      warn(message: string) {
        warnings.push(message);
      },
      child: () => capturing,
    };
    (created as unknown as { logger: SyncLogger }).logger = capturing;

    return created;
  }

  beforeEach(() => {
    warnings = [];
  });

  afterEach(async () => {
    await app?.stop();
  });

  test('should name the handler and the index on both dispatch arms', async () => {
    app = boot(UndecoratedModule);
    await app.start();

    const fastWarning = warnings.find((line) => line.includes('UndecoratedController.fast'));
    const fullWarning = warnings.find((line) => line.includes('UndecoratedController.full'));

    expect(fastWarning).toBeDefined();
    expect(fastWarning).toContain('parameter(s) 0');
    // The fast arm hands parameter 0 the request — and the message says why that is fragile.
    expect(fastWarning).toContain('raw request');

    expect(fullWarning).toBeDefined();
    expect(fullWarning).toContain('parameter(s) 1');
    expect(fullWarning).toContain('undefined');
  });

  test('should pin what each arm actually passes, so the split cannot drift silently', async () => {
    app = boot(UndecoratedModule);
    await app.start();

    await fetch(`${app.getHttpUrl()}/undecorated/fast`);
    await fetch(`${app.getHttpUrl()}/undecorated/full?q=hi`);

    // The defect in one line: the same undecorated parameter, two meanings.
    expect(seen.fast).toBe('object');
    expect(seen.full).toBe('undefined');
  });

  test('should say nothing about handlers whose parameters are all decorated', async () => {
    app = boot(DecoratedModule);
    await app.start();

    expect(warnings.filter((line) => line.includes('param decorator'))).toEqual([]);
  });
});

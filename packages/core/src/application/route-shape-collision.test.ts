/**
 * Two route templates that differ only by the name of a parameter describe the same URLs.
 *
 * Reported as onebun-FB-21: `@Get('/thing/:alpha')` beside `@Patch('/thing/:beta')` made the GET
 * answer 405 while the PATCH worked, and 405 actively misdirects — it says the path exists and the
 * verb is wrong, sending you to check the one thing that was right.
 *
 * The cause was not that Bun keeps one pattern per URL. Measured against raw `Bun.serve`: it tries
 * matching patterns in turn and falls through while the one it is looking at does not claim the
 * verb, so both handlers are reachable, each with its own `req.params` spelling. What broke it was
 * the 405 filler, which claimed every undeclared verb on EVERY template — so the first pattern Bun
 * tried answered for verbs the second one declared, and the search stopped before reaching them.
 * Filling per URL shape instead, on one template, restores the routing and keeps the 405.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import { type Logger, LoggerService } from '@onebun/logger';

import {
  All,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

@Controller('/differing')
class DifferingNames extends BaseController {
  @Get('/thing/:alpha')
  read(@Param('alpha') alpha: string) {
    return { via: 'GET', value: alpha };
  }

  @Patch('/thing/:beta')
  write(@Param('beta') beta: string) {
    return { via: 'PATCH', value: beta };
  }
}

@Controller('/three')
class ThreeNames extends BaseController {
  @Get('/thing/:alpha')
  read(@Param('alpha') alpha: string) {
    return { via: 'GET', value: alpha };
  }

  @Patch('/thing/:beta')
  write(@Param('beta') beta: string) {
    return { via: 'PATCH', value: beta };
  }

  @Delete('/thing/:gamma')
  remove(@Param('gamma') gamma: string) {
    return { via: 'DELETE', value: gamma };
  }
}

@Controller('/matching')
class MatchingNames extends BaseController {
  @Get('/thing/:alpha')
  read(@Param('alpha') alpha: string) {
    return { via: 'GET', value: alpha };
  }

  @Patch('/thing/:alpha')
  write(@Param('alpha') alpha: string) {
    return { via: 'PATCH', value: alpha };
  }
}

@Controller('/withall')
class CatchAllBeside extends BaseController {
  @Get('/thing/:alpha')
  read(@Param('alpha') alpha: string) {
    return { via: 'GET', value: alpha };
  }

  @All('/thing/:beta')
  everything(@Param('beta') beta: string) {
    return { via: 'ALL', value: beta };
  }
}

@Module({
  controllers: [DifferingNames, ThreeNames, MatchingNames, CatchAllBeside],
})
class RouteShapeModule {}

describe('route templates differing only by parameter name', () => {
  let app: OneBunApplication;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(RouteShapeModule, { port: 0, loggerLayer: makeMockLoggerLayer() });
    await app.start();
    base = `http://localhost:${app.getPort()}`;
  });

  afterAll(async () => {
    await app.stop();
  });

  const call = async (method: string, path: string): Promise<{
    status: number;
    allow: string | null;
    result: { via?: string; value?: string } | undefined;
  }> => {
    const response = await fetch(`${base}${path}`, { method });
    const body = await response.json() as { result?: { via?: string; value?: string } };

    return { status: response.status, allow: response.headers.get('Allow'), result: body.result };
  };

  it('should reach both handlers, each with the parameter name it declared', async () => {
    // The reported case. GET answered 405 before the fix.
    const read = await call('GET', '/differing/thing/abc');

    expect(read.status).toBe(200);
    expect(read.result).toEqual({ via: 'GET', value: 'abc' });

    const write = await call('PATCH', '/differing/thing/abc');

    expect(write.status).toBe(200);
    // `value` comes from `@Param('beta')`, so this also pins that the PATCH handler still reads
    // its OWN parameter name — collapsing the two templates into one pattern would make it
    // undefined, which is a silent wrong value rather than a loud 405.
    expect(write.result).toEqual({ via: 'PATCH', value: 'abc' });
  });

  it('should still answer 405 for a verb no template of that shape declares', async () => {
    const denied = await call('POST', '/differing/thing/abc');

    expect(denied.status).toBe(405);
  });

  it('should list the UNION of the shape\'s verbs in Allow, not one template\'s', async () => {
    const denied = await call('POST', '/differing/thing/abc');

    // Before the fix `Allow` named only the winning template's verbs, so it advertised half the
    // endpoint. HEAD is there because it is derived from GET.
    expect(denied.allow).toContain('GET');
    expect(denied.allow).toContain('PATCH');
    expect(denied.allow).toContain('HEAD');
  });

  it('should handle three templates of one shape, not just a pair', async () => {
    // A fix that special-cases two patterns passes the case above and fails here.
    expect(await call('GET', '/three/thing/abc')).toMatchObject({
      status: 200, result: { via: 'GET', value: 'abc' },
    });
    expect(await call('PATCH', '/three/thing/abc')).toMatchObject({
      status: 200, result: { via: 'PATCH', value: 'abc' },
    });
    expect(await call('DELETE', '/three/thing/abc')).toMatchObject({
      status: 200, result: { via: 'DELETE', value: 'abc' },
    });

    const denied = await call('POST', '/three/thing/abc');

    expect(denied.status).toBe(405);
    expect(denied.allow).toContain('DELETE');
  });

  it('should leave the consistent-naming control untouched', async () => {
    expect(await call('GET', '/matching/thing/abc')).toMatchObject({ status: 200 });
    expect(await call('PATCH', '/matching/thing/abc')).toMatchObject({ status: 200 });
    expect(await call('POST', '/matching/thing/abc')).toMatchObject({ status: 405 });
  });

  it('should let an @All() beside a differently-named template keep catching everything', async () => {
    // A shape carrying an `@All()` gets no 405 filler: that template is a bare function Bun routes
    // every unclaimed verb to, and a filler would shadow a real catch-all.
    expect(await call('GET', '/withall/thing/abc')).toMatchObject({
      status: 200, result: { via: 'GET', value: 'abc' },
    });
    expect(await call('POST', '/withall/thing/abc')).toMatchObject({
      status: 200, result: { via: 'ALL', value: 'abc' },
    });
  });
});

describe('the startup diagnostic', () => {
  it('should name both templates and both handlers, once', async () => {
    const warned: string[] = [];
    const noOp = Effect.succeed(undefined);
    // A recording logger rather than the silent mock: the diagnostic under test IS a log line, so
    // there is nothing else to observe it by.
    const recording: Logger = {
      trace: () => noOp,
      debug: () => noOp,
      info: () => noOp,
      warn(message: string) {
        warned.push(message);

        return noOp;
      },
      error: () => noOp,
      fatal: () => noOp,
      child: () => recording,
    };

    const app = new OneBunApplication(RouteShapeModule, {
      port: 0,
      loggerLayer: Layer.succeed(LoggerService, recording),
    });

    await app.start();
    try {
      const shadowing = warned.filter((message) => message.includes('differ only by parameter name'));

      // `/differing`, `/three` and `/withall` each carry one naming slip; `/matching` does not.
      expect(shadowing).toHaveLength(3);

      const differing = shadowing.find((message) => message.includes('/differing/thing/'));

      expect(differing).toBeDefined();
      expect(differing).toContain('DifferingNames.read()');
      expect(differing).toContain('DifferingNames.write()');
      // Reported once, not twice: every route is registered a second time with a trailing slash.
      expect(shadowing.filter((message) => message.includes('/differing/thing/'))).toHaveLength(1);
    } finally {
      await app.stop();
    }
  });
});

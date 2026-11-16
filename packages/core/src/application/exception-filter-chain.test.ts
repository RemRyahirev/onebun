/**
 * Which exception filter answers, and what declining means.
 *
 * The documentation showed `throw error; // pass to next filter`, and there was no next filter:
 * only the most specific one ran, and a filter that rethrew was answered by the DEFAULT filter —
 * so the documented way to decline was indistinguishable from a bug in a filter. Declining is a
 * return value now; a throw stays a bug.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { SyncLogger } from '@onebun/logger';
import { NotFoundError } from '@onebun/requests';

import {
  Controller,
  Get,
  Module,
  UseFilters,
} from '../decorators/decorators';
import { createExceptionFilter } from '../exception-filters/exception-filters';
import { HttpException } from '../exception-filters/http-exception';
import { Controller as BaseController } from '../module/controller';
import { createMockSyncLogger, makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const ran: string[] = [];

/** What each level does when it is consulted, set per test. */
const behaviour = {
  route: 'decline' as 'answer' | 'decline' | 'throw' | 'reject' | 'non-response',
  controller: 'decline' as 'answer' | 'decline',
  global: 'decline' as 'answer' | 'decline',
};

function levelFilter(level: 'route' | 'controller' | 'global') {
  return createExceptionFilter((): Response | undefined | Promise<Response | undefined> => {
    ran.push(level);

    const action = behaviour[level];

    if (action === 'throw') {
      throw new Error(`${level} filter is broken`);
    }

    if (action === 'reject') {
      return Promise.reject(new Error(`${level} filter rejected`));
    }

    if (action === 'non-response') {
      // What untyped code does when it returns the body instead of a Response.
      return { answeredBy: level } as unknown as Response;
    }

    if (action === 'answer') {
      return Response.json({ answeredBy: level }, { status: 418 });
    }

    return undefined;
  });
}

const globalFilter = levelFilter('global');
const controllerFilter = levelFilter('controller');
const routeFilter = levelFilter('route');

@UseFilters(controllerFilter)
@Controller('/chain')
class ChainController extends BaseController {
  @UseFilters(routeFilter)
  @Get('/boom')
  boom(): never {
    throw new Error('handler blew up');
  }

  @Get('/http-exception')
  httpException(): never {
    throw new HttpException(409, 'Conflict');
  }

  @Get('/base-error')
  baseError(): never {
    throw new NotFoundError('no such record');
  }

  /** A status `Response` rejects: the default filter cannot build its answer. */
  @Get('/unbuildable-http-exception')
  unbuildableHttpException(): never {
    throw new HttpException(999, 'Out of range');
  }

  /** A body `JSON.stringify` rejects: the default filter cannot build its answer. */
  @Get('/unbuildable-base-error')
  unbuildableBaseError(): never {
    throw new NotFoundError('no such record', { id: BigInt(7) });
  }
}

@Module({ controllers: [ChainController] })
class ChainModule {}

describe('exception filter chain', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let errors: string[];
  /** The error object handed to each `error()` call, in the same order as `errors`. */
  let errorPayloads: unknown[];
  let debugLines: string[];

  beforeEach(async () => {
    ran.length = 0;
    errors = [];
    errorPayloads = [];
    debugLines = [];
    behaviour.route = 'decline';
    behaviour.controller = 'decline';
    behaviour.global = 'decline';

    app = new OneBunApplication(ChainModule, {
      port: 0,
      host: '127.0.0.1',
      filters: [globalFilter],
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer() as never,
    });

    const capturing: SyncLogger = {
      ...createMockSyncLogger(),
      error(message: string, ...args: unknown[]) {
        errors.push(message);
        errorPayloads.push(args[0]);
      },
      debug(message: string) {
        debugLines.push(message);
      },
      child: () => capturing,
    };
    (app as unknown as { logger: SyncLogger }).logger = capturing;

    await app.start();
  });

  afterEach(async () => {
    await app.stop();
  });

  async function callBoom(): Promise<{ status: number; body: { answeredBy?: string; error?: string } }> {
    const response = await fetch(`${app.getHttpUrl()}/chain/boom`);

    return { status: response.status, body: await response.json() as { answeredBy?: string } };
  }

  test('should stop at the most specific filter that answers', async () => {
    behaviour.route = 'answer';

    const { status, body } = await callBoom();

    expect(status).toBe(418);
    expect(body.answeredBy).toBe('route');
    // The outer levels are never consulted.
    expect(ran).toEqual(['route']);
  });

  test('should hand a declined error to the next filter outwards', async () => {
    behaviour.controller = 'answer';

    const { body } = await callBoom();

    expect(body.answeredBy).toBe('controller');
    expect(ran).toEqual(['route', 'controller']);
  });

  test('should reach the global filter when both inner levels decline', async () => {
    behaviour.global = 'answer';

    const { body } = await callBoom();

    expect(body.answeredBy).toBe('global');
    expect(ran).toEqual(['route', 'controller', 'global']);
  });

  test('should fall back to the default filter when every filter declines', async () => {
    const { status, body } = await callBoom();

    expect(ran).toEqual(['route', 'controller', 'global']);
    expect(status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
  });

  test('should report a throwing filter and stop consulting the chain', async () => {
    behaviour.route = 'throw';
    behaviour.controller = 'answer';

    const { status, body } = await callBoom();

    // A filter that cannot be trusted to answer cannot be trusted to have declined either, so
    // the outer levels are skipped and the default filter answers.
    expect(ran).toEqual(['route']);
    expect(status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(errors.some((line) => line.includes('threw'))).toBe(true);
  });

  test('should log a decline at debug and a throw at error', async () => {
    await callBoom();

    expect(debugLines.filter((line) => line.includes('declined')).length).toBe(3);
    expect(errors.some((line) => line.includes('declined'))).toBe(false);
  });

  /**
   * What the chain writes at error level for an error it was handed.
   *
   * "Unhandled" means no filter of the application answered: the error is logged only on its way
   * to the framework's default filter. An error a registered filter answered is the application's
   * own control flow — a domain refusal mapped to a 404 — and is not an incident.
   */
  describe('the unhandled-error log', () => {
    const UNHANDLED_BOOM = 'Unhandled error in ChainController.boom:';

    for (const level of ['route', 'controller', 'global'] as const) {
      test(`should write no error-level line when the ${level} filter answers`, async () => {
        behaviour[level] = 'answer';

        const { status, body } = await callBoom();

        expect(status).toBe(418);
        expect(body.answeredBy).toBe(level);
        expect(errors).toEqual([]);
      });
    }

    test('should log the error once, with the error itself, when every filter declines', async () => {
      const { status } = await callBoom();

      expect(status).toBe(500);
      expect(errors).toEqual([UNHANDLED_BOOM]);
      expect(errorPayloads[0]).toBeInstanceOf(Error);
      expect((errorPayloads[0] as Error).message).toBe('handler blew up');
    });

    test('should log a throwing filter, then the error it was handed, when the default filter answers', async () => {
      behaviour.route = 'throw';

      const { status } = await callBoom();

      expect(status).toBe(500);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('threw; falling back to the default filter');
      expect((errorPayloads[0] as Error).message).toBe('route filter is broken');
      // The filter's own failure must not hide the error that reached it.
      expect(errors[1]).toBe(UNHANDLED_BOOM);
      expect((errorPayloads[1] as Error).message).toBe('handler blew up');
    });

    test('should log an async filter that rejects like one that throws', async () => {
      behaviour.route = 'reject';
      behaviour.controller = 'answer';

      const { status } = await callBoom();

      expect(ran).toEqual(['route']);
      expect(status).toBe(500);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('threw; falling back to the default filter');
      expect((errorPayloads[0] as Error).message).toBe('route filter rejected');
      expect(errors[1]).toBe(UNHANDLED_BOOM);
      expect((errorPayloads[1] as Error).message).toBe('handler blew up');
    });

    test('should log a filter that returns neither a Response nor undefined, then the error it was handed', async () => {
      behaviour.route = 'non-response';
      behaviour.controller = 'answer';

      const { status, body } = await callBoom();

      expect(ran).toEqual(['route']);
      expect(status).toBe(500);
      expect(body.error).toBe('Internal Server Error');
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('returned neither a Response nor undefined; falling back to the default filter');
      // The filter's line names the route, since the returned value says nothing about it.
      expect((errorPayloads[0] as Error).message).toBe('ChainController.boom');
      expect(errors[1]).toBe(UNHANDLED_BOOM);
      expect((errorPayloads[1] as Error).message).toBe('handler blew up');
    });

    test('should answer a plain 500 and log "Request handling error:" when the default filter cannot build its answer', async () => {
      for (const path of ['unbuildable-http-exception', 'unbuildable-base-error']) {
        errors.length = 0;
        errorPayloads.length = 0;

        const response = await fetch(`${app.getHttpUrl()}/chain/${path}`);
        const body = await response.json() as { success: boolean; error: string; code: number };

        expect(response.status).toBe(500);
        expect(body).toMatchObject({ success: false, error: 'Internal Server Error', code: 500 });
        // HttpException and OneBunBaseError are never "unhandled"; the failure is the
        // default filter's own, reported by the last-resort catch.
        expect(errors).toEqual(['Request handling error:']);
        expect(errorPayloads[0]).toBeInstanceOf(Error);
      }
    });

    test('should not log an HttpException or a OneBunBaseError the default filter answers', async () => {
      const httpException = await fetch(`${app.getHttpUrl()}/chain/http-exception`);
      const baseError = await fetch(`${app.getHttpUrl()}/chain/base-error`);

      expect(httpException.status).toBe(409);
      expect(baseError.status).toBe(404);
      expect(errors).toEqual([]);
    });
  });
});

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

import {
  Controller,
  Get,
  Module,
  UseFilters,
} from '../decorators/decorators';
import { createExceptionFilter } from '../exception-filters/exception-filters';
import { Controller as BaseController } from '../module/controller';
import { createMockSyncLogger, makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

const ran: string[] = [];

/** What each level does when it is consulted, set per test. */
const behaviour = {
  route: 'decline' as 'answer' | 'decline' | 'throw',
  controller: 'decline' as 'answer' | 'decline',
  global: 'decline' as 'answer' | 'decline',
};

function levelFilter(level: 'route' | 'controller' | 'global') {
  return createExceptionFilter((): Response | undefined => {
    ran.push(level);

    const action = behaviour[level];

    if (action === 'throw') {
      throw new Error(`${level} filter is broken`);
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
}

@Module({ controllers: [ChainController] })
class ChainModule {}

describe('exception filter chain', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let errors: string[];
  let debugLines: string[];

  beforeEach(async () => {
    ran.length = 0;
    errors = [];
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
      error(message: string) {
        errors.push(message);
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
});

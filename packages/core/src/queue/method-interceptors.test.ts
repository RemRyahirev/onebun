/**
 * Method-level `@UseInterceptors` on `@Subscribe` handlers: the same list an HTTP route gets for
 * that method, ordered global -> class -> method, and resolved through DI on the queue path.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import type { Message } from './types';
import type { Interceptor, ResolvedInterceptor } from '../types';

import { OneBunApplication } from '../application/application';
import {
  Controller,
  Get,
  getControllerInterceptors,
  getControllerMetadata,
  Module,
  UseInterceptors,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { clearGlobalServicesRegistry } from '../module/module';
import { BaseService, Service } from '../module/service';

import { InMemoryQueueAdapter } from './adapters/memory.adapter';
import { getMessageInterceptors, Subscribe } from './decorators';
import { QueueService } from './queue.service';

const calls: string[] = [];

function tag(name: string): Interceptor {
  return {
    async intercept(_ctx, next) {
      calls.push(`${name}:before`);
      const result = await next();
      calls.push(`${name}:after`);

      return result;
    },
  };
}

// Instances only: the test resolver hands them straight to the chain.
const resolve = (list: (Function | Interceptor)[]): ResolvedInterceptor[] =>
  list.map((item) => {
    const instance = item as Interceptor;

    return async (ctx, next) => await instance.intercept(ctx, next);
  });

describe('method-level @UseInterceptors on @Subscribe handlers', () => {
  let service: QueueService;

  beforeEach(async () => {
    calls.length = 0;
    service = new QueueService({ adapter: 'memory' as const });
    await service.initialize(new InMemoryQueueAdapter());
  });

  afterEach(async () => {
    await service.stop();
  });

  test('runs a method-level interceptor around the handler', async () => {
    class Consumer {
      @Subscribe('mi.method')
      @UseInterceptors(tag('method'))
      handle(_m: Message) {
        calls.push('handler');
      }
    }

    await service.start();
    await service.registerService(new Consumer(), Consumer, resolve);
    await service.publish('mi.method', {});

    expect(calls).toEqual(['method:before', 'handler', 'method:after']);
  });

  test('runs it with either decorator order', async () => {
    class Consumer {
      @UseInterceptors(tag('method'))
      @Subscribe('mi.order')
      handle(_m: Message) {
        calls.push('handler');
      }
    }

    await service.start();
    await service.registerService(new Consumer(), Consumer, resolve);
    await service.publish('mi.order', {});

    expect(calls).toEqual(['method:before', 'handler', 'method:after']);
  });

  test('runs a method-level interceptor on a @Controller-wrapped consumer', async () => {
    @Controller('/wrapped')
    class Consumer {
      @Subscribe('mi.wrapped')
      @UseInterceptors(tag('method'))
      handle(_m: Message) {
        calls.push('handler');
      }
    }

    await service.start();
    await service.registerService(new Consumer(), Consumer, resolve);
    await service.publish('mi.wrapped', {});

    expect(calls).toEqual(['method:before', 'handler', 'method:after']);
  });

  test('orders global, class, then method', async () => {
    @UseInterceptors(tag('class'))
    class Consumer {
      @Subscribe('mi.chain')
      @UseInterceptors(tag('method'))
      handle(_m: Message) {
        calls.push('handler');
      }
    }

    await service.start();
    await service.registerService(new Consumer(), Consumer, resolve, [tag('global')]);
    await service.publish('mi.chain', {});

    expect(calls).toEqual([
      'global:before',
      'class:before',
      'method:before',
      'handler',
      'method:after',
      'class:after',
      'global:after',
    ]);
  });

  test('an overriding handler has only its own method-level list, as on an HTTP route', async () => {
    const base = tag('base');
    class Base {
      @UseInterceptors(base)
      handle(_m: Message) {
        calls.push('base-handler');
      }
    }
    @Controller('/override')
    class Derived extends Base {
      @Get('/h')
      @Subscribe('mi.inherited')
      override handle(_m: Message) {
        calls.push('derived-handler');
      }
    }

    const route = getControllerMetadata(Derived)?.routes.find((r) => r.handler === 'handle');
    expect(route?.interceptors).toEqual([]);
    expect(getMessageInterceptors(Derived, 'handle')).toEqual([]);

    await service.start();
    await service.registerService(new Derived(), Derived, resolve);
    await service.publish('mi.inherited', {});

    expect(calls).toEqual(['derived-handler']);
  });

  test('an override declaring its own list gets that list on HTTP and on the queue', () => {
    const base = tag('base');
    const own = tag('own');
    class Base {
      @UseInterceptors(base)
      handle(_m: Message) {}
    }
    @Controller('/own')
    class Derived extends Base {
      @Get('/h')
      @UseInterceptors(own)
      @Subscribe('mi.own')
      override handle(_m: Message) {}
    }

    const route = getControllerMetadata(Derived)?.routes.find((r) => r.handler === 'handle');
    expect(route?.interceptors).toEqual([own]);
    expect(getMessageInterceptors(Derived, 'handle')).toEqual([own]);
  });

  test('a class-level list on a base class applies on HTTP and on the queue alike', async () => {
    @UseInterceptors(tag('base-class'))
    class Base {}
    @Controller('/classlevel')
    class Derived extends Base {
      @Subscribe('mi.baseclass')
      handle(_m: Message) {
        calls.push('handler');
      }
    }

    expect(getControllerInterceptors(Derived)).toHaveLength(1);

    await service.start();
    await service.registerService(new Derived(), Derived, resolve);
    await service.publish('mi.baseclass', {});

    expect(calls).toEqual(['base-class:before', 'handler', 'base-class:after']);
  });

  test('class-level only consumers are unchanged', async () => {
    @UseInterceptors(tag('class'))
    class Consumer {
      @Subscribe('mi.classonly')
      handle(_m: Message) {
        calls.push('handler');
      }
    }

    await service.start();
    await service.registerService(new Consumer(), Consumer, resolve);
    await service.publish('mi.classonly', {});

    expect(calls).toEqual(['class:before', 'handler', 'class:after']);
  });
});

describe('a method-level interceptor with constructor dependencies', () => {
  test('is built by the owning module and wraps the @Subscribe handler', async () => {
    const seen: string[] = [];

    @Service()
    class TrailService extends BaseService {
      record(entry: string): void {
        seen.push(entry);
      }
    }

    @Service()
    class TrailInterceptor {
      constructor(private readonly trail: TrailService) {}

      async intercept(_ctx: unknown, next: () => Promise<unknown>): Promise<unknown> {
        this.trail.record('interceptor');

        return await next();
      }
    }

    @Controller('/di-queue')
    class DiQueueController extends BaseController {
      @Subscribe('mi.di')
      @UseInterceptors(TrailInterceptor)
      async handle(): Promise<void> {
        seen.push('handler');
      }
    }

    @Module({ controllers: [DiQueueController], providers: [TrailService] })
    class DiQueueModule {}

    const app = new OneBunApplication(DiQueueModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      queue: { enabled: true, adapter: 'memory' },
    });
    await app.start();
    try {
      await (app.getQueueService() as QueueService).publish('mi.di', {});
    } finally {
      await app.stop();
      clearGlobalServicesRegistry();
    }

    expect(seen).toEqual(['interceptor', 'handler']);
  });
});

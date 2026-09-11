/**
 * Two applications in one process, two sets of metrics.
 *
 * Everything used to be written into prom-client's process-global `register`, and that broke in
 * two different ways depending on configuration.
 *
 * Same prefix (the default): the second application's `collectDefaultMetrics()` threw on the
 * duplicate name, the throw was swallowed, its `metricsService` stayed null, and `/metrics`
 * 404'd for it — while `register.setDefaultLabels()` had already run, so the FIRST application's
 * series came out stamped with the SECOND one's identity.
 *
 * Distinct prefixes, which is exactly what the multi-service page recommends: no throw, and both
 * endpoints served both services' series, all stamped with whichever started last. The prefix
 * namespaced the NAMES inside one shared registry; it bought no isolation.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Module,
  OneBunApplication,
  Service,
} from '@onebun/core';

import { Counted } from './decorators';


const USERS_LABEL = { service: 'users' };
const ORDERS_LABEL = { service: 'orders' };

@Service()
class UsersService extends BaseService {
  count(): void {
    this.metrics?.createCounter({ name: 'users_jobs_total', help: 'jobs' }).inc();
  }

  @Counted('decorated_calls_total')
  decorated(): void {
    // Body irrelevant: what matters is which application's registry the decorator records into.
  }
}

@Controller('/users')
class UsersController extends BaseController {
  constructor(private readonly users: UsersService) {
    super();
  }

  @Get('/ping')
  ping(): { ok: boolean } {
    this.users.count();
    this.users.decorated();

    return { ok: true };
  }
}

@Controller('/orders')
class OrdersController extends BaseController {
  @Get('/ping')
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
class UsersModule {}

@Module({ controllers: [OrdersController] })
class OrdersModule {}

describe('a metrics registry per application', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const started: OneBunApplication<any, any>[] = [];

  function boot(moduleClass: Function, metrics: Record<string, unknown>): OneBunApplication {
    const app = new OneBunApplication(moduleClass as new () => object, {
      port: 0,
      host: '127.0.0.1',
      tracing: { enabled: false },
      gracefulShutdown: false,
      metrics: metrics as never,
    });
    started.push(app as never);

    return app;
  }

  const scrape = async (app: OneBunApplication): Promise<string> => {
    const response = await fetch(`${app.getHttpUrl()}/metrics`);

    expect(response.status).toBe(200);

    return await response.text();
  };

  afterEach(async () => {
    await Promise.all(started.splice(0).map((app) => app.stop().catch(() => undefined)));
  });

  test('should give the second application a live metrics service on the default prefix', async () => {
    const users = boot(UsersModule, { defaultLabels: USERS_LABEL });
    const orders = boot(OrdersModule, { defaultLabels: ORDERS_LABEL });

    await users.start();
    await orders.start();

    // Before: the second construction threw "A metric with the name
    // onebun_process_cpu_user_seconds_total has already been registered", the throw was
    // swallowed, and /metrics was never registered for this application.
    await fetch(`${users.getHttpUrl()}/users/ping`);
    await fetch(`${orders.getHttpUrl()}/orders/ping`);

    const usersBody = await scrape(users);
    const ordersBody = await scrape(orders);

    expect(usersBody).toContain('route="/users/ping"');
    expect(usersBody).not.toContain('route="/orders/ping"');
    expect(ordersBody).toContain('route="/orders/ping"');
    expect(ordersBody).not.toContain('route="/users/ping"');
  });

  test('should stamp each application with its OWN default labels', async () => {
    const users = boot(UsersModule, { defaultLabels: USERS_LABEL });
    const orders = boot(OrdersModule, { defaultLabels: ORDERS_LABEL });

    await users.start();
    await orders.start();
    await fetch(`${users.getHttpUrl()}/users/ping`);

    const usersBody = await scrape(users);

    // Before: `onebun_http_requests_total{route="/users/ping",...,service="orders"}` — the
    // users service's own counter, wearing the identity of the service that started later,
    // because setDefaultLabels replaces one field on the whole registry.
    expect(usersBody).toContain('service="users"');
    expect(usersBody).not.toContain('service="orders"');
  });

  test('should keep the prefixes the multi-service page recommends apart', async () => {
    const users = boot(UsersModule, { prefix: 'users_', defaultLabels: USERS_LABEL });
    const orders = boot(OrdersModule, { prefix: 'orders_', defaultLabels: ORDERS_LABEL });

    await users.start();
    await orders.start();
    await fetch(`${users.getHttpUrl()}/users/ping`);
    await fetch(`${orders.getHttpUrl()}/orders/ping`);

    const usersBody = await scrape(users);
    const ordersBody = await scrape(orders);

    // Before: both bodies carried both prefixes. A Prometheus job scraping both targets
    // double-counted every series in the process.
    expect(usersBody).toContain('users_http_requests_total');
    expect(usersBody).not.toContain('orders_http_requests_total');
    expect(ordersBody).toContain('orders_http_requests_total');
    expect(ordersBody).not.toContain('users_http_requests_total');
  });

  test('should put a service-created custom metric in ITS application registry', async () => {
    const users = boot(UsersModule, { prefix: 'users_', defaultLabels: USERS_LABEL });
    const orders = boot(OrdersModule, { prefix: 'orders_', defaultLabels: ORDERS_LABEL });

    await users.start();
    await orders.start();
    await fetch(`${users.getHttpUrl()}/users/ping`);

    const usersBody = await scrape(users);
    const ordersBody = await scrape(orders);

    // `this.metrics` inside a service used to read one globalThis slot that the last
    // application to start owned, so a counter created in the users service was created by the
    // ORDERS service — with the orders prefix, in the orders registry.
    expect(usersBody).toContain('users_users_jobs_total');
    expect(ordersBody).not.toContain('users_jobs_total');
  });

  test('should record a decorated method into ITS application, not the last one started', async () => {
    const users = boot(UsersModule, { prefix: 'users_', defaultLabels: USERS_LABEL });
    const orders = boot(OrdersModule, { prefix: 'orders_', defaultLabels: ORDERS_LABEL });

    // Order matters: `orders` starts LAST and therefore owns the process-wide slot that the
    // decorators used to read.
    await users.start();
    await orders.start();
    await fetch(`${users.getHttpUrl()}/users/ping`);

    const usersBody = await scrape(users);
    const ordersBody = await scrape(orders);

    // Before: `orders_decorated_calls_total{service="orders"}` — wrong prefix, wrong identity,
    // wrong endpoint, and CREATED in the orders registry, so that application permanently owned
    // a series describing work it never did.
    expect(usersBody).toContain('users_decorated_calls_total');
    expect(usersBody).toContain('service="users"');
    expect(ordersBody).not.toContain('decorated_calls_total');
  });

  test('should release the registry and the process slot when the application stops', async () => {
    const users = boot(UsersModule, { prefix: 'released_' });

    await users.start();
    await fetch(`${users.getHttpUrl()}/users/ping`);

    const service = (users as unknown as { metricsService: { getMetrics(): Promise<string> } }).metricsService;

    expect(await service.getMetrics()).toContain('released_http_requests_total');

    await users.stop();

    // Nothing used to clear either one: a stopped application kept a live registry and kept
    // owning the process-wide slot, so every code path with no application handle went on
    // writing into a service nobody would ever scrape.
    // An emptied registry still renders its trailing newline, so trim rather than compare to ''.
    expect((await service.getMetrics()).trim()).toBe('');
    expect((globalThis as Record<string, unknown>).__onebunMetricsService).toBeUndefined();
  });
});

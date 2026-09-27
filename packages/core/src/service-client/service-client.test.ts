import {
  describe,
  expect,
  test,
  mock,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  type Mock,
} from 'bun:test';
import { Effect } from 'effect';

import { verifyOneBunRequest } from '@onebun/requests';

import { OneBunApplication } from '../application/application';
import {
  Controller,
  Get,
  Module,
  Param,
  Post,
  Body,
  Query,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';
import { HttpMethod } from '../types';

import { createServiceClient, getServiceUrl } from './service-client';
import { createServiceDefinition } from './service-definition';

// Test controller with various parameter types
@Controller('/users')
class UsersController {
  @Get('/')
  getAll() {
    return [];
  }

  @Get('/:id')
  getById(@Param('id') _id: string) {
    return {};
  }

  @Post('/')
  create(@Body() _body: unknown) {
    return {};
  }

  @Get('/search')
  search(@Query('q') _query: string) {
    return [];
  }
}

@Module({
  controllers: [UsersController],
})
class UsersModule {}

// Create definition for tests
const usersDefinition = createServiceDefinition(UsersModule);

describe('createServiceClient', () => {
  describe('client creation', () => {
    test('should create client with required options', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      expect(client).toBeDefined();
    });

    test('should create client with all options', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
        timeout: 5000,
        retries: { max: 3, delay: 100, backoff: 'exponential' },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'X-Custom': 'value' },
        serviceName: 'users',
      });

      expect(client).toBeDefined();
    });
  });

  describe('controller access', () => {
    test('should provide access to controller by name', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      // Access the UsersController
      const usersController = client['UsersController'];
      expect(usersController).toBeDefined();
    });

    test('should throw for non-existent controller', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      expect(() => client['NonExistentController']).toThrow(
        'Controller "NonExistentController" not found',
      );
    });
  });

  describe('method access', () => {
    test('should provide access to controller methods', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      const usersController = client['UsersController'];
      expect(typeof usersController.getAll).toBe('function');
      expect(typeof usersController.getById).toBe('function');
      expect(typeof usersController.create).toBe('function');
    });

    test('should throw for non-existent method', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      const usersController = client['UsersController'];
      expect(() => usersController['nonExistentMethod']).toThrow(
        'Method "nonExistentMethod" not found',
      );
    });
  });

  describe('request building', () => {
    // Mock fetch for request testing
    let originalFetch: typeof fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, result: {} }), {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('should build correct URL for path params', async () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      await client['UsersController'].getById('123');

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('/users/123');
    });

    test('should use correct HTTP method', async () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      await client['UsersController'].create({ name: 'Test' });

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].method).toBe(HttpMethod.POST);
    });

    test('should send body for POST requests', async () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      const body = { name: 'Test User' };
      await client['UsersController'].create(body);

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBe(JSON.stringify(body));
    });
  });
});

/*
 * Path parameter values against a real server (onebun-FB-32).
 *
 * The value used to be pasted into the template unencoded with `String.prototype.replace`, so
 * `'../admin/secret'` made `Items.detail` read `Admin.secret`, and `'../admin/purge?'` made a POST
 * land on `Admin.purge`, with whatever auth the client carries. 0.8.2 refused such values; since
 * 0.9.0 the client percent-encodes every value, so they reach the declared handler as data. The
 * server's own view is what matters here, so every handler records what it was called with.
 */
describe('path parameter values', () => {
  const hits: string[] = [];

  @Controller('/items')
  class Items extends BaseController {
    @Get('/')
    list() {
      hits.push('Items.list');

      return [];
    }

    @Get('/:id')
    detail(@Param('id') id: string) {
      hits.push(`Items.detail ${JSON.stringify(id)}`);

      return { id };
    }

    @Post('/:id/comment')
    comment(@Param('id') id: string, @Body() _body: unknown) {
      hits.push(`Items.comment ${JSON.stringify(id)}`);

      return { id };
    }
  }

  @Controller('/pairs')
  class Pairs extends BaseController {
    // The parameters are declared in the opposite order to the template on purpose.
    @Get('/:idx/:id')
    pair(@Param('id') id: string, @Param('idx') idx: string) {
      hits.push(`Pairs.pair id=${id} idx=${idx}`);

      return { id, idx };
    }
  }

  @Controller('/admin')
  class Admin extends BaseController {
    @Get('/secret')
    secret() {
      hits.push('Admin.secret');

      return { secret: 'S3CR3T' };
    }

    @Post('/purge')
    purge() {
      hits.push('Admin.purge');

      return { purged: true };
    }
  }

  @Module({ controllers: [Items, Pairs, Admin] })
  class ApiModule {}

  let app: OneBunApplication;
  let client: ReturnType<typeof createServiceClient>;
  let originalFetch: typeof fetch;
  let fetchSpy: Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;

  beforeAll(async () => {
    app = new OneBunApplication(ApiModule, { port: 0, loggerLayer: makeMockLoggerLayer() });
    await app.start();
    client = createServiceClient(createServiceDefinition(ApiModule), {
      url: `http://127.0.0.1:${app.getPort()}`,
      retries: { max: 0, delay: 0 },
    });
  });

  afterAll(async () => {
    await app.stop();
  });

  beforeEach(() => {
    hits.length = 0;
    originalFetch = globalThis.fetch;
    const realFetch = originalFetch;
    fetchSpy = mock(async (input: string | URL | Request, init?: RequestInit) => await realFetch(input, init));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const wirePaths = (): string[] => fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname);

  const rejectionOf = async (call: Promise<unknown>): Promise<Error> => {
    const outcome = await call.then(() => undefined, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);

    return outcome as Error;
  };

  test.each([
    ['folder/route?revision=other#section', 'folder/route?revision=other#section'],
    ['100%', '100%'],
    ['a b', 'a b'],
    ['$&x', '$&x'],
    ['a\\b', 'a\\b'],
    // Each of these reached another route in 0.8.1 and was refused in 0.8.2. Encoded, every one
    // of them is one segment of the declared route.
    ['../admin/secret', '../admin/secret'],
    ['a\\..\\admin', 'a\\..\\admin'],
    ['x/y', 'x/y'],
    ['x?y', 'x?y'],
    ['x#y', 'x#y'],
    // `%` is encoded too, so a URL parser never sees `%2e`: these arrive as the text they are.
    ['%2e%2e', '%2e%2e'],
    ['.%2E', '.%2E'],
    ['%2E.', '%2E.'],
    ['%2e', '%2e'],
    // Tabs, newlines and spaces are encoded, so the parser has nothing to delete or trim.
    ['.\t.', '.\t.'],
    ['.\n%2e', '.\n%2e'],
    ['.. ', '.. '],
    ['...', '...'],
    ['user@example.com', 'user@example.com'],
    ['é 😀', 'é 😀'],
    ['123', '123'],
    // The value is sent as its text, whatever its type.
    [42, '42'],
    [['../admin/secret'], '../admin/secret'],
  ])('sends %p encoded, and the handler of the declared route receives it unchanged', async (value, received) => {
    await client.Items.detail(value);

    expect(wirePaths()).toEqual([`/items/${encodeURIComponent(received)}`]);
    expect(hits).toEqual([`Items.detail ${JSON.stringify(received)}`]);
  });

  test('delivers a value the caller encoded first still encoded, because the client encodes it again', async () => {
    // Through 0.8.2 the client sent values as they were, so callers encoded them and the handler
    // received 'a/b'. Now the '%' is encoded too.
    await client.Items.detail('a%2Fb');
    await client.Items.detail(encodeURIComponent('folder/route?revision=other#section'));

    expect(wirePaths()).toEqual(['/items/a%252Fb', '/items/folder%252Froute%253Frevision%253Dother%2523section']);
    expect(hits).toEqual([
      `Items.detail ${JSON.stringify('a%2Fb')}`,
      `Items.detail ${JSON.stringify('folder%2Froute%3Frevision%3Dother%23section')}`,
    ]);
  });

  test('sends a POST whose value names another controller to the declared route, as data', async () => {
    await client.Items.comment('../admin/purge?', { text: 'hi' });

    expect(wirePaths()).toEqual(['/items/..%2Fadmin%2Fpurge%3F/comment']);
    expect(hits).toEqual([`Items.comment ${JSON.stringify('../admin/purge?')}`]);
  });

  test.each([
    ['..', 'is the dot segment ".."'],
    ['.', 'is the dot segment "."'],
    ['', 'is empty'],
    [null, 'is null'],
    [undefined, 'is undefined'],
    // An unpaired surrogate has no UTF-8 encoding. Sent as is, the URL parser replaced it with U+FFFD.
    ['a\uD800b', 'contains an unpaired UTF-16 surrogate'],
  ])('refuses %p before any request, naming the call and the parameter', async (value, problem) => {
    const error = await rejectionOf(client.Items.detail(value));

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toStartWith(`Items.detail: path parameter "id" ${problem}`);
    expect(error.message).toEndWith('Nothing was sent.');
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(hits).toEqual([]);
  });

  test('refuses a dot segment in a POST before any request', async () => {
    const error = await rejectionOf(client.Items.comment('..', { text: 'hi' }));

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('Items.comment');
    expect(error.message).toContain('"id"');
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(hits).toEqual([]);
  });

  test('substitutes each :param by its exact token, not by prefix', async () => {
    await client.Pairs.pair('D', 'I');

    // 0.8.1 replaced the first `:id` it found, which was inside `:idx`: `/pairs/Dx/:id`.
    expect(wirePaths()).toEqual(['/pairs/I/D']);
    expect(hits).toEqual(['Pairs.pair id=D idx=I']);
  });

  test('encodes each value of a multi-parameter route on its own', async () => {
    await client.Pairs.pair('a/b', 'c?d');

    expect(wirePaths()).toEqual(['/pairs/c%3Fd/a%2Fb']);
    expect(hits).toEqual(['Pairs.pair id=a/b idx=c?d']);
  });

  test('signs the encoded path, and the callee verifies it from the URL it received', async () => {
    const value = 'a/b?c#d %2e 100% é';
    const verified: Array<{ valid: boolean; path: string }> = [];
    const signed = Bun.serve({
      port: 0,
      async fetch(request) {
        const result = await Effect.runPromise(verifyOneBunRequest(
          {
            method: request.method, url: request.url, headers: request.headers, body: await request.text(),
          },
          { secret: 'shared-secret', audience: false, nonceStore: false },
        ));
        verified.push({ valid: result.valid, path: new URL(request.url).pathname });

        return Response.json({ success: true, result: {} });
      },
    });

    try {
      const signingClient = createServiceClient(createServiceDefinition(ApiModule), {
        url: `http://127.0.0.1:${signed.port}`,
        retries: { max: 0, delay: 0 },
        auth: { type: 'onebun', serviceId: 'orders-service', secretKey: 'shared-secret' },
      });

      await signingClient.Items.detail(value);

      expect(verified).toEqual([{ valid: true, path: `/items/${encodeURIComponent(value)}` }]);
    } finally {
      signed.stop(true);
    }
  });

  /*
   * 0.8.2 trimmed trailing C0 controls and spaces from the value for its dot-segment check. The
   * first cut did that with an end-anchored regex, which a backtracking engine retries from every
   * position of a run that does not reach the end: 100 000 spaces before an `x` held the event loop
   * for about 4 s. The value is still caller input, so building the path has to stay linear. The
   * fetch stub answers without the server, so only the client's own work is timed; the budget is
   * far above linear and far below 4 s.
   */
  const LONG_RUN = 100_000;
  const BUILD_BUDGET_MS = 100;

  test.each([
    ['spaces before its end', `${' '.repeat(LONG_RUN)}x`],
    ['C0 controls before its end', `${String.fromCharCode(1).repeat(LONG_RUN)}x`],
    ['spaces after a dot segment', `..${' '.repeat(LONG_RUN)}`],
  ])('encodes a value with a long run of %s in linear time, then sends it', async (_label, value) => {
    let reachedFetchAt = Number.NaN;
    fetchSpy.mockImplementation(async () => {
      reachedFetchAt = performance.now();

      return Response.json({ success: true, result: {} });
    });

    const calledAt = performance.now();
    await client.Items.detail(value);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(reachedFetchAt - calledAt).toBeLessThan(BUILD_BUDGET_MS);
    expect(wirePaths()).toEqual([`/items/${encodeURIComponent(value)}`]);
  });
});

/*
 * The client as a value (onebun-FB-32).
 *
 * Both proxy levels used to throw for every name that was not a controller or a method, including
 * the ones JavaScript reads on its own: `then` when a promise settles with the value, `toJSON` in
 * JSON.stringify, `Symbol.toPrimitive` in String(). So an async factory returning the client
 * rejected with 'Controller "then" not found'.
 */
describe('the client as a value', () => {
  const options = { url: 'http://localhost:3001' };

  test('await Promise.resolve(client) resolves to the client itself', async () => {
    const client = createServiceClient(usersDefinition, options);

    expect(await Promise.resolve(client)).toBe(client);
  });

  test('an async factory that returns the client resolves, and the resolved client still calls', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = mock(() => Promise.resolve(Response.json({ success: true, result: {} })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const client = await (async () => createServiceClient(usersDefinition, options))();
      await client.UsersController.getById('7');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('http://localhost:3001/users/7');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a controller client resolves as well', async () => {
    const controller = createServiceClient(usersDefinition, options).UsersController;

    expect(await Promise.resolve(controller)).toBe(controller);
  });

  test('then and toJSON read as undefined at both levels', () => {
    const client = createServiceClient(usersDefinition, options);
    const controller = client.UsersController;

    expect(client.then).toBeUndefined();
    expect(client.toJSON).toBeUndefined();
    expect(controller.then).toBeUndefined();
    expect(controller.toJSON).toBeUndefined();
  });

  test('symbol keys read as undefined at both levels', () => {
    const client = createServiceClient(usersDefinition, options);
    const controller = client.UsersController;

    for (const symbol of [Symbol.toPrimitive, Symbol.iterator, Symbol.asyncIterator, Symbol.toStringTag]) {
      expect(Reflect.get(client, symbol)).toBeUndefined();
      expect(Reflect.get(controller, symbol)).toBeUndefined();
    }
  });

  test('JSON.stringify, String and a template literal do not throw', () => {
    const client = createServiceClient(usersDefinition, options);
    const controller = client.UsersController;

    expect(JSON.stringify(client)).toBe('{}');
    expect(JSON.stringify(controller)).toBe('{}');
    expect(JSON.stringify({ client })).toBe('{"client":{}}');
    expect(String(client)).toBe('[object Object]');
    expect(String(controller)).toBe('[object Object]');
    expect(`${client}`).toBe('[object Object]');
    expect(Bun.inspect(client)).toBe('{}');
  });

  test('inherited Object.prototype members read as on a plain object', () => {
    const client = createServiceClient(usersDefinition, options);

    expect(client.constructor).toBe(Object);
    expect(client.hasOwnProperty('UsersController')).toBe(false);
    expect(Object.getPrototypeOf(client)).toBe(Object.prototype);
  });

  test('`in` is true for declared names and false for the rest', () => {
    const client = createServiceClient(usersDefinition, options);
    const controller = client.UsersController;

    expect('UsersController' in client).toBe(true);
    expect('Nope' in client).toBe(false);
    expect('then' in client).toBe(false);
    expect('toJSON' in client).toBe(false);
    expect(Symbol.iterator in client).toBe(false);

    expect('getById' in controller).toBe(true);
    expect('nope' in controller).toBe(false);
    expect('then' in controller).toBe(false);
  });

  test('an unknown controller or method name still throws its error', () => {
    const client = createServiceClient(usersDefinition, options);

    expect(() => client.Nope).toThrow(
      'Controller "Nope" not found in service definition. Available controllers: UsersController',
    );
    expect(() => client.UsersController.nope).toThrow('Method "nope" not found in controller "UsersController"');
  });

  test('a declared name wins over an inherited member of the same name', async () => {
    @Controller('/labels')
    class LabelsController {
      @Get('/as-text')
      toString() {
        return 'label';
      }
    }

    @Module({ controllers: [LabelsController] })
    class LabelsModule {}

    const originalFetch = globalThis.fetch;
    const fetchSpy = mock(() => Promise.resolve(Response.json({ success: true, result: 'label' })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const controller = createServiceClient(createServiceDefinition(LabelsModule), options).LabelsController;
      await controller.toString();

      expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('http://localhost:3001/labels/as-text');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('getServiceUrl', () => {
  test('should call getServiceUrl on app instance', () => {
    const mockApp = {
      getServiceUrl: mock((name: string | number | symbol) => `http://${String(name)}:3000`),
    };

    const url = getServiceUrl(mockApp, 'users');

    expect(mockApp.getServiceUrl).toHaveBeenCalledWith('users');
    expect(url).toBe('http://users:3000');
  });
});

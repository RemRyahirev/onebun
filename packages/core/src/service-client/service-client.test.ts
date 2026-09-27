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
  Cookie,
  createHttpParamDecorator,
  FormField,
  Get,
  Header,
  Module,
  Param,
  Post,
  Put,
  Body,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
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
 * Which arguments a generated call takes (onebun-FB-32, WI-379).
 *
 * Through 0.8 the client walked EVERY decorated parameter against `args[i]`, so a parameter the
 * client never sends (`@Header`, `@Cookie`, `@Req`, `@Res`, a custom extractor, a file or a form
 * field) still consumed an argument. Declared before a `@Query` or a `@Body`, it shifted them:
 * `(@Header a, @Query q)` called as `m('hello')` sent no query at all, and `(@Header a, @Body b)`
 * called as `m({ x: 1 })` sent a POST with no body. Since 0.9 only `@Param`, `@Query` and `@Body`
 * take arguments, one each, in the order the handler declares them.
 */
describe('argument mapping', () => {
  const received: unknown[] = [];

  /** A view over the SERVER's request: there is nothing for a caller to pass. */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const FromServer = createHttpParamDecorator(() => 'from-extractor');

  @Controller('/mixed')
  class Mixed extends BaseController {
    @Get('/header-query')
    headerThenQuery(@Header('x-a') a: string | null, @Query('q') q?: string) {
      received.push({ a, q: q ?? null });

      return {};
    }

    @Post('/header-body')
    headerThenBody(@Header('x-a') a: string | null, @Body() body: unknown) {
      received.push({ a, body: body ?? null });

      return {};
    }

    @Get('/header-path/:id')
    headerThenPath(@Header('x-a') a: string | null, @Param('id') id: string) {
      received.push({ a, id });

      return {};
    }

    @Get('/custom-query')
    customThenQuery(@FromServer() fromServer: string, @Query('q') q?: string) {
      received.push({ fromServer, q: q ?? null });

      return {};
    }

    @Post('/custom-body')
    customThenBody(@FromServer() fromServer: string, @Body() body: unknown) {
      received.push({ fromServer, body: body ?? null });

      return {};
    }

    @Put('/all/:id')
    everything(
      @Req() _req: unknown,
      @Param('id') id: string,
      @Header('x-a') a: string | null,
      @Query('q') q: string | undefined,
      @Cookie('c') c: string | undefined,
      @FromServer() fromServer: string,
      @Body() body: unknown,
    ) {
      received.push({
        id, a, q: q ?? null, c: c ?? null, fromServer, body: body ?? null,
      });

      return {};
    }

    // The second parameter has no decorator: it is not in the route metadata at all, so it never
    // took an argument, in 0.8 either.
    @Get('/gap/:id')
    gap(@Param('id') id: string, _undecorated: unknown, @Query('q') q?: string) {
      received.push({ id, q: q ?? null });

      return {};
    }
  }

  @Module({ controllers: [Mixed] })
  class MixedModule {}

  let app: OneBunApplication;
  let client: ReturnType<typeof createServiceClient>;
  let originalFetch: typeof fetch;
  let fetchSpy: Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;

  beforeAll(async () => {
    app = new OneBunApplication(MixedModule, { port: 0, loggerLayer: makeMockLoggerLayer() });
    await app.start();
    client = createServiceClient(createServiceDefinition(MixedModule), {
      url: `http://127.0.0.1:${app.getPort()}`,
      retries: { max: 0, delay: 0 },
    });
  });

  afterAll(async () => {
    await app.stop();
  });

  beforeEach(() => {
    received.length = 0;
    originalFetch = globalThis.fetch;
    const realFetch = originalFetch;
    fetchSpy = mock(async (input: string | URL | Request, init?: RequestInit) => await realFetch(input, init));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** What went over the wire: method, path with query string, and body. */
  const wire = (): string[] => fetchSpy.mock.calls.map(([input, init]) => {
    const url = new URL(String(input));

    return `${init?.method} ${url.pathname}${url.search} ${init?.body ?? '-'}`;
  });

  test('a @Header before a @Query takes no argument: the query carries the value the caller passed', async () => {
    await client.Mixed.headerThenQuery('hello');

    // 0.8: 'hello' went to the header's slot and was dropped, so `GET /mixed/header-query -`.
    expect(wire()).toEqual(['GET /mixed/header-query?q=hello -']);
    expect(received).toEqual([{ a: null, q: 'hello' }]);
  });

  test('a @Header before a @Body takes no argument: the body arrives', async () => {
    await client.Mixed.headerThenBody({ x: 1 });

    // 0.8: a POST with no body, and the handler received `undefined`.
    expect(wire()).toEqual(['POST /mixed/header-body {"x":1}']);
    expect(received).toEqual([{ a: null, body: { x: 1 } }]);
  });

  test('a @Header before a @Param takes no argument: the path value is the first argument', async () => {
    await client.Mixed.headerThenPath('123');

    // 0.8: '123' went to the header's slot, `id` read `undefined`, and the call was refused.
    expect(wire()).toEqual(['GET /mixed/header-path/123 -']);
    expect(received).toEqual([{ a: null, id: '123' }]);
  });

  test('a createHttpParamDecorator parameter before a @Query takes no argument', async () => {
    await client.Mixed.customThenQuery('hello');

    expect(wire()).toEqual(['GET /mixed/custom-query?q=hello -']);
    expect(received).toEqual([{ fromServer: 'from-extractor', q: 'hello' }]);
  });

  test('a createHttpParamDecorator parameter before a @Body takes no argument', async () => {
    await client.Mixed.customThenBody({ x: 1 });

    expect(wire()).toEqual(['POST /mixed/custom-body {"x":1}']);
    expect(received).toEqual([{ fromServer: 'from-extractor', body: { x: 1 } }]);
  });

  test('with server-only parameters between them, @Param, @Query and @Body take the arguments in order', async () => {
    await client.Mixed.everything('7', 'hello', { x: 1 });

    expect(wire()).toEqual(['PUT /mixed/all/7?q=hello {"x":1}']);
    expect(received).toEqual([{
      id: '7', a: null, q: 'hello', c: null, fromServer: 'from-extractor', body: { x: 1 },
    }]);
  });

  test('an undecorated parameter takes no argument, as in 0.8', async () => {
    await client.Mixed.gap('7', 'hello');

    expect(wire()).toEqual(['GET /mixed/gap/7?q=hello -']);
    expect(received).toEqual([{ id: '7', q: 'hello' }]);
  });

  /*
   * The 0.8 workaround was a placeholder in the server-only parameter's slot. It is now the first
   * client argument, and the real value is an extra one, which is dropped.
   */
  test('a placeholder for a server-only parameter is now read as the first client argument', async () => {
    await client.Mixed.headerThenQuery(undefined, 'hello');
    await client.Mixed.headerThenQuery('acme', 'hello');
    await client.Mixed.headerThenBody(undefined, { x: 1 });

    expect(wire()).toEqual([
      'GET /mixed/header-query -',
      'GET /mixed/header-query?q=acme -',
      'POST /mixed/header-body -',
    ]);
    expect(received).toEqual([
      { a: null, q: null },
      { a: null, q: 'acme' },
      { a: null, body: null },
    ]);

    // For a path value the placeholder is refused, since `undefined` cannot be sent in a path.
    await expect(client.Mixed.headerThenPath(undefined, '123')).rejects.toThrow(
      'Mixed.headerThenPath: path parameter "id" is undefined',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  test('file, form-field and @Res parameters take no argument either', async () => {
    @Controller('/uploads')
    class Uploads {
      @Put('/:id')
      replace(
        @UploadedFile('avatar', { required: false }) _avatar: unknown,
        @Param('id') _id: string,
        @UploadedFiles('docs', { required: false }) _docs: unknown,
        @Query('q') _q: string,
        @FormField('name') _name: unknown,
        @Res() _res: unknown,
        @Body() _body: unknown,
      ) {
        return {};
      }
    }

    @Module({ controllers: [Uploads] })
    class UploadsModule {}

    fetchSpy.mockImplementation(async () => Response.json({ success: true, result: {} }));
    const uploads = createServiceClient(createServiceDefinition(UploadsModule), {
      url: 'http://127.0.0.1:1',
      retries: { max: 0, delay: 0 },
    });

    await uploads.Uploads.replace('7', 'hello', { x: 1 });

    expect(wire()).toEqual(['PUT /uploads/7?q=hello {"x":1}']);
  });
});

/*
 * Query and body values against a real server (onebun-FB-32, WI-401).
 *
 * Through 0.8 the client handed both to the HTTP client as they were. Its query builder appends
 * `String(value)` once per key, so `['a', 'b']` went out as `tags=a%2Cb` and the handler received
 * `'a,b'`. Its body serializer sends a string as it is and skips a falsy value, so `'hello'` went
 * out as the bare text `hello` (the server's `req.json()` failed and the handler received
 * `undefined`), and `0`, `false`, `''` and `null` sent no body at all.
 */
describe('query and body values', () => {
  /** What a handler records for a parameter that received `undefined`. */
  const ABSENT = '<absent>';
  const received: unknown[] = [];

  @Controller('/values')
  class Values extends BaseController {
    @Get('/tags')
    tags(@Query('tags') tags?: unknown, @Query('q') q?: unknown) {
      received.push({ tags: tags === undefined ? ABSENT : tags, q: q === undefined ? ABSENT : q });

      return {};
    }

    @Post('/echo')
    echo(@Body() body: unknown) {
      received.push({ body: body === undefined ? ABSENT : body, type: typeof body });

      return {};
    }

    @Put('/both/:id')
    both(@Param('id') id: string, @Query('tags') tags: unknown, @Body() body: unknown) {
      received.push({ id, tags, body });

      return {};
    }

    @Get('/peek')
    peek(@Body() body: unknown) {
      received.push({ body: body === undefined ? ABSENT : body });

      return {};
    }
  }

  @Module({ controllers: [Values] })
  class ValuesModule {}

  const definition = createServiceDefinition(ValuesModule);

  let app: OneBunApplication;
  let client: ReturnType<typeof createServiceClient>;
  let originalFetch: typeof fetch;
  let fetchSpy: Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;

  beforeAll(async () => {
    app = new OneBunApplication(ValuesModule, { port: 0, loggerLayer: makeMockLoggerLayer() });
    await app.start();
    client = createServiceClient(definition, {
      url: `http://127.0.0.1:${app.getPort()}`,
      retries: { max: 0, delay: 0 },
    });
  });

  afterAll(async () => {
    await app.stop();
  });

  beforeEach(() => {
    received.length = 0;
    originalFetch = globalThis.fetch;
    const realFetch = originalFetch;
    fetchSpy = mock(async (input: string | URL | Request, init?: RequestInit) => await realFetch(input, init));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** What went over the wire: method, path with query string, and body. */
  const wire = (): string[] => fetchSpy.mock.calls.map(([input, init]) => {
    const url = new URL(String(input));

    return `${init?.method} ${url.pathname}${url.search} ${init?.body ?? '-'}`;
  });

  const rejectionOf = async (call: Promise<unknown>): Promise<Error> => {
    const outcome = await call.then(() => undefined, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);

    return outcome as Error;
  };

  test('an array reaches @Query as the same array', async () => {
    await client.Values.tags(['a', 'b']);

    // 0.8: `GET /values/tags?tags=a%2Cb`, and the handler received 'a,b'.
    expect(wire()).toEqual(['GET /values/tags?tags%5B%5D=a&tags%5B%5D=b -']);
    expect(received).toEqual([{ tags: ['a', 'b'], q: ABSENT }]);
  });

  test('a one-element array stays an array: each element is sent under `name[]`', async () => {
    await client.Values.tags(['a']);

    // Sent as a plain repeated `tags=a`, it would arrive as the string 'a'.
    expect(wire()).toEqual(['GET /values/tags?tags%5B%5D=a -']);
    expect(received).toEqual([{ tags: ['a'], q: ABSENT }]);
  });

  test('elements with URL syntax in them arrive unchanged', async () => {
    const tags = ['a,b', 'c&tags=d', 'e f', '100%', 'x#y', 'é'];
    await client.Values.tags(tags);

    expect(received).toEqual([{ tags, q: ABSENT }]);
  });

  test('an empty array sends no value, like undefined', async () => {
    await client.Values.tags([]);

    expect(wire()).toEqual(['GET /values/tags -']);
    expect(received).toEqual([{ tags: ABSENT, q: ABSENT }]);
  });

  test('null and undefined elements are left out, and the others are sent as text', async () => {
    await client.Values.tags(['a', null, undefined, 1, true]);

    expect(received).toEqual([{ tags: ['a', '1', 'true'], q: ABSENT }]);
  });

  test('a single value is sent as before: one key, as text', async () => {
    await client.Values.tags('a,b', 'hello world');
    await client.Values.tags(42, false);
    await client.Values.tags(null, undefined);

    expect(wire()).toEqual([
      'GET /values/tags?tags=a%2Cb&q=hello+world -',
      'GET /values/tags?tags=42&q=false -',
      'GET /values/tags -',
    ]);
    expect(received).toEqual([
      { tags: 'a,b', q: 'hello world' },
      { tags: '42', q: 'false' },
      { tags: ABSENT, q: ABSENT },
    ]);
  });

  test.each([
    ['a string', 'hello', '"hello"'],
    ['text that is itself JSON', '{"x":1}', '"{\\"x\\":1}"'],
    ['0', 0, '0'],
    ['false', false, 'false'],
    ['the empty string', '', '""'],
    ['null', null, 'null'],
    ['an object', { x: 1, nested: { y: [1, 'a'] } }, '{"x":1,"nested":{"y":[1,"a"]}}'],
    ['an array', [1, 'a', null], '[1,"a",null]'],
    ['a number', 1.5, '1.5'],
  ])('%s reaches @Body unchanged, sent as JSON', async (_label, value, json) => {
    await client.Values.echo(value);

    // 0.8: a string was sent as it was, and 0, false, '' and null sent no body at all.
    expect(wire()).toEqual([`POST /values/echo ${json}`]);
    expect(received).toEqual([{ body: value, type: typeof value }]);
  });

  test('the body is sent with Content-Type application/json', async () => {
    await client.Values.echo('hello');

    const [, init] = fetchSpy.mock.calls[0];
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  test('undefined sends no body', async () => {
    await client.Values.echo(undefined);
    await client.Values.echo();

    expect(wire()).toEqual(['POST /values/echo -', 'POST /values/echo -']);
    expect(received).toEqual([{ body: ABSENT, type: 'undefined' }, { body: ABSENT, type: 'undefined' }]);
  });

  test('path, array query and primitive body in one call each arrive unchanged', async () => {
    await client.Values.both('7', ['a'], 'hello');

    expect(wire()).toEqual(['PUT /values/both/7?tags%5B%5D=a "hello"']);
    expect(received).toEqual([{ id: '7', tags: ['a'], body: 'hello' }]);
  });

  test.each([
    ['a BigInt', (): unknown => 10n],
    ['a cyclic object', (): unknown => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      return cyclic;
    }],
  ])('%s as the body is refused with a TypeError naming the call, and nothing is sent', async (_label, make) => {
    const error = await rejectionOf(client.Values.echo(make()));

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toStartWith('Values.echo: the @Body value cannot be sent as JSON');
    expect(error.message).toEndWith('Nothing was sent.');
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each([
    ['a BigInt', (): unknown => 10n],
    ['a cyclic object', (): unknown => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      return cyclic;
    }],
    ['a string', (): unknown => 'hello'],
  ])('%s as the @Body of a GET is not serialized: no body is sent, and the call succeeds', async (_label, make) => {
    await client.Values.peek(make());

    // The HTTP client sends no body with a GET, so a value JSON cannot represent must not fail it.
    expect(wire()).toEqual(['GET /values/peek -']);
    expect(received).toEqual([{ body: ABSENT }]);
  });

  test('a custom auth interceptor sees what is sent: the query in config.url, the body as JSON text', async () => {
    const seen: unknown[] = [];
    const intercepted = createServiceClient(definition, {
      url: `http://127.0.0.1:${app.getPort()}`,
      retries: { max: 0, delay: 0 },
      auth: {
        type: 'custom',
        interceptor(config) {
          seen.push({
            method: config.method, url: config.url, query: config.query, data: config.data,
          });

          return config;
        },
      },
    });

    await intercepted.Values.both('7', ['a'], { name: 'Ada' });
    await intercepted.Values.echo('hello');
    await intercepted.Values.echo(undefined);
    await intercepted.Values.peek({ unsent: true });

    // 0.8: config.query was { tags: ['a'] }, and config.data was the @Body value, sent or not.
    expect(seen).toEqual([
      {
        method: 'PUT', url: '/values/both/7?tags%5B%5D=a', query: undefined, data: '{"name":"Ada"}',
      },
      {
        method: 'POST', url: '/values/echo', query: undefined, data: '"hello"',
      },
      {
        method: 'POST', url: '/values/echo', query: undefined, data: undefined,
      },
      {
        method: 'GET', url: '/values/peek', query: undefined, data: undefined,
      },
    ]);
    // config.data is byte for byte the body that went over the wire.
    expect(wire()).toEqual([
      'PUT /values/both/7?tags%5B%5D=a {"name":"Ada"}',
      'POST /values/echo "hello"',
      'POST /values/echo -',
      'GET /values/peek -',
    ]);
  });

  test('an interceptor that changes the body parses the JSON text and stringifies the result', async () => {
    const withTenant = (spread: boolean) => createServiceClient(definition, {
      url: `http://127.0.0.1:${app.getPort()}`,
      retries: { max: 0, delay: 0 },
      auth: {
        type: 'custom',
        interceptor(config) {
          if (spread) {
            // The 0.8 pattern: config.data is a string now, so its characters become keys.
            return { ...config, data: { ...(config.data as Record<string, unknown>), tenantId: 'acme' } };
          }
          if (typeof config.data !== 'string') {
            return config;
          }

          return { ...config, data: JSON.stringify({ ...JSON.parse(config.data), tenantId: 'acme' }) };
        },
      },
    });

    await withTenant(false).Values.echo({ name: 'Ada' });
    await withTenant(true).Values.echo({ name: 'Ada' });

    expect(received[0]).toEqual({ body: { name: 'Ada', tenantId: 'acme' }, type: 'object' });
    const spread = (received[1] as { body: Record<string, unknown> }).body;
    expect([spread['0'], spread['1'], spread.tenantId, spread.name]).toEqual(['{', '"', 'acme', undefined]);
  });

  test('an API key in query mode is appended after the array query', async () => {
    fetchSpy.mockImplementation(async () => Response.json({ success: true, result: {} }));
    const keyed = createServiceClient(definition, {
      url: 'http://127.0.0.1:1',
      retries: { max: 0, delay: 0 },
      auth: {
        type: 'apikey', key: 'api_key', value: 'k', location: 'query',
      },
    });

    await keyed.Values.tags(['a', 'b'], 'x');

    expect(wire()).toEqual(['GET /values/tags?tags%5B%5D=a&tags%5B%5D=b&q=x&api_key=k -']);
  });

  test('a signed call with an array query and a string body verifies on the callee', async () => {
    const verified: Array<{ valid: boolean; search: string; body: string }> = [];
    const signed = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.text();
        const result = await Effect.runPromise(verifyOneBunRequest(
          {
            method: request.method, url: request.url, headers: request.headers, body,
          },
          { secret: 'shared-secret', audience: false, nonceStore: false },
        ));
        verified.push({ valid: result.valid, search: new URL(request.url).search, body });

        return Response.json({ success: true, result: {} });
      },
    });

    try {
      const signingClient = createServiceClient(definition, {
        url: `http://127.0.0.1:${signed.port}`,
        retries: { max: 0, delay: 0 },
        auth: { type: 'onebun', serviceId: 'orders-service', secretKey: 'shared-secret' },
      });

      await signingClient.Values.both('7', ['a', 'b c'], '');

      expect(verified).toEqual([{ valid: true, search: '?tags%5B%5D=a&tags%5B%5D=b+c', body: '""' }]);
    } finally {
      signed.stop(true);
    }
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

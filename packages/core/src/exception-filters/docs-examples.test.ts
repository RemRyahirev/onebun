/**
 * Documentation examples for docs/api/exception-filters.md.
 *
 * Every test here pins a promise the prose makes about the filter chain — which filter
 * actually runs for a given throw, what the response body and status are, and what a
 * re-throw falls back to. The snippets are exercised through a live application on port
 * 0 rather than by calling `filter.catch()` directly, because "route-level shadows
 * controller-level", "a re-throw reaches the default filter" and "the pipeline awaits an
 * async filter" are properties of the request pipeline, not of the filter object.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import type { ExceptionFilter, HttpExecutionContext } from '@onebun/core';
import {
  BaseController,
  Body,
  Controller,
  createExceptionFilter,
  Effect,
  Get,
  HttpException,
  HttpStatusCode,
  Layer,
  Module,
  NotFoundError,
  OneBunApplication,
  OneBunBaseError,
  Post,
  type,
  UNHANDLED_ERROR_MESSAGE,
  UseFilters,
  BaseService,
  Service,
} from '@onebun/core';
import { LoggerService, type Logger } from '@onebun/logger';
import { ValidationError } from '@onebun/requests';

// `@onebun/core/testing` is a package subpath with no tsconfig path mapping, so in-repo
// tests reach the helper directly. Every documented symbol above comes through the public
// barrel, exactly as docs/api/exception-filters.md tells the reader to import it.
import { makeMockLoggerLayer } from '../testing/test-utils';

// ============================================================================
// Fixtures
// ============================================================================

const HTTP_TEAPOT = 418;
const HTTP_GONE = 410;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const AUDIT_DELAY_MS = 30;

interface ErrorBody {
  success: boolean;
  error: string;
  code: number;
  details?: Record<string, unknown>;
}

interface FilterBody {
  handledBy?: string;
  message?: string;
  receipt?: string;
  success?: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

interface AuditEntry {
  handler: string;
  controller: string;
  error: string;
}

/** Stand-in for the `FileSizeError` the "On a single route" snippet catches. */
class FileSizeError extends Error {
  constructor(public readonly bytes: number) {
    super(`Upload exceeds ${bytes} bytes`);
    this.name = 'FileSizeError';
  }
}

function makeAuditLog(): { entries: AuditEntry[]; record: (entry: AuditEntry) => Promise<string> } {
  const entries: AuditEntry[] = [];

  return {
    entries,
    async record(entry: AuditEntry): Promise<string> {
      // A real await, long enough that a pipeline which forgot to await the filter would
      // answer the request before the entry exists.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, AUDIT_DELAY_MS);
      });
      entries.push(entry);

      return `receipt-${entries.length}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Filters, transcribed from the documented snippets
// ---------------------------------------------------------------------------

/** docs "Function-based filter". */
const oneBunErrorFilter = createExceptionFilter((error, _ctx) => {
  if (error instanceof OneBunBaseError) {
    return new Response(
      JSON.stringify({ success: false, error: error.message, code: error.code }),
      {
        status: HttpStatusCode.OK,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // Re-throw to let the next filter (or default) handle it
  throw error;
});

/** docs "Class-based filter". */
class ValidationExceptionFilter implements ExceptionFilter {
  catch(error: unknown, _ctx: HttpExecutionContext): Response {
    if (error instanceof ValidationError) {
      return Response.json(
        { success: false, error: 'Validation failed', details: error.details },
        { status: HttpStatusCode.OK },
      );
    }

    throw error; // pass to next filter
  }
}

/** docs "Interface" — a filter written against the published `ExceptionFilter` shape. */
interface RecordedContext {
  type: string;
  handler: string;
  controller: string;
  path: string;
}

const NO_CONTEXT: RecordedContext = {
  type: 'never-called', handler: 'never-called', controller: 'never-called', path: 'never-called',
};

let recordedContext: RecordedContext = NO_CONTEXT;

class ContextRecordingFilter implements ExceptionFilter {
  catch(error: unknown, context: HttpExecutionContext): Response {
    recordedContext = {
      type: context.type,
      handler: context.getHandler(),
      controller: context.getController(),
      path: new URL(context.getRequest().url).pathname,
    };

    return Response.json(
      { handledBy: 'ContextRecordingFilter', message: String(error) },
      { status: HTTP_TEAPOT },
    );
  }
}

/** docs "Accessing the Request in a Filter" — `console.error` replaced by a capture. */
const requestLog: string[] = [];
const loggingFilter = createExceptionFilter((error, ctx) => {
  const req = ctx.getRequest();
  requestLog.push(`${req.method} ${new URL(req.url).pathname}: ${String(error)}`);

  throw error; // delegate to the default filter
});

/** docs "Async Filters". */
const returningAudit = makeAuditLog();
const rethrowingAudit = makeAuditLog();

const auditFilter = createExceptionFilter(async (error, ctx) => {
  const receipt = await returningAudit.record({
    handler: ctx.getHandler(),
    controller: ctx.getController(),
    error: String(error),
  });

  return Response.json({ handledBy: 'audit', receipt }, { status: HttpStatusCode.ACCEPTED });
});

const rethrowingAuditFilter = createExceptionFilter(async (error, ctx) => {
  await rethrowingAudit.record({
    handler: ctx.getHandler(),
    controller: ctx.getController(),
    error: String(error),
  });

  throw error;
});

/** docs "On a single route" / controller-level contrast. */
const uploadRouteFilter = createExceptionFilter((err, _ctx) => {
  if (err instanceof FileSizeError) {
    return Response.json({ success: false, error: 'File too large' });
  }

  throw err;
});

const uploadControllerFilter = createExceptionFilter(
  () => Response.json({ handledBy: 'upload-controller' }, { status: HTTP_GONE }),
);

/** docs "Global (all routes)". */
const myGlobalFilter = createExceptionFilter(
  (error) => Response.json({ handledBy: 'global', message: String(error) }, { status: HttpStatusCode.SERVICE_UNAVAILABLE }),
);

const controllerOverrideFilter = createExceptionFilter(
  () => Response.json({ handledBy: 'controller' }, { status: HTTP_GONE }),
);

// ============================================================================
// docs/api/exception-filters.md — filters on routes and controllers
// ============================================================================

describe('docs/api/exception-filters.md', () => {
  const userSchema = type({
    name: 'string',
    age: 'number',
  });

  @Controller('/defaults')
  class DefaultsController extends BaseController {
    @Get('/conflict')
    conflict(): never {
      throw new HttpException(HttpStatusCode.CONFLICT, 'Conflict');
    }

    @Get('/missing')
    missing(): never {
      throw new NotFoundError('User 42 not found');
    }

    @Get('/boom')
    boom(): never {
      throw new Error('kaboom');
    }

    @Get('/invalid')
    invalid(): never {
      throw new ValidationError('bad payload', { field: 'email' });
    }

    @Post('/users')
    createUser(@Body(userSchema) user: { name: string; age: number }): { name: string; age: number } {
      return user;
    }
  }

  @UseFilters(oneBunErrorFilter)
  @Controller('/fn')
  class FunctionFilterController extends BaseController {
    @Get('/known')
    known(): never {
      throw new NotFoundError('no such record');
    }

    @Get('/unknown')
    unknown(): never {
      throw new Error('unmapped');
    }
  }

  @UseFilters(new ValidationExceptionFilter())
  @Controller('/users')
  class UserController extends BaseController {
    @Get('/invalid')
    invalid(): never {
      throw new ValidationError('bad payload', { field: 'email' });
    }

    @Get('/also-invalid')
    alsoInvalid(): never {
      throw new ValidationError('bad payload', { field: 'email' });
    }

    @Get('/other')
    other(): never {
      throw new HttpException(HttpStatusCode.CONFLICT, 'Conflict');
    }
  }

  @UseFilters(new ContextRecordingFilter())
  @Controller('/iface')
  class InterfaceController extends BaseController {
    @Get('/boom')
    explode(): never {
      throw new Error('interface probe');
    }
  }

  @UseFilters(uploadControllerFilter)
  @Controller('/uploads')
  class UploadController extends BaseController {
    @UseFilters(uploadRouteFilter)
    @Post('/')
    upload(): never {
      throw new FileSizeError(1024);
    }

    @Post('/other')
    otherUpload(): never {
      throw new FileSizeError(2048);
    }
  }

  @UseFilters(loggingFilter)
  @Controller('/reqinfo')
  class RequestInfoController extends BaseController {
    @Post('/probe')
    probe(): never {
      throw new HttpException(HttpStatusCode.CONFLICT, 'Conflict');
    }
  }

  @UseFilters(auditFilter)
  @Controller('/audit')
  class AuditController extends BaseController {
    @Get('/returns')
    returns(): never {
      throw new Error('audit me');
    }
  }

  @UseFilters(rethrowingAuditFilter)
  @Controller('/audit-rethrow')
  class AuditRethrowController extends BaseController {
    @Get('/boom')
    boom(): never {
      throw new HttpException(HttpStatusCode.CONFLICT, 'Conflict');
    }
  }

  // From "With dependency injection": the CLASS form, built from the owning module's scope.
  const reportedErrors: string[] = [];

  @Service()
  class ErrorReporter extends BaseService {
    report(error: unknown): void {
      reportedErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  @Service()
  class ReportingFilter extends BaseService {
    constructor(private readonly reporter: ErrorReporter) {
      super();
    }

    catch(error: unknown): Response {
      this.reporter.report(error);

      return Response.json(
        { success: false, error: 'Internal error', hasLogger: this.logger !== undefined },
        { status: HttpStatusCode.INTERNAL_SERVER_ERROR },
      );
    }
  }

  @UseFilters(ReportingFilter)
  @Controller('/di-filter')
  class DiFilterController extends BaseController {
    @Get('/boom')
    boom(): never {
      throw new Error('report me');
    }
  }

  @Module({
    controllers: [
      DefaultsController,
      FunctionFilterController,
      UserController,
      InterfaceController,
      UploadController,
      RequestInfoController,
      AuditController,
      AuditRethrowController,
      DiFilterController,
    ],
    providers: [ErrorReporter],
  })
  class FiltersModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(FiltersModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app?.stop();
  });

  // --------------------------------------------------------------------------
  // Quick Reference for AI
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#quick-reference-for-ai
   */
  it('throwing HttpException from a handler answers with its status and the documented body', async () => {
    const response = await fetch(`${base}/defaults/conflict`);
    const body = await response.json() as ErrorBody;

    expect(response.status).toBe(HttpStatusCode.CONFLICT);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.success).toBe(false);
    expect(body.error).toBe('Conflict');
    expect(body.code).toBe(HttpStatusCode.CONFLICT);
  });

  /**
   * @source docs:api/exception-filters.md#quick-reference-for-ai
   */
  it('default filter maps OneBunBaseError to its own code and any other Error to 500', async () => {
    const notFound = await fetch(`${base}/defaults/missing`);
    const notFoundBody = await notFound.json() as ErrorBody;

    expect(notFound.status).toBe(HttpStatusCode.NOT_FOUND);
    expect(notFoundBody.error).toBe('User 42 not found');
    expect(notFoundBody.code).toBe(HttpStatusCode.NOT_FOUND);

    const plain = await fetch(`${base}/defaults/boom`);
    const plainBody = await plain.json() as ErrorBody;

    expect(plain.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    expect(plainBody.success).toBe(false);
    // The table's third row: an unhandled error answers with the fixed string, not with its
    // own message. The first two rows keep theirs, asserted above.
    expect(plainBody.error).toBe(UNHANDLED_ERROR_MESSAGE);
    expect(plainBody.code).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
  });

  /**
   * @source docs:api/exception-filters.md#quick-reference-for-ai
   */
  it('@Body(schema) validation failure surfaces as HttpException(400) through the default filter', async () => {
    const response = await fetch(`${base}/defaults/users`, {
      method: 'POST',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', age: 'thirty' }),
    });
    const body = await response.json() as ErrorBody;

    expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
    expect(body.success).toBe(false);
    expect(body.code).toBe(HttpStatusCode.BAD_REQUEST);
    expect(body.error).toContain('validation failed');
    expect(body.error).toContain('age must be a number');
  });

  // --------------------------------------------------------------------------
  // Interface
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#interface
   */
  it('catch() receives the thrown error and an HttpExecutionContext for the failing route', async () => {
    recordedContext = NO_CONTEXT;

    const response = await fetch(`${base}/iface/boom`);
    const body = await response.json() as FilterBody;

    expect(response.status).toBe(HTTP_TEAPOT);
    expect(body.handledBy).toBe('ContextRecordingFilter');
    expect(body.message).toBe('Error: interface probe');
    expect(recordedContext).toEqual({
      type: 'http',
      handler: 'explode',
      controller: 'InterfaceController',
      path: '/iface/boom',
    });
  });

  // --------------------------------------------------------------------------
  // Function-based filter
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#function-based-filter
   */
  it('createExceptionFilter handles the matched error and re-throws the rest to the default filter', async () => {
    const matched = await fetch(`${base}/fn/known`);
    const matchedBody = await matched.json() as ErrorBody;

    expect(matched.status).toBe(HttpStatusCode.OK);
    expect(matchedBody).toEqual({ success: false, error: 'no such record', code: HttpStatusCode.NOT_FOUND });

    // The `throw error` branch is not a no-op: the default filter takes over and the
    // response carries a real HTTP 500 instead of the filter's 200 envelope.
    const rethrown = await fetch(`${base}/fn/unknown`);
    const rethrownBody = await rethrown.json() as ErrorBody;

    expect(rethrown.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    // Re-thrown to the default filter, so it is an unhandled error by the time it is
    // serialized — and the default filter withholds the message.
    expect(rethrownBody.error).toBe(UNHANDLED_ERROR_MESSAGE);
    expect(rethrownBody.code).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
  });

  // --------------------------------------------------------------------------
  // Class-based filter
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#class-based-filter
   */
  it('a class implementing ExceptionFilter converts its error and passes the others on', async () => {
    const converted = await fetch(`${base}/users/invalid`);
    const convertedBody = await converted.json() as FilterBody;

    expect(converted.status).toBe(HttpStatusCode.OK);
    expect(convertedBody.success).toBe(false);
    expect(convertedBody.error).toBe('Validation failed');
    expect(convertedBody.details).toEqual({ field: 'email' });

    const passedOn = await fetch(`${base}/users/other`);
    const passedOnBody = await passedOn.json() as ErrorBody;

    expect(passedOn.status).toBe(HttpStatusCode.CONFLICT);
    expect(passedOnBody.error).toBe('Conflict');
  });

  // --------------------------------------------------------------------------
  // On a controller
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#on-a-controller
   */
  it('@UseFilters on the class covers every route of that controller and no other', async () => {
    const first = await fetch(`${base}/users/invalid`);
    const second = await fetch(`${base}/users/also-invalid`);

    expect(first.status).toBe(HttpStatusCode.OK);
    expect(second.status).toBe(HttpStatusCode.OK);
    expect(await second.json() as FilterBody).toEqual({
      success: false,
      error: 'Validation failed',
      details: { field: 'email' },
    });

    // Same error thrown from a controller without the decorator: unfiltered, so the
    // default filter answers with the ValidationError's own 422.
    const elsewhere = await fetch(`${base}/defaults/invalid`);
    const elsewhereBody = await elsewhere.json() as ErrorBody;

    expect(elsewhere.status).toBe(HttpStatusCode.UNPROCESSABLE_ENTITY);
    expect(elsewhereBody.error).toBe('bad payload');
  });

  // --------------------------------------------------------------------------
  // With dependency injection
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#with-dependency-injection
   */
  it('a filter class registered by class gets its injected service, logger and config', async () => {
    const before = reportedErrors.length;
    const response = await fetch(`${base}/di-filter/boom`);
    const body = await response.json() as { hasLogger: boolean };

    expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
    expect(reportedErrors.slice(before)).toEqual(['report me']);
    expect(body.hasLogger).toBe(true);
  });

  // --------------------------------------------------------------------------
  // On a single route
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#on-a-single-route
   */
  it('@UseFilters on a method applies to that route only and shadows the controller filter', async () => {
    const filtered = await fetch(`${base}/uploads/`, { method: 'POST' });
    const filteredBody = await filtered.json() as FilterBody;

    expect(filtered.status).toBe(HttpStatusCode.OK);
    expect(filteredBody).toEqual({ success: false, error: 'File too large' });

    // The sibling route keeps the controller-level filter — the route decorator did not
    // leak onto it, and did not disable the controller one either.
    const sibling = await fetch(`${base}/uploads/other`, { method: 'POST' });
    const siblingBody = await sibling.json() as FilterBody;

    expect(sibling.status).toBe(HTTP_GONE);
    expect(siblingBody.handledBy).toBe('upload-controller');
  });

  // --------------------------------------------------------------------------
  // Accessing the Request in a Filter
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#accessing-the-request-in-a-filter
   */
  it('ctx.getRequest() exposes the live request, and re-throwing hands over to the default filter', async () => {
    requestLog.length = 0;

    const response = await fetch(`${base}/reqinfo/probe?trace=1`, { method: 'POST' });
    const body = await response.json() as ErrorBody;

    expect(requestLog).toEqual(['POST /reqinfo/probe: HttpException: Conflict']);
    expect(response.status).toBe(HttpStatusCode.CONFLICT);
    expect(body.error).toBe('Conflict');
    expect(body.code).toBe(HttpStatusCode.CONFLICT);
  });

  // --------------------------------------------------------------------------
  // Async Filters
  // --------------------------------------------------------------------------

  /**
   * @source docs:api/exception-filters.md#async-filters
   */
  it('an async filter is awaited before the response is sent', async () => {
    const response = await fetch(`${base}/audit/returns`);
    const body = await response.json() as FilterBody;

    // Had the pipeline not awaited the promise the filter returned, `filtered` would not
    // be a Response and the default filter would have answered with 500 instead.
    expect(response.status).toBe(HttpStatusCode.ACCEPTED);
    expect(body).toEqual({ handledBy: 'audit', receipt: 'receipt-1' });
    expect(returningAudit.entries).toEqual([
      { handler: 'returns', controller: 'AuditController', error: 'Error: audit me' },
    ]);
  });

  /**
   * @source docs:api/exception-filters.md#async-filters
   */
  it('an async filter that awaits and then re-throws still records before the default filter answers', async () => {
    const response = await fetch(`${base}/audit-rethrow/boom`);
    const body = await response.json() as ErrorBody;

    expect(rethrowingAudit.entries).toEqual([
      { handler: 'boom', controller: 'AuditRethrowController', error: 'HttpException: Conflict' },
    ]);
    expect(response.status).toBe(HttpStatusCode.CONFLICT);
    expect(body.error).toBe('Conflict');
  });
});

// ============================================================================
// docs/api/exception-filters.md — ApplicationOptions.filters
// ============================================================================

describe('docs/api/exception-filters.md — global filters', () => {
  @Controller('/global-plain')
  class GlobalPlainController extends BaseController {
    @Get('/boom')
    boom(): never {
      throw new Error('global probe');
    }

    @Get('/also-boom')
    alsoBoom(): never {
      throw new HttpException(HttpStatusCode.CONFLICT, 'Conflict');
    }
  }

  @UseFilters(controllerOverrideFilter)
  @Controller('/global-shadowed')
  class GlobalShadowedController extends BaseController {
    @Get('/boom')
    boom(): never {
      throw new Error('shadow probe');
    }
  }

  @Module({ controllers: [GlobalPlainController, GlobalShadowedController] })
  class GlobalFiltersModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(GlobalFiltersModule, {
      port: 0,
      filters: [myGlobalFilter],
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app?.stop();
  });

  /**
   * @source docs:api/exception-filters.md#global-all-routes
   */
  it('ApplicationOptions.filters catches throws from every route with no filter of its own', async () => {
    const first = await fetch(`${base}/global-plain/boom`);
    const firstBody = await first.json() as FilterBody;

    expect(first.status).toBe(HttpStatusCode.SERVICE_UNAVAILABLE);
    expect(firstBody).toEqual({ handledBy: 'global', message: 'Error: global probe' });

    // Even an HttpException, which the default filter would have turned into a 409, is
    // taken over by the global filter.
    const second = await fetch(`${base}/global-plain/also-boom`);
    const secondBody = await second.json() as FilterBody;

    expect(second.status).toBe(HttpStatusCode.SERVICE_UNAVAILABLE);
    expect(secondBody).toEqual({ handledBy: 'global', message: 'HttpException: Conflict' });
  });

  /**
   * @source docs:api/exception-filters.md#quick-reference-for-ai
   */
  it('a controller-level filter shadows the global one for its own routes', async () => {
    const response = await fetch(`${base}/global-shadowed/boom`);
    const body = await response.json() as FilterBody;

    expect(response.status).toBe(HTTP_GONE);
    expect(body).toEqual({ handledBy: 'controller' });
  });
});

/** A record of one logger call, including the arguments after the message. */
interface LogRecord {
  level: string;
  message: string;
  extra: unknown[];
}

/**
 * A logger layer that keeps every write, arguments included.
 *
 * `makeMockLoggerLayer` is silent by design, so it cannot answer the question this section
 * needs answered: the response no longer carries the error's message, and the promise is that
 * the LOG still does. The error arrives as the second argument to `error()`, so a recorder
 * that keeps only the message string would miss exactly the thing under test.
 */
function recordingLoggerLayer(sink: LogRecord[]): Layer.Layer<Logger> {
  const make = (): Logger => {
    const record = (level: string) => (message: string, ...extra: unknown[]) =>
      Effect.sync(() => {
        sink.push({
          level,
          message,
          // Errors do not survive JSON.stringify, so they are flattened here where the shape
          // is still known.
          extra: extra.map(value => (value instanceof Error ? `${value.name}: ${value.message}` : value)),
        });
      });

    return {
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      fatal: record('fatal'),
      child: () => make(),
    };
  };

  return Layer.succeed(LoggerService, make());
}

/**
 * The "Default Filter Behaviour" table, and the `exposeErrorDetails` warning beneath it,
 * exercised against a live application rather than against the filter object — the disclosure
 * was on the application's own default filter, which it constructs itself.
 *
 * @source docs:api/exception-filters.md#default-filter-behaviour
 */
describe('Default Filter Behaviour (docs/api/exception-filters.md)', () => {
  @Controller('/default-filter')
  class UnhandledController extends BaseController {
    @Get('/boom')
    boom(): never {
      throw new Error('internal failure');
    }

    @Get('/http-exception')
    httpException(): never {
      throw new HttpException(HTTP_GONE, 'Gone for good');
    }

    /** The four shapes the docs quote, thrown from an ordinary handler. */
    @Get('/leaky')
    leaky(): never {
      throw new Error(
        "ENOENT: no such file or directory, open '/srv/app/config/private.pem'; "
        + 'connect ECONNREFUSED 10.0.3.17:5432; '
        + 'getaddrinfo ENOTFOUND internal-billing.svc.cluster.local; '
        + 'Invalid URL: postgres://app:hunter2@db.internal:5432/app',
      );
    }
  }

  @Module({ controllers: [UnhandledController] })
  class DefaultFilterModule {}

   
  async function withApp(options: Record<string, unknown>, run: (base: string) => Promise<void>): Promise<void> {
    const app = new OneBunApplication(DefaultFilterModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
      ...options,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await app.start();

    try {
      await run(app.getHttpUrl());
    } finally {
      await app.stop();
    }
  }

  it('answers an unhandled error with an EMPTY details object', async () => {
    // The table's third row plus the paragraph under it: `details` is present and empty.
    await withApp({}, async (base) => {
      const response = await fetch(`${base}/default-filter/boom`);
      const body = await response.json() as ErrorBody;

      expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(body.success).toBe(false);
      expect(body.error).toBe(UNHANDLED_ERROR_MESSAGE);
      expect(body.code).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(body.details).toEqual({});
    });
  });

  it('ships no stack trace and no filesystem path in that body', async () => {
    await withApp({}, async (base) => {
      const raw = await (await fetch(`${base}/default-filter/boom`)).text();

      // Raw text, not the parsed object: a stack under an unexpected key would still be sent.
      expect(raw).not.toContain('stack');
      expect(raw).not.toContain(import.meta.dir);
    });
  });

  it('puts the stack back only when exposeErrorDetails is set', async () => {
    // The `::: warning` block. Opt-in, and off unless written down.
    await withApp({ exposeErrorDetails: true }, async (base) => {
      const body = await (await fetch(`${base}/default-filter/boom`)).json() as ErrorBody;

      expect(typeof body.details?.stack).toBe('string');
      expect(body.details?.originalErrorName).toBe('Error');
    });
  });

  it('discloses no path, host:port, service name or credential from an unhandled error', async () => {
    // The four examples printed under the table, asserted on the raw response text of a real
    // request — the disclosure was in the body the application itself builds, so it has to be
    // checked there rather than on the filter object.
    await withApp({}, async (base) => {
      const raw = await (await fetch(`${base}/default-filter/leaky`)).text();

      expect(raw).not.toContain('/srv/app/config/private.pem');
      expect(raw).not.toContain('10.0.3.17:5432');
      expect(raw).not.toContain('internal-billing.svc.cluster.local');
      expect(raw).not.toContain('hunter2');
      expect(raw).toContain(UNHANDLED_ERROR_MESSAGE);
    });
  });

  it('still hands the real message to the log, which is where it belongs', async () => {
    // Withholding it from the response must not remove it from the operator's view. The
    // application logs the whole error before the filter runs; this asserts that, so that a
    // future change cannot quietly make the message disappear from both places at once.
    const records: Array<{ level: string; message: string; extra: unknown[] }> = [];
    const app = new OneBunApplication(DefaultFilterModule, {
      port: 0,
      loggerLayer: recordingLoggerLayer(records) as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await app.start();

    try {
      await fetch(`${app.getHttpUrl()}/default-filter/leaky`);
    } finally {
      await app.stop();
    }

    const logged = JSON.stringify(records);
    expect(logged).toContain('Unhandled error in UnhandledController.leaky');
    expect(logged).toContain('/srv/app/config/private.pem');
  });

  it('leaves the HttpException row unaffected by the flag', async () => {
    // The last sentence of the warning: these bodies never carried details.
    for (const exposeErrorDetails of [false, true]) {
      await withApp({ exposeErrorDetails }, async (base) => {
        const response = await fetch(`${base}/default-filter/http-exception`);
        const body = await response.json() as ErrorBody;

        expect(response.status).toBe(HTTP_GONE);
        expect(body.error).toBe('Gone for good');
        expect(body.details).toEqual({});
      });
    }
  });
});

---
description: Exception Filters — centralized, type-safe error handling for HTTP routes.
---

<llm-only>

## Quick Reference for AI

**Imports:**
```typescript
import { ExceptionFilter, createExceptionFilter, UseFilters, HttpException } from '@onebun/core';
```

**HttpException:**
- `throw new HttpException(statusCode, message)` from handlers/guards/middleware
- Default filter converts to JSON response with matching HTTP status
- Framework validation (`@Body(schema)`, `@Param`, etc.) automatically throws `HttpException(400, ...)`

**Three ways to create a filter:**
1. `createExceptionFilter(fn)` — inline function-based filter (simplest)
2. Implement `ExceptionFilter` interface (class-based) — pass the CLASS to get constructor DI, or an instance to own its lifetime yourself
3. Use the built-in `defaultExceptionFilter` (always active as the final fallback)

**Applying filters:**
- `ApplicationOptions.filters` — global (all routes)
- `@UseFilters(myFilter)` on a controller class — all routes in that controller
- `@UseFilters(myFilter)` on a route method — that route only
- Priority: route-level > controller-level > global > default

**Signature:**
<!-- typecheck: skip -->
```typescript
filter.catch(error: unknown, context: HttpExecutionContext): OneBunResponse | Promise<OneBunResponse>
```

**The default filter** handles:
- `HttpException` → `{ success: false, error: message, code: statusCode }` (HTTP status = exception's statusCode)
- `OneBunBaseError` subclasses → `error.toErrorResponse()`: `{ success: false, error, code, details, originalError }` (HTTP status = error's code). Serialized with the `withoutTransportDetails` replacer from `@onebun/requests` unless `exposeErrorDetails` is set: the transport details of an error the HTTP client produced — the upstream's response headers (`set-cookie`), the request URL with its query, a redirect's `Location`, the upstream's body or the raw transport error — are left out, at any depth (`client.req()` nests the client failure under `details.originalError`). Only records the client registered are touched; an author-written `details: { headers, url }` is sent whole. See docs/api/requests.md#uncaught-client-errors
- Any other `Error` **or thrown value** → `{ success: false, error: 'Internal Server Error', code: 500 }` (HTTP 500). The exported constant is `UNHANDLED_ERROR_MESSAGE`. The thrown value's own message is NOT in the body: it is written by whatever threw it — a driver, a socket, the file system — and routinely names an absolute path, an internal host and port, a service hostname, a failing statement with its bound parameters, or the password inside a connection string. The two branches above keep their messages, because they are author-written and client-facing; this branch has no way to tell a safe message from a leaking one, so it is withheld wholesale rather than filtered. A denylist of shapes would always miss the shape it had not met
- `createErrorResponse` always emits a `details` key, defaulting to `{}`. In the default filter only the unhandled branch populates it, and only when `exposeErrorDetails` is set: `createDefaultExceptionFilter({ exposeErrorDetails })` in `packages/core/src/exception-filters/exception-filters.ts`, fed from `ApplicationOptions.exposeErrorDetails` at the application's own filter construction site
- `exposeErrorDetails` governs the message and the details together — one knob, not two. A message naming an internal host is not meaningfully safer than the stack naming the file, so there is no configuration in which one is disclosed and the other is not
- The flag is deliberately NOT derived from `NODE_ENV`. An unset or mistyped `NODE_ENV` would flip a security-relevant default the wrong way with no signal
- The status computation is independent of the flag: a non-HTTP `code` such as `ECONNREFUSED` still maps to 500 through `toHttpStatus`, which is what stops `new Response` throwing RangeError from inside the filter
- The stack still reaches the operator: the application logs `'Unhandled error in ...'` with the error object before the filter runs, so withholding it from the response costs no debuggability

</llm-only>

# Exception Filters

Exception filters provide centralized, type-safe error handling for HTTP routes. When a route handler, guard, or interceptor throws, the filter chain catches the error and converts it to a response.

## Interface

```typescript
import type { ExceptionFilter, HttpExecutionContext } from '@onebun/core';

interface ExceptionFilter {
  catch(
    error: unknown,
    context: HttpExecutionContext,
  ): OneBunResponse | Promise<OneBunResponse>;
}
```

## Creating Filters

### Function-based filter

```typescript
import { createExceptionFilter } from '@onebun/core';
import { OneBunBaseError } from '@onebun/requests';

const myFilter = createExceptionFilter((error, ctx) => {
  if (error instanceof OneBunBaseError) {
    return new Response(
      JSON.stringify({ success: false, error: error.message, code: error.code }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // Re-throw to let the next filter (or default) handle it
  throw error;
});
```

### Class-based filter

`ValidationError` is a class from `@onebun/requests`, not from `@onebun/core` — `instanceof` needs the
runtime value, and the similarly named `ValidationError` in core's validation module is an interface
with no runtime existence. A `ValidationError` is also what an upstream's 422 becomes (the
`RequestsService` Effect API, `OneBunBaseError.fromErrorResponse`), and then its `details` is the
HTTP client's record: the upstream's headers, its body and the request URL. The
`withoutTransportDetails` replacer leaves those out, as the default filter does, and leaves the
`details` of a `ValidationError` you threw yourself as they are:

```typescript
import type { ExceptionFilter, HttpExecutionContext } from '@onebun/core';
import { ValidationError, withoutTransportDetails } from '@onebun/requests';

class ValidationExceptionFilter implements ExceptionFilter {
  catch(error: unknown, ctx: HttpExecutionContext): Response | undefined {
    if (error instanceof ValidationError) {
      const body = { success: false, error: 'Validation failed', details: error.details };

      return new Response(JSON.stringify(body, withoutTransportDetails), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return undefined; // decline: the next filter outwards gets it
  }
}
```

**Which filter answers.** Filters are tried from the most specific outwards — route, then
controller, then global, then the framework's default filter — and the first one to return a
Response answers. Returning `undefined` (or `null`) declines, and the error moves one level out;
that is the supported way to say "not mine". Do **not** rethrow to decline: a throw out of
`catch()` is how a BUG in a filter looks, so it is reported with the filter's name and answered by
the default filter without consulting the rest of the chain: a rethrow reaches the default
filter, never the next one out.

## HttpException

Throw `HttpException` from handlers, guards, or middleware to return a specific HTTP status code:

<!-- typecheck: skip -->
```typescript
import { HttpException } from '@onebun/core';

// In a controller handler:
@Get('/:id')
async findOne(@Param('id') id: string) {
  const item = await this.itemService.findById(id);
  if (!item) throw new HttpException(404, 'Item not found');
  return item;
}
```

The default exception filter converts `HttpException` to a JSON response with the matching HTTP status:

| Input | Response |
|-------|----------|
| `throw new HttpException(400, 'Bad input')` | HTTP 400 `{ success: false, error: "Bad input", code: 400 }` |
| `throw new HttpException(404, 'Not found')` | HTTP 404 `{ success: false, error: "Not found", code: 404 }` |
| `throw new HttpException(409, 'Conflict')` | HTTP 409 `{ success: false, error: "Conflict", code: 409 }` |

> **Note:** Framework validation errors (`@Body(schema)`, `@Param`, `@UploadedFile`) automatically throw `HttpException(400, ...)`, so validation failures return HTTP 400 with a descriptive error message. There is no `@File` decorator — the file-parameter decorators are `@UploadedFile`, `@UploadedFiles` and `@FormField`.

## Applying Filters

### Global (all routes)

```typescript
import { OneBunApplication } from '@onebun/core';
import { myGlobalFilter } from './filters';

const app = new OneBunApplication(AppModule, {
  filters: [myGlobalFilter],
});
```

### On a controller

```typescript
import { Controller, UseFilters } from '@onebun/core';

@UseFilters(new ValidationExceptionFilter())
@Controller('/users')
class UserController extends BaseController { /* ... */ }
```

### With dependency injection

Pass the class rather than an instance and the framework builds it from the owning module's scope — one instance per class, shared by every route that names it. This is the only place in an application that sees every unhandled error, so it is usually the place that wants a reporter:

```typescript
import {
  BaseService,
  Controller,
  Service,
  UseFilters,
  type HttpExecutionContext,
} from '@onebun/core';

@Service()
class ReportingFilter extends BaseService {
  constructor(private readonly reporter: ErrorReporter) {
    super();
  }

  catch(error: unknown, context: HttpExecutionContext): Response {
    this.reporter.report(error, context.getHandler());
    this.logger.error('Unhandled error reported');

    return Response.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

@UseFilters(ReportingFilter)
@Controller('/users')
class UserController extends BaseController { /* ... */ }
```

Constructor injection needs a class decorator — `@Service()` is the conventional one — because that is what makes TypeScript emit the parameter types. A dependency that cannot be resolved fails the application at startup, naming the filter, rather than at the first error it was supposed to handle. Extending `BaseService` additionally gives `this.logger` and `this.config`; a filter passed as an INSTANCE gets those too, but nothing injected through its constructor.

### On a single route

```typescript
@Controller('/uploads')
class UploadController extends BaseController {
  @UseFilters(createExceptionFilter((err, ctx) => {
    if (err instanceof FileSizeError) {
      return Response.json({ success: false, error: 'File too large' });
    }
    throw err;
  }))
  @Post('/')
  async upload(@UploadedFile() file: OneBunFile) { /* ... */ }
}
```

## What Filters Cover

Filters are applied at the innermost point that can throw, so a filtered response still
flows back out through the interceptor and middleware chains and still receives CORS,
security and rate-limit headers.

| throws | filtered |
|---|---|
| route handler — with or without parameter decorators | yes |
| guard (`canActivate` throws or rejects) | yes |
| interceptor (before or after `next()`) | yes |
| middleware | **no** — see below |

**Error handling does not depend on whether a handler declares parameter decorators.** A
handler written `async findAll()` and one written `async findAll(@Query('q') q?: string)`
produce identical responses for the same throw.

Middleware is deliberately not filtered. A middleware wraps `next()` and may modify the
response after it resolves — `cors`, `security` and `rateLimit` all set headers that way —
so catching a middleware error above the chain would skip the post-`next()` work of every
outer middleware and drop those headers from the response. A middleware that throws
produces `{ success: false, error: 'Internal Server Error', code: 500 }`. Handle errors
inside the middleware, or move the logic into a guard.

A guard that returns `false` is not an error: it produces
`{ success: false, error: 'Forbidden', code: 403 }` directly and never reaches a filter, so
a route-level filter cannot override that contract. A guard that *throws* is filtered.

## Filter Priority

Filters merge global → controller → route and are tried from the **most specific** outwards:
route-level first, then controller-level, then global, then the built-in default filter:

```
Route-level filter ▸ declines ▸ Controller-level ▸ declines ▸ Global ▸ declines ▸ Default
```

Exactly one filter answers each error: the first one that returns a `Response`. A filter that
returns `undefined` declines, and the next filter out gets the error; a `null` return (from
untyped code) declines the same way.

A filter that throws, or returns anything that is neither a `Response` nor `undefined`/`null`, is
reported with its name, and the built-in **default filter** answers without consulting the rest
of the chain. The default filter never throws and is therefore always the terminal handler.

## Default Filter Behaviour

The `defaultExceptionFilter` is always active. It handles:

| Error type | Response body | Status |
|------------|---------------|--------|
| `HttpException` | `{ success: false, error: message, code: statusCode, details: {} }` | exception's statusCode |
| `OneBunBaseError` subclass | `{ success: false, error, code, details, originalError }` — without an HTTP-client error's transport details, unless `exposeErrorDetails` | error's code |
| Any other `Error` or value | `{ success: false, error: 'Internal Server Error', code: 500, details: {} }` | 500 |

**An unhandled error does not put its own message in the response.** The first two rows do —
those messages are written by the author and meant for the client. The third is the branch where
the text came from a library or the kernel, and such a message routinely carries exactly what an
API response must not:

```
ENOENT: no such file or directory, open '/srv/app/config/private.pem'
connect ECONNREFUSED 10.0.3.17:5432
getaddrinfo ENOTFOUND internal-billing.svc.cluster.local
Invalid URL: postgres://app:hunter2@db.internal:5432/app
```

An absolute path, an internal host and port, the service topology, a password. Nothing in the
filter can tell one of those from a harmless message, so the whole branch answers with the fixed
string `'Internal Server Error'` — exported as `UNHANDLED_ERROR_MESSAGE`. It does not
filter by pattern: a denylist always misses the shape it has not met, and reads as safe.

Every body also carries a `details` object, and on the default filter it is **empty**: it does not
carry the error's stack trace, class name or non-HTTP `code`. A stack trace in an API response
discloses absolute filesystem paths, dependency versions and internal module layout to whoever can
provoke a 500, so it is withheld too.

Nothing is lost operationally: the application logs the whole error, message and stack included,
before the filter runs — look for `Unhandled error in <Controller>.<handler>`.

::: tip Returning a message to the client deliberately
Throw an `HttpException` — that is what it is for. `throw new HttpException(422, 'orderId must
be a positive integer')` answers with that text verbatim. Catching a driver error and rethrowing
it as an `HttpException` you worded yourself is the supported way to say something specific
about a failure.
:::

::: warning exposeErrorDetails puts it back
```typescript
const app = new OneBunApplication(AppModule, { exposeErrorDetails: true });
```

The unhandled branch then answers with the error's **real message**, and `details` carries
`originalErrorName`, `originalCode` and the full `stack`. One flag governs both: a message naming
an internal host is not meaningfully safer than the stack naming the file.

Off by default, and deliberately **not** tied to `NODE_ENV` — a deployment with an unset or
mistyped `NODE_ENV` would start disclosing all of it silently, which is the failure this guards
against. Turn it on knowingly, in a development configuration you can read.

`HttpException` bodies are unaffected by the flag. A `OneBunBaseError` body carries the error's
own `details` either way; the flag adds back only the transport details of an HTTP-client error —
see below.
:::

**An HTTP-client error keeps its transport details out of the body.** A `OneBunBaseError` is sent
whole, its `details` and `originalError` included, because the author wrote them for the client.
An error the HTTP client produced is the exception: `client.req()` throws one, and it carries the
upstream's response headers (its `set-cookie` among them), the URL the request went to and the
upstream's body. The upstream sent those to your application, not to its caller, so the
default filter leaves them out — at any depth, including under `details.originalError` — unless
`exposeErrorDetails` is on. The status, `error`, `code` and every other field stay. See
[An uncaught client error and your caller](./requests.md#uncaught-client-errors) for what is left
out of which error.

A filter of your own that serializes a `OneBunBaseError` can do the same with the replacer the
default filter uses:

```typescript
import { createExceptionFilter, OneBunBaseError, withoutTransportDetails } from '@onebun/core';

const auditedFilter = createExceptionFilter((error) => {
  if (!(error instanceof OneBunBaseError)) {
    return undefined;
  }

  // Envelope mode: always 200, the real code in the body
  return new Response(JSON.stringify(error.toErrorResponse(), withoutTransportDetails), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

## Accessing the Request in a Filter

```typescript
const loggingFilter = createExceptionFilter((error, ctx) => {
  const req = ctx.getRequest();
  console.error(`Error on ${req.method} ${new URL(req.url).pathname}:`, error);
  throw error; // delegate to the default filter
});
```

## Async Filters

Filters can be asynchronous:

```typescript
const auditFilter = createExceptionFilter(async (error, ctx) => {
  await auditLog.record({
    handler: ctx.getHandler(),
    controller: ctx.getController(),
    error: String(error),
  });
  throw error;
});
```

## Execution Order

```
Handler, guard or interceptor throws
→ the route's filters, most specific first (route ▸ controller ▸ global); the first Response answers
→ Default filter, if every filter declined, or one threw or returned something else
→ Response sent, back out through the interceptor and middleware chains
```

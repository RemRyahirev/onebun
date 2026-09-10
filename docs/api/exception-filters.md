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
- `OneBunBaseError` subclasses → `{ success: false, error: message, code: errorCode }` (HTTP status = error's code)
- Any other `Error` **or thrown value** → `{ success: false, error: 'Internal Server Error', code: 500 }` (HTTP 500). The exported constant is `UNHANDLED_ERROR_MESSAGE`. The thrown value's own message is NOT in the body: it is written by whatever threw it — a driver, a socket, the file system — and routinely names an absolute path, an internal host and port, a service hostname, a failing statement with its bound parameters, or the password inside a connection string. The two branches above keep their messages, because they are author-written and client-facing; this branch has no way to tell a safe message from a leaking one, so it is withheld wholesale rather than filtered. A denylist of shapes would always miss the shape it had not met
- `createErrorResponse` always emits a `details` key, defaulting to `{}`. Only the unhandled branch ever populated it, and it no longer does unless `exposeErrorDetails` is set: `createDefaultExceptionFilter({ exposeErrorDetails })` in `packages/core/src/exception-filters/exception-filters.ts`, fed from `ApplicationOptions.exposeErrorDetails` at the application's own filter construction site
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
with no runtime existence:

```typescript
import type { ExceptionFilter, HttpExecutionContext } from '@onebun/core';
import { ValidationError } from '@onebun/requests';

class ValidationExceptionFilter implements ExceptionFilter {
  catch(error: unknown, ctx: HttpExecutionContext): Response {
    if (error instanceof ValidationError) {
      return Response.json(
        { success: false, error: 'Validation failed', details: error.details },
        { status: 200 },
      );
    }
    throw error; // pass to next filter
  }
}
```

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

Filters merge global → controller → route, and **the last one wins**. A route-level filter
fully shadows controller-level and global filters, which in turn shadow the built-in
default filter:

```
Route-level filter ▸ shadows ▸ Controller-level ▸ shadows ▸ Global ▸ shadows ▸ Default
```

Exactly one filter runs per error. There is no fallthrough between user filters.

A filter that re-throws, or returns anything other than a `Response`, falls back to the
built-in **default filter** — which never throws and is therefore always the terminal
handler.

## Default Filter Behaviour

The `defaultExceptionFilter` is always active. It handles:

| Error type | Response body | Status |
|------------|---------------|--------|
| `HttpException` | `{ success: false, error: message, code: statusCode, details: {} }` | exception's statusCode |
| `OneBunBaseError` subclass | `{ success: false, error: message, code: errorCode }` | error's code |
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
string `'Internal Server Error'` — exported as `UNHANDLED_ERROR_MESSAGE`. Filtering by pattern
instead was rejected: a denylist always misses the shape it has not met, and reads as safe.

Every body also carries a `details` object, and on the default filter it is **empty**. It used to
carry the error's stack trace, class name and non-HTTP `code` for any unhandled throw. A stack
trace in an API response discloses absolute filesystem paths, dependency versions and internal
module layout to whoever can provoke a 500, so it is withheld too.

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

`HttpException` and `OneBunBaseError` bodies are unaffected by the flag: they never carried
details.
:::

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
→ the route's effective filter (route ▸ controller ▸ global, last one wins)
→ Default filter, if that filter re-threw or returned a non-Response
→ Response sent, back out through the interceptor and middleware chains
```

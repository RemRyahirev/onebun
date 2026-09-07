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
2. Implement `ExceptionFilter` interface (class-based)
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
- Any other `Error` → `{ success: false, error: message, code: 500 }` (HTTP 500)

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
| `HttpException` | `{ success: false, error: message, code: statusCode }` | exception's statusCode |
| `OneBunBaseError` subclass | `{ success: false, error: message, code: errorCode }` | error's code |
| Any other `Error` or value | `{ success: false, error: message, code: 500 }` | 500 |

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

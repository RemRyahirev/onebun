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
      JSON.stringify({ success: false, error: error.message, code: error.statusCode }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // Re-throw to let the next filter (or default) handle it
  throw error;
});
```

### Class-based filter

```typescript
import type { ExceptionFilter, HttpExecutionContext } from '@onebun/core';

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

> **Note:** Framework validation errors (`@Body(schema)`, `@Param`, `@File`) automatically throw `HttpException(400, ...)`, so validation failures return HTTP 400 with a descriptive error message.

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
  async upload(@File() file: OneBunFile) { /* ... */ }
}
```

## Filter Priority

Filters are applied in priority order, from most specific to least specific:

```
Route-level filter → Controller-level filter → Global filter → Default filter
```

Each filter may:
- Return a `Response` to short-circuit and send that response
- `throw error` to pass the error to the next filter in the chain

The built-in **default filter** is always the final fallback and never throws.

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
  throw error; // let the next filter handle the response
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
Route Handler throws
→ Route-level filters (if any)
→ Controller-level filters (if any)
→ Global filters (if any)
→ Default filter (always present)
→ Response sent
```

# OneBun Controllers — Full Reference

## Decorators

### Class-level
- `@Controller('/prefix')` — sets route prefix for all methods
- `@UseMiddleware(MiddlewareClass, ...)` — apply middleware to all routes. **Classes only**, see below
- `@UseGuards(GuardClass, ...)` — apply guards to all routes. Pass the **class**, not `new Guard()`
- `@UseInterceptors(InterceptorClass, ...)` — onion-wrap every handler on the controller
- `@UseFilters(filterInstance, ...)` — apply exception filters to all routes

The four pipeline decorators do **not** take the same kind of argument, and the asymmetry is
load-bearing:

| Decorator | Pass | Why |
|---|---|---|
| `@UseMiddleware` | class only | `resolveMiddleware()` does `new cls(...deps)` unconditionally |
| `@UseGuards` | class (instance accepted) | the class form resolves deps once but constructs **per invocation**, so per-request state on `this` is safe. An instance is shared across every concurrent request and leaks that state — it can let a denied request through |
| `@UseInterceptors` | class (instance accepted) | the class form gets DI; an instance is used as-is |
| `@UseFilters` | **instance** | signature is `UseFilters(...filters: ExceptionFilter[])` — there is no class form and therefore no DI. Build the filter with `createExceptionFilter(fn)`, or `new` your own class implementing `ExceptionFilter` and close over what it needs |

**The class form gets DI only if the class carries a CLASS decorator** — `@Middleware()` on
middleware, `@Service()` on a guard or interceptor. TypeScript emits `design:paramtypes` only for a
decorated class; without it the class is constructed with NO arguments, silently, and every request
through it 500s with no hint (a decorator on a method does not count).

All four are **inherited** by a subclass controller (base entries first, then the subclass's own).
Routes are not — a `@Get` on a base class is a 404 under the subclass.

### Method-level (HTTP verbs)
- `@Get('/path')` — GET handler
- `@Post('/path')` — POST handler
- `@Put('/path')` — PUT handler
- `@Delete('/path')` — DELETE handler
- `@Patch('/path')` — PATCH handler
- `@Options('/path')` — OPTIONS handler
- `@Head('/path')` — HEAD handler
- `@All('/path')` — **true** catch-all: answers every method on that path, including verbs with
  no decorator of their own (`PROPFIND`, `QUERY`, vendor verbs). An explicitly declared verb on
  the same path always wins, regardless of decorator order
- `@Sse()` — combine with `@Get('/path')` on an `async *` generator returning `SseGenerator`

Route options (`RouteOptions`) — `timeout` is a **per-request idle timeout in SECONDS**, not ms:
<!-- typecheck: skip -->
```typescript
@Get('/long-task', { timeout: 300 })   // 5 minutes
@Get('/stream', { timeout: 0 })        // no timeout at all
```

For SSE use `@Sse()` rather than hand-tuning `timeout`: it already defaults to a 600 s timeout
and a 30 s heartbeat (`@Sse({ heartbeat: 15000 })` — heartbeat is in ms, timeout in seconds).

### Parameter decorators
- `@Body()` — parse JSON body (no validation); `undefined` when the body is not valid JSON
- `@Body(schema)` — parse + validate body. Requiredness is derived from the schema
- `@Param('name')` — path parameter from route (e.g., `/:name`). **Always required** (OpenAPI
  rule); a missing one is a 400 before the handler runs
- `@Query('key')` — one query parameter, `string | string[] | undefined`. It becomes an **array**
  when the key repeats (`?tag=a&tag=b`) or uses `[]` notation (`?tag[]=a`), so a handler that
  types it `string` and calls `.trim()` crashes on a client that sends the key twice
- `@Header('X-Custom')` — one header, `string | null` (`Headers.get()` returns `null`, not
  `undefined` — the one param decorator that does)
- `@Cookie('name')` — one cookie, `string | undefined`
- `@Req()` — the `OneBunRequest` object
- `@UploadedFile('field', opts?)`, `@UploadedFiles('field', opts?)`, `@FormField('name', opts?)`
  — multipart uploads

**Query, header and cookie parameters are OPTIONAL BY DEFAULT.** When absent the handler gets
`undefined`/`null` — no error is raised. Type them `?: string` or opt into a 400:

<!-- typecheck: skip -->
```typescript
@Query('page') page?: string                          // optional (default)
@Query('limit', { required: true }) limit: string     // 400 "Required parameter limit is missing"
@Query('sort', sortSchema) sort?: string              // per-parameter validation, still optional
@Query('sort', sortSchema, { required: true }) s: string
@Header('Authorization', { required: true }) auth: string
@Cookie('session', { required: true }) session: string
```

The signatures are `@Query(name, options?)` and `@Query(name, schema?, options?)` — `@Header`
and `@Cookie` take the same three. **There is no whole-query form.** `@Query(schema)` with no
name compiles and silently does nothing: the decorator stores `name: ''`, extraction is
`param.name ? queryParams[param.name] : undefined`, the handler receives `undefined`, and the
schema is skipped because validation only runs on a defined value. Validate query parameters one
at a time, or take `@Req()` and validate `new URL(req.url).searchParams` yourself.

## Response Patterns

Return plain data from controller methods — the framework auto-wraps it to `{ success: true, result: data }`.
For errors, throw `HttpException` — auto-converted to
`{ success: false, error: message, code: statusCode, details: {} }`. `details` is always present
(it defaults to `{}`), so a client that does `'details' in body` to detect a rich error is wrong.
With `httpEnvelope: true` in `ApplicationOptions` that body ships under HTTP 200 instead of the
real status.

<!-- typecheck: skip -->
```typescript
// Recommended: return plain data (auto-wrapped)
return users;                                        // 200 { success: true, result: users }
return { count: users.length };                      // 200 { success: true, result: { count: ... } }

// Errors: throw HttpException
throw new HttpException(HttpStatusCode.NOT_FOUND, 'Not found');

// Alternative: explicit wrappers (when you need custom HTTP status for success)
return this.success(user, HttpStatusCode.CREATED);   // 201
return this.error('Not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);  // legacy
```

Import `HttpStatusCode` and `HttpException` from `@onebun/core`.
Use `OneBunRequest` (not `Request`) with `@Req()`.

## Path Parameters

<!-- typecheck: skip -->
```typescript
@Get('/users/:id')
async getUser(@Param('id') id: string) {
  const user = await this.userService.findById(id);
  if (!user) throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
  return user;
}

@Get('/orgs/:orgId/members/:memberId')
async getMember(
  @Param('orgId') orgId: string,
  @Param('memberId') memberId: string,
) { ... }
```

## Validation Pattern

Schemas and their inferred types live in `validation/schemas.ts`.

**Import `type` from `@onebun/core`, never from `arktype`.** `arktype` is a dependency of
`@onebun/core`, not of your app — `import { type } from 'arktype'` does not even resolve in an
application that only depends on `@onebun/core`. Adding `arktype` to your own `package.json` to
make it resolve is worse: two copies of ArkType cannot compose schemas with each other, and the
failure is late. The app still **starts** — a duplicate copy only produces one `console.warn` at
decoration time — and then throws `DuplicateArkTypeError` from the first request whose validation
runs against a schema built by the other copy.

```typescript
// src/validation/schemas.ts
import { type } from '@onebun/core';

export const createSchema = type({
  name: 'string',
  'email?': 'string.email',
  age: 'number > 0',
  role: '"admin" | "user"',
});

// Export the inferred type — don't inline typeof in controllers
export type CreateBody = typeof createSchema.infer;
```

<!-- typecheck: skip -->
```typescript
// In controller — import type separately
import { createSchema, type CreateBody } from '../validation/schemas';

@Post('/')
async create(@Body(createSchema) body: CreateBody) {
  // body is guaranteed valid — validation happens at parameter extraction
  return this.service.create(body);
}
```

## Middleware Application

**Middleware is class-based only.** There is no function-based middleware: `resolveMiddleware()`
does `new cls(...deps)` on whatever you pass and then binds `instance.use`. Hand it a function and
the application crashes during `app.start()`, before it serves a request — not on the first request
through the route. A plain `function` is *called as a constructor* with zero arguments and dies with
`TypeError: next is not a function`; an `async` or arrow function is not a constructor at all and
dies earlier with `TypeError: function is not a constructor`.

**The class must carry `@Middleware()` for constructor DI to work.** TypeScript emits the
`design:paramtypes` metadata the DI reads only for a class that has at least one decorator. An
undecorated `class AuthMiddleware extends BaseMiddleware` with a service in its constructor is
constructed with NO arguments, silently, at startup; the dependency is `undefined` and every
request through it 500s with no hint about the cause.

<!-- typecheck: skip -->
```typescript
@Middleware()                       // required — otherwise authService is undefined
export class AuthMiddleware extends BaseMiddleware {
  constructor(private authService: AuthService) {
    super();                        // picks up this.logger / this.config from ambient context
  }

  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
    if (!this.authService.verify(req.headers.get('Authorization'))) {
      return new Response('Unauthorized', { status: 401 });   // short-circuits the chain
    }

    return next();
  }
}

// Class-level — applies to all routes
@Controller('/api/admin')
@UseMiddleware(AuthMiddleware, LogMiddleware)
export class AdminController extends BaseController { ... }

// Method-level — applies to single route. Class constructors here too.
@Get('/dashboard')
@UseMiddleware(LogMiddleware, AuthMiddleware)
async getDashboard() { ... }
```

Middleware is constructed at startup, never per request — but **once per attachment point**: once
for the global list, once per module, and once per controller and per route that declares it. So
`this` is safe for config, not for per-request state, and not for state you expect the whole app to
share. (Guards are the opposite: the class form is constructed per invocation. Do not carry the
habit across.)

Execution order: global → module → controller → route middleware, then guards, then interceptors,
then the handler.

## Complete Controller Example

```typescript
import {
  Controller, BaseController, Get, Post, Put, Delete,
  Param, Query, Body, Header, Req, Cookie,
  UseMiddleware, HttpStatusCode, HttpException,
  type OneBunRequest,
} from '@onebun/core';
import {
  createUserSchema, updateUserSchema,
  type CreateUserBody, type UpdateUserBody,
} from '../validation/schemas';

@Controller('/api/users')
@UseMiddleware(AuthMiddleware)
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.userService.findAll({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 10,
    });
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    const user = await this.userService.findById(id);
    if (!user) throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
    return user;
  }

  @Post('/')
  async create(
    @Body(createUserSchema) body: CreateUserBody,
    @Header('X-Request-ID') requestId?: string | null,   // headers give null, not undefined
  ) {
    this.logger.info('Creating user', { email: body.email, requestId });
    const user = await this.userService.create(body);
    return this.success(user, HttpStatusCode.CREATED);
  }

  @Put('/:id')
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: UpdateUserBody,
  ) {
    const user = await this.userService.update(id, body);
    if (!user) throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
    return user;
  }

  @Delete('/:id')
  async remove(@Param('id') id: string) {
    const deleted = await this.userService.delete(id);
    if (!deleted) throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
    return { deleted: true };
  }

  @Get('/me')
  async getCurrentUser(
    @Req() req: OneBunRequest,
    @Cookie('session') session?: string,
  ) {
    const authHeader = req.headers.get('Authorization');
    return { session, authenticated: !!authHeader };
  }
}
```
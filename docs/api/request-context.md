<llm-only>

## Quick Reference for AI

**One ambient per unit of work**, established by the framework at every entry point — HTTP request, queue delivery, scheduler tick, WebSocket frame. Not a DI scope: services stay singletons.

```typescript
import { getRequestContext, updateRequestContext } from '@onebun/core';

declare module '@onebun/core' {
  interface RequestContext {
    user?: AuthenticatedUser;   // MUST be optional
  }
}

updateRequestContext({ user });     // write — returns false outside a scope, never throws
getRequestContext()?.user;          // read — undefined outside a scope, never throws
```

**Rules:**
- An augmented member **must be optional**. A required one does not compile — `@onebun/core` ships sources, so a consumer typechecks the framework's own constructions of `RequestContext` inside `node_modules`.
- `traceContext` is the framework's and cannot be written: `RequestContextPatch` is `Partial<Omit<RequestContext, 'traceContext'>>`.
- `updateRequestContext` MERGES into the stored object, so a write from a middleware reaches the handler. It does not replace the store.
- Outside a scope both helpers are silent: `false` and `undefined`. Several framework paths deliberately have no scope — CORS preflight short-circuit, `/docs`, `/openapi.json`, `/metrics`, 404s, static assets, lifecycle hooks.
- Background work started with `inEntrySpan` gets a COPY: it reads what scheduled it, and its writes do not travel back.

</llm-only>

# Request Context

One ambient value per unit of work, established by the framework at every entry point: an HTTP request, a queue delivery, a scheduler tick, a WebSocket frame. It is where an application puts what it computes once and reads at any depth — the authenticated user, the tenant, the transaction this request opened — without threading it through every method signature.

It is backed by `AsyncLocalStorage`, so two requests in flight together never see each other's values, and a value written before an `await` is still there after it.

**It is not a DI scope.** Services remain one instance per process; see [Services](/api/services). The context is data that travels with the work, not a second lifetime for the objects that handle it.

## Extending it

Add your own members by declaration merging:

<!-- typecheck: skip -->
```typescript
declare module '@onebun/core' {
  interface RequestContext {
    user?: AuthenticatedUser;
    tenant?: string;
  }
}
```

Put this in a `.d.ts` your program includes, or at the top of the module that owns the type. Reads are then typed with no cast anywhere in the application.

::: danger An augmented member must be optional
`user?: AuthenticatedUser`, never `user: AuthenticatedUser`.

`@onebun/core` ships TypeScript sources rather than built declarations, so your program typechecks the framework's own files. The framework constructs a `RequestContext` carrying only `traceContext`; a required augmented member makes each of those constructions an error inside `node_modules`, where there is nothing you can edit to fix it.

Nothing catches this for you — `docs:typecheck` discards diagnostics from files that are not snippets, and the error surfaces only in a consumer build.
:::

## Reading and writing

```typescript
import { getRequestContext, updateRequestContext } from '@onebun/core';

// In a middleware or a guard, once per request:
updateRequestContext({ user: await verifyToken(req) });

// Anywhere below it — a controller, a service, a repository:
const user = getRequestContext()?.user;
```

`updateRequestContext` **merges** into the stored object and returns whether there was one. Merging rather than replacing is what makes it useful: `AsyncLocalStorage` propagates a mutation of the stored object both outward and inward, while replacing the store's value is only possible by opening a new scope — whose effect ends with that scope, so a middleware that wrote a replacement would leave the handler reading the old value.

`traceContext` cannot be written. It is the framework's, it must agree with the active span, and a caller who replaced it would make every log line and every outgoing `traceparent` name a span that does not exist.

::: warning Outside a scope both helpers are silent
`getRequestContext()` returns `undefined` and `updateRequestContext()` returns `false`. Neither throws, because code shared between a request handler and something else must not have to know which it is running in.

Several framework paths deliberately have no scope: the CORS preflight short-circuit, the `/docs`, `/openapi.json` and `/metrics` endpoints, 404s and static assets — which skip the `AsyncLocalStorage` frame on purpose, being the cheapest path in the server — and every lifecycle hook. A guard used on both a route and any of those would fail on the wrong one if these threw.

Use the boolean when the answer matters:

```typescript
if (!updateRequestContext({ tenant })) {
  logger.warn('no request scope here — tenant not recorded');
}
```
:::

## On every transport

The scope exists at all four entry points, not only HTTP. That is what lets one helper — and one custom decorator built on it — mean the same thing on a route, a `@Subscribe` consumer, a `@Cron` job and an `@OnMessage` handler.

Background work gets a **copy** of the context that scheduled it. It reads what that work had, and its own writes stay with it:

```typescript
updateRequestContext({ tenant: 'acme' });

await queue.publish('orders.created', order);
// the consumer reads tenant 'acme', and anything it writes does not travel back here
```

An untraced handler enters the scope with a `null` trace context, because there is no span to name — the context still exists and is still writable. See [Tracing](/api/trace) for how a trace id is resolved.

## Establishing a scope yourself

The framework opens a scope at every entry point it owns. Code that invents its own entry point — a bespoke worker loop, a test that drives a service directly — opens one with `requestContextStore` and `createRequestContext`:

```typescript
import { createRequestContext, getRequestContext, requestContextStore } from '@onebun/core';

await requestContextStore.run(createRequestContext(null), async () => {
  // Inside here `getRequestContext()` answers, and `updateRequestContext()` returns true.
  const ctx = getRequestContext();

  await Promise.resolve(ctx);
});
```

`createRequestContext(null)` rather than an object literal: it is the one place a framework-side default for a member would be applied, so a literal would drift.

## Why not request-scoped services

Per-request service instances would put a construction on the hot path of every request, for a need that is almost always "carry this value", not "give me a different object". One ambient carries the value; the services stay singletons and stay cheap.

The cost is that a service cannot *declare* its need for the current user in its constructor — it asks for it where it uses it. That is deliberate: it keeps the dependency graph static and checkable, and it keeps the value's lifetime tied to the work rather than to an object.

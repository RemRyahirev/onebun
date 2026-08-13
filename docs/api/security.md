---
description: Built-in security middleware — CORS, rate limiting, and HTTP security headers.
---

<llm-only>

## Quick Reference for AI

**Imports:**
```typescript
import {
  CorsMiddleware,
  RateLimitMiddleware,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  SecurityHeadersMiddleware,
} from '@onebun/core';
```

**Shorthand options on `ApplicationOptions`:**
- `cors: true` or `cors: CorsOptions` — auto-adds `CorsMiddleware` before user middleware
- `rateLimit: true` or `rateLimit: RateLimitOptions` — auto-adds `RateLimitMiddleware` after CORS
- `security: true` or `security: SecurityHeadersOptions` — auto-adds `SecurityHeadersMiddleware` after user middleware

**Manual via `middleware` array:**
```typescript
middleware: [CorsMiddleware.configure({ origin: 'https://example.com' })]
```

**Auto-ordering:** CORS → RateLimit → [user middleware] → SecurityHeaders

**CORS preflight:** `CorsMiddleware` answers `OPTIONS` only on a path that declares an
`OPTIONS`-capable route (`@Options()` or `@All()`). On any other path `OPTIONS` falls through to the
`404` fallback with NO `Access-Control-*` headers. Headers are added to every response of a matched
route (errors included), never to fallback 404s.

**Rate limit response:** HTTP 429, `{ success: false, error: 'Too Many Requests', code: 429, details: {} }`.
`Retry-After` is sent only when `legacyHeaders: true`

**Rate limit backends:**
- `MemoryRateLimitStore` — default, in-process only
- `RedisRateLimitStore(redisClient)` — shared across instances

**Security headers set by default (all helmet-equivalent):**
Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security,
Referrer-Policy, X-XSS-Protection, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy,
Origin-Agent-Cluster, X-DNS-Prefetch-Control, X-Download-Options, X-Permitted-Cross-Domain-Policies

</llm-only>

# Security Middleware

OneBun provides three built-in security middleware components that can be enabled via `ApplicationOptions` shorthand properties or applied manually via the `middleware` array.

## Quick Setup

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  cors: { origin: 'https://my-frontend.example.com', credentials: true },
  rateLimit: { windowMs: 60_000, max: 100 },
  security: true,  // use all defaults
});

await app.start();
```

**Auto-ordering when all three are active:**

```
Request → CorsMiddleware → RateLimitMiddleware → [your middleware] → SecurityHeadersMiddleware → Handler
```

---

## CorsMiddleware

Adds `Access-Control-*` headers to every response that comes from a matched route, including
error responses. A preflight is answered only where the path carries an `OPTIONS`-capable route:
declare `@Options()` — or [`@All()`](/api/decorators#all-catch-all-routes) — on any path a browser
will preflight. Without one the `OPTIONS` request never enters the middleware chain and answers a
bare `404` with no CORS headers, so a cross-origin `POST` to a path that only declares `@Post()` is
blocked at preflight. The same bare `404` is what an unmatched path, or an unmatched verb on a
matched path, returns — no CORS headers there either.

### Via `ApplicationOptions.cors`

```typescript
const app = new OneBunApplication(AppModule, {
  cors: {
    origin: 'https://my-frontend.example.com',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 3600,
  },
});
```

Pass `cors: true` to allow all origins with default settings.

### Via `middleware` array (manual configuration)

```typescript
import { CorsMiddleware } from '@onebun/core';

const app = new OneBunApplication(AppModule, {
  middleware: [
    CorsMiddleware.configure({
      origin: /\.example\.com$/,  // RegExp origin matching
    }),
  ],
});
```

### CorsOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | `string \| RegExp \| Array<...> \| ((origin) => boolean)` | `'*'` | Allowed origin(s) |
| `methods` | `string[]` | `['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS']` | Allowed methods |
| `allowedHeaders` | `string[]` | `['Content-Type', 'Authorization']` | Allowed request headers |
| `exposedHeaders` | `string[]` | — | Headers exposed to the browser |
| `credentials` | `boolean` | `false` | Allow cookies / credentials |
| `maxAge` | `number` | `86400` | Preflight cache duration (seconds) |
| `preflightContinue` | `boolean` | `false` | Pass OPTIONS to next handler |

### Origin variants

```typescript
// Any origin (default)
cors: true

// Exact string
cors: { origin: 'https://example.com' }

// RegExp
cors: { origin: /\.example\.com$/ }

// Array
cors: { origin: ['https://app1.com', 'https://app2.com', /\.dev$/] }

// Function predicate
cors: { origin: (o) => o.startsWith('https://trusted') }
```

---

## RateLimitMiddleware

Limits the number of requests per time window per client. Supports in-memory and Redis backends.

The client is identified by the **transport peer address** — the address the TCP connection
actually came from, read via `server.requestIP()`. It is not taken from a header, so a caller
cannot move itself into a fresh bucket by setting one. See
[Client identification and `trustProxy`](#client-identification-and-trustproxy) for running
behind a load balancer.

### Via `ApplicationOptions.rateLimit`

```typescript
const app = new OneBunApplication(AppModule, {
  rateLimit: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 200,                   // 200 requests per window
  },
});
```

Pass `rateLimit: true` for defaults (100 requests / 60 seconds, in-memory, keyed on the
transport peer address).

### Client identification and `trustProxy`

`ApplicationOptions.trustProxy` decides whether the proxy headers a caller sends may override
the transport peer. It is `false` by default and lives on the **application**, not on the rate
limiter, because it settles one question — "who called" — for everything that asks: the default
rate-limit key and the `remoteAddr` field on HTTP spans.

| `trustProxy` | Client address is | Use when |
|---|---|---|
| `false` (default) | the transport peer from `server.requestIP()` | the app is reachable directly, or you are unsure |
| `true` | first entry of `x-forwarded-for`, else `cf-connecting-ip`, else `x-real-ip`, else the peer | **every** request arrives through a proxy that overwrites those headers |

```typescript
// Direct exposure — headers are ignored, the peer is the bucket
const app = new OneBunApplication(AppModule, {
  rateLimit: { windowMs: 60_000, max: 100 },
});

// Behind a load balancer that sets x-forwarded-for
const app = new OneBunApplication(AppModule, {
  trustProxy: true,
  rateLimit: { windowMs: 60_000, max: 100 },
});
```

::: warning Do not enable `trustProxy` on a directly reachable app
`x-forwarded-for` is just a request header. If clients can reach the application without passing
through a proxy that overwrites it, `trustProxy: true` lets any caller pick its own rate-limit
bucket — a fresh header value per request means no effective limit at all. Conversely, leaving it
off *behind* a proxy makes every request appear to come from the proxy, so all callers share one
bucket. Match the setting to your deployment.
:::

#### Reading the client address yourself

`getClientAddress(req)` returns the same address the framework uses, honouring `trustProxy`.
`getPeerAddress(req)` always returns the transport peer, ignoring headers entirely.

```typescript
import { getClientAddress, RateLimitMiddleware } from '@onebun/core';

RateLimitMiddleware.configure({
  // Authenticated callers get their own bucket; anonymous ones fall back to their address
  keyGenerator: (req) => req.headers.get('x-api-key') ?? getClientAddress(req) ?? 'unknown',
});
```

Both return `undefined` for a `Request` that never went through a OneBun server (a
hand-constructed one in a unit test, for example). The default key generator falls back to
`'unknown'` in that case; on a served request the peer is always known.

### Redis-backed (multi-instance)

`SharedRedisProvider` must be configured before the first `getClient()` call — there is no
auto-configuration and no `REDIS_URL` fallback, so calling it unconfigured throws
`SharedRedisProvider not configured`.

```typescript
import { RateLimitMiddleware, RedisRateLimitStore } from '@onebun/core';
import { SharedRedisProvider } from '@onebun/core';

SharedRedisProvider.configure({ url: 'redis://localhost:6379' });

const redis = await SharedRedisProvider.getClient();

const app = new OneBunApplication(AppModule, {
  middleware: [
    RateLimitMiddleware.configure({
      windowMs: 60_000,
      max: 100,
      store: new RedisRateLimitStore(redis),
    }),
  ],
});
```

`getClient()` takes a lease on the shared connection — call `await SharedRedisProvider.release()`
on shutdown to give it back.

### Custom key generator

```typescript
RateLimitMiddleware.configure({
  max: 50,
  windowMs: 60_000,
  keyGenerator: (req) => req.headers.get('x-api-key') ?? 'anon',
})
```

### RateLimitOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `windowMs` | `number` | `60_000` | Time window in ms |
| `max` | `number` | `100` | Max requests per window |
| `keyGenerator` | `(req) => string` | `getClientAddress(req) ?? 'unknown'` | Key for grouping requests |
| `message` | `string` | `'Too Many Requests'` | Error message when limit exceeded |
| `standardHeaders` | `boolean` | `true` | Add `RateLimit-*` headers |
| `legacyHeaders` | `boolean` | `false` | Add the legacy `X-RateLimit-*` headers, plus `Retry-After` on the 429 |
| `store` | `RateLimitStore` | `MemoryRateLimitStore` | Storage backend |

### Rate limit response (HTTP 429)

```json
{
  "success": false,
  "error": "Too Many Requests",
  "code": 429,
  "details": {}
}
```

Response headers (when `standardHeaders: true`):
- `RateLimit-Limit: 100`
- `RateLimit-Remaining: 0`
- `RateLimit-Reset: 42` (seconds until window resets)

`Retry-After` (same value as `RateLimit-Reset`) is sent only when `legacyHeaders: true`, and only
on the 429 — never on a successful response. It does not depend on `standardHeaders`.

---

## SecurityHeadersMiddleware

Sets security-related HTTP response headers on every response — analogous to [helmet](https://helmetjs.github.io/).

### Via `ApplicationOptions.security`

```typescript
// All defaults
const app = new OneBunApplication(AppModule, { security: true });

// Custom configuration
const app = new OneBunApplication(AppModule, {
  security: {
    contentSecurityPolicy: "default-src 'self'; img-src *",
    strictTransportSecurity: false,  // disable HSTS in development
  },
});
```

### Default headers set

| Header | Default value |
|--------|---------------|
| `Content-Security-Policy` | `default-src 'self'` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0` (disabled — use CSP instead) |

### SecurityHeadersOptions

Each property accepts a `string` (custom value) or `false` (disable the header entirely).

```typescript
security: {
  contentSecurityPolicy: "default-src 'self'; connect-src 'self' https://api.example.com",
  xFrameOptions: 'DENY',
  strictTransportSecurity: false,  // disable in local dev
}
```

---

## Implementing a Custom Store

You can plug in any storage backend by implementing the `RateLimitStore` interface:

```typescript
import type { RateLimitStore } from '@onebun/core';

class MyCustomStore implements RateLimitStore {
  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }> {
    // ...custom logic...
    return { count: 1, resetAt: Date.now() + windowMs };
  }
}

const app = new OneBunApplication(AppModule, {
  middleware: [
    RateLimitMiddleware.configure({ store: new MyCustomStore() }),
  ],
});
```

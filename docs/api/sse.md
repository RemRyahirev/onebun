---
description: "SSE (Server-Sent Events) support — @Sse() decorator, Controller.sse() programmatic API, SseEvent interface, heartbeat, proxy pattern."
---

<llm-only>

## Quick Reference for AI

**Two patterns for SSE in OneBun:**

1. **@Sse() decorator** — mark an async generator method; framework handles Response creation
2. **Controller.sse()** — programmatic; call from any route handler, returns a Response

**Decorator pattern (preferred for simple cases):**
```typescript
@Get('/events')
@Sse()
async *events(): SseGenerator {
  yield { event: 'ping', data: { ts: Date.now() } };
}
```

**Programmatic pattern (for dynamic sources, proxying):**
```typescript
@Get('/events')
events(): Response {
  return this.sse(this.generateEvents());
}

// With AbortSignal for proxying:
@Get('/proxy')
proxy(): Response {
  return this.sse((signal) => this.upstream(signal));
}
```

**SseEvent interface:**
```typescript
interface SseEvent {
  event?: string;   // event name (default: 'message')
  data: unknown;    // JSON-serialized payload
  id?: string;      // reconnection ID (Last-Event-ID)
  retry?: number;   // reconnection interval (ms)
}
```

**Key types:** `SseGenerator`, `SseOptions` (`heartbeat`, `onAbort`), `SseDecoratorOptions` (`heartbeat`, `timeout`)

**Helper functions:** `formatSseEvent(event)`, `createSseStream(source, options)`

**Constants:** `DEFAULT_SSE_HEARTBEAT_MS` = 30000, `DEFAULT_SSE_TIMEOUT` = 600, `DEFAULT_IDLE_TIMEOUT` = 120

**Imports:**
```typescript
import { Sse, type SseGenerator, type SseEvent, type SseOptions, formatSseEvent, createSseStream, DEFAULT_SSE_HEARTBEAT_MS, DEFAULT_SSE_TIMEOUT } from '@onebun/core';
```

</llm-only>

# SSE (Server-Sent Events) API

Package: `@onebun/core`

## Overview

OneBun provides built-in support for [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE) — a standard for streaming real-time updates from server to client over HTTP.

Two patterns are available:

- **`@Sse()` decorator** — annotate an async generator method. The framework automatically creates the SSE response with correct headers, heartbeat, and timeout.
- **`Controller.sse()` method** — programmatic API for when you need more control. Call it from any route handler and get a `Response` back.

Both patterns produce the same wire format (`text/event-stream`) and support heartbeat keep-alive, client disconnect detection, and cleanup.

## Quick Start

Minimal SSE endpoint using the `@Sse()` decorator:

```typescript
import { Controller, Module, Get, Sse, type SseGenerator } from '@onebun/core';

@Controller('/api')
class EventController {
  @Get('/events')
  @Sse()
  async *events(): SseGenerator {
    yield { event: 'connected', data: { timestamp: Date.now() } };

    for (let i = 0; i < 10; i++) {
      await Bun.sleep(1000);
      yield { event: 'tick', data: { count: i } };
    }

    yield { event: 'done', data: { total: 10 } };
  }
}

@Module({ controllers: [EventController] })
export class AppModule {}
```

The framework sets the response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`) and starts streaming events as the generator yields them.

## SseEvent Interface

Each yielded value can be an `SseEvent` object or raw data. Raw data is wrapped in a default `data:` frame automatically.

```typescript
interface SseEvent {
  /** Event name (optional, defaults to 'message') */
  event?: string;
  /** Event data (will be JSON serialized) */
  data: unknown;
  /** Event ID for reconnection (Last-Event-ID header) */
  id?: string;
  /** Reconnection interval in milliseconds */
  retry?: number;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string?` | Event name. Clients filter on this via `EventSource.addEventListener(name, ...)`. Omit for the default `message` event. |
| `data` | `unknown` | Payload. Strings are sent as-is; everything else is `JSON.stringify()`-ed. Multi-line data is split into multiple `data:` lines per the SSE spec. |
| `id` | `string?` | Sets the `Last-Event-ID` on the client. On reconnect, the browser sends this back via the `Last-Event-ID` header so you can resume. |
| `retry` | `number?` | Tells the client how many milliseconds to wait before reconnecting after a disconnect. |

### Wire format examples

```typescript
// Named event with ID
yield { event: 'update', data: { count: 42 }, id: '123' };
// Wire: event: update\nid: 123\ndata: {"count":42}\n\n

// Simple data (no event name → default 'message' event)
yield { data: { message: 'Hello' } };
// Wire: data: {"message":"Hello"}\n\n

// Raw data (not an SseEvent object)
yield { message: 'Hello' };
// Wire: data: {"message":"Hello"}\n\n

// With retry
yield { event: 'status', data: { online: true }, retry: 5000 };
// Wire: event: status\nretry: 5000\ndata: {"online":true}\n\n
```

## @Sse() Decorator

Marks a controller method as an SSE endpoint. The method must be an async generator that yields `SseEvent` objects (or raw data).

```typescript
import { Get, Sse, type SseGenerator } from '@onebun/core';

@Get('/events')
@Sse()
async *events(): SseGenerator {
  // yield events...
}
```

### SseDecoratorOptions

```typescript
interface SseDecoratorOptions {
  /**
   * Heartbeat interval in milliseconds.
   * Sends a comment (": heartbeat\n\n") at this interval to keep the connection alive.
   * @defaultValue 30000 (30 seconds)
   */
  heartbeat?: number;

  /**
   * Per-request idle timeout in seconds for this SSE connection.
   * Overrides the global `idleTimeout` from ApplicationOptions.
   * Set to 0 to disable the timeout entirely.
   * @defaultValue 600 (10 minutes)
   */
  timeout?: number;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `heartbeat` | `number?` | `30000` (30s) | Interval in ms between heartbeat comments. Prevents proxies/load balancers from closing idle connections. |
| `timeout` | `number?` | `600` (10min) | Per-request idle timeout in seconds. SSE connections are long-lived, so they get a longer timeout than regular HTTP requests (default 120s). Set to `0` to disable. |

### Examples

```typescript
// Default: 30s heartbeat, 10min timeout
@Get('/events')
@Sse()
async *events(): SseGenerator { /* ... */ }

// Custom heartbeat (15s) for aggressive proxies
@Get('/live')
@Sse({ heartbeat: 15000 })
async *liveUpdates(): SseGenerator { /* ... */ }

// Long-running stream with no timeout
@Get('/stream')
@Sse({ heartbeat: 30000, timeout: 0 })
async *infiniteStream(): SseGenerator { /* ... */ }
```

## Controller.sse() Method

The programmatic API for SSE. Available on all controllers that extend `BaseController`. Returns a `Response` object — use it when the `@Sse()` decorator doesn't fit (dynamic sources, SSE proxying, conditional streaming).

### Signatures

```typescript
// Basic: pass an async iterable
protected sse(source: AsyncIterable<SseEvent | unknown>, options?: SseOptions): Response;

// Factory: receive an AbortSignal, return an async iterable
protected sse(
  source: (signal: AbortSignal) => AsyncIterable<SseEvent | unknown>,
  options?: SseOptions
): Response;
```

### SseOptions

```typescript
interface SseOptions {
  /**
   * Heartbeat interval in milliseconds.
   * Sends a comment (": heartbeat\n\n") at this interval.
   */
  heartbeat?: number;

  /**
   * Callback invoked when the client disconnects or aborts the SSE connection.
   * Useful for cleanup logic (unsubscribe, release resources).
   *
   * For @Sse() decorator usage, prefer try/finally in the generator instead.
   */
  onAbort?: () => void;
}
```

| Option | Type | Description |
|--------|------|-------------|
| `heartbeat` | `number?` | Heartbeat interval in ms (no default — set explicitly if needed) |
| `onAbort` | `() => void` | Called when the client disconnects. Use for cleanup when you can't use `try/finally` in the generator. |

### Usage examples

```typescript
import { Controller, Get, type SseEvent, type SseGenerator } from '@onebun/core';

@Controller('/api')
class StreamController {
  // Basic: pass an async generator directly
  @Get('/events')
  events(): Response {
    return this.sse(this.generateEvents());
  }

  // With options: heartbeat + cleanup callback
  @Get('/live')
  live(): Response {
    const subscription = this.dataService.subscribe();
    return this.sse(subscription, {
      heartbeat: 15000,
      onAbort: () => this.dataService.unsubscribe(subscription),
    });
  }

  // Factory pattern: AbortSignal for upstream proxying
  @Get('/proxy')
  proxy(): Response {
    return this.sse((signal) => this.proxyUpstream(signal));
  }

  private async *generateEvents(): SseGenerator {
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(1000);
      yield { event: 'tick', data: { count: i } };
    }
  }

  private async *proxyUpstream(signal: AbortSignal): SseGenerator {
    // When the client disconnects, signal is aborted → fetch is cancelled
    const response = await fetch('https://api.example.com/events', { signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        // Parse and re-emit SSE events from upstream
        yield { event: 'upstream', data: text };
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

## SseGenerator Type

The return type for `@Sse()`-decorated async generator methods:

```typescript
type SseGenerator = AsyncGenerator<SseEvent | unknown, void, unknown>;
```

Yields `SseEvent` objects for structured events, or any other value (which gets JSON-serialized as a default `data:` frame).

## Helper Functions

OneBun exports two helper functions for advanced use cases (custom middleware, non-controller SSE, etc.):

### formatSseEvent()

Converts an event object into SSE wire format (the `event:`, `id:`, `retry:`, `data:` text protocol).

```typescript
import { formatSseEvent } from '@onebun/core';

formatSseEvent({ event: 'update', data: { count: 1 }, id: '123' });
// Returns: "event: update\nid: 123\ndata: {\"count\":1}\n\n"

formatSseEvent({ count: 1 });
// Returns: "data: {\"count\":1}\n\n"
```

### createSseStream()

Creates a `ReadableStream<Uint8Array>` from an async iterable. This is what `Controller.sse()` uses internally. Use it when you need to build the `Response` yourself.

```typescript
import { createSseStream, type SseEvent } from '@onebun/core';

async function* myEvents(): AsyncGenerator<SseEvent> {
  yield { event: 'hello', data: { msg: 'world' } };
}

const stream = createSseStream(myEvents(), { heartbeat: 30000 });
const response = new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
});
```

## Constants

```typescript
import {
  DEFAULT_SSE_HEARTBEAT_MS,
  DEFAULT_SSE_TIMEOUT,
  DEFAULT_IDLE_TIMEOUT,
} from '@onebun/core';
```

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_SSE_HEARTBEAT_MS` | `30000` (30s) | Default heartbeat interval for `@Sse()` decorator |
| `DEFAULT_SSE_TIMEOUT` | `600` (10min) | Default idle timeout for SSE connections (seconds) |
| `DEFAULT_IDLE_TIMEOUT` | `120` (2min) | Default idle timeout for regular HTTP connections (seconds) |

## Examples

### Basic event stream

```typescript
@Get('/notifications')
@Sse()
async *notifications(): SseGenerator {
  while (true) {
    const notification = await this.notificationService.waitForNext();
    yield {
      event: 'notification',
      data: notification,
      id: notification.id,
    };
  }
}
```

### Named events with IDs

```typescript
@Get('/updates')
@Sse()
async *updates(): SseGenerator {
  let counter = 0;

  yield { event: 'init', data: { version: '1.0' }, id: String(counter++) };

  for await (const update of this.updateService.stream()) {
    yield {
      event: update.type,  // 'create', 'update', 'delete'
      data: update.payload,
      id: String(counter++),
    };
  }
}
```

### Heartbeat configuration

```typescript
// Aggressive heartbeat for environments behind Cloudflare/nginx with short timeouts
@Get('/live')
@Sse({ heartbeat: 10000, timeout: 0 })
async *liveData(): SseGenerator {
  for await (const data of this.dataService.subscribe()) {
    yield { event: 'data', data };
  }
}
```

### SSE proxy / relay pattern

Forward events from an upstream SSE source to clients. The factory pattern with `AbortSignal` ensures the upstream connection is cleaned up when the client disconnects.

```typescript
@Get('/relay')
relay(): Response {
  return this.sse((signal) => this.relayUpstream(signal));
}

private async *relayUpstream(signal: AbortSignal): SseGenerator {
  const upstream = await fetch('https://api.example.com/stream', { signal });
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop()!; // keep incomplete event in buffer

      for (const raw of events) {
        if (!raw.trim()) continue;
        yield { event: 'relayed', data: raw };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

### Cleanup with try/finally in generators

For `@Sse()` decorator usage, use `try/finally` in the generator for cleanup instead of `onAbort`:

```typescript
@Get('/stream')
@Sse({ heartbeat: 15000 })
async *stream(): SseGenerator {
  const subscription = this.pubsub.subscribe('events');

  try {
    for await (const event of subscription) {
      yield { event: 'update', data: event };
    }
  } finally {
    // Always runs: generator completes OR client disconnects
    await this.pubsub.unsubscribe(subscription);
    this.logger.info('SSE client disconnected, cleaned up subscription');
  }
}
```

## Client-Side Usage

SSE is consumed via the standard [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) API:

```typescript
const source = new EventSource('/api/events');

// Default 'message' events (no event name in SseEvent)
source.onmessage = (e) => {
  console.log('Data:', JSON.parse(e.data));
};

// Named events
source.addEventListener('notification', (e) => {
  const notification = JSON.parse(e.data);
  console.log('Notification:', notification);
});

// Connection lifecycle
source.onopen = () => console.log('Connected');
source.onerror = (e) => {
  console.error('SSE error:', e);
  // EventSource automatically reconnects
};

// Clean up when done
source.close();
```

> **Reconnection:** `EventSource` automatically reconnects on disconnect. If your events include `id` fields, the browser sends the last ID via `Last-Event-ID` header on reconnect — use this to resume the stream from where the client left off.

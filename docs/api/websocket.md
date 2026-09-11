---
description: "@WebSocketGateway decorator, message handlers (@OnMessage, @OnConnect), rooms, guards, native WebSocket and Socket.IO."
---

# WebSocket Gateway API

## Overview

OneBun provides a WebSocket Gateway system similar to NestJS. Two protocols are supported:

- **Native WebSocket** — default; simple JSON messages `{ event, data }`. No extra handshake or heartbeat.
- **Socket.IO** — optional; runs on a separate path (e.g. `/socket.io`), full Engine.IO/Socket.IO protocol for compatibility with `socket.io-client`.

Gateways are **controllers**: you register them in the module's `controllers` array and pass WebSocket options to the application.

## Quick Start

Minimal setup: a gateway, a module that lists it as a controller, and application options that enable WebSocket.

```typescript
// gateway.ts
import { WebSocketGateway, BaseWebSocketGateway, OnConnect, OnMessage, Client, MessageData } from '@onebun/core';
import type { WsClientData } from '@onebun/core';

@WebSocketGateway({ path: '/ws' })
export class AppGateway extends BaseWebSocketGateway {
  @OnConnect()
  handleConnect(@Client() client: WsClientData) {
    return { event: 'welcome', data: { id: client.id } };
  }

  @OnMessage('ping')
  handlePing() {
    return { event: 'pong', data: {} };
  }
}
```

```typescript
// app.module.ts
import { Module } from '@onebun/core';
import { AppGateway } from './gateway';

@Module({
  controllers: [AppGateway],  // Gateways are controllers — add your gateway here
  providers: [],
})
export class AppModule {}
```

```typescript
// index.ts
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  websocket: {
    // Optional: storage, socketio, maxPayload
  },
});

await app.start();
// Native WebSocket: ws://localhost:3000/ws
```

> **Gateways are controllers**  
> A WebSocket gateway is a controller. You must add it to your module's `controllers` array (e.g. `@Module({ controllers: [AppGateway, ChatGateway], providers: [...] })`). The framework discovers gateways from that list and does not register HTTP routes for them.

## Configuration

Pass `websocket` in the application options to enable and tune WebSocket and optionally Socket.IO.

### Application options

```typescript
const app = new OneBunApplication(AppModule, {
  port: 3000,
  websocket: {
    enabled: true,              // default: auto (enabled if gateways exist)
    storage: {
      type: 'memory',            // 'memory' | 'redis'
      redis: {
        url: 'redis://localhost:6379',
        prefix: 'ws:',
      },
    },
    socketio: {
      enabled: false,            // set true to enable Socket.IO on a separate path
      path: '/socket.io',
      pingInterval: 25000,
      pingTimeout: 20000,
    },
    maxPayload: 1048576,         // 1MB
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | auto | Enable WebSocket (auto when gateways exist) |
| `storage` | object | - | `memory` or `redis` storage |
| `socketio.enabled` | `boolean` | `false` | Enable Socket.IO protocol on `socketio.path` |
| `socketio.path` | `string` | `'/socket.io'` | Path for Socket.IO connections |
| `socketio.pingInterval` | `number` | `25000` | Socket.IO heartbeat interval (ms) |
| `socketio.pingTimeout` | `number` | `20000` | Socket.IO heartbeat timeout (ms) |
| `maxPayload` | `number` | `1048576` | Max message size (bytes) |

On startup you will see separate log lines for each protocol, for example:

- `WebSocket server (native) enabled at ws://127.0.0.1:3000`
- `WebSocket server (Socket.IO) enabled at ws://127.0.0.1:3000/socket.io` (only when `socketio.enabled` is true)

## Native WebSocket

Default mode. Clients connect to the gateway path (e.g. `ws://host:port/ws`). Messages are plain JSON: `{ "event": "string", "data": any, "ack"?: number }`.

### Message format

- **Client → Server**: `{ "event": "eventName", "data": payload, "ack"?: number }`
- **Server → Client**: same shape; `ack` used for request-response.

### Typed client (native)

Use `createWsClient` with `protocol: 'native'` (or omit; it is the default). Connect to the gateway path.

```typescript
import { createWsServiceDefinition, createWsClient } from '@onebun/core';
import { AppModule } from './app.module';

const definition = createWsServiceDefinition(AppModule);
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/ws',
  protocol: 'native',
  auth: { token: 'xxx' },
});

await client.connect();
const reply = await client.AppGateway.emit('ping', {});
client.AppGateway.on('pong', (data) => console.log(data));
client.disconnect();
```

### Standalone client (no definition)

When you do not want to depend on backend modules (e.g. frontend in a monorepo), use `createNativeWsClient`. Same message format and API (emit, send, on, off), but no gateway proxies and no `createWsServiceDefinition`.

```typescript
import { createNativeWsClient } from '@onebun/core';

const client = createNativeWsClient({
  url: 'ws://localhost:3000/chat',
  protocol: 'native',
  auth: { token: 'xxx' },
});

await client.connect();

// Lifecycle
client.on('connect', () => console.log('Connected'));
client.on('disconnect', (reason) => console.log('Disconnected', reason));

// Server events (same event names as your gateway)
client.on('welcome', (data) => console.log(data));
client.on('chat:message', (msg) => console.log(msg));

await client.emit('chat:message', { text: 'Hello' });
client.send('typing', {});

client.disconnect();
```

## Socket.IO

To use Socket.IO, enable it in application options and connect clients to the Socket.IO path.

### Enabling Socket.IO

```typescript
const app = new OneBunApplication(AppModule, {
  port: 3000,
  websocket: {
    socketio: {
      enabled: true,
      path: '/socket.io',
      pingInterval: 25000,
      pingTimeout: 20000,
    },
  },
});
```

Clients must connect to the Socket.IO path (e.g. `ws://localhost:3000/socket.io` with query `EIO=4&transport=websocket`).

### Using socket.io-client

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  path: '/socket.io',
  transports: ['websocket'],
  auth: { token: 'user-jwt' },
});

socket.on('connect', () => console.log('Connected', socket.id));
socket.on('welcome', (data) => console.log('Welcome', data));
socket.emit('ping', {}, (ack) => console.log('Pong', ack));
socket.disconnect();
```

### Typed client (Socket.IO)

Use `createWsClient` with `protocol: 'socketio'` and a URL that includes the Socket.IO path.

```typescript
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/socket.io',
  protocol: 'socketio',
  auth: { token: 'xxx' },
});
await client.connect();
```

### Protocol support

- Engine.IO v4, Socket.IO v4
- WebSocket and HTTP long-polling transports
- Acknowledgements
- Binary data (base64 encoded)

## WebSocketGateway decorator

The `@WebSocketGateway` decorator marks a class as a WebSocket gateway.

```typescript
@WebSocketGateway({ path: '/ws', namespace: 'chat' })
export class ChatGateway extends BaseWebSocketGateway {
  // handlers...
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `'/'` | WebSocket connection path |
| `namespace` | `string` | - | Distinguishes gateways that share a path. See [Which gateway a connection belongs to](#which-gateway-a-connection-belongs-to) |
| `authenticate` | `(ctx) => WsAuthResult \| Promise<WsAuthResult>` | - | Authenticates the client during the upgrade. See below |

### Which gateway a connection belongs to

A connection is bound to exactly ONE gateway, decided at upgrade from the URL it connected to.
That gateway's `@OnConnect`, `@OnMessage`, `@OnJoinRoom`, `@OnLeaveRoom` and `@OnDisconnect`
handlers are the only ones that run for it, and it appears only in that gateway's `clients`.

Everything a gateway sends covers the connections IT admitted: `broadcast()`, `emit()`,
`emitToRoom()`/`emitToRooms()`/`emitToRoomPattern()`, `disconnectClient()`, `disconnectAll()`.
`emit()`, `joinRoom()`, `leaveRoom()` and `disconnectClient()` do nothing for a client another
gateway owns. The scope is also per-application: two applications in one process do not see
each other's connections.

Everything a gateway READS is scoped the same way. `clients`, `rooms`, `getClient()`,
`getRoom()`, `getClientsByRoom()` and `getRoomsByPattern()` answer only about connections this
gateway admitted: a room only another gateway ever touched does not exist as far as this one is
concerned, and a room with members on both sides lists only its own. Room storage is shared by
every gateway in the application, so this is a filter rather than a partition — two gateways may
use the same room name without meeting.

With the Redis storage adapter, a remote event reaches the gateway that published it and no
other: the published payload carries the publishing gateway's key. A payload that carries none —
published by an instance running an older build — is still delivered, and the receiving gateway
says so once, so a rolling deploy neither breaks nor goes quiet.

For a room fan-out through Bun's native pub/sub — one call, fan-out in the runtime rather than
a send per socket — use `publishToRoom(room, event, data)`. It addresses a topic scoped to this
gateway, so a room name used by two gateways does not collide.

::: warning
`getWsServer().publish(topic, …)` is NOT fenced. Bun's native pub/sub topics are a process-wide
namespace and sockets are subscribed to the raw room name, so a message published that way
reaches any socket subscribed to that topic regardless of which gateway admitted it. That is
unchanged on purpose — existing `publish('lobby', …)` calls keep working exactly as they did.
Use `emitToRoom()` or `publishToRoom()` when you want the gateway boundary respected.
:::

`namespace` distinguishes two gateways that would otherwise share a path. A client selects one by
connecting with `?namespace=<name>`; OneBun's own `WsClient` sends that automatically when its
`namespace` option is set. A namespace that matches no gateway is ignored and resolution falls
back to the path — it never refuses the connection. Isolation does not depend on this option:
the binding above holds either way.

::: warning
With the Socket.IO protocol enabled, every client arrives on one path, so `?namespace=` is the
only thing that can tell two gateways apart. Without it, a single registered gateway is
unambiguous; with more than one the client is bound to the first and a warning is logged. The
Socket.IO `nsp` field in the CONNECT packet is echoed but does not select a gateway — the client
receives the `@OnConnect` reply before it sends that packet.
:::

Because a Socket.IO client is now bound to a gateway at upgrade, that gateway's `authenticate`
hook runs for it. It did not before: no gateway was resolved on the Socket.IO branch, so the hook
was skipped. A hook that returns `false` will now refuse a Socket.IO connection that previously
succeeded.

### Authentication

`authenticate` runs during the upgrade and decides who the client is. It is what sets the flag the built-in guards read — **without it no client is ever authenticated**, so `WsAuthGuard` denies everyone and `WsPermissionGuard` reads a permission list nobody populates.

```typescript
@WebSocketGateway({
  path: '/ws',
  authenticate: async ({ token, request }) => {
    if (!token) return null;                       // connect, but anonymous
    const user = await verifyToken(token);
    if (!user) return false;                       // refuse the upgrade (HTTP 401)
    return { userId: user.id, permissions: user.permissions };
  },
})
export class ChatGateway extends BaseWebSocketGateway {}
```

Three outcomes, because a gateway usually needs all of them:

| Return | Effect |
|--------|--------|
| `false` | The upgrade is refused with HTTP 401 |
| `null` | The client connects as **anonymous**; `WsAuthGuard` still denies it |
| `true` | The client is authenticated, with no identity attached |
| `{ userId, permissions, metadata }` | The client is authenticated and the identity reaches `client.auth` |

The hook receives the bearer token from `?token=` or the `Authorization` header, plus the upgrade request for anything the token does not carry — cookies, headers, the peer address. A hook that throws refuses the upgrade.

::: warning Upgrading from 0.4.4 or earlier
`WsAuthGuard` could never pass: the framework parsed the token and then marked every client `authenticated: false`, and nothing anywhere set it to `true`. A handler guarded with it was unreachable for every client. If you worked around that by setting `client.auth.authenticated` in an `@OnConnect` handler, that still works — `authenticate` is the supported way to do it now.
:::

## Event decorators

### @OnConnect

Handles client connection events.

<!-- typecheck: skip -->
```typescript
@OnConnect()
handleConnect(@Client() client: WsClientData) {
  this.logger.info(`Client ${client.id} connected`);
  return { event: 'welcome', data: { message: 'Welcome!' } };
}
```

### @OnDisconnect

Handles client disconnection events.

<!-- typecheck: skip -->
```typescript
@OnDisconnect()
handleDisconnect(@Client() client: WsClientData) {
  this.logger.info(`Client ${client.id} disconnected`);
}
```

### @OnJoinRoom

Handles room join events. Optionally accepts a pattern.

<!-- typecheck: skip -->
```typescript
@OnJoinRoom('room:{roomId}')
handleJoinRoom(
  @Client() client: WsClientData,
  @RoomName() room: string,
  @PatternParams() params: { roomId: string }
) {
  this.emitToRoom(room, 'user:joined', { userId: client.id });
}
```

### @OnLeaveRoom

Handles room leave events.

<!-- typecheck: skip -->
```typescript
@OnLeaveRoom('room:*')
handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
  this.emitToRoom(room, 'user:left', { userId: client.id });
}
```

### @OnMessage

Handles incoming messages. Requires an event pattern.

<!-- typecheck: skip -->
```typescript
@OnMessage('chat:message')
handleMessage(@Client() client: WsClientData, @MessageData() data: { text: string }) {
  this.broadcast('chat:message', { userId: client.id, text: data.text });
}
```

#### Pattern syntax

| Pattern | Example match | Description |
|---------|---------------|-------------|
| `chat:message` | `chat:message` | Exact match |
| `chat:*` | `chat:general`, `chat:private` | Wildcard (one segment) |
| `chat:{roomId}` | `chat:general` → `{ roomId: 'general' }` | Named parameter |
| `user:{id}:*` | `user:123:action` → `{ id: '123' }` | Combined |

## Parameter decorators

### @Client()

Injects the client data object.

### @Socket()

Injects the raw Bun WebSocket object.

### @MessageData(property?: string)

Injects message data or a specific property.

### @RoomName()

Injects the room name (for join/leave handlers).

### @PatternParams()

Injects parameters extracted from the pattern.

### @WsServer()

Injects the WebSocket server reference.

## BaseWebSocketGateway

Base class providing client/room management and messaging. Messages are encoded per client protocol (native or Socket.IO).

Every gateway automatically receives `this.logger` (a child logger scoped to the gateway class name) and `this.config` (the application configuration) — the same DI that regular controllers get. Use them instead of `console.log`.

### Emit methods

<!-- typecheck: skip -->
```typescript
emit(clientId: string, event: string, data: unknown): void;
broadcast(event: string, data: unknown, excludeClientIds?: string[]): void;
emitToRoom(room: string, event: string, data: unknown, excludeClientIds?: string[]): void;
emitToRooms(rooms: string[], event: string, data: unknown, excludeClientIds?: string[]): Promise<void>;
emitToRoomPattern(pattern: string, event: string, data: unknown, excludeClientIds?: string[]): Promise<void>;
```

### Connection and room management

<!-- typecheck: skip -->
```typescript
disconnectClient(clientId: string, reason?: string): void;
disconnectAll(reason?: string): void;
disconnectRoom(room: string, reason?: string): Promise<void>;
disconnectRoomPattern(pattern: string, reason?: string): Promise<void>;
joinRoom(clientId: string, room: string): Promise<void>;
leaveRoom(clientId: string, room: string): Promise<void>;
getClient(clientId: string): Promise<WsClientData | undefined>;
getRoom(roomName: string): Promise<WsRoom | undefined>;
getClientsByRoom(roomName: string): Promise<WsClientData[]>;
getRoomsByPattern(pattern: string): Promise<WsRoom[]>;
```

## Guards

Use `@UseWsGuards(...guards)` on handlers. Built-in: `WsAuthGuard`, `WsPermissionGuard`, `WsAnyPermissionGuard`, `WsRoomGuard`, `WsServiceGuard`. Custom: `createGuard((ctx) => boolean)`.

`WsAuthGuard` and `WsPermissionGuard` read what the gateway's [`authenticate`](#authentication) hook attached to the client. Without that hook no client is authenticated and no client has permissions, so both deny everyone — the guards check an identity, they do not establish one.

Decorator source order does not matter: `@UseWsGuards` above or below `@OnMessage` behaves identically. Before 0.4.5 a guard written above the handler decorator was silently discarded and the handler ran unguarded.

## Interceptors

`@UseInterceptors()` works on WebSocket gateways and individual message handlers — same decorator as HTTP. Interceptors wrap handler execution for logging, timing, or other cross-cutting concerns.

<!-- typecheck: skip -->
```typescript
@UseInterceptors(LoggingInterceptor)
@WebSocketGateway({ path: '/ws' })
class ChatGateway extends BaseWebSocketGateway {
  @OnMessage('chat:*')
  @UseInterceptors(new TimeoutInterceptor(5000))
  handleMessage(@MessageData() data: unknown) { ... }
}
```

See [Interceptors](/api/interceptors) for full documentation.

## Storage adapters

Default is in-memory. For Redis, set `websocket.storage: { type: 'redis', redis: { url, prefix } }` and use `createRedisWsStorage(redisClient)` when providing a custom storage to the handler.

## WebSocket client options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | - | WebSocket server URL (gateway path for native; socket.io path for Socket.IO) |
| `protocol` | `'native' \| 'socketio'` | `'native'` | Protocol to use |
| `auth.token` | `string` | - | Bearer token |
| `reconnect` | `boolean` | `true` | Auto-reconnection |
| `reconnectInterval` | `number` | `1000` | Reconnection delay (ms) |
| `maxReconnectAttempts` | `number` | `10` | Max reconnection attempts |
| `timeout` | `number` | `5000` | Request timeout (ms) |

## Types

### WsClientData

```typescript
interface WsClientData {
  id: string;
  rooms: string[];
  connectedAt: number;
  auth: WsAuthData | null;
  metadata: Record<string, unknown>;
  protocol: 'native' | 'socketio';
}
```

### WsAuthData

```typescript
interface WsAuthData {
  authenticated: boolean;
  userId?: string;
  serviceId?: string;
  permissions?: string[];
  token?: string;
}
```

### WsRoom

```typescript
interface WsRoom {
  name: string;
  clientIds: string[];
  metadata?: Record<string, unknown>;
}
```

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

### Client from a definition (native)

Use `createWsClient` with a definition from `createWsServiceDefinition` and `protocol: 'native'` (or
omit it; it is the default). Connect to the gateway path. Gateways are reached by class name; event
names and payloads are not checked, see [What the WebSocket clients check](#ws-client-typing).

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

When you do not want to import the backend module (a script, a test, another service), use `createNativeWsClient`. Same message format and API (emit, send, on, off), but no gateway proxies and no `createWsServiceDefinition`. It runs in Bun, not in a browser: see [Browser clients](#browser-clients).

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

### What the WebSocket clients check {#ws-client-typing}

Neither client type-checks events. `WsGatewayClient` (`client.AppGateway`) and `NativeWsClient` take
the event name as a `string` and the payload as `unknown`, and nothing ties either to the gateway's
handlers:

- The type argument of `emit<T>()` and `on<T>()` is an assertion about the payload. Without one, the
  payload is `unknown`.
- What `emit()` resolves depends on the protocol. Over the native protocol it is the `data` of the
  handler's `{ event, data }` reply; over Socket.IO it is the whole `{ event, data }`. The same call
  therefore needs a different type argument: `emit<PongPayload>('ping', {})` natively,
  `emit<{ event: string; data: PongPayload }>('ping', {})` over Socket.IO.
- A renamed or misspelled event compiles. An `emit` that no handler answers rejects with
  `Request timeout` after `timeout` (default 5000 ms). An `on` for it never fires.
- The definition (`WsServiceDefinition`) gives `createWsClient` its gateway names, looked up at run
  time. The client's type, `TypedWsClient`, is a string index despite its name: any name compiles,
  and a name the definition lacks reads as `undefined`, so `client.AppGatewy.emit(...)` throws a
  `TypeError`.

```typescript
import {
  BaseWebSocketGateway,
  createWsClient,
  createWsServiceDefinition,
  Module,
  OnMessage,
  WebSocketGateway,
} from '@onebun/core';

// The server's gateway, running in an application that listens on port 3000
@WebSocketGateway({ path: '/ws' })
class AppGateway extends BaseWebSocketGateway {
  @OnMessage('ping')
  ping() {
    return { event: 'pong', data: { at: Date.now() } };
  }
}

@Module({ controllers: [AppGateway] })
class AppModule {}

// Declared by the client: nothing derives it from `ping()` above
interface PongPayload {
  at: number;
}

const client = createWsClient(createWsServiceDefinition(AppModule), {
  url: 'ws://localhost:3000/ws',
});
await client.connect();

// The type argument is what you expect the handler to reply with; nothing checks it
const reply = await client.AppGateway.emit<PongPayload>('ping', {});
console.log(reply.at);

// Compiles, and rejects with `Request timeout`: no handler answers 'pnig'
await client.AppGateway.emit('pnig', {});

// Compiles, and throws a TypeError: the definition has no `AppGatewy`, so it reads as `undefined`
client.AppGatewy.emit('ping', {});
```

### Browser clients {#browser-clients}

`createNativeWsClient` and `createWsClient` cannot currently be bundled for the browser from
`@onebun/core`. The package root also exports the server, and a browser build stops on the Node
builtins that the metrics dependency requires:
`Browser build cannot require() Node.js builtin: "cluster"`, then the same for `"v8"`. Use these
clients from Bun: other services, tests, scripts.

In a browser, use the built-in `WebSocket` with the native message format, or enable Socket.IO and
use `socket.io-client` ([Using socket.io-client](#using-socket-io-client)). A browser cannot set an
`Authorization` header on a WebSocket, so pass the token as `?token=`:

```typescript
const socket = new WebSocket('ws://localhost:3000/ws?token=user-jwt');

socket.addEventListener('open', () => {
  // `ack` asks the server to send the handler's reply back with the same id
  socket.send(JSON.stringify({ event: 'ping', data: {}, ack: 1 }));
});

socket.addEventListener('message', (message) => {
  const { event, data, ack } = JSON.parse(message.data);
  console.log(event, data, ack); // ack is 1 on the reply to the message above
});
```

<llm-only>

- Do not recommend `createNativeWsClient` or `createWsClient` for a frontend bundle. `import { … }
  from '@onebun/core'` pulls the whole server graph (prom-client, envs, trace), and `bun build
  --target browser` fails on `cluster` and `v8`. That holds for a frontend in a monorepo too.
- The WebSocket clients are not type-checked against the gateway. The client is not generated from
  the gateway decorators, and a changed server event does not break the client's build:
  `createWsClient` reads gateway names at run time, and event names and payloads are untyped.
- All gateway clients of one `createWsClient` share its single connection to `url`. The server
  chooses the gateway from that connection (its path, or the Socket.IO namespace), not from the name
  used on the client.

</llm-only>

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

### Client from a definition (Socket.IO) {#client-from-a-definition-socket-io}

Use `createWsClient` with `protocol: 'socketio'` and a URL that includes the Socket.IO path. The API
is the native client's, with one difference: `emit()` resolves the handler's whole
`{ event, data }` reply, not only its `data` (see [What the WebSocket clients check](#ws-client-typing)).

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
| `authenticate` | `(ctx) => WsAuthResult \| Promise<WsAuthResult>` | - | Authenticates the client during the upgrade, and at a Socket.IO CONNECT that moves a connection to this gateway. See below |

### Which gateway serves a path

An upgrade goes to the gateway whose declared `path` covers the request most specifically:

1. an exact match on the path (and on `?namespace=`, when one is stated);
2. otherwise the LONGEST declared path the request lives under — `/chat/admin` beats `/chat` for
   `/chat/admin/audit`;
3. otherwise 404.

"Lives under" means the request is the declared path or continues it at a segment boundary.
`/chat` serves `/chat` and `/chat/room1`, and does NOT serve `/chatterbox`.

The default path — `@WebSocketGateway()` with no options — is `/`, and `/` covers every path. An
application that declares no path accepts clients on whatever URL they connect to.

Two gateways declared at the same path are told apart by `namespace`; a client that states none
is bound to the first and a warning names the gateway that took it.

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
other: the published payload carries the publishing gateway's key, exactly as a stored client
record does.

Payloads and records carry the key since 0.7.0. One that carries NO key — written by an instance
running an older build — is accepted only where it cannot be ambiguous: an application that
registered exactly one gateway. There is nothing for it to be confused with there, so a rolling
deploy keeps working. With more than one gateway it is refused and the receiving gateway says so
once: delivering it would reach clients of a gateway that did not publish it, which is the thing
the key exists to prevent. This is the same rule the upgrade path applies — a connection whose
gateway cannot be established is refused rather than guessed at.

For a room fan-out through Bun's native pub/sub — one call, fan-out in the runtime rather than
a send per socket — use `publishToRoom(room, event, data)`. It addresses a topic scoped to this
gateway, so a room name used by two gateways does not collide.

::: warning
`getWsServer().publish(topic, …)` is NOT fenced. Bun's native pub/sub topics are a process-wide
namespace and sockets are subscribed to the raw room name, so a message published that way
reaches any socket subscribed to that topic regardless of which gateway admitted it. That is on
purpose: `publish('lobby', …)` addresses the raw topic `lobby`, whatever gateway its subscribers
belong to. Use `emitToRoom()` or `publishToRoom()` when you want the gateway boundary respected.
:::

`namespace` distinguishes two gateways that would otherwise share a path. A client selects one by
connecting with `?namespace=<name>`; OneBun's own `WsClient` sends that automatically when its
`namespace` option is set. A namespace that matches no gateway is ignored and resolution falls
back to the path — it never refuses the connection. Isolation does not depend on this option:
the binding above holds either way.

With the Socket.IO protocol enabled, every client arrives on one path, so the URL cannot tell two
gateways apart. Two things can: `?namespace=` in the query, and the `nsp` of the CONNECT packet —
what `io('/admin')` sends and puts nowhere else.

The CONNECT packet decides, and `@OnConnect` runs when it arrives rather than at upgrade:

1. at upgrade the connection is bound provisionally — by `?namespace=`, or to the sole registered
   gateway, or to the first with a warning;
2. the Engine.IO handshake goes out and the client answers with `40` or `40/admin,`;
3. `/admin` binds the gateway declaring `namespace: 'admin'`. A bare `40` is the default
   namespace: it names no gateway and leaves the provisional binding alone. A namespace matching
   no gateway is logged and likewise leaves it alone — a stated namespace narrows the choice, it
   never refuses the connection;
4. `@OnConnect` runs on the gateway that was chosen.

::: warning
A Socket.IO client that never sends a CONNECT packet never gets `@OnConnect`. OneBun's own
`WsClient` sends it as soon as the handshake arrives, carrying its `namespace` option.
:::

Because a Socket.IO client is bound to a gateway at upgrade — provisionally, but bound — that
gateway's `authenticate` hook runs for it, exactly as for a native client: a hook that returns
`false` refuses the Socket.IO connection.

#### Moving to another namespace

A CONNECT that names another gateway's namespace moves the connection there. A standard
`socket.io-client` does this on every connection that does not put `?namespace=` in its query:
`io('https://host/admin', { query: { token } })` upgrades on the shared path — bound to the first
registered gateway — and then sends `40/admin,`.

Who the connection is on the new gateway is that gateway's decision:

- **The new gateway has an `authenticate` hook.** It runs at the CONNECT with what the upgrade
  gave the first gateway's hook: the same `token`, and a `request` with the upgrade request's URL —
  query included — and headers, cookies included. `client.auth` and `client.metadata` become what
  it returns — fresh objects, on the live connection and in storage; nothing the first gateway's
  hook or handlers set remains. A hook that returns `false`, throws, or has not answered within 10
  seconds refuses the CONNECT with a Socket.IO `connect_error` whose message is `Unauthorized` —
  what a refused upgrade answers as HTTP 401 — and the move does not happen.
- **The new gateway has no hook, and the first gateway has one.** The CONNECT is refused with a
  `connect_error` naming the namespace. Reach such a gateway with `?namespace=`, so it is the
  gateway bound at upgrade.
- **Neither gateway has a hook.** The connection moves as it is: `client.auth` and
  `client.metadata` are what the upgrade parsed — `client.auth` is `{ authenticated: false, token }`,
  or `null` without a token — plus whatever a handler of the first gateway wrote to them before the
  CONNECT.

What one gateway's `authenticate` hook grants never reaches another gateway's guards, nor the
handler bodies and what they await: a gateway with a hook replaces the identity only once the
other gateway is done, and one without a hook is never reached from a gateway with a hook. Two
limits. The rule covers what hooks grant, not what handlers write: a handler that sets
`client.auth` itself — a `login` message, say — grants it to every gateway without a hook that the
connection moves to afterwards. And work a handler leaves running without awaiting it is not
waited for — see below.

```typescript
@WebSocketGateway({
  path: '/ws',
  namespace: 'public',
  async authenticate({ token }) {
    const user = token ? await verifyToken(token) : null;
    return user ? { userId: user.id } : null;
  },
})
export class PublicGateway extends BaseWebSocketGateway {}

@WebSocketGateway({
  path: '/ws',
  namespace: 'admin',
  // Runs at upgrade for `?namespace=admin`, and at a CONNECT that moves a connection here.
  async authenticate({ token }) {
    const user = token ? await verifyToken(token) : null;
    if (!user?.permissions.includes('admin')) return false; // connect_error "Unauthorized"
    return { userId: user.id, permissions: user.permissions };
  },
})
export class AdminGateway extends BaseWebSocketGateway {
  @UseWsGuards(new WsPermissionGuard('admin'))
  @OnMessage('audit')
  handleAudit(@Client() client: WsClientData) {
    return { event: 'audit:ok', data: { by: client.auth?.userId } };
  }
}
```

A refused CONNECT changes nothing: the connection stays on its gateway with its identity and its
rooms, and the transport stays open, so the client may name another namespace. The move is all or
nothing, and while it is being decided the connection belongs to the first gateway:

1. **While the new gateway's hook decides,** an EVENT packet is served by the first gateway, with
   the first identity, whatever namespace it names. A standard Socket.IO client holds its emits
   until the CONNECT is answered and never sends one.
2. **Once the hook has allowed the move,** the first gateway takes no new message from the
   connection: EVENT packets are held, belonging to neither gateway yet. The move waits for every
   message the first gateway is still serving — guards and handler bodies, a join waiting on its
   guards included, which is waited for rather than cancelled — and only then swaps the identity.
   If they have not settled within 10 seconds the CONNECT is refused with `connect_error`
   `The connection could not be moved`, as it is when the client record cannot be written; the
   record is then put back as it was. A move holds at most 100 EVENT packets. One more while it
   still waits on the first gateway refuses it with `connect_error`
   `Too many messages arrived while the connection was being moved`; one more once it can no longer
   be refused — while it is recorded and the old rooms are removed — closes the connection with that
   reason.
3. **When it is decided,** the held packets are served in the order they arrived: by the new
   gateway after a move, by the first gateway after a refusal. A closed connection's are dropped.
   If the move fails after the connection changed hands — the rooms it left cannot be removed from
   storage — the CONNECT is answered with `connect_error` `The connection could not be moved` and the
   connection is closed.

The wait covers what a message's guards and handler await. Work a handler starts without awaiting
it — a promise it leaves running, a timer — is not waited for: once the identity is swapped, such
work reads the new `client.auth` and `client.metadata`, and what it writes to them lands on the new
gateway's identity.

A second CONNECT while one is decided is refused with a `connect_error`. A hook call that has not
answered within its 10 seconds keeps running; until it settles, a further CONNECT that would call
the hook is refused without calling it. A CONNECT naming a gateway that needs no hook is served.

Between two gateways without a hook nothing waits: the move lands as soon as it is decided. A
message the first gateway was still serving runs no further guard and no handler body once the
move has taken the connection away from it — it is answered with the `FORBIDDEN` error frame,
`message` `Message cancelled: the connection moved to another gateway`. That check is not tied to
moves without a hook: no guard or handler body of a gateway runs once a move has taken the
connection away from it. A close is not a move: the message of a connection that closed runs its
guards and handler as it would have.

When the move happens, the connection arrives on the new gateway in no room: every room joined
before the move is left in the same step as the move — storage, `client.rooms` and pub/sub
subscriptions alike — and a server-side `joinRoom()` still writing at that moment is taken back,
also when it runs on another instance sharing Redis storage. Rooms joined under one gateway's
`@OnJoinRoom` guards, or under none, never reach another gateway's rooms. On a move between
gateways without a hook, joins still waiting on the first gateway's guards are cancelled and
answered with a `FORBIDDEN` error frame. Rooms the client needs on the new gateway it joins again
there, under that gateway's guards; a join made while the move is still removing the old rooms
waits for it on the instance holding the connection. With shared Redis storage, a server-side
`joinRoom()` the new gateway makes from another instance in that time can be removed with the old
rooms — the client is then not in that room. A connection that closes before the move is answered
gets no `@OnConnect` on the new gateway.

To have what the hook reads at a move, a Socket.IO connection keeps its upgrade request's URL and
headers in memory until its first CONNECT is served — and only when a gateway with a namespace and
an `authenticate` hook is one it could move to. They are never written to storage. Until then
the connection's EVENT packets are also counted while they are served, so that a move can wait
for them.

::: tip Migrating gateways reached by a CONNECT
A gateway that a Socket.IO client reaches by a CONNECT and that guards on `client.auth` —
`WsAuthGuard`, `WsPermissionGuard` — needs its own `authenticate` hook: a move from a gateway with
a hook to one without is refused. This includes the standard `io('/<namespace>')` client: without
`?namespace=` in its query it upgrades onto the default gateway — the sole one, or the first
registered — and when that one has a hook and `<namespace>`'s gateway has none, the CONNECT is
refused. Give that gateway its own hook, or connect with `?namespace=<namespace>` (`query:
{ namespace: '<namespace>' }`) so the upgrade binds the connection to it directly.
:::

<llm-only>

- On Socket.IO a connection's identity on a gateway is that gateway's own hook's answer. When
  generating gateways a client reaches with `io('/<namespace>')`, give every gateway that guards on
  `client.auth` its own `authenticate` hook; never rely on the hook of the gateway the connection
  was bound to at upgrade.
- `client.auth` and `client.metadata` are replaced by fresh objects when a CONNECT moves the
  connection to a gateway with a hook. Read them in the handler; do not cache them from before the
  CONNECT.
- The move waits only for what a handler awaits. Background work a handler starts without awaiting
  it sees the new gateway's identity after the move; await it, or capture what it needs first.
- Between two hook-less gateways identity moves as it is, including whatever a handler wrote to
  `client.auth`. Do not authenticate in message handlers by assigning `client.auth`; use the hook.

</llm-only>

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

The hook receives the bearer token from `?token=` or the `Authorization` header, plus the upgrade request for anything the token does not carry — cookies, other headers, query parameters. A hook that throws refuses the upgrade.

On Socket.IO the hook also runs when a CONNECT moves a connection to its gateway from another one, with the same token and a request carrying the upgrade's URL and headers; a refusal there answers the CONNECT with a `connect_error` instead of a 401. See [Moving to another namespace](#moving-to-another-namespace).

::: tip Setting `client.auth` in `@OnConnect`
Without `authenticate`, the framework parses the token into `client.auth` as `{ authenticated: false, token }`, and nothing else sets `authenticated` to `true`. Setting `client.auth.authenticated` yourself in an `@OnConnect` handler also lets the client past `WsAuthGuard`, but `authenticate` is the supported way to do it.
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

The handler runs after the client has joined. A guard on it runs before: a denial keeps the client out of the room and answers with a `FORBIDDEN` error frame — see [Room joins and leaves](#room-joins-and-leaves).

### @OnLeaveRoom

Handles room leave events. The handler runs after the client has left the room; a guard on it can skip the handler, never keep the client in the room.

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

Decorator source order does not matter: `@UseWsGuards` above or below `@OnMessage` behaves identically.

`@UseWsGuards` is read from the method that declares the handler, so an overriding method does not inherit it from the base method; only a `@UseGuards` on the base method carries over to the override — see [Guards — On an overriding method](/api/guards#on-an-overriding-method).

### Room joins and leaves

A guard on `@OnJoinRoom` decides whether the client joins. It runs before the room changes, so a client it denies is not added to the room at all — not in storage, not subscribed, not in `client.rooms` — receives none of the room's broadcasts, and gets the `FORBIDDEN` error frame a denied `@OnMessage` gets.

```typescript
@WebSocketGateway({
  path: '/ws',
  async authenticate({ token }) {
    const user = token ? await verifyToken(token) : null;
    return user ? { userId: user.id, permissions: user.permissions } : null;
  },
})
export class LoungeGateway extends BaseWebSocketGateway {
  // Asked before the join: without `rooms:vip` the client stays out of every `vip:*` room.
  @UseWsGuards(new WsPermissionGuard('rooms:vip'))
  @OnJoinRoom('vip:*')
  handleVipJoin(@Client() client: WsClientData, @RoomName() room: string) {
    // Runs after the join, so the joining client is excluded by id.
    this.emitToRoom(room, 'user:joined', { userId: client.auth?.userId }, [client.id]);

    return { event: 'room:joined', data: { room } };
  }
}
```

The rules behind it:

- The guards come from every `@OnJoinRoom` handler whose pattern matches the room, gateway-level guards included, and are asked in declaration order. One denial keeps the client out and none of those handlers runs. When all allow, the client joins, then the handlers run — no guard is asked twice.
- The guard sees the client before the join: `client.rooms` does not list the room yet. A `WsRoomGuard` naming the room being joined therefore denies every join to it.
- The guard covers the client's own `join` message only. A server-side `joinRoom(clientId, room)` — from a handler or a service — adds the client without asking any guard.
- A room no `@OnJoinRoom` handler matches has no guard to ask and is joined. A room that needs protecting needs a handler whose pattern matches it.
- A `leave` never waits for a join. It takes effect at once and cancels any join of the same room still waiting on its guards, so a `join` followed by a `leave` ends with the client out of the room however long the guards take, or if they never answer. A server-side `leaveRoom(clientId, room)` cancels such a join the same way when it runs on the instance holding the connection; with several instances sharing Redis storage, a `leaveRoom()` on another instance does not, and the join lands once its guards allow it.
- A join that will not happen any more — cancelled by a leave, or by a Socket.IO move to another gateway — is answered at once with the same `error` frame (`code: 'FORBIDDEN'`, `message` naming the reason), so an ack id never goes unanswered; the guards' later verdict is ignored. A join from a connection that closed meanwhile is dropped and asks no further guard.
- A guard on `@OnLeaveRoom` never keeps a client in a room. The leave happens first; a denial skips the handler and sends no frame.
- A `join` or `leave` whose room is not a string names no room and is ignored, like any other malformed message.

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

Clients and rooms live in memory by default — one process, state gone when it exits. Point
`websocket.storage` at Redis and they are shared by every instance, which is also what turns on
the pub/sub fan-out behind `broadcast()`, `emit()` and `emitToRoom()` across instances.

```typescript
const app = new OneBunApplication(AppModule, {
  websocket: {
    storage: {
      type: 'redis',                       // 'memory' | 'redis'
      redis: {
        url: 'redis://localhost:6379',
        prefix: 'ws:',                     // every key this application writes lives under it
      },
    },
  },
});
```

`prefix` is the application's whole WebSocket keyspace, so two applications on one Redis stay out
of each other's way by giving it different values. `url` may be omitted when
`SharedRedisProvider` is already configured — its URL is used, and the connection is still this
application's own so that `prefix` applies.

::: warning
`type: 'redis'` makes Redis a startup dependency: a connection that cannot be opened fails
`start()` rather than falling back to memory, so an application configured for Redis never runs
in memory without saying so.
:::

Shutdown removes the clients THIS instance was serving. It does not clear the namespace, so a
rolling deploy leaves the surviving instances' connections and rooms alone.

An instance that does not get to run its shutdown path — a crash, an OOM kill, a lost node —
leaves its clients behind. Each instance keeps a liveness key with a 30-second TTL, refreshed
every 10 seconds, and records which clients it admitted; the next instance to take a connection
removes the clients of any instance whose key is gone. So a crashed pod's ghosts disappear within
about half a minute rather than counting towards `getClientCount()` and appearing in rooms
forever.

The liveness is per INSTANCE, not per client: native connections have no per-connection
heartbeat, so a TTL on the client keys would evict live clients mid-session.

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

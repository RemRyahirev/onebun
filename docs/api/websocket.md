# WebSocket Gateway API

## Overview

OneBun provides a WebSocket Gateway system similar to NestJS, with full Socket.IO protocol compatibility. Gateways are registered as controllers in modules and auto-detected by the framework.

## WebSocketGateway Decorator

The `@WebSocketGateway` decorator marks a class as a WebSocket gateway.

```typescript
import { WebSocketGateway, BaseWebSocketGateway } from '@onebun/core';

@WebSocketGateway({ path: '/ws', namespace: 'chat' })
export class ChatGateway extends BaseWebSocketGateway {
  // handlers...
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `'/'` | WebSocket connection path |
| `namespace` | `string` | - | Namespace for isolating gateways |

## Event Decorators

### @OnConnect

Handles client connection events.

```typescript
@OnConnect()
handleConnect(@Client() client: WsClientData) {
  console.log(`Client ${client.id} connected`);
  return { event: 'welcome', data: { message: 'Welcome!' } };
}
```

### @OnDisconnect

Handles client disconnection events.

```typescript
@OnDisconnect()
handleDisconnect(@Client() client: WsClientData) {
  console.log(`Client ${client.id} disconnected`);
}
```

### @OnJoinRoom

Handles room join events. Optionally accepts a pattern.

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

```typescript
@OnLeaveRoom('room:*')
handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
  this.emitToRoom(room, 'user:left', { userId: client.id });
}
```

### @OnMessage

Handles incoming messages. Requires an event pattern.

```typescript
@OnMessage('chat:message')
handleMessage(@Client() client: WsClientData, @MessageData() data: { text: string }) {
  this.broadcast('chat:message', { userId: client.id, text: data.text });
}
```

#### Pattern Syntax

| Pattern | Example Match | Description |
|---------|--------------|-------------|
| `chat:message` | `chat:message` | Exact match |
| `chat:*` | `chat:general`, `chat:private` | Wildcard (any single segment) |
| `chat:{roomId}` | `chat:general` → `{ roomId: 'general' }` | Named parameter |
| `user:{id}:*` | `user:123:action` → `{ id: '123' }` | Combined |

## Parameter Decorators

### @Client()

Injects the client data object.

```typescript
@OnMessage('ping')
handlePing(@Client() client: WsClientData) {
  console.log(`Ping from ${client.id}`);
}
```

### @Socket()

Injects the raw Bun WebSocket object.

```typescript
@OnMessage('raw')
handleRaw(@Socket() socket: ServerWebSocket<WsClientData>) {
  socket.send('raw message');
}
```

### @MessageData(property?: string)

Injects message data or a specific property.

```typescript
// Full data
@OnMessage('chat:message')
handleMessage(@MessageData() data: { text: string }) {}

// Specific property
@OnMessage('chat:message')
handleMessage(@MessageData('text') text: string) {}
```

### @RoomName()

Injects the room name (for join/leave handlers).

```typescript
@OnJoinRoom()
handleJoin(@RoomName() room: string) {}
```

### @PatternParams()

Injects parameters extracted from the pattern.

```typescript
@OnMessage('chat:{roomId}:message')
handleMessage(@PatternParams() params: { roomId: string }) {}
```

### @WsServer()

Injects the WebSocket server reference.

```typescript
@OnMessage('broadcast')
handleBroadcast(@WsServer() server: WsServer) {
  server.publish('all', 'Hello everyone!');
}
```

## BaseWebSocketGateway

Base class providing client/room management and messaging methods.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `clients` | `Map<string, WsClientData>` | Connected clients (local) |
| `rooms` | `Map<string, WsRoom>` | Active rooms |

### Emit Methods

```typescript
// Send to specific client
emit(clientId: string, event: string, data: unknown): void;

// Broadcast to all clients
broadcast(event: string, data: unknown, excludeClientIds?: string[]): void;

// Send to room
emitToRoom(room: string, event: string, data: unknown, excludeClientIds?: string[]): void;

// Send to multiple rooms
emitToRooms(rooms: string[], event: string, data: unknown): Promise<void>;

// Send to rooms matching pattern
emitToRoomPattern(pattern: string, event: string, data: unknown): Promise<void>;
```

### Connection Management

```typescript
// Disconnect a client
disconnectClient(clientId: string, reason?: string): void;

// Disconnect all clients
disconnectAll(reason?: string): void;

// Disconnect all clients in a room
disconnectRoom(room: string, reason?: string): Promise<void>;

// Disconnect clients in rooms matching pattern
disconnectRoomPattern(pattern: string, reason?: string): Promise<void>;
```

### Room Management

```typescript
// Add client to room
joinRoom(clientId: string, room: string): Promise<void>;

// Remove client from room
leaveRoom(clientId: string, room: string): Promise<void>;
```

### Getters

```typescript
// Get client by ID
getClient(clientId: string): Promise<WsClientData | undefined>;

// Get room by name
getRoom(roomName: string): Promise<WsRoom | undefined>;

// Get all clients in a room
getClientsByRoom(roomName: string): Promise<WsClientData[]>;

// Get rooms matching pattern
getRoomsByPattern(pattern: string): Promise<WsRoom[]>;
```

## Guards

### WsGuard Interface

```typescript
interface WsGuard {
  canActivate(context: WsExecutionContext): boolean | Promise<boolean>;
}
```

### Built-in Guards

```typescript
import {
  WsAuthGuard,
  WsPermissionGuard,
  WsRoomGuard,
  WsAnyPermissionGuard,
  WsServiceGuard,
} from '@onebun/core';

// Require authentication
@UseWsGuards(WsAuthGuard)
@OnMessage('protected:*')
handleProtected(@Client() client: WsClientData) {}

// Require specific permission
@UseWsGuards(new WsPermissionGuard('admin'))
@OnMessage('admin:*')
handleAdmin(@Client() client: WsClientData) {}

// Require any of multiple permissions
@UseWsGuards(new WsAnyPermissionGuard(['admin', 'moderator']))
@OnMessage('manage:*')
handleManage(@Client() client: WsClientData) {}
```

### Custom Guards

```typescript
import { createGuard } from '@onebun/core';

const CustomGuard = createGuard((ctx) => {
  return ctx.getClient().metadata.customCheck === true;
});

@UseWsGuards(CustomGuard)
@OnMessage('custom:*')
handleCustom(@Client() client: WsClientData) {}
```

## Storage Adapters

### In-Memory Storage (Default)

```typescript
import { createInMemoryWsStorage } from '@onebun/core';

const storage = createInMemoryWsStorage();
```

### Redis Storage

```typescript
import { createRedisWsStorage, SharedRedisProvider } from '@onebun/core';

// Configure shared Redis
SharedRedisProvider.configure({
  url: 'redis://localhost:6379',
  keyPrefix: 'myapp:',
});

const storage = createRedisWsStorage(await SharedRedisProvider.getClient());
```

## WebSocket Client

### Creating a Client

```typescript
import { createWsServiceDefinition, createWsClient } from '@onebun/core';
import { ChatModule } from './chat.module';

const definition = createWsServiceDefinition(ChatModule);
const client = createWsClient(definition, {
  url: 'ws://localhost:3000',
  auth: { token: 'xxx' },
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectAttempts: 10,
});
```

### Client Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | - | WebSocket server URL |
| `auth.token` | `string` | - | Bearer token for authentication |
| `reconnect` | `boolean` | `true` | Enable auto-reconnection |
| `reconnectInterval` | `number` | `1000` | Reconnection delay (ms) |
| `maxReconnectAttempts` | `number` | `10` | Max reconnection attempts |
| `timeout` | `number` | `5000` | Request timeout (ms) |

### Using the Client

```typescript
// Connect
await client.connect();

// Send message and wait for acknowledgement
const response = await client.ChatGateway.emit('chat:message', { text: 'Hello' });

// Send without waiting
client.ChatGateway.send('ping', {});

// Subscribe to events
client.ChatGateway.on('chat:message', (data) => {
  console.log('Received:', data);
});

// Subscribe with pattern
client.ChatGateway.on('chat:*', (data, params) => {
  console.log(`Event in ${params?.roomId}:`, data);
});

// Lifecycle events
client.on('connect', () => console.log('Connected'));
client.on('disconnect', (reason) => console.log('Disconnected:', reason));
client.on('error', (error) => console.log('Error:', error));
client.on('reconnect', (attempt) => console.log('Reconnected after', attempt, 'attempts'));

// Disconnect
client.disconnect();
```

## Socket.IO Compatibility

OneBun WebSocket Gateway supports connections from `socket.io-client` with full protocol compatibility.

### Protocol Support

- Engine.IO v4 (transport layer)
- Socket.IO v4 (application layer)
- WebSocket and HTTP long-polling transports
- Namespaces
- Acknowledgements
- Binary data

### Limitations

- Binary data is base64 encoded (not streaming binary frames)
- Some advanced Socket.IO features may not be fully supported

## Configuration

### Application Options

```typescript
const app = new OneBunApplication(AppModule, {
  port: 3000,
  websocket: {
    enabled: true,              // auto: enabled if gateways exist
    storage: {
      type: 'memory',           // 'memory' | 'redis'
      redis: {
        url: 'redis://localhost:6379',
        prefix: 'ws:',
      },
    },
    pingInterval: 25000,        // Socket.IO heartbeat interval
    pingTimeout: 20000,         // Socket.IO heartbeat timeout
    maxPayload: 1048576,        // Max message size (1MB)
  },
});
```

## Types

### WsClientData

```typescript
interface WsClientData {
  id: string;
  rooms: string[];
  connectedAt: number;
  auth: WsAuthData | null;
  metadata: Record<string, unknown>;
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

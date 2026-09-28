---
description: Real-time chat application with WebSocket Gateway. Rooms, message broadcasting, connection handling.
---

# WebSocket Chat Application

A real-time chat application with OneBun WebSocket Gateway: rooms, authentication guards, message broadcasting, and multiple client options.

## Overview

The chat application demonstrates:
- Multiple chat rooms with join/leave
- Guard-protected message handlers
- Message history and broadcasting
- Native WebSocket and Socket.IO clients

## Project structure

```
websocket-chat/
├── src/
│   ├── chat.gateway.ts      # WebSocket gateway
│   ├── chat.service.ts      # Business logic
│   ├── chat.module.ts       # Module definition
│   ├── auth.guard.ts        # Custom guard
│   ├── config.ts            # Environment config
│   └── index.ts             # Application entry
├── client/
│   └── native-client.ts     # Example client
├── package.json
└── tsconfig.json
```

## Step 1: Create the gateway

Define the WebSocket gateway with connection, room, and message handlers. Use `@WebSocketGateway({ path: '/chat' })` so clients connect to `/chat`.

```typescript
// src/chat.gateway.ts (key handlers — full source in repo)
@WebSocketGateway({ path: '/chat' })
export class ChatGateway extends BaseWebSocketGateway {
  constructor(private chatService: ChatService) {
    super();
  }

  @OnConnect()
  async handleConnect(@Client() client: WsClientData) {
    this.logger.info(`Client ${client.id} connected`);

    return {
      event: 'welcome',
      data: {
        message: 'Welcome to the chat!',
        clientId: client.id,
        timestamp: Date.now(),
      },
    };
  }

  @OnJoinRoom('room:{roomId}')
  async handleJoinRoom(
    @Client() client: WsClientData,
    @RoomName() room: string,
    @PatternParams() params: { roomId: string },
  ) {
    await this.joinRoom(client.id, room);

    // Notify others (exclude the joining user)
    this.emitToRoom(room, 'user:joined', {
      userId: client.id,
      room,
    }, [client.id]);

    const history = await this.chatService.getMessageHistory(params.roomId);

    return {
      event: 'room:joined',
      data: {
        room: params.roomId,
        history,
        users: await this.getClientsInRoom(room),
      },
    };
  }

  @UseWsGuards(ChatAuthGuard)
  @OnMessage('chat:{roomId}:message')
  async handleMessage(
    @Client() client: WsClientData,
    @MessageData() data: ChatMessage,
    @PatternParams() params: { roomId: string },
  ) {
    if (!client.rooms.includes(`room:${params.roomId}`)) {
      return { event: 'error', data: { message: 'Not in room' } };
    }

    const message = await this.chatService.saveMessage({
      roomId: params.roomId,
      userId: client.id,
      text: data.text,
      timestamp: Date.now(),
    });

    // Broadcast to room
    this.emitToRoom(`room:${params.roomId}`, 'chat:message', message);

    return { event: 'chat:message:ack', data: { messageId: message.id } };
  }

  // Also: @OnDisconnect, @OnLeaveRoom, @OnMessage('typing:{roomId}')
}
```

## Step 2: Chat service

Business logic for messages and history:

```typescript
// src/chat.service.ts
@Service()
export class ChatService extends BaseService {
  private messages: Map<string, Message[]> = new Map();
  private messageIdCounter = 0;

  async saveMessage(data: Omit<Message, 'id'>): Promise<Message> {
    const message: Message = {
      id: `msg_${++this.messageIdCounter}`,
      ...data,
    };

    const roomMessages = this.messages.get(data.roomId) || [];
    roomMessages.push(message);
    this.messages.set(data.roomId, roomMessages);

    return message;
  }

  async getMessageHistory(roomId: string, limit = 50): Promise<Message[]> {
    const roomMessages = this.messages.get(roomId) || [];
    return roomMessages.slice(-limit);
  }

  async clearRoom(roomId: string): Promise<void> {
    this.messages.delete(roomId);
  }
}
```

## Step 3: Auth guard

Guard to require authentication on message handlers:

```typescript
// src/auth.guard.ts
import { createGuard, type WsExecutionContext } from '@onebun/core';

export const ChatAuthGuard = createGuard((context: WsExecutionContext) => {
  const client = context.getClient();

  if (!client.auth?.authenticated) {
    return false;
  }

  return true;
});
```

## Step 4: Register the gateway in the module

**A WebSocket gateway is a controller.** Add `ChatGateway` to the module's `controllers` array so the framework discovers it. Do not add it to `providers`.

```typescript
// src/chat.module.ts
@Module({
  controllers: [ChatGateway],  // Gateways are controllers — register here
  providers: [ChatService],
})
export class ChatModule {}
```

## Step 5: Application entry and WebSocket config

```typescript
// src/index.ts
import { OneBunApplication } from '@onebun/core';
import { ChatModule } from './chat.module';
import { envSchema } from './config';

const app = new OneBunApplication(ChatModule, {
  envSchema,
  websocket: {},
});

await app.start();

const logger = app.getLogger();
logger.info(`Chat server running on ${app.getHttpUrl()}`);
logger.info(`Native WebSocket: ws://localhost:${app.getPort()}/chat`);
```

## Client implementation

You can use: **a client from the gateway definition** (`createWsClient`), **a standalone client** (`createNativeWsClient`: no definition, same API), or **Socket.IO** (enable `socketio` in app config).

The first two run in Bun (other services, tests, scripts). `@onebun/core` cannot currently be bundled for a browser, so a browser connects with `WebSocket` or `socket.io-client`: see [Browser clients](/api/websocket#browser-clients). Neither client type-checks events: the payload shapes below are declared on the client side and asserted with a type argument ([what the clients check](/api/websocket#ws-client-typing)).

### Option A: Client from the definition (native WebSocket)

Connect to the gateway path. Default `protocol` is `'native'`.

```typescript
// client-native.ts
import { createWsServiceDefinition, createWsClient } from '@onebun/core';
import { ChatModule } from './chat.module';

// Declared by the client: nothing checks these shapes against the gateway's handlers
interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  timestamp: number;
}

interface RoomJoined {
  room: string;
  history: ChatMessage[];
  users: string[];
}

interface Membership {
  userId: string;
  room: string;
}

const definition = createWsServiceDefinition(ChatModule);
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/chat',
  protocol: 'native',
  auth: { token: 'user-jwt-token' },
  reconnect: true,
  reconnectInterval: 2000,
  maxReconnectAttempts: 5,
});

// Connection lifecycle
client.on('connect', () => {
  console.log('Connected to chat server');
});

client.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

client.on('reconnect', (attempt) => {
  console.log(`Reconnected after ${attempt} attempts`);
});

client.on('error', (error) => {
  console.error('Connection error:', error);
});

// Connect
await client.connect();

// Subscribe to events. Without a type argument the payload is `unknown`
client.ChatGateway.on<{ message: string }>('welcome', (data) => {
  console.log('Welcome message:', data.message);
});

client.ChatGateway.on<ChatMessage>('chat:message', (message) => {
  console.log(`[${message.userId}]: ${message.text}`);
});

client.ChatGateway.on<Membership>('user:joined', (data) => {
  console.log(`User ${data.userId} joined ${data.room}`);
});

client.ChatGateway.on<Membership>('user:left', (data) => {
  console.log(`User ${data.userId} left ${data.room}`);
});

client.ChatGateway.on<{ userId: string }>('typing', (data) => {
  console.log(`${data.userId} is typing...`);
});

// Join a room
const roomInfo = await client.ChatGateway.emit<RoomJoined>('join', 'room:general');
console.log('Joined room with history:', roomInfo.history);

// Send a message
const ack = await client.ChatGateway.emit<{ messageId: string }>('chat:general:message', {
  text: 'Hello everyone!',
});
console.log('Message sent, id:', ack.messageId);

// Send typing indicator
client.ChatGateway.send('typing:general', {});

// Leave room when done
client.ChatGateway.send('leave', 'room:general');

// Disconnect
client.disconnect();
```

### Option B: Standalone client (no definition)

Use when the client does not import the backend module: a script, a test, another service. Same message format and API as Option A. It runs in Bun, not in a browser.

```typescript
// client-standalone.ts
import { createNativeWsClient } from '@onebun/core';

interface ChatMessage {
  userId: string;
  text: string;
}

const client = createNativeWsClient({
  url: 'ws://localhost:3000/chat',
  protocol: 'native',
  auth: { token: 'user-jwt-token' },
  reconnect: true,
});

client.on('connect', () => console.log('Connected to chat'));
client.on<{ message: string }>('welcome', (data) => console.log('Welcome:', data.message));
client.on<ChatMessage>('chat:message', (msg) => console.log(`[${msg.userId}]: ${msg.text}`));
client.on<{ userId: string }>('user:joined', (data) => console.log(`User ${data.userId} joined`));
client.on<{ userId: string }>('user:left', (data) => console.log(`User ${data.userId} left`));

await client.connect();

// Join room (server expects event 'join' with room name as data)
const roomInfo = await client.emit('join', 'room:general');
console.log('Joined room:', roomInfo);

await client.emit('chat:general:message', { text: 'Hello everyone!' });
client.send('typing:general', {});

client.send('leave', 'room:general');
client.disconnect();
```

### Option C: socket.io-client (Socket.IO protocol)

Enable Socket.IO in the application config (`websocket.socketio.enabled: true`), then connect to the server origin with `path: '/socket.io'`.

```typescript
// client-socketio.ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  path: '/socket.io',
  auth: { token: 'user-jwt-token' },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('Connected with id:', socket.id);
});

socket.on('welcome', (data) => {
  console.log('Welcome:', data);
});

socket.on('chat:message', (message) => {
  console.log('Message:', message);
});

// Join room
socket.emit('join', 'room:general', (response) => {
  console.log('Room joined:', response);
});

// Send message
socket.emit('chat:general:message', { text: 'Hello!' }, (ack) => {
  console.log('Message acknowledged:', ack);
});

socket.disconnect();
```

### Option D: Client from the definition with Socket.IO {#option-d-client-from-the-definition-with-socket-io}

If Socket.IO is enabled on the server, you can use the `createWsClient` client of Option A with `protocol: 'socketio'` and the Socket.IO path:

```typescript
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/socket.io',
  protocol: 'socketio',
  auth: { token: 'user-jwt-token' },
});
await client.connect();
// Same API: client.ChatGateway.emit(...), client.ChatGateway.on(...)
// One difference: over Socket.IO, emit() resolves the handler's whole { event, data } reply
const joined = await client.ChatGateway.emit<{ event: string; data: RoomJoined }>('join', 'room:general');
console.log('Joined room with history:', joined.data.history);
```

## Authentication

### Token-based Authentication

Clients can authenticate by providing a token in the connection options:

```typescript
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/chat',
  auth: {
    token: 'your-jwt-token',
  },
});
```

The token can be validated in a connect handler or guard:

<!-- typecheck: skip -->
```typescript
@OnConnect()
async handleConnect(@Client() client: WsClientData) {
  if (client.auth?.token) {
    try {
      const decoded = await verifyJwtToken(client.auth.token);
      client.auth.authenticated = true;
      client.auth.userId = decoded.userId;
      client.auth.permissions = decoded.permissions;
    } catch {
      // Token invalid
      client.auth.authenticated = false;
    }
  }
}
```

## Running the Example

1. Start the server:

```bash
bun run src/index.ts
```

2. Connect clients: `createWsClient` or `createNativeWsClient` from Bun, `WebSocket` or socket.io-client from a browser.

---

> Full source code: [examples/websocket-chat](https://github.com/RemRyahirev/onebun/tree/master/examples/websocket-chat)

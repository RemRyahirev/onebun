# WebSocket Chat Application

This example demonstrates how to build a real-time chat application using OneBun WebSocket Gateway.

## Overview

We'll create a chat application with:
- Multiple chat rooms
- User authentication
- Message broadcasting
- Room management

## Project Structure

```
src/
├── chat.gateway.ts      # WebSocket gateway
├── chat.service.ts      # Business logic
├── chat.module.ts       # Module definition
├── auth.guard.ts        # Custom guard
└── index.ts             # Application entry
```

## Server Implementation

### Chat Gateway

```typescript
// src/chat.gateway.ts
import {
  WebSocketGateway,
  BaseWebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  Client,
  MessageData,
  RoomName,
  PatternParams,
  UseWsGuards,
} from '@onebun/core';
import type { WsClientData } from '@onebun/core';
import { ChatService } from './chat.service';
import { ChatAuthGuard } from './auth.guard';

interface ChatMessage {
  text: string;
}

@WebSocketGateway({ path: '/chat' })
export class ChatGateway extends BaseWebSocketGateway {
  constructor(private chatService: ChatService) {
    super();
  }

  @OnConnect()
  async handleConnect(@Client() client: WsClientData) {
    console.log(`Client ${client.id} connected`);
    
    // Send welcome message
    return {
      event: 'welcome',
      data: {
        message: 'Welcome to the chat!',
        clientId: client.id,
        timestamp: Date.now(),
      },
    };
  }

  @OnDisconnect()
  async handleDisconnect(@Client() client: WsClientData) {
    console.log(`Client ${client.id} disconnected`);
    
    // Notify all rooms the client was in
    for (const room of client.rooms) {
      this.emitToRoom(room, 'user:left', {
        userId: client.id,
        room,
      });
    }
  }

  @OnJoinRoom('room:{roomId}')
  async handleJoinRoom(
    @Client() client: WsClientData,
    @RoomName() room: string,
    @PatternParams() params: { roomId: string },
  ) {
    console.log(`Client ${client.id} joining room ${params.roomId}`);
    
    // Add to room
    await this.joinRoom(client.id, room);
    
    // Notify others in the room
    this.emitToRoom(room, 'user:joined', {
      userId: client.id,
      room,
    }, [client.id]); // Exclude the joining user
    
    // Get message history
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

  @OnLeaveRoom('room:{roomId}')
  async handleLeaveRoom(
    @Client() client: WsClientData,
    @RoomName() room: string,
    @PatternParams() params: { roomId: string },
  ) {
    // Remove from room
    await this.leaveRoom(client.id, room);
    
    // Notify others
    this.emitToRoom(room, 'user:left', {
      userId: client.id,
      room,
    });
  }

  @UseWsGuards(ChatAuthGuard)
  @OnMessage('chat:{roomId}:message')
  async handleMessage(
    @Client() client: WsClientData,
    @MessageData() data: ChatMessage,
    @PatternParams() params: { roomId: string },
  ) {
    // Validate client is in the room
    if (!client.rooms.includes(`room:${params.roomId}`)) {
      return {
        event: 'error',
        data: { message: 'Not in room' },
      };
    }
    
    // Save message
    const message = await this.chatService.saveMessage({
      roomId: params.roomId,
      userId: client.id,
      text: data.text,
      timestamp: Date.now(),
    });
    
    // Broadcast to room
    this.emitToRoom(`room:${params.roomId}`, 'chat:message', message);
    
    // Acknowledge sender
    return {
      event: 'chat:message:ack',
      data: { messageId: message.id },
    };
  }

  @OnMessage('typing:{roomId}')
  handleTyping(
    @Client() client: WsClientData,
    @PatternParams() params: { roomId: string },
  ) {
    // Broadcast typing indicator (except to sender)
    this.emitToRoom(
      `room:${params.roomId}`,
      'typing',
      { userId: client.id },
      [client.id],
    );
  }

  // Helper method to get clients in a room
  private async getClientsInRoom(roomName: string): Promise<string[]> {
    const clients = await super.getClientsByRoom(roomName);
    return clients.map(c => c.id);
  }
}
```

### Chat Service

```typescript
// src/chat.service.ts
import { Service } from '@onebun/core';

interface Message {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  timestamp: number;
}

@Service()
export class ChatService {
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

### Auth Guard

```typescript
// src/auth.guard.ts
import { createGuard, type WsExecutionContext } from '@onebun/core';

export const ChatAuthGuard = createGuard((context: WsExecutionContext) => {
  const client = context.getClient();
  
  // Check if client has authenticated
  if (!client.auth?.authenticated) {
    return false;
  }
  
  // Optional: Check for specific permissions
  // return client.auth.permissions?.includes('chat:send') ?? false;
  
  return true;
});
```

### Module Setup

```typescript
// src/chat.module.ts
import { Module } from '@onebun/core';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatGateway], // Gateways go in controllers
  providers: [ChatService],
})
export class ChatModule {}
```

### Application Entry

```typescript
// src/index.ts
import { OneBunApplication } from '@onebun/core';
import { ChatModule } from './chat.module';

const app = new OneBunApplication(ChatModule, {
  port: 3000,
  websocket: {
    pingInterval: 25000,
    pingTimeout: 20000,
  },
});

await app.start();

console.log('Chat server running on http://localhost:3000');
console.log('WebSocket available at ws://localhost:3000/chat');
```

## Client Implementation

### Typed Client

```typescript
// client.ts
import { createWsServiceDefinition, createWsClient } from '@onebun/core';
import { ChatModule } from './chat.module';

// Create typed client
const definition = createWsServiceDefinition(ChatModule);
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/chat',
  auth: {
    token: 'user-jwt-token',
  },
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

// Subscribe to events
client.ChatGateway.on('welcome', (data) => {
  console.log('Welcome message:', data.message);
});

client.ChatGateway.on('chat:message', (message) => {
  console.log(`[${message.userId}]: ${message.text}`);
});

client.ChatGateway.on('user:joined', (data) => {
  console.log(`User ${data.userId} joined ${data.room}`);
});

client.ChatGateway.on('user:left', (data) => {
  console.log(`User ${data.userId} left ${data.room}`);
});

client.ChatGateway.on('typing', (data) => {
  console.log(`${data.userId} is typing...`);
});

// Join a room
const roomInfo = await client.ChatGateway.emit('join', 'room:general');
console.log('Joined room with history:', roomInfo.history);

// Send a message
const ack = await client.ChatGateway.emit('chat:general:message', {
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

### Using socket.io-client

```typescript
// socket-io-client.ts
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3000/chat', {
  auth: {
    token: 'user-jwt-token',
  },
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

// Disconnect
socket.disconnect();
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

2. Connect clients using the typed client or socket.io-client.

## Testing

```typescript
// chat.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { OneBunApplication, createWsServiceDefinition, createWsClient } from '@onebun/core';
import { ChatModule } from './chat.module';

describe('Chat WebSocket', () => {
  let app: OneBunApplication;
  let client: ReturnType<typeof createWsClient>;

  beforeAll(async () => {
    app = new OneBunApplication(ChatModule, { port: 3001 });
    await app.start();

    const definition = createWsServiceDefinition(ChatModule);
    client = createWsClient(definition, {
      url: 'ws://localhost:3001/chat',
    });
    await client.connect();
  });

  afterAll(async () => {
    client.disconnect();
    await app.stop();
  });

  it('should receive welcome message on connect', (done) => {
    client.ChatGateway.on('welcome', (data) => {
      expect(data.message).toBe('Welcome to the chat!');
      done();
    });
  });

  it('should join room and receive history', async () => {
    const response = await client.ChatGateway.emit('join', 'room:test');
    expect(response.room).toBe('test');
    expect(response.history).toBeArray();
  });

  it('should send and receive messages', async () => {
    // Join room first
    await client.ChatGateway.emit('join', 'room:test');

    // Setup listener
    const messagePromise = new Promise<any>((resolve) => {
      client.ChatGateway.on('chat:message', resolve);
    });

    // Send message
    const ack = await client.ChatGateway.emit('chat:test:message', { text: 'Hello' });
    expect(ack.messageId).toBeDefined();

    // Verify received
    const received = await messagePromise;
    expect(received.text).toBe('Hello');
  });
});
```

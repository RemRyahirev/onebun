# @onebun/core

Core package for OneBun framework providing decorators, dependency injection, and modular architecture.

## Features

- 🎯 **Modular Architecture** - Organize code in modules with controllers and services
- 🏷️ **Declarative Routes** - Use decorators (@Controller, @Get, @Post, etc.)
- 💉 **Type-safe DI** - Effect.Context and Layer for dependency management
- ✅ **Built-in Validation** - Schema-based validation with ArkType integration
- 🔧 **Middleware Support** - Chainable middleware with decorators
- 📦 **Service Pattern** - BaseService and BaseController for standardized code
- 🔄 **Multi-service Support** - Run multiple services in one process
- ⚡ **Effect.js Integration** - Full Effect.js ecosystem support

## Installation

```bash
bun add @onebun/core
```

## Quick Start

```typescript
import { OneBunApplication, Controller, Get, Module } from '@onebun/core';

@Controller('/api')
class AppController {
  @Get('/hello')
  async hello() {
    return { message: 'Hello, OneBun!' };
  }
}

@Module({
  controllers: [AppController],
})
class AppModule {}

const app = new OneBunApplication(AppModule);
await app.start();
```

## Route Decorators

The OneBun framework provides a set of decorators for defining routes in controllers:

```typescript
import { Controller, Get, Post, Put, Delete, Patch, Options, Head, All } from '@onebun/core';

@Controller('/users')
export class UsersController {
  @Get()
  getAllUsers() {
    // Handle GET /users
  }

  @Get('/:id')
  getUserById(@Param('id') id: string) {
    // Handle GET /users/:id
  }

  @Post()
  createUser(@Body() userData: any) {
    // Handle POST /users
  }

  @Put('/:id')
  updateUser(@Param('id') id: string, @Body() userData: any) {
    // Handle PUT /users/:id
  }

  @Delete('/:id')
  deleteUser(@Param('id') id: string) {
    // Handle DELETE /users/:id
  }
}
```

### Parameter Decorators

OneBun provides parameter decorators for extracting data from requests:

- `@Param(name)`: Extract path parameters
- `@Query(name)`: Extract query parameters
- `@Body()`: Extract request body
- `@Header(name)`: Extract request headers
- `@Req()`: Get the request object
- `@Res()`: Get the response object (currently not fully supported)

Example:

```typescript
@Controller('/api')
export class ApiController {
  @Get('/search')
  search(
    @Query('q') query: string,
    @Query('limit', { required: true }) limit: number
  ) {
    // Handle GET /api/search?q=something&limit=10
    return { results: [], query, limit };
  }

  @Post('/users/:id/profile')
  updateProfile(
    @Param('id') userId: string,
    @Body() profileData: any,
    @Header('Authorization') token: string
  ) {
    // Handle POST /api/users/123/profile
    return { success: true, userId };
  }
}
```

### Middleware

You can add middleware to routes using the `@UseMiddleware` decorator:

```typescript
function loggerMiddleware(req: Request, next: () => Promise<Response>): Promise<Response> {
  console.log(`Request: ${req.method} ${new URL(req.url).pathname}`);
  return next();
}

function authMiddleware(req: Request, next: () => Promise<Response>): Promise<Response> {
  const token = req.headers.get('Authorization');
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  return next();
}

@Controller('/admin')
export class AdminController {
  @Get('/dashboard')
  @UseMiddleware(loggerMiddleware, authMiddleware)
  getDashboard() {
    // This route will be protected by authMiddleware
    // and logged by loggerMiddleware
    return { stats: {} };
  }
}
```

## Path Parameters

OneBun supports path parameters in routes:

```typescript
@Controller('/api')
export class ApiController {
  @Get('/users/:id')
  getUser(@Param('id') id: string) {
    // The :id in the path will be extracted and passed to the handler
    return { id };
  }

  @Get('/organizations/:orgId/members/:memberId')
  getMember(
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string
  ) {
    // Multiple path parameters are supported
    return { orgId, memberId };
  }
}
```

## Parameter Validation

You can add validation to parameters:

```typescript
@Controller('/api')
export class ApiController {
  @Get('/users/:id')
  getUser(
    @Param('id', { 
      required: true,
      validator: (value) => /^\d+$/.test(value)
    }) id: string
  ) {
    // The id parameter is required and must be numeric
    return { id };
  }
}
```

## Modules

OneBun uses modules to organize controllers and services:

```typescript
import { Module } from '@onebun/core';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService]
})
export class UsersModule {}
```

### Global Modules

Use `@Global()` decorator to make a module's exports available in all other modules without explicit import:

```typescript
import { Module, Global, Service, BaseService } from '@onebun/core';

@Service()
export class DatabaseService extends BaseService {
  async query(sql: string) { /* ... */ }
}

// Mark module as global - DatabaseService is now available everywhere
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

// Import once in root module
@Module({
  imports: [DatabaseModule, UserModule],
})
export class AppModule {}

// UserModule can use DatabaseService without importing DatabaseModule
@Module({
  controllers: [UserController],
  providers: [UserService], // UserService can inject DatabaseService
})
export class UserModule {}
```

This is particularly useful for cross-cutting concerns like database connections, caching, or logging services that are needed throughout the application.

## Services

OneBun provides a simple way to define services with the `@Service` decorator:

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  private users = [];

  findAll() {
    return this.users;
  }

  findById(id: string) {
    return this.users.find(user => user.id === id);
  }

  create(userData: any) {
    const user = { id: Date.now().toString(), ...userData };
    this.users.push(user);
    return user;
  }
}
```

The `@Service` decorator automatically creates a Context tag for the service and registers it with the module system. The `BaseService` class provides utility methods for working with Effect.js.

## Metadata System

OneBun includes a lightweight metadata system that powers its decorators and dependency injection. Unlike many TypeScript frameworks, OneBun doesn't rely on external dependencies like reflect-metadata, making it more lightweight and easier to use in client applications.

The metadata system provides:

- Storage for controller route definitions
- Parameter type information for request handling
- Middleware registration
- Service registration and dependency tracking

This system is used internally by the framework and generally doesn't need to be accessed directly by application code.

## Dependency Injection

Controllers can access services using dependency injection:

```typescript
import { Controller, Get, Post, BaseController } from '@onebun/core';
import { UserService } from './user.service';

@Controller('/users')
export class UserController extends BaseController {
  @Get()
  getAllUsers() {
    // Get the service using dependency injection
    const userService = this.getService(UserService);

    // Call the service method directly
    const users = userService.findAll();

    // Return a standardized success response
    return this.success({ users });
  }

  @Post()
  createUser(@Body() userData: any) {
    const userService = this.getService(UserService);
    const user = userService.create(userData);
    return this.success({ user });
  }
}
```

## Standardized Responses

OneBun provides standardized response formats:

```typescript
// Success response: { success: true, result: data }
return this.success({ users });

// Error response: { success: false, code: number, message: string }
return this.error('User not found', 404);
```

Errors thrown in controller methods are automatically caught and converted to standardized error responses.

## WebSocket Gateway

OneBun provides WebSocket support with a Gateway pattern similar to NestJS, with full Socket.IO protocol compatibility.

### Basic Gateway

```typescript
import {
  WebSocketGateway,
  BaseWebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnMessage,
  Client,
  MessageData,
} from '@onebun/core';
import type { WsClientData } from '@onebun/core';

@WebSocketGateway({ path: '/ws' })
export class ChatGateway extends BaseWebSocketGateway {
  @OnConnect()
  handleConnect(@Client() client: WsClientData) {
    console.log(`Client ${client.id} connected`);
    return { event: 'welcome', data: { clientId: client.id } };
  }

  @OnDisconnect()
  handleDisconnect(@Client() client: WsClientData) {
    console.log(`Client ${client.id} disconnected`);
  }

  @OnMessage('chat:message')
  handleMessage(
    @Client() client: WsClientData,
    @MessageData() data: { text: string }
  ) {
    // Broadcast to all clients
    this.broadcast('chat:message', {
      userId: client.id,
      text: data.text,
    });
  }
}
```

### Pattern Matching

Event patterns support wildcards and named parameters:

```typescript
// Wildcard: matches chat:general, chat:private, etc.
@OnMessage('chat:*')
handleAnyChat(@MessageData() data: unknown) {}

// Named parameter: extracts roomId
@OnMessage('chat:{roomId}:message')
handleRoomMessage(@PatternParams() params: { roomId: string }) {}
```

### Room Management

```typescript
@WebSocketGateway({ path: '/ws' })
export class RoomGateway extends BaseWebSocketGateway {
  @OnJoinRoom('room:{roomId}')
  async handleJoin(
    @Client() client: WsClientData,
    @RoomName() room: string,
    @PatternParams() params: { roomId: string }
  ) {
    await this.joinRoom(client.id, room);
    this.emitToRoom(room, 'user:joined', { userId: client.id });
  }

  @OnLeaveRoom('room:*')
  async handleLeave(@Client() client: WsClientData, @RoomName() room: string) {
    await this.leaveRoom(client.id, room);
    this.emitToRoom(room, 'user:left', { userId: client.id });
  }
}
```

### Guards

Protect WebSocket handlers with guards:

```typescript
import { UseWsGuards, WsAuthGuard, WsPermissionGuard } from '@onebun/core';

@UseWsGuards(WsAuthGuard)
@OnMessage('protected:*')
handleProtected(@Client() client: WsClientData) {
  // Only authenticated clients can access
}

@UseWsGuards(new WsPermissionGuard('admin'))
@OnMessage('admin:*')
handleAdmin(@Client() client: WsClientData) {
  // Only clients with 'admin' permission
}
```

### Typed Client

Generate a type-safe WebSocket client:

```typescript
import { createWsServiceDefinition, createWsClient } from '@onebun/core';
import { AppModule } from './app.module';

const definition = createWsServiceDefinition(AppModule);
const client = createWsClient(definition, {
  url: 'ws://localhost:3000/ws',
  auth: { token: 'your-token' },
});

await client.connect();

// Type-safe event emission
await client.ChatGateway.emit('chat:message', { text: 'Hello!' });

// Subscribe to events
client.ChatGateway.on('chat:message', (data) => {
  console.log('Received:', data);
});

client.disconnect();
```

### Storage Options

Configure client/room storage:

```typescript
const app = new OneBunApplication(AppModule, {
  websocket: {
    storage: {
      type: 'memory', // or 'redis' for multi-instance
      redis: {
        url: 'redis://localhost:6379',
        prefix: 'ws:',
      },
    },
  },
});
```

### Socket.IO Compatibility

OneBun WebSocket Gateway is fully compatible with `socket.io-client`:

```typescript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3000/ws', {
  auth: { token: 'your-token' },
});

socket.on('chat:message', (data) => console.log(data));
socket.emit('chat:message', { text: 'Hello!' });
```

For complete API documentation, see [docs/api/websocket.md](../../docs/api/websocket.md).

## Application

Create and start an OneBun application:

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  host: '0.0.0.0',
  development: true
});

// Start the application (no Effect.js calls needed)
app.start()
  .then(() => console.log('Application started'))
  .catch(error => console.error('Failed to start application:', error));
```

The application automatically creates a logger based on NODE_ENV (development or production) and handles all Effect.js calls internally.

## Graceful Shutdown

OneBun supports graceful shutdown to cleanly close connections and release resources when the application stops. **Graceful shutdown is enabled by default.**

### Default Behavior

By default, the application automatically handles SIGTERM and SIGINT signals:

```typescript
const app = new OneBunApplication(AppModule, {
  port: 3000,
  // gracefulShutdown: true is the default
});

await app.start();
// Application will automatically handle shutdown signals
```

### Disabling Graceful Shutdown

If you need to manage shutdown manually, you can disable automatic handling:

```typescript
const app = new OneBunApplication(AppModule, {
  gracefulShutdown: false, // Disable automatic SIGTERM/SIGINT handling
});

await app.start();

// Now you must handle shutdown manually:
// Option 1: Enable signal handlers later
app.enableGracefulShutdown();

// Option 2: Stop programmatically
await app.stop();

// Option 3: Stop but keep shared Redis connection open (for other consumers)
await app.stop({ closeSharedRedis: false });
```

### What Gets Cleaned Up

When the application stops, the following resources are cleaned up:

1. **HTTP Server** - Bun server is stopped
2. **WebSocket Handler** - All WebSocket connections are closed
3. **Shared Redis** - If using SharedRedisProvider, the connection is closed (unless `closeSharedRedis: false`)

### Shared Redis Connection

When using `SharedRedisProvider` for cache, WebSocket storage, or other features, the connection is automatically closed on shutdown:

```typescript
import { SharedRedisProvider, OneBunApplication } from '@onebun/core';

// Configure shared Redis at startup
SharedRedisProvider.configure({
  url: 'redis://localhost:6379',
  keyPrefix: 'myapp:',
});

const app = new OneBunApplication(AppModule, {
  gracefulShutdown: true,
});

await app.start();
// Shared Redis will be closed when app receives SIGTERM/SIGINT
```

## License

[LGPL-3.0](../../LICENSE)

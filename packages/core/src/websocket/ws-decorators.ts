/**
 * WebSocket Decorators
 *
 * Decorators for creating WebSocket gateways with event handlers.
 */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import type {
  WebSocketGatewayOptions,
  GatewayMetadata,
  WsHandlerMetadata,
  WsParamMetadata,
  WsGuard,
} from './ws.types';

import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  registerPipelineReapplyHook,
} from '../decorators/decorators';
import { Reflect } from '../decorators/metadata';

import { WsHandlerType, WsParamType } from './ws.types';


// ============================================================================
// Metadata Keys
// ============================================================================

const WS_GATEWAY_METADATA = 'onebun:ws:gateway';
const WS_PARAMS_METADATA = 'onebun:ws:params';
const WS_GUARDS_METADATA = 'onebun:ws:guards';

// ============================================================================
// Metadata Storage
// ============================================================================

const META_GATEWAYS = new Map<Function, GatewayMetadata>();

// ============================================================================
// Class Decorators
// ============================================================================

/**
 * Decorator to mark a class as a WebSocket Gateway
 *
 * @param options - Gateway options (path, namespace)
 *
 * @example
 * ```typescript
 * @WebSocketGateway({ path: '/ws', namespace: 'chat' })
 * export class ChatGateway extends BaseWebSocketGateway {
 *   // ...
 * }
 * ```
 * @see docs:api/websocket.md
 */
export function WebSocketGateway(options?: WebSocketGatewayOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends new (...args: any[]) => any>(target: T): T => {
    const metadata: GatewayMetadata = {
      path: options?.path || '/',
      namespace: options?.namespace,
      authenticate: options?.authenticate,
      handlers: [],
    };

    // Get existing handlers metadata
    const existingMetadata = META_GATEWAYS.get(target);
    if (existingMetadata) {
      metadata.handlers = existingMetadata.handlers;
    }

    META_GATEWAYS.set(target, metadata);
    Reflect.defineMetadata(WS_GATEWAY_METADATA, metadata, target);

    return target;
  };
}

/**
 * Get gateway metadata for a class
 */
export function getGatewayMetadata(target: Function): GatewayMetadata | undefined {
  return META_GATEWAYS.get(target) || Reflect.getMetadata(WS_GATEWAY_METADATA, target);
}

/**
 * Check if a class is a WebSocket Gateway
 */
export function isWebSocketGateway(target: Function): boolean {
  return META_GATEWAYS.has(target) || Reflect.getMetadata(WS_GATEWAY_METADATA, target) !== undefined;
}

// ============================================================================
// Method Decorators (Event Handlers)
// ============================================================================

/**
 * Create a WebSocket handler decorator
 */
function createWsHandlerDecorator(type: WsHandlerType, pattern?: string) {
  return (target: object, propertyKey: string, descriptor: PropertyDescriptor) => {
    const gatewayClass = target.constructor as Function;

    // Get existing metadata or create new
    let metadata = META_GATEWAYS.get(gatewayClass);
    if (!metadata) {
      metadata = { path: '/', handlers: [] };
    }

    // Get parameter metadata
    const params: WsParamMetadata[] =
      Reflect.getMetadata(WS_PARAMS_METADATA, target, propertyKey) || [];

    // Get guards metadata: the shared @UseGuards key first, then the WS-specific
    // @UseWsGuards one. Sharing the key is what stops `@UseGuards` on an `@OnMessage`
    // handler from being a silent no-op — see readHandlerGuards.
    const guards = readHandlerGuards(target, propertyKey);

    // Get interceptors metadata (shared key with HTTP/Queue via @UseInterceptors)
    const interceptors: Function[] =
      Reflect.getMetadata(INTERCEPTORS_METADATA, target, propertyKey) || [];

    // Create handler metadata
    const handlerMetadata: WsHandlerMetadata = {
      type,
      pattern,
      handler: propertyKey,
      params,
      guards,
      // Interceptors stored as unresolved here; resolved at gateway registration time
      ...(interceptors.length > 0 ? { interceptors: interceptors as unknown as import('../types').ResolvedInterceptor[] } : {}),
    };

    metadata.handlers.push(handlerMetadata);
    META_GATEWAYS.set(gatewayClass, metadata);

    return descriptor;
  };
}

/**
 * Decorator for handling client connection events
 *
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnConnect()
 * handleConnect(@Client() client: WsClientData) {
 *   console.log('Client connected:', client.id);
 *   return { event: 'welcome', data: { message: 'Welcome!' } };
 * }
 * ```
 */
export function OnConnect() {
  return createWsHandlerDecorator(WsHandlerType.CONNECT);
}

/**
 * Decorator for handling client disconnection events
 *
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnDisconnect()
 * handleDisconnect(@Client() client: WsClientData) {
 *   console.log('Client disconnected:', client.id);
 * }
 * ```
 */
export function OnDisconnect() {
  return createWsHandlerDecorator(WsHandlerType.DISCONNECT);
}

/**
 * Decorator for handling room join events
 *
 * @param pattern - Optional pattern for room name matching
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnJoinRoom('room:{roomId}')
 * handleJoinRoom(@Client() client: WsClientData, @RoomName() room: string) {
 *   console.log(`Client ${client.id} joined room ${room}`);
 * }
 * ```
 */
export function OnJoinRoom(pattern?: string) {
  return createWsHandlerDecorator(WsHandlerType.JOIN_ROOM, pattern);
}

/**
 * Decorator for handling room leave events
 *
 * @param pattern - Optional pattern for room name matching
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnLeaveRoom('room:*')
 * handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
 *   console.log(`Client ${client.id} left room ${room}`);
 * }
 * ```
 */
export function OnLeaveRoom(pattern?: string) {
  return createWsHandlerDecorator(WsHandlerType.LEAVE_ROOM, pattern);
}

/**
 * Decorator for handling incoming messages
 *
 * @param pattern - Event pattern to match (supports wildcards and parameters)
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnMessage('chat:message')
 * handleMessage(@Client() client: WsClientData, @MessageData() data: any) {
 *   this.broadcast('chat:message', { userId: client.id, ...data });
 * }
 *
 * @OnMessage('chat:{roomId}:message')
 * handleRoomMessage(
 *   @Client() client: WsClientData,
 *   @MessageData() data: any,
 *   @PatternParams() params: { roomId: string }
 * ) {
 *   this.emitToRoom(`room:${params.roomId}`, 'chat:message', data);
 * }
 * ```
 */
export function OnMessage(pattern: string) {
  return createWsHandlerDecorator(WsHandlerType.MESSAGE, pattern);
}

// ============================================================================
// Parameter Decorators
// ============================================================================

/**
 * Create a WebSocket parameter decorator
 */
function createWsParamDecorator(type: WsParamType, property?: string) {
  return (target: object, propertyKey: string, parameterIndex: number) => {
    const params: WsParamMetadata[] =
      Reflect.getMetadata(WS_PARAMS_METADATA, target, propertyKey) || [];

    params.push({
      type,
      property,
      index: parameterIndex,
    });

    Reflect.defineMetadata(WS_PARAMS_METADATA, params, target, propertyKey);
  };
}

/**
 * Decorator to inject client data into handler
 *
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnMessage('chat:message')
 * handleMessage(@Client() client: WsClientData) {
 *   console.log('Message from:', client.id);
 * }
 * ```
 */
export function Client() {
  return createWsParamDecorator(WsParamType.CLIENT);
}

/**
 * Decorator to inject raw WebSocket into handler
 *
 * @example
 * ```typescript
 * @OnMessage('ping')
 * handlePing(@Socket() socket: ServerWebSocket) {
 *   socket.send(JSON.stringify({ event: 'pong', data: {} }));
 * }
 * ```
 */
export function Socket() {
  return createWsParamDecorator(WsParamType.SOCKET);
}

/**
 * Decorator to inject message data into handler
 *
 * @param property - Optional property path to extract from message data
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnMessage('chat:message')
 * handleMessage(@MessageData() data: { text: string }) {
 *   console.log('Message:', data.text);
 * }
 *
 * @OnMessage('chat:message')
 * handleMessage(@MessageData('text') text: string) {
 *   console.log('Message text:', text);
 * }
 * ```
 */
export function MessageData(property?: string) {
  return createWsParamDecorator(WsParamType.MESSAGE_DATA, property);
}

/**
 * Decorator to inject room name into handler
 *
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnJoinRoom('room:{roomId}')
 * handleJoinRoom(@RoomName() room: string) {
 *   console.log('Joining room:', room);
 * }
 * ```
 */
export function RoomName() {
  return createWsParamDecorator(WsParamType.ROOM_NAME);
}

/**
 * Decorator to inject pattern parameters into handler
 *
 * @see docs:api/websocket.md
 * @example
 * ```typescript
 * @OnMessage('chat:{roomId}:message')
 * handleMessage(@PatternParams() params: { roomId: string }) {
 *   console.log('Room ID:', params.roomId);
 * }
 * ```
 */
export function PatternParams() {
  return createWsParamDecorator(WsParamType.PATTERN_PARAMS);
}

/**
 * Decorator to inject WebSocket server into handler or property
 *
 * @example
 * ```typescript
 * @WebSocketGateway()
 * export class ChatGateway extends BaseWebSocketGateway {
 *   @WsServer()
 *   server: WsServer;
 *
 *   // Or as parameter
 *   @OnMessage('broadcast')
 *   handleBroadcast(@WsServer() server: WsServer) {
 *     server.publish('all', 'Hello everyone!');
 *   }
 * }
 * ```
 */
export function WsServer() {
  return createWsParamDecorator(WsParamType.SERVER);
}

// ============================================================================
// Guards Decorator
// ============================================================================

/**
 * Decorator to apply guards to a WebSocket handler
 *
 * @param guards - Guard classes or instances to apply
 *
 * @example
 * ```typescript
 * @UseWsGuards(WsAuthGuard)
 * @OnMessage('admin:*')
 * handleAdminMessage(@Client() client: WsClientData) {
 *   // Only authenticated clients can reach here
 * }
 * ```
 */
export function UseWsGuards(...guards: (Function | WsGuard)[]): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const existingGuards: (Function | WsGuard)[] =
      Reflect.getMetadata(WS_GUARDS_METADATA, target, propertyKey as string) || [];

    Reflect.defineMetadata(
      WS_GUARDS_METADATA,
      [...existingGuards, ...guards],
      target,
      propertyKey as string,
    );

    // Order independence: `@OnMessage` may already have snapshotted an empty guard list,
    // because method decorators apply bottom-up. Without this, `@UseWsGuards` written ABOVE
    // the handler decorator was silently discarded and the handler ran unguarded.
    reapplyGatewayPipelineMetadata(target, propertyKey);

    return descriptor;
  };
}

/**
 * The guards a gateway handler runs: shared `@UseGuards` first, then `@UseWsGuards`.
 *
 * `@UseGuards` used to write a key only HTTP route registration read, so it was silently
 * discarded here and the message handler ran unguarded — a security hole shaped like working
 * code. Both decorators now feed the same handler list; `@UseWsGuards` keeps working and is
 * still the right choice for a guard that only ever makes sense on a socket.
 *
 * Deduplicated by identity, because the same guard written with both decorators must not run
 * twice.
 *
 * @see docs:api/guards.md
 */
function readHandlerGuards(target: object, propertyKey: string | symbol): (Function | WsGuard)[] {
  const shared: (Function | WsGuard)[] =
    Reflect.getMetadata(GUARDS_METADATA, target, propertyKey as string) || [];
  const wsSpecific: (Function | WsGuard)[] =
    Reflect.getMetadata(WS_GUARDS_METADATA, target, propertyKey as string) || [];

  return [...new Set([...shared, ...wsSpecific])];
}

/**
 * Re-apply a handler's pipeline metadata onto gateway handlers already registered.
 *
 * The WebSocket twin of the route-level fix: `@OnMessage` and friends snapshot guards and
 * interceptors when they run, and method decorators apply bottom-up, so anything written
 * above the handler decorator landed after the snapshot and was dropped.
 *
 * @see docs:api/websocket.md
 */
function reapplyGatewayPipelineMetadata(target: object, propertyKey: string | symbol): void {
  const gatewayClass = (target as { constructor?: Function }).constructor;
  if (!gatewayClass) {
    return;
  }

  const metadata = META_GATEWAYS.get(gatewayClass);
  if (!metadata) {
    // The handler decorator has not run yet; it will read this metadata itself.
    return;
  }

  for (const handler of metadata.handlers) {
    if (handler.handler !== propertyKey) {
      continue;
    }

    handler.guards = readHandlerGuards(target, propertyKey as string);

    const interceptors: Function[] =
      Reflect.getMetadata(INTERCEPTORS_METADATA, target, propertyKey as string) || [];
    if (interceptors.length > 0) {
      handler.interceptors = interceptors as unknown as import('../types').ResolvedInterceptor[];
    }
  }
}

// `@UseInterceptors` is shared across HTTP, WebSocket and Queue and lives in the decorators
// module, so it cannot import this one. It calls every registered hook instead.
registerPipelineReapplyHook(reapplyGatewayPipelineMetadata);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get handler metadata for a gateway method
 */
export function getWsHandlerMetadata(
  target: Function,
  methodName: string,
): WsHandlerMetadata | undefined {
  const metadata = getGatewayMetadata(target);

  return metadata?.handlers.find((h) => h.handler === methodName);
}

/**
 * Get all handlers from a gateway
 */
export function getWsHandlers(target: Function): WsHandlerMetadata[] {
  const metadata = getGatewayMetadata(target);

  return metadata?.handlers || [];
}

/**
 * Get parameter metadata for a handler
 */
export function getWsParamMetadata(target: object, methodName: string): WsParamMetadata[] {
  return Reflect.getMetadata(WS_PARAMS_METADATA, target, methodName) || [];
}

/**
 * Get guards for a handler
 */
export function getWsGuards(target: object, methodName: string): Function[] {
  return Reflect.getMetadata(WS_GUARDS_METADATA, target, methodName) || [];
}

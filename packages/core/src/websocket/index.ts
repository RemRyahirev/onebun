/**
 * WebSocket Module
 *
 * WebSocket gateway system with Socket.IO protocol support.
 */

// Types (excluding duplicates that come from ws-client.types)
// Note: WsServer type is exported from ws.types.ts but WsServer decorator is from ws-decorators.ts
// We export the type as WsServerType to avoid conflict with the decorator
export {
  WsHandlerType,
  WsParamType,
  isWsMessage,
  isWsHandlerResponse,
  isWsClientData,
  isWsRoom,
  type WsClientData,
  type WsAuthData,
  type WsRoom,
  type GatewayMetadata,
  type WsHandlerMetadata,
  type WsParamMetadata,
  type WebSocketGatewayOptions,
  type WsMessage,
  type WsHandlerResponse,
  type PatternMatch,
  type WsExecutionContext,
  type WsGuard,
  // Export WsServer type as WsServerType to avoid conflict with WsServer decorator
  type WsServer as WsServerType,
} from './ws.types';

export * from './ws-client.types';

// Core
export * from './ws-base-gateway';
export * from './ws-handler';
export * from './ws-decorators';
export * from './ws-guards';
export * from './ws-pattern-matcher';
export * from './ws-socketio-protocol';

// Storage
export * from './ws-storage';
export * from './ws-storage-memory';
export * from './ws-storage-redis';

// Service definition & client
export * from './ws-service-definition';
export * from './ws-client';

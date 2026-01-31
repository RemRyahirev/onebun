// export * from './metadata';
// export * from './types';
// export * from './config.service';
// Re-export envs from @onebun/envs
export { Env, type EnvSchema, EnvValidationError } from '@onebun/envs';
export type { SyncLogger } from '@onebun/logger';
export {
  createHttpClient,
  type ErrorResponse,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  NotFoundError,
  OneBunBaseError,
  type SuccessResponse,
} from '@onebun/requests';
export { Span } from '@onebun/trace';
// Re-export Effect and Layer from effect
export { Effect, Layer } from 'effect';
export { OneBunApplication } from './application';
export { Controller as BaseController } from './controller';
export * from './decorators';
export { defineMetadata, getMetadata } from './metadata';
export { OneBunModule } from './module';
export { BaseService, getServiceTag, Service } from './service';
export {
  FakeTimers,
  fakeTimers,
  useFakeTimers,
  makeMockLoggerLayer,
} from './test-utils';
export {
  HttpMethod,
  type RouteMetadata,
  type ControllerMetadata,
  type ParamMetadata,
  type ResponseSchemaMetadata,
  ParamType, 
} from './types';
export * from './validation';

// Multi-service application
export { MultiServiceApplication } from './multi-service-application';
export type {
  MultiServiceApplicationOptions,
  ServiceConfig,
  ServicesMap,
  BaseServiceOptions,
  EnvOverrideValue,
  EnvOverrides,
} from './multi-service.types';

// Service definition and client
export { createServiceDefinition } from './service-definition';
export type {
  ServiceDefinition,
  EndpointMetadata,
  ControllerDefinition,
} from './service-definition';

export { createServiceClient, getServiceUrl } from './service-client';
export type { ServiceClientOptions, ControllerClient } from './service-client.types';

// ENV resolver
export { resolveEnvOverrides, resolveEnvOverridesSync } from './env-resolver';

// WebSocket Gateway
export { BaseWebSocketGateway } from './ws-base-gateway';
export {
  WebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  Client,
  Socket,
  MessageData,
  RoomName,
  PatternParams,
  WsServer,
  UseWsGuards,
  getGatewayMetadata,
  isWebSocketGateway,
} from './ws-decorators';
export {
  WsAuthGuard,
  WsPermissionGuard,
  WsRoomGuard,
  WsAnyPermissionGuard,
  WsServiceGuard,
  WsAllGuards,
  WsAnyGuard,
  WsExecutionContextImpl,
  executeGuards,
  createGuard,
} from './ws-guards';
export type {
  WsClientData,
  WsAuthData,
  WsRoom,
  WsHandlerType,
  WsParamType,
  GatewayMetadata,
  WsHandlerMetadata,
  WsParamMetadata,
  WebSocketGatewayOptions,
  WsStorageOptions,
  WebSocketApplicationOptions,
  WsMessage,
  WsHandlerResponse,
  PatternMatch,
  WsExecutionContext,
  WsGuard,
  WsServer as WsServerType,
} from './ws.types';
export {
  WsHandlerType as WsHandlerTypeEnum,
  WsParamType as WsParamTypeEnum,
  isWsMessage,
  isWsHandlerResponse,
  isWsClientData,
  isWsRoom,
} from './ws.types';
export {
  matchPattern,
  isPatternMatch,
  createPatternMatcher,
  isPattern,
  getPatternParams,
  buildFromPattern,
} from './ws-pattern-matcher';
export type { WsStorageAdapter, WsPubSubStorageAdapter, WsStorageEventPayload } from './ws-storage';
export { WsStorageEvent, isPubSubAdapter } from './ws-storage';
export { InMemoryWsStorage, createInMemoryWsStorage } from './ws-storage-memory';
export { RedisWsStorage, createRedisWsStorage } from './ws-storage-redis';

// Redis Client (shared)
export { RedisClient, createRedisClient } from './redis-client';
export type { RedisClientOptions } from './redis-client';
export {
  SharedRedisProvider, SharedRedisService, makeSharedRedisLayer, getSharedRedis, 
} from './shared-redis';
export type { SharedRedisOptions } from './shared-redis';

// WebSocket Service Definition and Client
export {
  createWsServiceDefinition, getWsGatewayNames, getWsEventNames, getWsEndpoint, 
} from './ws-service-definition';
export type { WsServiceDefinition, WsGatewayDefinition, WsEndpointMetadata } from './ws-service-definition';
export { createWsClient } from './ws-client';
export type {
  WsClientOptions,
  WsClient,
  WsGatewayClient,
  WsEventListener,
  WsClientEvent,
  WsClientEventListeners,
  TypedWsClient,
} from './ws-client.types';
export { WsConnectionState } from './ws-client.types';

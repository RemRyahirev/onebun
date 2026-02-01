// Re-export from external packages
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

// Types (excluding WebSocket types that are re-exported from ./websocket)
export {
  HttpMethod,
  ParamType,
  type ServiceInterface,
  type ModuleProviders,
  type ModuleInstance,
  type TypedEnvSchema,
  type ApplicationOptions,
  type ParamMetadata,
  type ResponseSchemaMetadata,
  type RouteMetadata,
  type ControllerMetadata,
  // WebSocket types are exported from ./websocket
  type WsStorageType,
  type WsStorageOptions,
  type WebSocketApplicationOptions,
  // Docs types
  type DocsApplicationOptions,
} from './types';

// Decorators and Metadata (exports Controller decorator, Module decorator, etc.)
export * from './decorators';

// Module System - explicitly re-export to avoid Controller conflict
export {
  OneBunModule,
  Controller as BaseController,
  BaseService,
  Service,
  getServiceMetadata,
  getServiceTag,
  createServiceLayer,
  ConfigServiceImpl,
  ConfigServiceTag,
  ConfigService,
} from './module';

// Application
export * from './application';

// Service Client
export * from './service-client';

// Redis
export * from './redis';

// WebSocket
export * from './websocket';

// Queue System
export * from './queue';

// Validation
export * from './validation';

// Testing Utilities
export * from './testing';

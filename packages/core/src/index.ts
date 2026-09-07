// Re-export from external packages
export {
  Env,
  type EnvSchema,
  EnvValidationError,
  getConfig,
  type InferConfigType,
  type EnvVariableConfig,
} from '@onebun/envs';
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
// Re-export Effect and Layer from effect
export { Effect, Layer } from 'effect';

// Types (excluding WebSocket types that are re-exported from ./websocket)
export {
  HttpMethod,
  ParamType,
  type OneBunRequest,
  type OneBunResponse,
  type ServiceInterface,
  type ModuleProviders,
  type ModuleInstance,
  type TypedEnvSchema,
  type ApplicationOptions,
  type ParamDecoratorOptions,
  type ParamMetadata,
  type ResponseSchemaMetadata,
  type RouteOptions,
  type RouteMetadata,
  type ControllerMetadata,
  type MiddlewareClass,
  type OnModuleConfigure,
  // File upload types
  type FileUploadOptions,
  type FilesUploadOptions,
  // WebSocket types are exported from ./websocket
  type WsStorageType,
  type WsStorageOptions,
  type WebSocketApplicationOptions,
  type StaticApplicationOptions,
  // Docs types
  type DocsApplicationOptions,
  // SSE types
  type SseEvent,
  type SseOptions,
  type SseGenerator,
  // Guard and pipeline context types. The docs tell readers to import these from
  // '@onebun/core'; until they were listed here that import did not resolve, and the
  // docs-examples tests reached into './types' instead, so nothing noticed.
  type ExecutionContext,
  type HttpExecutionContext,
  type HttpGuard,
} from './types';

// Decorators and Metadata (exports Controller decorator, Module decorator, etc.)
export * from './decorators';

// File Upload (OneBunFile class, MimeType enum, helpers)
export {
  OneBunFile, MimeType, matchMimeType, validateFile, 
} from './file';

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
  // Global modules support
  clearGlobalServicesRegistry,
  getGlobalServicesRegistry,
  // Config interface types
  type IConfig,
  type OneBunAppConfig,
  NotInitializedConfig,
  // Lifecycle hooks interfaces
  type OnModuleInit,
  type OnApplicationInit,
  type OnModuleDestroy,
  type BeforeApplicationDestroy,
  type OnApplicationDestroy,
  // Middleware
  BaseMiddleware,
  // Lifecycle hooks helper functions
  hasOnModuleInit,
  hasOnApplicationInit,
  hasOnModuleDestroy,
  hasBeforeApplicationDestroy,
  hasOnApplicationDestroy,
  callOnModuleInit,
  callOnApplicationInit,
  callOnModuleDestroy,
  callBeforeApplicationDestroy,
  callOnApplicationDestroy,
  // SSE helpers
  formatSseEvent,
  createSseStream,
  // Server & SSE default constants
  DEFAULT_IDLE_TIMEOUT,
  DEFAULT_SSE_HEARTBEAT_MS,
  DEFAULT_SSE_TIMEOUT,
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

// Profiler
export {
  type ProfileMark,
  type ProfileReport,
  type Profiler,
  type ProfilingOptions,
  PROFILING_ENABLED,
  getProfiler,
  setProfiler,
  runProfileScope,
  DefaultProfiler,
} from './profiler';

// Testing utilities live behind the '@onebun/core/testing' subpath so the framework's own
// entry point stays free of them. `testcontainers` is a REQUIRED peer dependency: OneBun
// takes integration tests as the default way to test a service and ships the helpers for
// them, so the subpath is a boundary of concern, not a way to make the peer optional.
// Declare it in your devDependencies — a production install never pulls it.

// HTTP Guards
export * from './http-guards';

// Exception Filters
export * from './exception-filters';

// HTTP Interceptors
export * from './interceptors';

// Security Middleware
export * from './security';

// Bootstrap Errors
export * from './errors';

// Request Context (AsyncLocalStorage)
export { getCurrentTraceContext, requestContextStore, type RequestContext } from './request-context';

// Named module registrations — the supported way to configure a dynamic module more than
// once. See docs:api/decorators.md.
export {
  getRegistrationBase,
  getRegistrationOptions,
  isRegistrationModule,
  registerModule,
  type RegistrationToken,
  resetRegistrations,
  selectRegistration,
} from './module/registration';

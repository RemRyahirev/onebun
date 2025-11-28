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

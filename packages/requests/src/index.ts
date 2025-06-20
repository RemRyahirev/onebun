/**
 * @onebun/requests
 * 
 * Unified HTTP client module for OneBun framework
 * Provides built-in tracing, metrics, error handling, and retries
 */

// Core types
export * from './types.js';

// Authentication
export * from './auth.js';

// HTTP client
export { 
  HttpClient, 
  createRequestError, 
  executeRequest, 
  createHttpClient 
} from './client.js';

// Service for dependency injection
export {
  RequestsService,
  makeRequestsService,
  makeRequestsServiceFromEnv,
  createHttpClient as createClient,
  requests
} from './service.js';

// Re-export common types for convenience
export type {
  RequestConfig,
  RequestResponse,
  RequestError,
  RequestsOptions,
  AuthConfig,
  RetryConfig,
  HttpMethod,
  RequestMetricsData,
  RequestTraceData
} from './types.js'; 
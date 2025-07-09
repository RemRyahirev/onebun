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
  executeRequest,
} from './client.js';

// Service for dependency injection
export {
  RequestsService,
  makeRequestsService,
} from './service.js';

// Export the createHttpClient function specifically to avoid conflicts
export { createHttpClient } from './client.js';

// Re-export common types for convenience
export type {
  ErrorResponse,
  SuccessResponse,
  ApiResponse,
  RequestConfig,
  RequestsOptions,
  AuthConfig,
  RetryConfig,
  HttpMethod,
  RequestMetricsData,
  RequestTraceData,
  ReqConfig,
  RequestErrorConfig,
} from './types.js'; 
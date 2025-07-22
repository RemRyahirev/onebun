/**
 * \@onebun/requests
 *
 * Unified HTTP client module for OneBun framework
 * Provides built-in tracing, metrics, error handling, and retries
 */

// Authentication
export * from './auth.js';
// HTTP client
// Export the createHttpClient function specifically to avoid conflicts
export { createHttpClient, executeRequest, HttpClient } from './client.js';

// Service for dependency injection
export {
  makeRequestsService,
  RequestsService,
} from './service.js';
// Re-export common types for convenience
export type {
  ApiResponse,
  AuthConfig,
  ErrorResponse,
  HttpMethod,
  ReqConfig,
  RequestConfig,
  RequestErrorConfig,
  RequestMetricsData,
  RequestsOptions,
  RequestTraceData,
  RetryConfig,
  SuccessResponse,
} from './types.js';
// Core types
export * from './types.js';

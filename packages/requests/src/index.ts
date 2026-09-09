/**
 * \@onebun/requests
 *
 * Unified HTTP client module for OneBun framework
 * Provides built-in tracing, metrics, error handling, and retries
 */

// Authentication
export * from './auth.js';
export * from './onebun-auth.js';
// HTTP client
// Export the createHttpClient function specifically to avoid conflicts
export {
  calculateRetryDelay, createHttpClient, executeRequest, HttpClient, 
} from './client.js';

// Outgoing trace context
export {
  currentOutgoingTraceContext,
  formatTraceparent,
  isUsableTraceContext,
  type OutgoingTraceContext,
  setTraceContextProvider,
  type TraceContextProvider,
} from './trace-context.js';

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

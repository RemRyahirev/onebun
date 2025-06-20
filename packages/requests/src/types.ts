/**
 * HTTP method enumeration
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS'
}

/**
 * Request error with chainable context
 */
export interface RequestError {
  code: string;
  message: string;
  details?: any;
  cause?: RequestError;  // Chained errors for request chains
  statusCode?: number;
  traceId?: string;
  timestamp: number;
}

/**
 * Standardized request response format
 */
export interface RequestResponse<T = any> {
  success: boolean;
  data?: T;
  error?: RequestError;
  statusCode: number;
  headers: Record<string, string>;
  duration: number;
  traceId?: string;
  url: string;
  method: string;
  retryCount?: number;
}

/**
 * Authentication configuration types
 */
export type AuthConfig = 
  | BearerAuthConfig
  | ApiKeyAuthConfig
  | BasicAuthConfig
  | CustomAuthConfig
  | OneBunAuthConfig;

export interface BearerAuthConfig {
  type: 'bearer';
  token: string;
}

export interface ApiKeyAuthConfig {
  type: 'apikey';
  key: string;
  value: string;
  location?: 'header' | 'query';
}

export interface BasicAuthConfig {
  type: 'basic';
  username: string;
  password: string;
}

export interface CustomAuthConfig {
  type: 'custom';
  headers?: Record<string, string>;
  query?: Record<string, string>;
  interceptor?: (request: RequestConfig) => RequestConfig | Promise<RequestConfig>;
}

export interface OneBunAuthConfig {
  type: 'onebun';
  serviceId: string;
  secretKey: string;
  algorithm?: 'hmac-sha256' | 'hmac-sha512';
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  max: number;
  delay: number;
  backoff: 'linear' | 'exponential' | 'fixed';
  factor?: number;
  retryOn?: number[];
  onRetry?: (error: RequestError, attempt: number) => void | Promise<void>;
}

/**
 * Request configuration
 */
export interface RequestConfig {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  data?: any;
  timeout?: number;
  retries?: Partial<RetryConfig>;
  auth?: AuthConfig;
  tracing?: boolean;
  metrics?: boolean;
}

/**
 * HTTP client options
 */
export interface RequestsOptions {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
  auth?: AuthConfig;
  retries?: RetryConfig;
  tracing?: boolean;
  metrics?: boolean;
  userAgent?: string;
}

/**
 * Request metrics data
 */
export interface RequestMetricsData {
  method: string;
  url: string;
  statusCode: number;
  duration: number;
  success: boolean;
  retryCount: number;
  baseUrl?: string;
}

/**
 * Request trace data for distributed tracing
 */
export interface RequestTraceData {
  method: string;
  url: string;
  headers?: Record<string, string>;
  statusCode?: number;
  duration?: number;
  requestSize?: number;
  responseSize?: number;
  error?: string;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  max: 3,
  delay: 1000,
  backoff: 'exponential',
  factor: 2,
  retryOn: [408, 429, 500, 502, 503, 504]
};

/**
 * Default requests options
 */
export const DEFAULT_REQUESTS_OPTIONS: Required<Omit<RequestsOptions, 'baseUrl' | 'auth'>> = {
  timeout: 10000,
  headers: {},
  retries: DEFAULT_RETRY_CONFIG,
  tracing: true,
  metrics: true,
  userAgent: 'OneBun-Requests/1.0'
}; 
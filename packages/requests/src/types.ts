/**
 * Standardized API response formats for OneBun framework
 */

/**
 * Recursive OneBun error type for error chaining
 */
export interface OneBunError<E extends string = string, R extends string = string> {
  error: E;
  code: number;
  message?: string;
  traceId?: string;
  details?: Record<string, unknown>;
  originalError?: OneBunError<R>;
}

/**
 * Successful API response
 */
export interface SuccessResponse<T = any> {
  success: true;
  result: T;
  traceId?: string;
}

/**
 * Error API response
 */
export interface ErrorResponse<E extends string = string, R extends string = string> extends OneBunError<E, R> {
  success: false;
}

/**
 * Standardized API response type - either success or error
 */
export type ApiResponse<T = any, E extends string = string, R extends string = string> = SuccessResponse<T> | ErrorResponse<E, R>;

/**
 * Base OneBun error class
 */
export abstract class OneBunBaseError<E extends string = string, R extends string = string> extends Error {
  public abstract readonly code: number;
  
  constructor(
    public readonly error: E,
    public readonly details: Record<string, unknown> = {},
    public readonly originalError?: OneBunError<R>,
  ) {
    super(String(error));
    this.name = this.constructor.name;
  }

  toErrorResponse(): ErrorResponse<E, R> {
    return {
      success: false,
      error: this.error,
      code: this.code,
      details: this.details,
      originalError: this.originalError,
    };
  }

  static fromErrorResponse<U extends string, V extends string>(errorResponse: ErrorResponse<U, V>): OneBunBaseError<U, V> {
    // Определяем тип ошибки по коду
    switch (errorResponse.code) {
      case 400:
        return new BadRequestError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 401:
        return new UnauthorizedError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 403:
        return new ForbiddenError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 404:
        return new NotFoundError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 409:
        return new ConflictError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 422:
        return new ValidationError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 429:
        return new TooManyRequestsError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 500:
        return new InternalServerError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 502:
        return new BadGatewayError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 503:
        return new ServiceUnavailableError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      case 504:
        return new GatewayTimeoutError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
      default:
        return new InternalServerError<U, V>(errorResponse.error, errorResponse.details, errorResponse.originalError);
    }
  }

  /**
   * Add context to error and create error chain
   */
  withContext<U extends string>(contextMessage: U, contextDetails: Record<string, unknown> = {}): OneBunBaseError<U, E> {
    return new InternalServerError<U, E>(
      contextMessage,
      contextDetails,
      this.toErrorResponse(),
    );
  }
}

// 4xx Client Errors
export class BadRequestError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 400;
}

export class UnauthorizedError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 401;
}

export class ForbiddenError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 403;
}

export class NotFoundError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 404;
}

export class ConflictError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 409;
}

export class ValidationError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 422;
}

export class TooManyRequestsError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 429;
}

// 5xx Server Errors
export class InternalServerError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 500;
}

export class BadGatewayError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 502;
}

export class ServiceUnavailableError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 503;
}

export class GatewayTimeoutError<E extends string = string, R extends string = string> extends OneBunBaseError<E, R> {
  public readonly code = 504;
}

/**
 * Helper function to create success response
 */
export function createSuccessResponse<T>(
  result: T,
  traceId?: string,
): SuccessResponse<T> {
  return {
    success: true,
    result,
    traceId,
  };
}

/**
 * Helper function to create error response
 */
export function createErrorResponse<E extends string, R extends string>(
  error: string,
  code: number,
  message?: string,
  traceId?: string,
  details: Record<string, unknown> = {},
  originalError?: OneBunError<E, R>,
): ErrorResponse {
  return {
    success: false,
    error,
    message,
    traceId,
    code,
    details,
    originalError,
  };
}

export function wrapToErrorResponse<E extends string, R extends string>(error: OneBunError<E, R>): ErrorResponse<E, R> {
  return {
    ...error,
    success: false,
  };
}

/**
 * Helper function to check if response is an error
 */
export function isErrorResponse(response: any): response is ErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    response.success === false &&
    'error' in response &&
    typeof response.code === 'number'
  );
}

/**
 * Helper function to check if response is a success
 */
export function isSuccessResponse(response: any): response is SuccessResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    response.success === true &&
    'result' in response
  );
}

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
  onRetry?: (error: ErrorResponse, attempt: number) => void | Promise<void>;
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
  delay: 300,
  backoff: 'exponential',
  factor: 2,
  retryOn: [408, 429, 500, 502, 503, 504],
};

/**
 * Error configuration for req method
 */
export interface RequestErrorConfig {
  [errorKey: string]: {
    error: string;
    message: string;
    details?: Record<string, unknown>;
    code?: number;
  };
}

/**
 * Configuration for req method
 */
export interface ReqConfig {
  errors?: RequestErrorConfig;
}

/**
 * Default requests options
 */
export const DEFAULT_REQUESTS_OPTIONS: Required<Omit<RequestsOptions, 'baseUrl' | 'auth'>> = {
  timeout: 3000,
  headers: {},
  retries: DEFAULT_RETRY_CONFIG,
  tracing: true,
  metrics: true,
  userAgent: 'OneBun-Requests/1.0',
}; 
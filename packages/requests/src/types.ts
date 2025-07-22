/**
 * Standardized API response formats for OneBun framework
 */

/**
 * HTTP status codes enumeration
 */
/* eslint-disable no-magic-numbers -- Standard HTTP status codes defined in one place */
export enum HttpStatusCode {
  // 2xx Success
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,

  // 3xx Redirection
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  NOT_MODIFIED = 304,

  // 4xx Client Errors
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
}
/* eslint-enable no-magic-numbers */

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
export interface SuccessResponse<T = unknown> {
  success: true;
  result: T;
  traceId?: string;
}

/**
 * Error API response
 */
export interface ErrorResponse<E extends string = string, R extends string = string>
  extends OneBunError<E, R> {
  success: false;
}

/**
 * Standardized API response type - either success or error
 */
export type ApiResponse<T = unknown, E extends string = string, R extends string = string> =
  | SuccessResponse<T>
  | ErrorResponse<E, R>;

/**
 * Base OneBun error class
 */
export abstract class OneBunBaseError<
  E extends string = string,
  R extends string = string,
> extends Error {
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

  static fromErrorResponse<U extends string, V extends string>(
    errorResponse: ErrorResponse<U, V>,
  ): OneBunBaseError<U, V> {
    switch (errorResponse.code) {
      case HttpStatusCode.BAD_REQUEST:
        return new BadRequestError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.UNAUTHORIZED:
        return new UnauthorizedError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.FORBIDDEN:
        return new ForbiddenError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.NOT_FOUND:
        return new NotFoundError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.CONFLICT:
        return new ConflictError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.UNPROCESSABLE_ENTITY:
        return new ValidationError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.TOO_MANY_REQUESTS:
        return new TooManyRequestsError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.INTERNAL_SERVER_ERROR:
        return new InternalServerError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.BAD_GATEWAY:
        return new BadGatewayError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.SERVICE_UNAVAILABLE:
        return new ServiceUnavailableError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      case HttpStatusCode.GATEWAY_TIMEOUT:
        return new GatewayTimeoutError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
      default:
        return new InternalServerError<U, V>(
          errorResponse.error,
          errorResponse.details,
          errorResponse.originalError,
        );
    }
  }

  /**
   * Add context to error and create error chain
   */
  withContext<U extends string>(
    contextMessage: U,
    contextDetails: Record<string, unknown> = {},
  ): OneBunBaseError<U, E> {
    return new InternalServerError<U, E>(contextMessage, contextDetails, this.toErrorResponse());
  }
}

// 4xx Client Errors
export class BadRequestError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.BAD_REQUEST;
}

export class UnauthorizedError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.UNAUTHORIZED;
}

export class ForbiddenError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.FORBIDDEN;
}

export class NotFoundError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.NOT_FOUND;
}

export class ConflictError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.CONFLICT;
}

export class ValidationError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.UNPROCESSABLE_ENTITY;
}

export class TooManyRequestsError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.TOO_MANY_REQUESTS;
}

// 5xx Server Errors
export class InternalServerError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.INTERNAL_SERVER_ERROR;
}

export class BadGatewayError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.BAD_GATEWAY;
}

export class ServiceUnavailableError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.SERVICE_UNAVAILABLE;
}

export class GatewayTimeoutError<
  E extends string = string,
  R extends string = string,
> extends OneBunBaseError<E, R> {
  public readonly code = HttpStatusCode.GATEWAY_TIMEOUT;
}

/**
 * Helper function to create success response
 */
export function createSuccessResponse<T>(result: T, traceId?: string): SuccessResponse<T> {
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

export function wrapToErrorResponse<E extends string, R extends string>(
  error: OneBunError<E, R>,
): ErrorResponse<E, R> {
  return {
    ...error,
    success: false,
  };
}

/**
 * Helper function to check if response is an error
 */
export function isErrorResponse(response: unknown): response is ErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    (response as { success: unknown }).success === false &&
    'error' in response &&
    'code' in response &&
    typeof (response as { code: unknown }).code === 'number'
  );
}

/**
 * Helper function to check if response is a success
 */
export function isSuccessResponse(response: unknown): response is SuccessResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    (response as { success: unknown }).success === true &&
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
  OPTIONS = 'OPTIONS',
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
  query?: Record<string, unknown>;
  data?: unknown;
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
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY = 300;

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  max: DEFAULT_MAX_RETRIES,
  delay: DEFAULT_RETRY_DELAY,
  backoff: 'exponential',
  factor: 2,
  retryOn: [
    HttpStatusCode.REQUEST_TIMEOUT,
    HttpStatusCode.TOO_MANY_REQUESTS,
    HttpStatusCode.INTERNAL_SERVER_ERROR,
    HttpStatusCode.BAD_GATEWAY,
    HttpStatusCode.SERVICE_UNAVAILABLE,
    HttpStatusCode.GATEWAY_TIMEOUT,
  ],
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
export const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

export const DEFAULT_REQUESTS_OPTIONS: Required<Omit<RequestsOptions, 'baseUrl' | 'auth'>> = {
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {},
  retries: DEFAULT_RETRY_CONFIG,
  tracing: true,
  metrics: true,
  userAgent: 'OneBun-Requests/1.0',
};

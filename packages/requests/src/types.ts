/**
 * Standardized API response formats for OneBun framework
 */

/**
 * HTTP status codes enumeration
 */
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

/**
 * Recursive OneBun error type for error chaining
 */
export interface OneBunError<E extends string = string, R extends string = string> {
  error: E;
  code: number;
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
  /**
   * How many retries were spent before this response was produced.
   * `0` means the request was sent exactly once.
   */
  retryCount?: number;
}

/**
 * Error API response
 */
export interface ErrorResponse<E extends string = string, R extends string = string>
  extends OneBunError<E, R> {
  success: false;
  /**
   * How many retries were spent before this response was produced.
   * `0` means the request was sent exactly once.
   */
  retryCount?: number;
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
   * The returned error preserves the original error as the main one
   * and nests the provided context as the originalError (error chain).
   */
  withContext<U extends string>(
    contextMessage: U,
    contextDetails: Record<string, unknown> = {},
  ): OneBunBaseError<E, U> {
    const contextErr = new InternalServerError<U, E>(
      contextMessage,
      contextDetails,
    ).toErrorResponse();

    return new InternalServerError<E, U>(this.error as E, this.details, contextErr);
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
  traceId?: string,
  details: Record<string, unknown> = {},
  originalError?: OneBunError<E, R>,
): ErrorResponse {
  return {
    success: false,
    error,
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
 * Kind of failure that happened before any HTTP response existed.
 *
 * - `timeout` — the client-side timeout fired; the server may still have processed the request
 * - `abort` — the request was aborted deliberately
 * - `network` — connection refused, DNS failure, TLS failure: the request never arrived
 *
 * @see docs:api/requests.md
 */
export type TransportFailureKind = 'timeout' | 'abort' | 'network';

/**
 * Pseudo status code carried by transport failures.
 *
 * Zero is not a valid HTTP status, so a transport failure can never collide with an entry
 * of `RetryConfig.retryOn` — that list stays a pure status-code list and a timeout stops
 * masquerading as a server 500.
 *
 * @see docs:api/requests.md
 */
export const TRANSPORT_FAILURE_CODE = 0;

/**
 * Read the transport failure kind off a response, if it is one.
 *
 * Returns `undefined` for every response that came back from a server, including 5xx.
 *
 * @see docs:api/requests.md
 */
export function getTransportFailureKind(response: unknown): TransportFailureKind | undefined {
  if (!isErrorResponse(response) || response.code !== TRANSPORT_FAILURE_CODE) {
    return undefined;
  }

  const kind = response.details?.transport;

  return kind === 'timeout' || kind === 'abort' || kind === 'network' ? kind : undefined;
}

/**
 * Retry configuration
 *
 * @see docs:api/requests.md
 */
export interface RetryConfig {
  /** Number of retries after the initial attempt. `max: 3` means up to 4 requests in total. */
  max: number;
  /** Base delay in milliseconds between attempts. */
  delay: number;
  backoff: 'linear' | 'exponential' | 'fixed';
  factor?: number;
  /**
   * HTTP status codes that trigger a retry. Only statuses that a server actually returned are
   * matched here — transport failures are governed by `retryOnNetworkError`/`retryOnTimeout`.
   */
  retryOn?: number[];
  /**
   * HTTP methods allowed to be retried. Defaults to {@link DEFAULT_RETRY_METHODS} — the
   * idempotent set. POST and PATCH must be listed explicitly to be retried, because replaying
   * them can duplicate a charge, an order or a message.
   */
  methods?: string[];
  /** Retry when the request never reached the server (connection refused, DNS, TLS). */
  retryOnNetworkError?: boolean;
  /**
   * Retry when the client-side timeout fired. Off by default: the server may have processed
   * the request already, so a retry duplicates it even for an idempotent method.
   */
  retryOnTimeout?: boolean;
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
  /** Partial: every field left out keeps its {@link DEFAULT_RETRY_CONFIG} value. */
  retries?: Partial<RetryConfig>;
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

/**
 * Methods retried without any configuration: the idempotent set of RFC 9110 §9.2.2.
 *
 * POST and PATCH are absent on purpose — re-sending them creates a second order, charge or
 * message. A caller who knows a particular endpoint is safe opts in via `retries.methods`.
 *
 * @see docs:api/requests.md
 */
export const DEFAULT_RETRY_METHODS: string[] = [
  HttpMethod.GET,
  HttpMethod.HEAD,
  HttpMethod.OPTIONS,
  HttpMethod.PUT,
  HttpMethod.DELETE,
];

/**
 * The single source of truth for retry behaviour. Every partial config is merged onto this.
 *
 * @see docs:api/requests.md
 */
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
  methods: DEFAULT_RETRY_METHODS,
  retryOnNetworkError: true,
  retryOnTimeout: false,
};

/**
 * Merge partial retry configs field-wise onto {@link DEFAULT_RETRY_CONFIG}, later wins.
 *
 * Passing `{ max: 5 }` changes only `max`; every other field keeps its documented default
 * instead of being dropped by a shallow object replacement.
 *
 * @see docs:api/requests.md
 */
export function resolveRetryConfig(
  ...configs: (Partial<RetryConfig> | undefined)[]
): RetryConfig {
  return configs.reduce<RetryConfig>(
    (acc, config) => (config ? { ...acc, ...config } : acc),
    { ...DEFAULT_RETRY_CONFIG },
  );
}

/**
 * Whether a method may be retried under the given config.
 *
 * @see docs:api/requests.md
 */
export function isRetryableMethod(method: string, config: RetryConfig): boolean {
  const methods = config.methods ?? DEFAULT_RETRY_METHODS;
  const normalized = method.toUpperCase();

  return methods.some((allowed) => allowed.toUpperCase() === normalized);
}

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

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
  SEE_OTHER = 303,
  NOT_MODIFIED = 304,
  TEMPORARY_REDIRECT = 307,
  PERMANENT_REDIRECT = 308,

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
 *
 * @see docs:api/requests.md
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
  /**
   * The HTTP status the upstream actually returned.
   *
   * Present on responses the HTTP client produced; absent when a handler's return value was
   * wrapped by the framework, which has no upstream. Every 2xx is a success, and so is a
   * 304 Not Modified, and they are not interchangeable — 201 Created, 202 Accepted, 204 No Content
   * and 304 each mean something a caller may need to branch on, and the metric label is derived
   * from this rather than assumed. For 204, 304 and any answer to HEAD, `result` is `undefined`.
   * Under `redirect: 'manual'` a `301`, `302`, `303`, `307` or `308` is a success too, and this is
   * that status.
   */
  statusCode?: number;
  /**
   * The headers the upstream answered with — after redirects, the final hop's. Under
   * `redirect: 'manual'`, the redirect's own, `location` included.
   *
   * Names are lower-cased, and a header sent more than once is joined with `, `, as
   * `Headers.get()` joins it (`set-cookie` included). Present on responses the HTTP client
   * produced, absent when a handler's return value was wrapped by the framework. Under
   * `maxResponseBytes`, a body the client decoded itself comes without `content-encoding` and
   * `content-length`: they describe the compressed bytes, not `result`.
   *
   * NOT enumerable: `JSON.stringify`, `Object.keys`, a spread and `structuredClone` all skip it,
   * while `response.headers` and `'headers' in response` work as usual. A controller that returns
   * the envelope as it is would otherwise forward the upstream's `set-cookie`, `server` and every
   * other header to its own caller, in the body. To pass one on, set it on a `Response` yourself.
   */
  headers?: Record<string, string>;
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
 *
 * It never sets `headers`: the framework wraps a handler's return value with it, and that value
 * has no upstream. The HTTP client attaches the upstream's headers to the envelopes it produces.
 */
export function createSuccessResponse<T>(
  result: T,
  traceId?: string,
  statusCode?: number,
): SuccessResponse<T> {
  return {
    success: true,
    result,
    traceId,
    ...(statusCode === undefined ? {} : { statusCode }),
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

/**
 * Inter-service HMAC authentication.
 *
 * @see docs:api/requests.md
 */
export interface OneBunAuthConfig {
  type: 'onebun';
  /** Who is calling. Signed, and reported to the callee once the signature verifies. */
  serviceId: string;
  secretKey: string;
  algorithm?: 'hmac-sha256' | 'hmac-sha512';
  /**
   * Which key this is, for rotation. Signed. Defaults to `'default'`.
   *
   * A callee resolving secrets by `(serviceId, keyId)` can accept both the old and the new key
   * during a rollover; without it, rotating a secret means a flag day.
   */
  keyId?: string;
  /**
   * Which callee this signature is for.
   *
   * Bind it unless the verifier runs with `audience: false`. Without it, a request captured en
   * route to one service can be replayed at another that shares the secret — which is the default
   * shape when a fleet is given one `secretKey`.
   */
  audience?: string;
}

/**
 * Kind of failure that happened before the response was complete.
 *
 * - `timeout` — the client-side timeout fired, before the headers arrived or while the body was
 *   being read; the server may still have processed the request. A timeout during the body read
 *   keeps the status that did arrive in `details.statusCode`, with `details.phase: 'body'`.
 * - `abort` — the request was aborted deliberately rather than by the timeout
 * - `network` — the connection failed before a response arrived: refused, DNS, TLS, or reset. A
 *   refused connection or a failed lookup proves the server never saw the request; a reset after
 *   the request was sent (`ECONNRESET`) does not — that request may have been processed.
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
 * Returns `undefined` for every response that came back from a server complete, including 5xx. A
 * response whose body timed out did not: it is a `'timeout'`, and the status that arrived is in
 * `details.statusCode`.
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
   * HTTP status codes that trigger a retry. Only statuses of responses that actually arrived are
   * matched here — transport failures are governed by `retryOnNetworkError`/`retryOnTimeout`,
   * and that includes a 5xx whose body stalled until the timeout.
   */
  retryOn?: number[];
  /**
   * HTTP methods allowed to be retried. Defaults to {@link DEFAULT_RETRY_METHODS} — the
   * idempotent set. POST and PATCH must be listed explicitly to be retried, because replaying
   * them can duplicate a charge, an order or a message.
   */
  methods?: string[];
  /**
   * Retry when the connection failed before a response arrived (refused, DNS, TLS, reset). A
   * reset after the request was sent does not prove the server skipped it, which is one more
   * reason POST and PATCH stay off {@link methods} unless an endpoint is safe to call twice.
   */
  retryOnNetworkError?: boolean;
  /**
   * Retry when the client-side timeout fired — before the headers arrived or while the body was
   * being read. Off by default: the server may have processed the request already, so a retry
   * duplicates it even for an idempotent method.
   */
  retryOnTimeout?: boolean;
  onRetry?: (error: ErrorResponse, attempt: number) => void | Promise<void>;
}

/**
 * What the client does with a `301`, `302`, `303`, `307` or `308`.
 *
 * - `'follow'` — the default. The client follows it, up to 20 in one call, and a hop to another
 *   origin carries no credential.
 * - `'error'` — fail with `REDIRECT_ERROR`, `details.reason: 'refused-by-policy'`, without
 *   contacting the `Location`. Never retried.
 * - `'manual'` — resolve with the redirect itself: a success whose `statusCode` is the 3xx and
 *   whose `headers.location` is the `Location` as the server sent it. An empty body typed as JSON
 *   resolves with `result: undefined` rather than failing. `RequestsService` returns `result`
 *   alone, so read a redirect through `HttpClient`.
 *
 * Any other 3xx is an answer rather than a redirect, under every policy.
 *
 * @see docs:api/requests.md
 */
export type RedirectPolicy = 'follow' | 'error' | 'manual';

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
  /**
   * The largest response body this request accepts, in decoded bytes. Overrides the client's
   * {@link RequestsOptions.maxResponseBytes}. `Infinity` lifts the client's cap for this request,
   * which is then read as without one: decompressed by `fetch`, not by the client.
   */
  maxResponseBytes?: number;
  /**
   * What this request does with a redirect. Overrides the client's
   * {@link RequestsOptions.redirect}.
   *
   * Not a config marker: `client.get('/login', { redirect: '/home' })` is query data. `get`,
   * `delete`, `head` and `options` take the policy in their third argument.
   */
  redirect?: RedirectPolicy;
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
  /**
   * Whether to report request metrics at all. Reporting also needs a {@link metricsSink}.
   *
   * @defaultValue true
   */
  metrics?: boolean;
  /**
   * Where request metrics go.
   *
   * This client is a free function: it has no application and no instance, so it cannot find
   * out which application it belongs to. It used to reach a process-wide slot — which in a
   * multi-application process belongs to whichever application started LAST — and record an
   * OUTGOING call into the SERVER's own `http_requests_total`, with the full URL as the route.
   * Measured: a call made by one application produced
   * `beta_http_requests_total{controller="requests-client",route="http://127.0.0.1:35379/alpha/ping",app="beta"}`.
   *
   * So the destination is passed in. `@onebun/metrics` provides a sink that records into a
   * client-specific metric family; without one, nothing is recorded.
   */
  metricsSink?: (data: RequestMetricsData) => void;
  userAgent?: string;
  /**
   * The largest response body any request of this client accepts, counted in decoded bytes as the
   * body arrives. A request's own `maxResponseBytes` overrides it.
   *
   * Unset — the default — a body is read whole, however large, and `fetch` decompresses it. Set,
   * the client asks for the raw bytes and undoes `gzip`, `deflate`, `br` and `zstd` itself, so the
   * count is of what the body inflates to rather than of what crossed the wire. A body that grows
   * past the cap fails `RESPONSE_TOO_LARGE` at that chunk and its connection is closed; an error
   * status is read under the same cap. A content coding the client cannot decode fails
   * `RESPONSE_DECODE_ERROR` before anything is read. Neither is ever retried. A body the client
   * decoded comes without `content-encoding` and `content-length`, in a success's `headers` and in
   * an `HTTP_ERROR`'s `details.headers` alike. `Infinity` is the same as unset.
   */
  maxResponseBytes?: number;
  /**
   * What every request of this client does with a redirect ({@link RedirectPolicy}). A request's
   * own `redirect` overrides it.
   *
   * @defaultValue 'follow'
   */
  redirect?: RedirectPolicy;
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

export const DEFAULT_REQUESTS_OPTIONS: Required<
  Omit<RequestsOptions, 'baseUrl' | 'auth' | 'metricsSink' | 'maxResponseBytes'>
> = {
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {},
  retries: DEFAULT_RETRY_CONFIG,
  tracing: true,
  metrics: true,
  userAgent: 'OneBun-Requests/1.0',
  redirect: 'follow',
};

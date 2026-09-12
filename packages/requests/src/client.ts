import { Effect, pipe } from 'effect';

import { applyAuth, isSigningAuth } from './auth.js';
import { signOneBunRequest } from './onebun-auth.js';
import {
  currentOutgoingTraceContext,
  formatTraceparent,
  type OutgoingTraceContext,
} from './trace-context.js';
import {
  type ApiResponse,
  createErrorResponse,
  createSuccessResponse,
  DEFAULT_REQUESTS_OPTIONS,
  DEFAULT_TIMEOUT_MS,
  type ErrorResponse,
  getTransportFailureKind,
  HttpMethod,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  isRetryableMethod,
  OneBunBaseError,
  type ReqConfig,
  type RequestConfig,
  type RequestMetricsData,
  type RequestsOptions,
  resolveRetryConfig,
  type RetryConfig,
  type SuccessResponse,
  TRANSPORT_FAILURE_CODE,
  type TransportFailureKind,
  wrapToErrorResponse,
} from './types.js';

/** Methods whose body is sent, and therefore signed. */
const BODY_CARRYING_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH'];

/**
 * Fields that mark the second argument of `get`/`delete` as a config rather than query data.
 *
 * The overload is ambiguous by construction — both arms take a plain object — so this list is the
 * whole of the decision. It used to name four fields, which left `tracing` on the wrong side:
 * `client.get(url, { tracing: false })` was read as query data and went out as `?tracing=false`,
 * with the header it was meant to suppress still attached.
 *
 * `retries` and `query` are deliberately NOT here. `query` is documented as producing a literal
 * `?query=[object Object]` — the page warns against wrapping the query in a key and a test pins
 * it — and a `?retries=3` is a plausible query param in a way that `?tracing=` is not. Both still
 * need the three-argument form, as does any caller whose query really contains one of these names.
 */
const REQUEST_CONFIG_MARKERS: readonly string[] = [
  'method',
  'headers',
  'timeout',
  'auth',
  'tracing',
  'metrics',
];

/**
 * Build full URL from base URL and request URL
 */
const buildUrl = (
  baseUrl: string | undefined,
  url: string,
  query?: Record<string, unknown>,
): string => {
  let fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}` : url;

  if (query && Object.keys(query).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    if (queryString) {
      fullUrl += `${fullUrl.includes('?') ? '&' : '?'}${queryString}`;
    }
  }

  return fullUrl;
};

/**
 * Calculate retry delay based on configuration
 */
export const calculateRetryDelay = (attempt: number, config: RetryConfig): number => {
  const { delay, backoff, factor = 2 } = config;

  switch (backoff) {
    case 'linear':
      return delay * attempt;
    case 'exponential':
      return delay * factor ** (attempt - 1);
    case 'fixed':
    default:
      return delay;
  }
};

/**
 * Merge client options onto the defaults, re-basing the retry config field-wise so that a
 * partial `retries` never silently drops the fields it did not mention.
 */
const mergeRequestsOptions = (options: RequestsOptions): RequestsOptions => ({
  ...DEFAULT_REQUESTS_OPTIONS,
  ...options,
  retries: resolveRetryConfig(options.retries),
});

/**
 * Classify a failure that happened before any HTTP response existed.
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`, an explicit abort with an `AbortError`,
 * and everything else (connection refused, DNS, TLS) is a network failure. None of them are a
 * server 500, so none of them carry an HTTP status code.
 */
const classifyTransportFailure = (error: unknown, traceId?: string): ErrorResponse => {
  const name = error instanceof Error ? error.name : '';
  let kind: TransportFailureKind = 'network';
  let code = 'FETCH_ERROR';

  if (name === 'TimeoutError') {
    kind = 'timeout';
    code = 'TIMEOUT_ERROR';
  } else if (name === 'AbortError') {
    kind = 'abort';
    code = 'ABORT_ERROR';
  }

  return createErrorResponse(
    code,
    TRANSPORT_FAILURE_CODE,
    traceId,
    { details: error, transport: kind },
  );
};

/**
 * Decide whether a failed attempt may be retried.
 *
 * The method gate comes first: a method outside the allowlist is never retried, whatever the
 * status code. Transport failures are then decided by their own flags, so `retryOn` only ever
 * matches statuses a server actually returned.
 */
const shouldRetryRequest = (
  error: unknown,
  method: string,
  retryConfig: RetryConfig,
): boolean => {
  if (!isErrorResponse(error) || !isRetryableMethod(method, retryConfig)) {
    return false;
  }

  const transport = getTransportFailureKind(error);

  if (transport === 'timeout') {
    return retryConfig.retryOnTimeout === true;
  }

  if (transport === 'network') {
    return retryConfig.retryOnNetworkError !== false;
  }

  if (transport === 'abort') {
    return false;
  }

  return Array.isArray(retryConfig.retryOn) && retryConfig.retryOn.includes(error.code);
};

/**
 * Emit a framework-level record of a retry, independent of the user-supplied `onRetry`.
 *
 * Prefers the ambient logger the framework installs (same pattern as the metrics service);
 * falls back to Effect's logger so that a retry is never completely silent.
 */
const logRetryAttempt = (
  method: string,
  url: string,
  attempt: number,
  delay: number,
  error: ErrorResponse,
  retryConfig: RetryConfig,
): Effect.Effect<void, never> => {
  const transport = getTransportFailureKind(error);
  const context: Record<string, unknown> = {
    method,
    url,
    attempt,
    maxAttempts: retryConfig.max,
    delay,
    code: error.code,
    error: error.error,
    ...(transport ? { transport } : {}),
  };
  const reason = transport ? `${error.error} (${transport})` : `${error.error} ${error.code}`;
  const message =
    `HTTP retry ${attempt}/${retryConfig.max}: ${method} ${url} failed with ${reason}, ` +
    `retrying in ${delay}ms`;

  interface OneBunRetryLogger {
    warn(message: string, ...args: unknown[]): void;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const g = globalThis as unknown as { __onebunLoggerService?: OneBunRetryLogger };
  const logger = g.__onebunLoggerService;

  if (logger && typeof logger.warn === 'function') {
    return Effect.sync(() => {
      try {
        logger.warn(message, context);
      } catch {
        // Logging must never break the request
      }
    });
  }

  return pipe(Effect.logWarning(message), Effect.annotateLogs(context));
};

/**
 * Record request metrics
 */
const recordRequestMetrics = (
  data: RequestMetricsData,
  sink: ((data: RequestMetricsData) => void) | undefined,
): Effect.Effect<void, never> => {
  return Effect.sync(() => {
    if (!sink) {
      return;
    }

    try {
      sink(data);
    } catch (error) {
      // A metrics sink must never fail a request.
      // eslint-disable-next-line no-console
      console.debug('Failed to record request metrics:', error);
    }
  });
};

/**
 * The trace this call belongs to, or `undefined` when it belongs to none.
 *
 * Read through the registered provider (`setTraceContextProvider`), which `OneBunApplication`
 * points at its per-request `AsyncLocalStorage`. It used to read
 * `globalThis.__onebunCurrentTraceContext` — a global nothing in the framework ever assigned, so
 * the answer was permanently `undefined` and every outgoing call left untraced without a word.
 * One global cell would have been wrong anyway: concurrent requests share it, so a call would be
 * attributed to whichever request wrote to it last.
 */
const getTraceContext = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
): OutgoingTraceContext | undefined => {
  if (config.tracing === false || !mergedOptions.tracing) {
    return undefined;
  }

  return currentOutgoingTraceContext();
};

/**
 * The exact bytes this request will send, or `undefined` when it sends none.
 *
 * Extracted so the signer and `fetch` cannot disagree: a signature over a re-serialization of the
 * same object is a signature over bytes nobody sent.
 */
const serializeBody = (config: RequestConfig): string | undefined => {
  if (!config.data || !BODY_CARRYING_METHODS.includes(config.method)) {
    return undefined;
  }

  return typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
};

/**
 * Apply authentication if configured
 */
const applyAuthIfNeeded = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  traceId?: string,
): Effect.Effect<RequestConfig, ErrorResponse> => {
  if (config.auth || mergedOptions.auth) {
    const authConfig = config.auth || mergedOptions.auth!;

    return pipe(
      applyAuth(authConfig, config),
      Effect.catchAll((error) =>
        Effect.fail(
          createErrorResponse(
            'AUTH_ERROR',
            HttpStatusCode.UNAUTHORIZED,
            traceId,
            { details: error },
          ),
        ),
      ),
    );
  }

  return Effect.succeed(config);
};

/**
 * Build request headers
 */
const buildHeaders = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  traceContext?: OutgoingTraceContext,
): Record<string, string> => {
  const headers: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'User-Agent': mergedOptions.userAgent || 'OneBun-Requests/1.0',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Accept: 'application/json',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Type': 'application/json',
    ...mergedOptions.headers,
    ...config.headers,
  };

  if (traceContext && config.tracing !== false && mergedOptions.tracing) {
    // W3C `traceparent` first, because it is the only one a collector, a service mesh or a
    // non-OneBun peer understands.
     
    headers.traceparent = formatTraceparent(traceContext);
    // The pair, not `X-Trace-Id` alone. On its own it joined nothing — even the receiving OneBun
    // service requires trace and span id together, so a lone id fell through and the callee
    // started a fresh trace. Kept alongside `traceparent` for anything already reading them.
     
    headers['X-Trace-Id'] = traceContext.traceId;
     
    headers['X-Span-Id'] = traceContext.spanId;
  }

  return headers;
};

/**
 * Parse response data based on content type
 */
const parseResponseData = <T>(
  response: Response,
  traceId?: string,
): Effect.Effect<T, ErrorResponse> => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return pipe(
      Effect.tryPromise({
        try: () => response.text(),
        catch: (error) =>
          createErrorResponse(
            'RESPONSE_PARSE_ERROR',
            response.status,
            traceId,
            { details: error },
          ),
      }),
      Effect.flatMap((text) => {
        if (!text) {
          return Effect.fail(
            createErrorResponse(
              'RESPONSE_PARSE_ERROR',
              response.status,
              traceId,
              { details: 'Response text is empty' },
            ),
          );
        }

        let parsedData: T;
        try {
          parsedData = JSON.parse(text);
        } catch {
          return Effect.fail(
            createErrorResponse(
              'RESPONSE_PARSE_ERROR',
              response.status,
              traceId,
              { details: text },
            ),
          );
        }

        // Check if response is a standardized error format
        if (isErrorResponse(parsedData)) {
          // Create OneBunApiError to throw
          const apiError = OneBunBaseError.fromErrorResponse(parsedData);

          return Effect.fail(wrapToErrorResponse(apiError));
        }

        return Effect.succeed(parsedData);
      }),
    );
  } else {
    return Effect.tryPromise({
      try: () => response.text() as Promise<T>,
      catch: (error) =>
        createErrorResponse(
          'RESPONSE_READ_ERROR',
          response.status,
          traceId,
          { details: error },
        ),
    });
  }
};

/**
 * Add the `X-OneBun-Signature` header when `onebun` auth is configured, otherwise pass through.
 *
 * Returns the headers rather than mutating them, so a retry signs the request afresh instead of
 * inheriting the previous attempt's timestamp and nonce.
 */
const signOneBunIfNeeded = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  body: string | undefined,
  traceId?: string,
): Effect.Effect<Record<string, string>, ErrorResponse> => {
  const authConfig = config.auth ?? mergedOptions.auth;

  // Two statements rather than one disjunction: a type predicate negated inside `||` does not
  // narrow reliably, and the narrowing is what gives `authConfig.audience` a type here.
  if (authConfig === undefined) {
    return Effect.succeed(headers);
  }

  if (!isSigningAuth(authConfig)) {
    return Effect.succeed(headers);
  }

  const contentType = Object.entries(headers)
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1];

  return pipe(
    signOneBunRequest(authConfig, {
      method: config.method,
      url: fullUrl,
      contentType,
      body,
      audience: authConfig.audience,
    }),
    Effect.map((signature) => ({
      ...headers,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'X-OneBun-Signature': signature,
    })),
    Effect.catchAll((error) =>
      Effect.fail(
        createErrorResponse('AUTH_ERROR', HttpStatusCode.UNAUTHORIZED, traceId, { details: error }),
      ),
    ),
  );
};

/**
 * Execute single HTTP request attempt
 */
const executeSingleRequest = <T, E extends string, R extends string>(
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  traceId?: string,
): Effect.Effect<ApiResponse<T, E | string, R | string>, never> => {
  const requestStartTime = Date.now();

  // Create fetch request
  const requestInit: RequestInit = {
    method: config.method,
    headers,
    signal: AbortSignal.timeout(config.timeout || mergedOptions.timeout || DEFAULT_TIMEOUT_MS),
  };

  // One serialization, used both for the body that is sent and for the body that is signed.
  // Serializing twice would let the two diverge, and a signature over different bytes than the
  // ones on the wire is worse than no signature — it reads as protection.
  const body = serializeBody(config);
  if (body !== undefined) {
    requestInit.body = body;
  }

  return pipe(
    // Signed HERE, inside the attempt, over the assembled request. Two reasons it cannot move
    // out: the signature has to cover the final URL and the exact body bytes, and each retry
    // needs its own timestamp and nonce — reusing one would make attempt 2 a replay of attempt 1
    // and the callee would reject it as such.
    signOneBunIfNeeded(config, mergedOptions, headers, fullUrl, body, traceId),
    Effect.flatMap((signedHeaders) => Effect.tryPromise({
      try: () => fetch(fullUrl, { ...requestInit, headers: signedHeaders }),
      catch: (error) => classifyTransportFailure(error, traceId),
    })),
    Effect.flatMap((response) => {
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return pipe(
        parseResponseData<T>(response, traceId),
        Effect.map((responseData) => {
          const duration = Date.now() - requestStartTime;
          const success =
            response.status >= HttpStatusCode.OK &&
            response.status < HttpStatusCode.MOVED_PERMANENTLY;

          if (success) {
            return createSuccessResponse(responseData, traceId, response.status);
          }

          return createErrorResponse(
            'HTTP_ERROR',
            response.status,
            traceId,
            {
              headers: responseHeaders,
              details: responseData,
              duration,
              url: fullUrl,
              method: config.method,
            },
          );
        }),
      );
    }),
    Effect.catchAll((error) => {
      return Effect.succeed(error);
    }),
  );
};

/**
 * Execute request with retry logic
 */
const executeWithRetry = <T, E extends string, R extends string>(
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  traceId?: string,
  attemptNumber: number = 1,
): Effect.Effect<SuccessResponse<T>, ErrorResponse<E | string, R | string>> => {
  const requestStartTime = Date.now();

  return pipe(
    executeSingleRequest<T, E, R>(config, mergedOptions, headers, fullUrl, traceId),
    Effect.map((result) => ({ ...result, retryCount: attemptNumber - 1 })),
    Effect.flatMap((result) => {
      const duration = Date.now() - requestStartTime;
      // Record metrics if enabled
      const recordMetrics =
        config.metrics !== false && mergedOptions.metrics
          ? recordRequestMetrics({
            method: config.method,
            url: fullUrl,
            // The status the upstream actually returned. It used to be `HttpStatusCode.OK` for
            // every success, so a 201, 202 or 204 was recorded as 200 — a dashboard could not
            // tell them apart and an alert on non-200 responses never fired. `?? OK` covers the
            // one path that has no upstream status: a success synthesized without a response.
            statusCode: result.success ? result.statusCode ?? HttpStatusCode.OK : result.code,
            duration,
            success: result.success,
            retryCount: result.retryCount || 0,
            baseUrl: mergedOptions.baseUrl,
          }, mergedOptions.metricsSink)
          : Effect.succeed(undefined);

      return pipe(
        recordMetrics,
        Effect.flatMap(() => {
          if (isErrorResponse(result)) {
            return Effect.fail(result);
          }

          return Effect.succeed(result);
        }),
      );
    }),
    Effect.catchAll((error) => {
      // Check if we should retry on this error
      const retryConfig: RetryConfig = resolveRetryConfig(mergedOptions.retries, config.retries);
      const shouldRetry = shouldRetryRequest(error, config.method, retryConfig);

      if (shouldRetry && attemptNumber <= retryConfig.max) {
        const callRetryCallback = retryConfig.onRetry
          ? Effect.tryPromise({
            try: () => Promise.resolve(retryConfig.onRetry!(error, attemptNumber)),
            catch: () =>
              createErrorResponse(
                'RETRY_CALLBACK_ERROR',
                HttpStatusCode.INTERNAL_SERVER_ERROR,
                traceId,
                { details: error },
              ),
          })
          : Effect.succeed(undefined);

        const delay = calculateRetryDelay(attemptNumber, retryConfig);

        return pipe(
          logRetryAttempt(config.method, fullUrl, attemptNumber, delay, error, retryConfig),
          Effect.flatMap(() => callRetryCallback),
          Effect.flatMap(() => Effect.sleep(`${delay} millis`)),
          Effect.flatMap(() =>
            executeWithRetry<T, E, R>(
              config,
              mergedOptions,
              headers,
              fullUrl,
              traceId,
              attemptNumber + 1,
            ),
          ),
        );
      }

      return Effect.fail(error);
    }),
  );
};

/**
 * Execute HTTP request with full configuration
 */
export const executeRequest = <
  T = unknown,
  E extends string = string,
  R extends string = string,
>(
  config: RequestConfig,
  requestOptions: RequestsOptions = {},
): Effect.Effect<SuccessResponse<T>, ErrorResponse<E | string, R | string>> => {
  const mergedOptions = mergeRequestsOptions(requestOptions);
  // Resolved once, before the first attempt: a retry belongs to the same trace as the attempt it
  // replaces, and re-reading the ambient context per attempt would let a slow retry pick up
  // whatever scope the process happened to be in by then.
  const traceContext = getTraceContext(config, mergedOptions);
  const traceId = traceContext?.traceId;

  return pipe(
    applyAuthIfNeeded(config, mergedOptions, traceId),
    Effect.map((finalConfig) => {
      // The URL is built AFTER auth, from the config auth produced. It used to be built one line
      // before, so `apikey` with `location: 'query'` added its key to a `config.query` the URL had
      // already been assembled from — the key never reached the wire and nothing said so.
      const fullUrl = buildUrl(mergedOptions.baseUrl, finalConfig.url, finalConfig.query);
      const headers = buildHeaders(finalConfig, mergedOptions, traceContext);

      return { finalConfig, headers, fullUrl };
    }),
    Effect.flatMap(({ finalConfig, headers, fullUrl }) =>
      executeWithRetry<T, E, R>(finalConfig, mergedOptions, headers, fullUrl, traceId),
    ),
  );
};

/**
 * HTTP Client class for making requests with configuration
 *
 * @see docs:api/requests.md
 */
export class HttpClient {
  constructor(private clientOptions: RequestsOptions = {}) {}

  /**
   * Execute a request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestEffect<T = any>(
    config: Partial<RequestConfig>,
  ): Effect.Effect<SuccessResponse<T>, ErrorResponse> {
    const mergedOptions = mergeRequestsOptions(this.clientOptions);
    const fullConfig: RequestConfig = {
      method: HttpMethod.GET,
      url: '',
      ...config,
    };

    return executeRequest<T>(fullConfig, mergedOptions);
  }

  /**
   * Execute a request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request<T = any>(
    config: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.requestEffect<T>(config));
  }

  /**
   * GET request with Effect interface
   */
  getEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    // Handle overloads: either query data as second param, or config as second param
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      // queryOrConfig is query data, config is request config
      finalConfig = {
        method: HttpMethod.GET,
        url,
        query: queryOrConfig as Q,
        ...config,
      };
    } else if (
      queryOrConfig &&
      typeof queryOrConfig === 'object' &&
      !Array.isArray(queryOrConfig)
    ) {
      // Check if it's a RequestConfig (has method, url, etc.) or query data
      const hasConfigFields = REQUEST_CONFIG_MARKERS.some((field) => field in queryOrConfig);
      if (hasConfigFields) {
        // It's config
        finalConfig = {
          method: HttpMethod.GET,
          url,
          ...(queryOrConfig as Partial<RequestConfig>),
        };
      } else {
        // It's query data
        finalConfig = {
          method: HttpMethod.GET,
          url,
          query: queryOrConfig as Q,
        };
      }
    } else {
      finalConfig = { method: HttpMethod.GET, url };
    }

    return this.requestEffect<T>(finalConfig);
  }

  /**
   * GET request with Promise interface (default)
   */
  async get<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.getEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * POST request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postEffect<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.POST,
      url,
      data,
      ...config,
    });
  }

  /**
   * POST request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async post<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.postEffect<T, D>(url, data, config));
  }

  /**
   * PUT request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  putEffect<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.PUT,
      url,
      data,
      ...config,
    });
  }

  /**
   * PUT request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async put<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.putEffect<T, D>(url, data, config));
  }

  /**
   * PATCH request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patchEffect<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.PATCH,
      url,
      data,
      ...config,
    });
  }

  /**
   * PATCH request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async patch<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.patchEffect<T, D>(url, data, config));
  }

  /**
   * DELETE request with Effect interface
   */
  deleteEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      finalConfig = {
        method: HttpMethod.DELETE,
        url,
        query: queryOrConfig as Q,
        ...config,
      };
    } else if (
      queryOrConfig &&
      typeof queryOrConfig === 'object' &&
      !Array.isArray(queryOrConfig)
    ) {
      const hasConfigFields =
        'method' in queryOrConfig ||
        'headers' in queryOrConfig ||
        'timeout' in queryOrConfig ||
        'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = {
          method: HttpMethod.DELETE,
          url,
          ...(queryOrConfig as Partial<RequestConfig>),
        };
      } else {
        finalConfig = {
          method: HttpMethod.DELETE,
          url,
          query: queryOrConfig as Q,
        };
      }
    } else {
      finalConfig = { method: HttpMethod.DELETE, url };
    }

    return this.requestEffect<T>(finalConfig);
  }

  /**
   * DELETE request with Promise interface (default)
   */
  async delete<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.deleteEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * HEAD request with Effect interface
   */
  headEffect<
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<void>, ErrorResponse> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      finalConfig = {
        method: HttpMethod.HEAD,
        url,
        query: queryOrConfig as Q,
        ...config,
      };
    } else if (
      queryOrConfig &&
      typeof queryOrConfig === 'object' &&
      !Array.isArray(queryOrConfig)
    ) {
      const hasConfigFields =
        'method' in queryOrConfig ||
        'headers' in queryOrConfig ||
        'timeout' in queryOrConfig ||
        'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = {
          method: HttpMethod.HEAD,
          url,
          ...(queryOrConfig as Partial<RequestConfig>),
        };
      } else {
        finalConfig = {
          method: HttpMethod.HEAD,
          url,
          query: queryOrConfig as Q,
        };
      }
    } else {
      finalConfig = { method: HttpMethod.HEAD, url };
    }

    return this.requestEffect<void>(finalConfig);
  }

  /**
   * HEAD request with Promise interface (default)
   */
  async head<
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<void>> {
    return await Effect.runPromise(this.headEffect<Q>(url, queryOrConfig, config));
  }

  /**
   * OPTIONS request with Effect interface
   */
  optionsEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      finalConfig = {
        method: HttpMethod.OPTIONS,
        url,
        query: queryOrConfig as Q,
        ...config,
      };
    } else if (
      queryOrConfig &&
      typeof queryOrConfig === 'object' &&
      !Array.isArray(queryOrConfig)
    ) {
      const hasConfigFields =
        'method' in queryOrConfig ||
        'headers' in queryOrConfig ||
        'timeout' in queryOrConfig ||
        'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = {
          method: HttpMethod.OPTIONS,
          url,
          ...(queryOrConfig as Partial<RequestConfig>),
        };
      } else {
        finalConfig = {
          method: HttpMethod.OPTIONS,
          url,
          query: queryOrConfig as Q,
        };
      }
    } else {
      finalConfig = { method: HttpMethod.OPTIONS, url };
    }

    return this.requestEffect<T>(finalConfig);
  }

  /**
   * OPTIONS request with Promise interface (default)
   */
  async options<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.optionsEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * Generic request method - throws on error, returns data directly
   */
  async req<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: ReqConfig & Partial<RequestConfig>,
  ): Promise<T> {
    try {
      const methodEnum = typeof method === 'string' ? (method as HttpMethod) : method;
      const response = await this.request<T>({
        method: methodEnum,
        url,
        ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE
          ? { query: queryOrData }
          : { data: queryOrData }),
        ...config,
      });

      if (isErrorResponse(response)) {
        // Check if we have custom error configuration
        if (config?.errors) {
          const errorKey = Object.keys(config.errors)[0]; // Use first error config as default
          const errorConfig = config.errors[errorKey];
          const customError = new InternalServerError(
            errorConfig.error,
            { ...errorConfig.details, originalResponse: response },
            response,
          );
          if (errorConfig.message) {
            customError.message = errorConfig.message;
          }
          throw customError;
        }

        throw OneBunBaseError.fromErrorResponse(response);
      }

      return response.result;
    } catch (error: unknown) {
      // If it's already an OneBun error, rethrow
      if (error instanceof OneBunBaseError) {
        throw error;
      }

      // Check if we have custom error configuration for unexpected errors
      if (config?.errors) {
        const errorKey = Object.keys(config.errors)[0];
        const errorConfig = config.errors[errorKey];
        throw new InternalServerError(errorConfig.error, {
          ...errorConfig.details,
          originalError: error,
        });
      }

      // Wrap unexpected errors
      throw new InternalServerError('REQUEST_FAILED', { originalError: error });
    }
  }

  /**
   * Generic request method - returns full API response
   */
  async reqRaw<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    const methodEnum = typeof method === 'string' ? (method as HttpMethod) : method;

    return await this.request<T>({
      method: methodEnum,
      url,
      ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE
        ? { query: queryOrData }
        : { data: queryOrData }),
      ...config,
    });
  }

  /**
   * Generic request method - returns Effect
   */
  reqEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<SuccessResponse<T>, ErrorResponse> {
    const methodEnum = typeof method === 'string' ? (method as HttpMethod) : method;

    return this.requestEffect<T>({
      method: methodEnum,
      url,
      ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE
        ? { query: queryOrData }
        : { data: queryOrData }),
      ...config,
    });
  }
}

/**
 * Create a new HTTP client instance
 *
 * @see docs:api/requests.md
 */
export const createHttpClient = (clientOptions: RequestsOptions = {}): HttpClient => {
  return new HttpClient(clientOptions);
};

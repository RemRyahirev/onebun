import { Effect, pipe } from 'effect';

import { applyAuth } from './auth.js';
import {
  RequestConfig,
  RequestsOptions,
  RetryConfig,
  HttpMethod,
  DEFAULT_REQUESTS_OPTIONS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  RequestMetricsData,
  ErrorResponse,
  createErrorResponse,
  ApiResponse,
  isErrorResponse,
  OneBunBaseError,
  wrapToErrorResponse,
  createSuccessResponse,
  SuccessResponse,
  ReqConfig,
  InternalServerError,
  HttpStatusCode,
} from './types.js';

/**
 * Build full URL from base URL and request URL
 */
const buildUrl = (
  baseUrl: string | undefined,
  url: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query?: Record<string, any>,
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
const calculateRetryDelay = (attempt: number, config: RetryConfig): number => {
  const { delay, backoff, factor = 2 } = config;

  switch (backoff) {
    case 'linear':
      return delay * attempt;
    case 'exponential':
      return delay * Math.pow(factor, attempt - 1);
    case 'fixed':
    default:
      return delay;
  }
};

/**
 * Record request metrics
 */
const recordRequestMetrics = (data: RequestMetricsData): Effect.Effect<void, never> => {
  return Effect.sync(() => {
    try {
      // Try to record metrics if metrics service is available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof globalThis !== 'undefined' && (globalThis as any).__onebunMetricsService) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metricsService = (globalThis as any).__onebunMetricsService;
        if (metricsService && metricsService.recordHttpRequest) {
          metricsService.recordHttpRequest({
            method: data.method,
            route: data.url,
            statusCode: data.statusCode,
            duration: data.duration / 1000, // Convert to seconds
            controller: 'requests-client',
            action: 'http-request',
          });
        }
      }
    } catch (error) {
      // Silently ignore metrics errors
      // eslint-disable-next-line no-console
      console.debug('Failed to record request metrics:', error);
    }
  });
};

/**
 * Get trace ID if available
 */
const getTraceId = (config: RequestConfig, mergedOptions: RequestsOptions): string | undefined => {
  if (config.tracing !== false && mergedOptions.tracing) {
    try {
      if (typeof globalThis !== 'undefined' && (globalThis as any).__onebunCurrentTraceContext) { // eslint-disable-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__onebunCurrentTraceContext.traceId; // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    } catch {
      // Tracing not available, continue without it
    }
  }

  return undefined;
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
      Effect.catchAll((error) => Effect.fail(createErrorResponse(
        'AUTH_ERROR',
        HttpStatusCode.UNAUTHORIZED,
        `Authentication failed: ${error}`,
        traceId,
        { details: error },
      ))),
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
  traceId?: string,
): Record<string, string> => {
  const headers: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'User-Agent': mergedOptions.userAgent || 'OneBun-Requests/1.0',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Accept': 'application/json',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Type': 'application/json',
    ...mergedOptions.headers,
    ...config.headers,
  };

  // Add trace headers if tracing is enabled
  if (traceId && config.tracing !== false && mergedOptions.tracing) {
    headers['X-Trace-Id'] = traceId;
  }

  return headers;
};

/**
 * Parse response data based on content type
 */
const parseResponseData = <T>(response: Response, traceId?: string): Effect.Effect<T, ErrorResponse> => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return pipe(
      Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => createErrorResponse(
          'RESPONSE_PARSE_ERROR',
          response.status,
          `Failed to read response text: ${error}`,
          traceId,
          { details: error },
        ),
      }),
      Effect.flatMap((text) => {
        if (!text) {
          return Effect.fail(createErrorResponse(
            'RESPONSE_PARSE_ERROR',
            response.status,
            'Response text is empty',
            traceId,
            { details: 'Response text is empty' },
          ));
        }

        let parsedData: T;
        try {
          parsedData = JSON.parse(text);
        } catch {
          return Effect.fail(createErrorResponse(
            'RESPONSE_PARSE_ERROR',
            response.status,
            'Response text is not valid JSON',
            traceId,
            { details: text },
          ));
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
      catch: (error) => createErrorResponse(
        'RESPONSE_READ_ERROR',
        response.status,
        `Failed to read response: ${error}`,
        traceId,
        { details: error },
      ),
    });
  }
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

  // Add body for methods that support it
  if (config.data && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
    if (typeof config.data === 'string') {
      requestInit.body = config.data;
    } else {
      requestInit.body = JSON.stringify(config.data);
    }
  }

  return pipe(
    Effect.tryPromise({
      try: () => fetch(fullUrl, requestInit),
      catch: (error) => createErrorResponse(
        'FETCH_ERROR',
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        `Request failed: ${error}`,
        traceId,
        { details: error },
      ),
    }),
    Effect.flatMap((response) => {
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return pipe(
        parseResponseData<T>(response, traceId),
        Effect.map((responseData) => {
          const duration = Date.now() - requestStartTime;
          const success = response.status >= HttpStatusCode.OK && response.status < HttpStatusCode.MOVED_PERMANENTLY;

          if (success) {
            return createSuccessResponse(
              responseData,
              traceId,
            );
          }

          return createErrorResponse(
            'HTTP_ERROR',
            response.status,
            `HTTP ${response.status}: ${response.statusText}`,
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
      const recordMetrics = config.metrics !== false && mergedOptions.metrics
        ? recordRequestMetrics({
          method: config.method,
          url: fullUrl,
          statusCode: result.success ? HttpStatusCode.OK : result.code,
          duration,
          success: result.success,
          retryCount: result.retryCount || 0,
          baseUrl: mergedOptions.baseUrl,
        })
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
      const retryConfig: RetryConfig = {
        max: DEFAULT_MAX_RETRIES,
        delay: 1000,
        backoff: 'exponential',
        factor: 2,
        retryOn: [
          HttpStatusCode.INTERNAL_SERVER_ERROR,
          HttpStatusCode.BAD_GATEWAY,
          HttpStatusCode.SERVICE_UNAVAILABLE,
          HttpStatusCode.GATEWAY_TIMEOUT,
        ],
        ...mergedOptions.retries,
        ...config.retries,
      };

      if (attemptNumber <= retryConfig.max) {
        const callRetryCallback = retryConfig.onRetry
          ? Effect.tryPromise({
            try: () => Promise.resolve(retryConfig.onRetry!(error, attemptNumber)),
            catch: () => createErrorResponse(
              'RETRY_CALLBACK_ERROR',
              HttpStatusCode.INTERNAL_SERVER_ERROR,
              'Retry callback failed',
              traceId,
              { details: error },
            ),
          })
          : Effect.succeed(undefined);

        const delay = calculateRetryDelay(attemptNumber, retryConfig);

        return pipe(
          callRetryCallback,
          Effect.flatMap(() => Effect.sleep(`${delay} millis`)),
          Effect.flatMap(() => executeWithRetry<T, E, R>(config, mergedOptions, headers, fullUrl, traceId, attemptNumber + 1)),
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
  T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
  E extends string = string,
  R extends string = string
>(
  config: RequestConfig,
  requestOptions: RequestsOptions = {},
): Effect.Effect<SuccessResponse<T>, ErrorResponse<E | string, R | string>> => {
  const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...requestOptions };
  const fullUrl = buildUrl(mergedOptions.baseUrl, config.url, config.query);
  const traceId = getTraceId(config, mergedOptions);

  return pipe(
    applyAuthIfNeeded(config, mergedOptions, traceId),
    Effect.map((finalConfig) => {
      const headers = buildHeaders(finalConfig, mergedOptions, traceId);

      return { finalConfig, headers };
    }),
    Effect.flatMap(({ finalConfig, headers }) =>
      executeWithRetry<T, E, R>(finalConfig, mergedOptions, headers, fullUrl, traceId),
    ),
  );
};

/**
 * HTTP Client class for making requests with configuration
 */
export class HttpClient {
  constructor(private clientOptions: RequestsOptions = {}) {}

  /**
   * Execute a request with Effect interface
   */
  requestEffect<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    config: Partial<RequestConfig>,
  ): Effect.Effect<SuccessResponse<T>, ErrorResponse> {
    const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...this.clientOptions };
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
  async request<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    config: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.requestEffect<T>(config));
  }

  /**
   * GET request with Effect interface
   */
  getEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
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
        method: HttpMethod.GET, url, query: queryOrConfig as Q, ...config,
      };
    } else if (queryOrConfig && typeof queryOrConfig === 'object' && !Array.isArray(queryOrConfig)) {
      // Check if it's a RequestConfig (has method, url, etc.) or query data
      const hasConfigFields = 'method' in queryOrConfig || 'headers' in queryOrConfig || 'timeout' in queryOrConfig || 'auth' in queryOrConfig;
      if (hasConfigFields) {
        // It's config
        finalConfig = { method: HttpMethod.GET, url, ...queryOrConfig as Partial<RequestConfig> };
      } else {
        // It's query data
        finalConfig = { method: HttpMethod.GET, url, query: queryOrConfig as Q };
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
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
  postEffect<T = any, D = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.POST, url, data, ...config,
    });
  }

  /**
   * POST request with Promise interface (default)
   */
  async post<T = any, D = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.postEffect<T, D>(url, data, config));
  }

  /**
   * PUT request with Effect interface
   */
  putEffect<T = any, D = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.PUT, url, data, ...config,
    });
  }

  /**
   * PUT request with Promise interface (default)
   */
  async put<T = any, D = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.putEffect<T, D>(url, data, config));
  }

  /**
   * PATCH request with Effect interface
   */
  patchEffect<T = any, D = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.PATCH, url, data, ...config,
    });
  }

  /**
   * PATCH request with Promise interface (default)
   */
  async patch<T = any, D = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      finalConfig = {
        method: HttpMethod.DELETE, url, query: queryOrConfig as Q, ...config,
      };
    } else if (queryOrConfig && typeof queryOrConfig === 'object' && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = 'method' in queryOrConfig || 'headers' in queryOrConfig || 'timeout' in queryOrConfig || 'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: HttpMethod.DELETE, url, ...queryOrConfig as Partial<RequestConfig> };
      } else {
        finalConfig = { method: HttpMethod.DELETE, url, query: queryOrConfig as Q };
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<void>, ErrorResponse> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      finalConfig = {
        method: HttpMethod.HEAD, url, query: queryOrConfig as Q, ...config,
      };
    } else if (queryOrConfig && typeof queryOrConfig === 'object' && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = 'method' in queryOrConfig || 'headers' in queryOrConfig || 'timeout' in queryOrConfig || 'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: HttpMethod.HEAD, url, ...queryOrConfig as Partial<RequestConfig> };
      } else {
        finalConfig = { method: HttpMethod.HEAD, url, query: queryOrConfig as Q };
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;

    if (queryOrConfig && config) {
      finalConfig = {
        method: HttpMethod.OPTIONS, url, query: queryOrConfig as Q, ...config,
      };
    } else if (queryOrConfig && typeof queryOrConfig === 'object' && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = 'method' in queryOrConfig || 'headers' in queryOrConfig || 'timeout' in queryOrConfig || 'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: HttpMethod.OPTIONS, url, ...queryOrConfig as Partial<RequestConfig> };
      } else {
        finalConfig = { method: HttpMethod.OPTIONS, url, query: queryOrConfig as Q };
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: ReqConfig & Partial<RequestConfig>,
  ): Promise<T> {
    try {
      const methodEnum = typeof method === 'string' ? method as HttpMethod : method;
      const response = await this.request<T>({
        method: methodEnum,
        url,
        ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE ? { query: queryOrData } : { data: queryOrData }),
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
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      // If it's already an OneBun error, rethrow
      if (error instanceof OneBunBaseError) {
        throw error;
      }

      // Check if we have custom error configuration for unexpected errors
      if (config?.errors) {
        const errorKey = Object.keys(config.errors)[0];
        const errorConfig = config.errors[errorKey];
        throw new InternalServerError(
          errorConfig.error,
          { ...errorConfig.details, originalError: error },
        );
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
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    const methodEnum = typeof method === 'string' ? method as HttpMethod : method;

    return await this.request<T>({
      method: methodEnum,
      url,
      ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE ? { query: queryOrData } : { data: queryOrData }),
      ...config,
    });
  }

  /**
   * Generic request method - returns Effect
   */
  reqEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<SuccessResponse<T>, ErrorResponse> {
    const methodEnum = typeof method === 'string' ? method as HttpMethod : method;

    return this.requestEffect<T>({
      method: methodEnum,
      url,
      ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE ? { query: queryOrData } : { data: queryOrData }),
      ...config,
    });
  }
}

/**
 * Create a new HTTP client instance
 */
export const createHttpClient = (clientOptions: RequestsOptions = {}): HttpClient => {
  return new HttpClient(clientOptions);
};

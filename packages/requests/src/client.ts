import { Effect, pipe } from 'effect';
import {
  RequestConfig,
  RequestResponse,
  RequestError,
  RequestsOptions,
  RetryConfig,
  HttpMethod,
  DEFAULT_REQUESTS_OPTIONS,
  RequestMetricsData
} from './types.js';
import { applyAuth } from './auth.js';

/**
 * Create a request error with chainable context
 */
export const createRequestError = (
  code: string,
  message: string,
  options: {
    details?: any;
    cause?: RequestError;
    statusCode?: number;
    traceId?: string;
  } = {}
): RequestError => ({
  code,
  message,
  details: options.details,
  cause: options.cause,
  statusCode: options.statusCode,
  traceId: options.traceId,
  timestamp: Date.now()
});

/**
 * Build full URL from base URL and request URL
 */
const buildUrl = (baseUrl: string | undefined, url: string, query?: Record<string, any>): string => {
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
 * Check if error should trigger a retry
 */
const shouldRetry = (error: RequestError, config: RetryConfig): boolean => {
  if (!config.retryOn || config.retryOn.length === 0) {
    return false;
  }
  
  return error.statusCode !== undefined && config.retryOn.includes(error.statusCode);
};

/**
 * Record request metrics
 */
const recordRequestMetrics = (data: RequestMetricsData): Effect.Effect<void, never> => {
  return Effect.sync(() => {
    try {
      // Try to record metrics if metrics service is available
      if (typeof globalThis !== 'undefined' && (globalThis as any).__onebunMetricsService) {
        const metricsService = (globalThis as any).__onebunMetricsService;
        if (metricsService && metricsService.recordHttpRequest) {
          metricsService.recordHttpRequest({
            method: data.method,
            route: data.url,
            statusCode: data.statusCode,
            duration: data.duration / 1000, // Convert to seconds
            controller: 'requests-client',
            action: 'http-request'
          });
        }
      }
    } catch (error) {
      // Silently ignore metrics errors
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
      if (typeof globalThis !== 'undefined' && (globalThis as any).__onebunCurrentTraceContext) {
        return (globalThis as any).__onebunCurrentTraceContext.traceId;
      }
    } catch (error) {
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
  traceId?: string
): Effect.Effect<RequestConfig, RequestError> => {
  if (config.auth || mergedOptions.auth) {
    const authConfig = config.auth || mergedOptions.auth!;
    return pipe(
      applyAuth(authConfig, config),
      Effect.catchAll((error) => Effect.fail(createRequestError(
        'AUTH_ERROR',
        `Authentication failed: ${error}`,
        { details: error, traceId }
      )))
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
  traceId?: string
): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': mergedOptions.userAgent || 'OneBun-Requests/1.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...mergedOptions.headers,
    ...config.headers
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
const parseResponseData = (response: Response, traceId?: string): Effect.Effect<any, RequestError> => {
  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('application/json')) {
    return pipe(
      Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => createRequestError(
          'RESPONSE_PARSE_ERROR',
          `Failed to read response text: ${error}`,
          { statusCode: response.status, traceId }
        )
      }),
      Effect.flatMap((text) => {
        if (!text) {
          return Effect.succeed(undefined);
        }
        
        try {
          return Effect.succeed(JSON.parse(text));
        } catch {
          return Effect.succeed(text); // Return text if JSON parsing fails
        }
      })
    );
  } else {
    return Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => createRequestError(
        'RESPONSE_READ_ERROR',
        `Failed to read response: ${error}`,
        { statusCode: response.status, traceId }
      )
    });
  }
};

/**
 * Execute single HTTP request attempt
 */
const executeSingleRequest = <T>(
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  traceId?: string
): Effect.Effect<RequestResponse<T>, RequestError> => {
  const requestStartTime = Date.now();
  
  // Create fetch request
  const requestInit: RequestInit = {
    method: config.method,
    headers,
    signal: AbortSignal.timeout(config.timeout || mergedOptions.timeout || 30000)
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
      catch: (error) => createRequestError(
        'FETCH_ERROR',
        `Request failed: ${error}`,
        { details: error, traceId }
      )
    }),
    Effect.flatMap((response) => {
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return pipe(
        parseResponseData(response, traceId),
        Effect.map((responseData) => {
          const duration = Date.now() - requestStartTime;
          const success = response.status >= 200 && response.status < 300;

          const result: RequestResponse<T> = {
            success,
            data: success ? responseData : undefined,
            error: !success ? createRequestError(
              'HTTP_ERROR',
              `HTTP ${response.status}: ${response.statusText}`,
              { statusCode: response.status, details: responseData, traceId }
            ) : undefined,
            statusCode: response.status,
            headers: responseHeaders,
            duration,
            traceId,
            url: fullUrl,
            method: config.method,
            retryCount: 0
          };

          return result;
        })
      );
    })
  );
};

/**
 * Execute request with retry logic
 */
const executeWithRetry = <T>(
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  traceId?: string,
  attemptNumber: number = 1
): Effect.Effect<RequestResponse<T>, RequestError> => {
  return pipe(
    executeSingleRequest<T>(config, mergedOptions, headers, fullUrl, traceId),
    Effect.map((result) => ({ ...result, retryCount: attemptNumber - 1 })),
    Effect.flatMap((result) => {
      // Record metrics if enabled
      const recordMetrics = config.metrics !== false && mergedOptions.metrics
        ? recordRequestMetrics({
            method: config.method,
            url: fullUrl,
            statusCode: result.statusCode,
            duration: result.duration,
            success: result.success,
            retryCount: result.retryCount || 0,
            baseUrl: mergedOptions.baseUrl
          })
        : Effect.succeed(undefined);

      return pipe(
        recordMetrics,
        Effect.flatMap(() => {
                     // Check if we should retry
           if (!result.success && result.error) {
             const retryConfig: RetryConfig = { 
               max: 3, 
               delay: 1000, 
               backoff: 'exponential',
               factor: 2,
               retryOn: [500, 502, 503, 504],
               ...mergedOptions.retries, 
               ...config.retries 
             };
             
             if (attemptNumber <= retryConfig.max && shouldRetry(result.error, retryConfig)) {
              // Call retry callback if provided
              const callRetryCallback = retryConfig.onRetry
                ? Effect.tryPromise({
                    try: () => Promise.resolve(retryConfig.onRetry!(result.error!, attemptNumber)),
                    catch: () => createRequestError('RETRY_CALLBACK_ERROR', 'Retry callback failed')
                  })
                : Effect.succeed(undefined);

              const delay = calculateRetryDelay(attemptNumber, retryConfig);
              
              return pipe(
                callRetryCallback,
                Effect.flatMap(() => Effect.sleep(`${delay} millis`)),
                Effect.flatMap(() => executeWithRetry<T>(config, mergedOptions, headers, fullUrl, traceId, attemptNumber + 1))
              );
            }
          }

          return Effect.succeed(result);
        })
      );
    }),
    Effect.catchAll((error) => {
      const duration = Date.now() - Date.now(); // This should be calculated properly
      
      // Record error metrics
      const recordErrorMetrics = config.metrics !== false && mergedOptions.metrics
        ? recordRequestMetrics({
            method: config.method,
            url: fullUrl,
            statusCode: 0,
            duration,
            success: false,
            retryCount: attemptNumber - 1,
            baseUrl: mergedOptions.baseUrl
          })
        : Effect.succeed(undefined);

      return pipe(
        recordErrorMetrics,
        Effect.flatMap(() => {
                     // Check if we should retry on this error
           const retryConfig: RetryConfig = { 
             max: 3, 
             delay: 1000, 
             backoff: 'exponential',
             factor: 2,
             retryOn: [500, 502, 503, 504],
             ...mergedOptions.retries, 
             ...config.retries 
           };
           
           if (attemptNumber <= retryConfig.max) {
            const callRetryCallback = retryConfig.onRetry
              ? Effect.tryPromise({
                  try: () => Promise.resolve(retryConfig.onRetry!(error, attemptNumber)),
                  catch: () => createRequestError('RETRY_CALLBACK_ERROR', 'Retry callback failed')
                })
              : Effect.succeed(undefined);

            const delay = calculateRetryDelay(attemptNumber, retryConfig);
            
            return pipe(
              callRetryCallback,
              Effect.flatMap(() => Effect.sleep(`${delay} millis`)),
              Effect.flatMap(() => executeWithRetry<T>(config, mergedOptions, headers, fullUrl, traceId, attemptNumber + 1))
            );
          }

          return Effect.fail(error);
        })
      );
    })
  );
};

/**
 * Execute HTTP request with full configuration
 */
export const executeRequest = <T = any>(
  config: RequestConfig,
  requestOptions: RequestsOptions = {}
): Effect.Effect<RequestResponse<T>, RequestError> => {
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
      executeWithRetry<T>(finalConfig, mergedOptions, headers, fullUrl, traceId)
    )
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
  requestEffect<T = any>(config: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...this.clientOptions };
    const fullConfig: RequestConfig = {
      method: HttpMethod.GET,
      url: '',
      ...config
    };
    return executeRequest<T>(fullConfig, mergedOptions);
  }

  /**
   * Execute a request with Promise interface (default)
   */
  async request<T = any>(config: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.requestEffect<T>(config));
  }

  /**
   * GET request with Effect interface
   */
  getEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    // Handle overloads: either query data as second param, or config as second param
    let finalConfig: Partial<RequestConfig>;
    
    if (queryOrConfig && config) {
      // queryOrConfig is query data, config is request config
      finalConfig = { method: HttpMethod.GET, url, query: queryOrConfig as Q, ...config };
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
  async get<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.getEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * POST request with Effect interface
   */
  postEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    return this.requestEffect<T>({ method: HttpMethod.POST, url, data, ...config });
  }

  /**
   * POST request with Promise interface (default)
   */
  async post<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.postEffect<T, D>(url, data, config));
  }

  /**
   * PUT request with Effect interface
   */
  putEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    return this.requestEffect<T>({ method: HttpMethod.PUT, url, data, ...config });
  }

  /**
   * PUT request with Promise interface (default)
   */
  async put<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.putEffect<T, D>(url, data, config));
  }

  /**
   * PATCH request with Effect interface
   */
  patchEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    return this.requestEffect<T>({ method: HttpMethod.PATCH, url, data, ...config });
  }

  /**
   * PATCH request with Promise interface (default)
   */
  async patch<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.patchEffect<T, D>(url, data, config));
  }

  /**
   * DELETE request with Effect interface
   */
  deleteEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;
    
    if (queryOrConfig && config) {
      finalConfig = { method: HttpMethod.DELETE, url, query: queryOrConfig as Q, ...config };
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
  async delete<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.deleteEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * HEAD request with Effect interface
   */
  headEffect<Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<void>, RequestError> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;
    
    if (queryOrConfig && config) {
      finalConfig = { method: HttpMethod.HEAD, url, query: queryOrConfig as Q, ...config };
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
  async head<Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<void>> {
    return Effect.runPromise(this.headEffect<Q>(url, queryOrConfig, config));
  }

  /**
   * OPTIONS request with Effect interface
   */
  optionsEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    // Handle overloads similar to GET
    let finalConfig: Partial<RequestConfig>;
    
    if (queryOrConfig && config) {
      finalConfig = { method: HttpMethod.OPTIONS, url, query: queryOrConfig as Q, ...config };
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
  async options<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.optionsEffect<T, Q>(url, queryOrConfig, config));
  }
}

/**
 * Create a new HTTP client instance
 */
export const createHttpClient = (clientOptions: RequestsOptions = {}): HttpClient => {
  return new HttpClient(clientOptions);
}; 
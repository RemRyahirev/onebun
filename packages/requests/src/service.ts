import { Effect, Layer, Context, pipe } from 'effect';
import {
  RequestsOptions,
  RequestConfig,
  HttpMethod,
  DEFAULT_REQUESTS_OPTIONS,
  ApiResponse,
  OneBunBaseError,
  InternalServerError,
  isErrorResponse,
  isSuccessResponse
} from './types.js';
import { HttpClient, executeRequest } from './client.js';

/**
 * RequestsService interface for dependency injection
 */
export interface RequestsService {
  /**
   * Execute a request with full configuration
   * Automatically unwraps OneBun API responses and throws OneBunApiError on errors
   */
  request<T = any>(config: RequestConfig): Promise<T>;

  /**
   * Execute a request with full configuration (Effect interface)
   * Automatically unwraps OneBun API responses and fails with OneBunApiError on errors
   */
  requestEffect<T = any>(config: RequestConfig): Effect.Effect<T, OneBunBaseError>;

  /**
   * GET request with automatic unwrapping
   */
  get<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<T>;

  /**
   * GET request with automatic unwrapping (Effect interface)
   */
  getEffect<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<T, OneBunBaseError>;

  /**
   * POST request with automatic unwrapping
   */
  post<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<T>;

  /**
   * POST request with automatic unwrapping (Effect interface)
   */
  postEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<T, OneBunBaseError>;

  /**
   * PUT request with automatic unwrapping
   */
  put<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<T>;

  /**
   * PUT request with automatic unwrapping (Effect interface)
   */
  putEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<T, OneBunBaseError>;

  /**
   * PATCH request with automatic unwrapping
   */
  patch<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<T>;

  /**
   * PATCH request with automatic unwrapping (Effect interface)
   */
  patchEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<T, OneBunBaseError>;

  /**
   * DELETE request with automatic unwrapping
   */
  delete<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<T>;

  /**
   * DELETE request with automatic unwrapping (Effect interface)
   */
  deleteEffect<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<T, OneBunBaseError>;

  /**
   * HEAD request
   */
  head<Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<void>;

  /**
   * HEAD request (Effect interface)
   */
  headEffect<Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<void, OneBunBaseError>;

  /**
   * OPTIONS request
   */
  options<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<T>;

  /**
   * OPTIONS request (Effect interface)
   */
  optionsEffect<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<T, OneBunBaseError>;

  /**
   * Create a new HTTP client with specific configuration
   */
  createClient(options: RequestsOptions): HttpClient;

  /**
   * Get service configuration
   */
  getConfig(): RequestsOptions;

  /**
   * Update service configuration
   */
  updateConfig(newConfig: Partial<RequestsOptions>): Promise<void>;

  /**
   * Update service configuration (Effect interface)
   */
  updateConfigEffect(newConfig: Partial<RequestsOptions>): Effect.Effect<void>;
}

/**
 * Helper function to unwrap OneBun API response
 */
function unwrapOneBunResponse<T, E extends string, R extends string>(response: ApiResponse<T, E, R>): T {
  if (isErrorResponse(response)) {
    throw OneBunBaseError.fromErrorResponse(response);
  }

  if (!isSuccessResponse(response)) {
    throw new InternalServerError<string, R>(
      'Request failed',
      { response },
    );
  }

  return response.result;
}

/**
 * Helper function to unwrap OneBun API response in Effect
 */
function unwrapOneBunResponseEffect<T, E extends string, R extends string>(response: ApiResponse<T, E, R>): Effect.Effect<T, OneBunBaseError<E | string, R>> {
  if (isErrorResponse(response)) {
    return Effect.fail(OneBunBaseError.fromErrorResponse(response));
  }

  if (!isSuccessResponse(response)) {
    return Effect.fail(new InternalServerError<string, R>(
      'Request failed',
      { response },
    ));
  }

  return Effect.succeed(response.result);
}

/**
 * RequestsService implementation
 */
class RequestsServiceImpl implements RequestsService {
  constructor(private serviceOptions: RequestsOptions) {}

  // Core Effect methods
  requestEffect<T = any, E extends string = string, R extends string = string>(config: RequestConfig): Effect.Effect<T, OneBunBaseError<E | string, R | string>> {
    return pipe(
      executeRequest<T, E, R>(config, this.serviceOptions),
      Effect.catchAll((error) => {
        return Effect.succeed(error);
      }),
      Effect.flatMap(unwrapOneBunResponseEffect<T, E | string, R | string>),
    );
  }

  getEffect<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<T, OneBunBaseError> {
    let finalConfig: RequestConfig;
    
    if (queryOrConfig && config) {
      finalConfig = { method: HttpMethod.GET, url, query: queryOrConfig as Q, ...config };
    } else if (queryOrConfig && typeof queryOrConfig === 'object' && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = 'method' in queryOrConfig || 'headers' in queryOrConfig || 'timeout' in queryOrConfig || 'auth' in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: HttpMethod.GET, url, ...queryOrConfig as Partial<RequestConfig> };
      } else {
        finalConfig = { method: HttpMethod.GET, url, query: queryOrConfig as Q };
      }
    } else {
      finalConfig = { method: HttpMethod.GET, url };
    }
    
    return this.requestEffect<T>(finalConfig);
  }

  postEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<T, OneBunBaseError> {
    return this.requestEffect<T>({ method: HttpMethod.POST, url, data, ...config });
  }

  putEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<T, OneBunBaseError> {
    return this.requestEffect<T>({ method: HttpMethod.PUT, url, data, ...config });
  }

  patchEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<T, OneBunBaseError> {
    return this.requestEffect<T>({ method: HttpMethod.PATCH, url, data, ...config });
  }

  deleteEffect<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<T, OneBunBaseError> {
    let finalConfig: RequestConfig;
    
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

  headEffect<Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<void, OneBunBaseError> {
    let finalConfig: RequestConfig;
    
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

  optionsEffect<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Effect.Effect<T, OneBunBaseError> {
    let finalConfig: RequestConfig;
    
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

  updateConfigEffect(newConfig: Partial<RequestsOptions>): Effect.Effect<void> {
    return Effect.sync(() => {
      this.serviceOptions = { ...this.serviceOptions, ...newConfig };
    });
  }

  // Promise wrappers
  async request<T = any>(config: RequestConfig): Promise<T> {
    return Effect.runPromise(this.requestEffect<T>(config));
  }

  async get<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<T> {
    return Effect.runPromise(this.getEffect<T>(url, queryOrConfig, config));
  }

  async post<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<T> {
    return Effect.runPromise(this.postEffect<T>(url, data, config));
  }

  async put<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<T> {
    return Effect.runPromise(this.putEffect<T>(url, data, config));
  }

  async patch<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<T> {
    return Effect.runPromise(this.patchEffect<T>(url, data, config));
  }

  async delete<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<T> {
    return Effect.runPromise(this.deleteEffect<T>(url, queryOrConfig, config));
  }

  async head<Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<void> {
    return Effect.runPromise(this.headEffect(url, queryOrConfig, config));
  }

  async options<T = any, Q extends Record<string, any> = Record<string, any>>(
    url: string, 
    queryOrConfig?: Q | Partial<RequestConfig>, 
    config?: Partial<RequestConfig>
  ): Promise<T> {
    return Effect.runPromise(this.optionsEffect<T>(url, queryOrConfig, config));
  }

  async updateConfig(newConfig: Partial<RequestsOptions>): Promise<void> {
    return Effect.runPromise(this.updateConfigEffect(newConfig));
  }

  createClient(options: RequestsOptions): HttpClient {
    return new HttpClient(options);
  }

  getConfig(): RequestsOptions {
    return { ...this.serviceOptions };
  }
}

/**
 * RequestsService context tag for dependency injection
 */
export const RequestsService = Context.GenericTag<RequestsService>('@onebun/requests/RequestsService');

/**
 * Create RequestsService Layer
 */
export const makeRequestsService = (options: RequestsOptions = {}): Layer.Layer<RequestsService> => {
  const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...options };
  
  return Layer.succeed(
    RequestsService,
    new RequestsServiceImpl(mergedOptions)
  );
};

/**
 * Convenience function to create HTTP client with default options
 */
export const createHttpClient = (options: RequestsOptions = {}): HttpClient => {
  const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...options };
  return new HttpClient(mergedOptions);
};

/**
 * Utility functions for direct usage without service injection
 */
export const requests = {
  /**
   * Execute a GET request (Promise interface)
   */
  get: async <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.GET, url, query, ...config })),

  /**
   * Execute a GET request (Effect interface)
   */
  getEffect: <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.GET, url, query, ...config }),

  /**
   * Execute a POST request (Promise interface)
   */
  post: async <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.POST, url, data, ...config })),

  /**
   * Execute a POST request (Effect interface)
   */
  postEffect: <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.POST, url, data, ...config }),

  /**
   * Execute a PUT request (Promise interface)
   */
  put: async <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.PUT, url, data, ...config })),

  /**
   * Execute a PUT request (Effect interface)
   */
  putEffect: <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.PUT, url, data, ...config }),

  /**
   * Execute a PATCH request (Promise interface)
   */
  patch: async <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.PATCH, url, data, ...config })),

  /**
   * Execute a PATCH request (Effect interface)
   */
  patchEffect: <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.PATCH, url, data, ...config }),

  /**
   * Execute a DELETE request (Promise interface)
   */
  delete: async <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.DELETE, url, query, ...config })),

  /**
   * Execute a DELETE request (Effect interface)
   */
  deleteEffect: <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.DELETE, url, query, ...config }),

  /**
   * Execute a HEAD request (Promise interface)
   */
  head: async <Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<ApiResponse<void>> =>
    Effect.runPromise(executeRequest<void>({ method: HttpMethod.HEAD, url, query, ...config })),

  /**
   * Execute a HEAD request (Effect interface)
   */
  headEffect: <Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<void>({ method: HttpMethod.HEAD, url, query, ...config }),

  /**
   * Execute an OPTIONS request (Promise interface)
   */
  options: async <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.OPTIONS, url, query, ...config })),

  /**
   * Execute an OPTIONS request (Effect interface)
   */
  optionsEffect: <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.OPTIONS, url, query, ...config }),

  /**
   * Execute a request with full configuration (Promise interface)
   */
  request: async <T = any>(config: RequestConfig): Promise<ApiResponse<T>> =>
    Effect.runPromise(executeRequest<T>(config)),

  /**
   * Execute a request with full configuration (Effect interface)
   */
  requestEffect: <T = any>(config: RequestConfig) => executeRequest<T>(config)
}; 
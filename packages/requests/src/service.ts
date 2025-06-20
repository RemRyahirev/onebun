import { Effect, Layer, Context, pipe } from 'effect';
import {
  RequestsOptions,
  RequestConfig,
  RequestResponse,
  RequestError,
  HttpMethod,
  DEFAULT_REQUESTS_OPTIONS
} from './types.js';
import { HttpClient, executeRequest } from './client.js';

/**
 * RequestsService interface for dependency injection
 */
export interface RequestsService {
  /**
   * Execute a request with full configuration (Promise interface)
   */
  request<T = any>(config: RequestConfig): Promise<RequestResponse<T>>;

  /**
   * Execute a request with full configuration (Effect interface)
   */
  requestEffect<T = any>(config: RequestConfig): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * GET request (Promise interface)
   */
  get<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>>;

  /**
   * GET request (Effect interface)
   */
  getEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * POST request (Promise interface)
   */
  post<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>>;

  /**
   * POST request (Effect interface)
   */
  postEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * PUT request (Promise interface)
   */
  put<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>>;

  /**
   * PUT request (Effect interface)
   */
  putEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * PATCH request (Promise interface)
   */
  patch<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>>;

  /**
   * PATCH request (Effect interface)
   */
  patchEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * DELETE request (Promise interface)
   */
  delete<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>>;

  /**
   * DELETE request (Effect interface)
   */
  deleteEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * HEAD request (Promise interface)
   */
  head<Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<void>>;

  /**
   * HEAD request (Effect interface)
   */
  headEffect<Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<void>, RequestError>;

  /**
   * OPTIONS request (Promise interface)
   */
  optionsRequest<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>>;

  /**
   * OPTIONS request (Effect interface)
   */
  optionsRequestEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * Create a new HTTP client with specific configuration
   */
  createClient(options: RequestsOptions): HttpClient;

  /**
   * Get service configuration
   */
  getConfig(): RequestsOptions;

  /**
   * Update service configuration (Promise interface)
   */
  updateConfig(newConfig: Partial<RequestsOptions>): Promise<void>;

  /**
   * Update service configuration (Effect interface)
   */
  updateConfigEffect(newConfig: Partial<RequestsOptions>): Effect.Effect<void>;
}

/**
 * RequestsService implementation
 */
class RequestsServiceImpl implements RequestsService {
  constructor(private serviceOptions: RequestsOptions) {}

  // Effect methods with Effect postfix
  requestEffect<T = any>(config: RequestConfig): Effect.Effect<RequestResponse<T>, RequestError> {
    return executeRequest<T>(config, this.serviceOptions);
  }

  getEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    // Handle overloads: either query data as second param, or config as second param
    let finalConfig: RequestConfig;
    
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

  postEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.POST,
      url,
      data,
      ...config
    };
    return this.requestEffect<T>(fullConfig);
  }

  putEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.PUT,
      url,
      data,
      ...config
    };
    return this.requestEffect<T>(fullConfig);
  }

  patchEffect<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.PATCH,
      url,
      data,
      ...config
    };
    return this.requestEffect<T>(fullConfig);
  }

  deleteEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    // Handle overloads similar to GET
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

  headEffect<Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<void>, RequestError> {
    // Handle overloads similar to GET
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

  optionsRequestEffect<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError> {
    // Handle overloads similar to GET
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

  // Promise methods (default interface)
  async request<T = any>(config: RequestConfig): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.requestEffect<T>(config));
  }

  async get<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.getEffect<T, Q>(url, queryOrConfig, config));
  }

  async post<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.postEffect<T, D>(url, data, config));
  }

  async put<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.putEffect<T, D>(url, data, config));
  }

  async patch<T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.patchEffect<T, D>(url, data, config));
  }

  async delete<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.deleteEffect<T, Q>(url, queryOrConfig, config));
  }

  async head<Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<void>> {
    return Effect.runPromise(this.headEffect<Q>(url, queryOrConfig, config));
  }

  async optionsRequest<T = any, Q extends Record<string, any> = Record<string, any>>(url: string, queryOrConfig?: Q | Partial<RequestConfig>, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> {
    return Effect.runPromise(this.optionsRequestEffect<T, Q>(url, queryOrConfig, config));
  }

  async updateConfig(newConfig: Partial<RequestsOptions>): Promise<void> {
    return Effect.runPromise(this.updateConfigEffect(newConfig));
  }

  // Common methods that don't need dual API
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
 * Create RequestsService Layer with environment-based configuration
 */
export const makeRequestsServiceFromEnv = (): Layer.Layer<RequestsService> => {
  return Layer.effect(
    RequestsService,
    Effect.sync(() => {
      // Try to get configuration from environment or other sources
      const envConfig: Partial<RequestsOptions> = {};

      // Check for common environment variables
      if (typeof process !== 'undefined' && process.env) {
        if (process.env.HTTP_TIMEOUT) {
          envConfig.timeout = parseInt(process.env.HTTP_TIMEOUT, 10);
        }
        
        if (process.env.HTTP_BASE_URL) {
          envConfig.baseUrl = process.env.HTTP_BASE_URL;
        }

        if (process.env.HTTP_USER_AGENT) {
          envConfig.userAgent = process.env.HTTP_USER_AGENT;
        }

        if (process.env.HTTP_RETRIES_MAX) {
          envConfig.retries = {
            ...DEFAULT_REQUESTS_OPTIONS.retries,
            max: parseInt(process.env.HTTP_RETRIES_MAX, 10)
          };
        }

        if (process.env.HTTP_RETRIES_DELAY) {
          envConfig.retries = {
            ...envConfig.retries,
            ...DEFAULT_REQUESTS_OPTIONS.retries,
            delay: parseInt(process.env.HTTP_RETRIES_DELAY, 10)
          };
        }

        // Disable tracing/metrics if specified
        if (process.env.HTTP_TRACING === 'false') {
          envConfig.tracing = false;
        }

        if (process.env.HTTP_METRICS === 'false') {
          envConfig.metrics = false;
        }
      }

      const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...envConfig };
      return new RequestsServiceImpl(mergedOptions);
    })
  );
};

/**
 * Create a standalone HTTP client without dependency injection
 */
export const createHttpClient = (options: RequestsOptions = {}): HttpClient => {
  return new HttpClient(options);
};

/**
 * Utility functions for direct usage without service injection
 */
export const requests = {
  /**
   * Execute a GET request (Promise interface)
   */
  get: async <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.GET, url, query, ...config })),

  /**
   * Execute a GET request (Effect interface)
   */
  getEffect: <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.GET, url, query, ...config }),

  /**
   * Execute a POST request (Promise interface)
   */
  post: async <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.POST, url, data, ...config })),

  /**
   * Execute a POST request (Effect interface)
   */
  postEffect: <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.POST, url, data, ...config }),

  /**
   * Execute a PUT request (Promise interface)
   */
  put: async <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.PUT, url, data, ...config })),

  /**
   * Execute a PUT request (Effect interface)
   */
  putEffect: <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.PUT, url, data, ...config }),

  /**
   * Execute a PATCH request (Promise interface)
   */
  patch: async <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.PATCH, url, data, ...config })),

  /**
   * Execute a PATCH request (Effect interface)
   */
  patchEffect: <T = any, D = any>(url: string, data?: D, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.PATCH, url, data, ...config }),

  /**
   * Execute a DELETE request (Promise interface)
   */
  delete: async <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.DELETE, url, query, ...config })),

  /**
   * Execute a DELETE request (Effect interface)
   */
  deleteEffect: <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.DELETE, url, query, ...config }),

  /**
   * Execute a HEAD request (Promise interface)
   */
  head: async <Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<RequestResponse<void>> =>
    Effect.runPromise(executeRequest<void>({ method: HttpMethod.HEAD, url, query, ...config })),

  /**
   * Execute a HEAD request (Effect interface)
   */
  headEffect: <Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<void>({ method: HttpMethod.HEAD, url, query, ...config }),

  /**
   * Execute an OPTIONS request (Promise interface)
   */
  options: async <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>({ method: HttpMethod.OPTIONS, url, query, ...config })),

  /**
   * Execute an OPTIONS request (Effect interface)
   */
  optionsEffect: <T = any, Q extends Record<string, any> = Record<string, any>>(url: string, query?: Q, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.OPTIONS, url, query, ...config }),

  /**
   * Execute a request with full configuration (Promise interface)
   */
  request: async <T = any>(config: RequestConfig): Promise<RequestResponse<T>> =>
    Effect.runPromise(executeRequest<T>(config)),

  /**
   * Execute a request with full configuration (Effect interface)
   */
  requestEffect: <T = any>(config: RequestConfig) => executeRequest<T>(config)
}; 
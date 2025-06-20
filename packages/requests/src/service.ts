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
   * Execute a request with full configuration
   */
  request<T = any>(config: RequestConfig): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * GET request
   */
  get<T = any>(url: string, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * POST request
   */
  post<T = any>(url: string, data?: any, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * PUT request
   */
  put<T = any>(url: string, data?: any, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * PATCH request
   */
  patch<T = any>(url: string, data?: any, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * DELETE request
   */
  delete<T = any>(url: string, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

  /**
   * HEAD request
   */
  head(url: string, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<void>, RequestError>;

  /**
   * OPTIONS request
   */
  optionsRequest<T = any>(url: string, config?: Partial<RequestConfig>): Effect.Effect<RequestResponse<T>, RequestError>;

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
  updateConfig(newConfig: Partial<RequestsOptions>): Effect.Effect<void>;
}

/**
 * RequestsService implementation
 */
class RequestsServiceImpl implements RequestsService {
  constructor(private serviceOptions: RequestsOptions) {}

  request<T = any>(config: RequestConfig): Effect.Effect<RequestResponse<T>, RequestError> {
    return executeRequest<T>(config, this.serviceOptions);
  }

  get<T = any>(url: string, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.GET,
      url,
      ...config
    };
    return this.request<T>(fullConfig);
  }

  post<T = any>(url: string, data?: any, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.POST,
      url,
      data,
      ...config
    };
    return this.request<T>(fullConfig);
  }

  put<T = any>(url: string, data?: any, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.PUT,
      url,
      data,
      ...config
    };
    return this.request<T>(fullConfig);
  }

  patch<T = any>(url: string, data?: any, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.PATCH,
      url,
      data,
      ...config
    };
    return this.request<T>(fullConfig);
  }

  delete<T = any>(url: string, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.DELETE,
      url,
      ...config
    };
    return this.request<T>(fullConfig);
  }

  head(url: string, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<void>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.HEAD,
      url,
      ...config
    };
    return this.request<void>(fullConfig);
  }

  optionsRequest<T = any>(url: string, config: Partial<RequestConfig> = {}): Effect.Effect<RequestResponse<T>, RequestError> {
    const fullConfig: RequestConfig = {
      method: HttpMethod.OPTIONS,
      url,
      ...config
    };
    return this.request<T>(fullConfig);
  }

  createClient(options: RequestsOptions): HttpClient {
    return new HttpClient(options);
  }

  getConfig(): RequestsOptions {
    return { ...this.serviceOptions };
  }

  updateConfig(newConfig: Partial<RequestsOptions>): Effect.Effect<void> {
    return Effect.sync(() => {
      this.serviceOptions = { ...this.serviceOptions, ...newConfig };
    });
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
   * Execute a GET request
   */
  get: <T = any>(url: string, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.GET, url, ...config }),

  /**
   * Execute a POST request
   */
  post: <T = any>(url: string, data?: any, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.POST, url, data, ...config }),

  /**
   * Execute a PUT request
   */
  put: <T = any>(url: string, data?: any, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.PUT, url, data, ...config }),

  /**
   * Execute a PATCH request
   */
  patch: <T = any>(url: string, data?: any, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.PATCH, url, data, ...config }),

  /**
   * Execute a DELETE request
   */
  delete: <T = any>(url: string, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.DELETE, url, ...config }),

  /**
   * Execute a HEAD request
   */
  head: (url: string, config?: Partial<RequestConfig>) =>
    executeRequest<void>({ method: HttpMethod.HEAD, url, ...config }),

  /**
   * Execute an OPTIONS request
   */
  options: <T = any>(url: string, config?: Partial<RequestConfig>) =>
    executeRequest<T>({ method: HttpMethod.OPTIONS, url, ...config }),

  /**
   * Execute a request with full configuration
   */
  request: <T = any>(config: RequestConfig) => executeRequest<T>(config)
}; 
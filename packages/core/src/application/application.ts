import path from 'node:path';

import {
  type Context,
  Effect,
  type Layer,
} from 'effect';

import type { Controller } from '../module/controller';
import type { WsClientData } from '../websocket/ws.types';

import {
  type DeepPaths,
  type DeepValue,
  TypedEnv,
} from '@onebun/envs';
import {
  createSyncLogger,
  type Logger,
  LoggerService,
  makeLogger,
  makeLoggerFromOptions,
  shutdownLogger,
  type SyncLogger,
} from '@onebun/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  HttpStatusCode,
} from '@onebun/requests';

import {
  getControllerFilters,
  getControllerGuards,
  getControllerMetadata,
  getControllerMiddleware,
  getSseMetadata,
  type SseDecoratorOptions,
} from '../decorators/decorators';
import { createDefaultExceptionFilter, type ExceptionFilter } from '../exception-filters/exception-filters';
import { HttpException } from '../exception-filters/http-exception';
import { OneBunFile, validateFile } from '../file/onebun-file';
import { executeHttpGuards, HttpExecutionContextImpl } from '../http-guards/http-guards';
import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from '../module/config.interface';
import { ConfigServiceImpl } from '../module/config.service';
import {
  createSseStream,
  DEFAULT_IDLE_TIMEOUT,
  DEFAULT_SSE_HEARTBEAT_MS,
  DEFAULT_SSE_TIMEOUT,
} from '../module/controller';
import { OneBunModule, registerGlobalService } from '../module/module';
import {
  type ProfileMark,
  PROFILING_ENABLED,
  getProfiler,
  setProfiler,
  runProfileScope,
  DefaultProfiler,
} from '../profiler';
import {
  QueueService,
  QueueServiceProxy,
  QueueServiceTag,
  type QueueAdapter,
  type QueueConfig,
} from '../queue';
import { InMemoryQueueAdapter } from '../queue/adapters/memory.adapter';
import { RedisQueueAdapter } from '../queue/adapters/redis.adapter';
import { hasQueueDecorators } from '../queue/decorators';
import { SharedRedisProvider } from '../redis/shared-redis';
import { CorsMiddleware } from '../security/cors-middleware';
import { RateLimitMiddleware } from '../security/rate-limit-middleware';
import { SecurityHeadersMiddleware } from '../security/security-headers-middleware';
import {
  type ApplicationOptions,
  type HttpMethod,
  type ModuleInstance,
  type OneBunRequest,
  ParamType,
  type RouteMetadata,
} from '../types';
import { validateOrThrow } from '../validation';
import { WsHandler, isWebSocketGateway } from '../websocket/ws-handler';

// Conditionally import metrics
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createMetricsService: any;

try {
  const metricsModule = require('@onebun/metrics');
  createMetricsService = metricsModule.createMetricsService;
} catch {
  // Metrics module not available - this is optional
}

// Conditionally import docs (optional dependency - not added to package.json to avoid circular deps)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generateOpenApiSpec: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generateSwaggerUiHtml: any;

try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const docsModule = require('@onebun/docs');
  generateOpenApiSpec = docsModule.generateOpenApiSpec;
  generateSwaggerUiHtml = docsModule.generateSwaggerUiHtml;
} catch {
  // Docs module not available - this is optional
}

// Optional CacheService for static file existence caching
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cacheServiceClass: new (...args: unknown[]) => any = null as any;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const cacheModule = require('@onebun/cache');
  cacheServiceClass = cacheModule.CacheService;
} catch {
  // @onebun/cache not available - use in-memory Map fallback
}

// Import tracing modules directly

// Helper function to clear trace context
function clearGlobalTraceContext(): void {
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).__onebunCurrentTraceContext = null;
  }
}

/**
 * Normalize URL path by removing trailing slashes (except for root path).
 * This ensures consistent route matching and metrics collection.
 *
 * @param path - The URL path to normalize
 * @returns Normalized path without trailing slash
 * @example
 * normalizePath('/users/') // => '/users'
 * normalizePath('/users')  // => '/users'
 * normalizePath('/')       // => '/'
 * normalizePath('/api/v1/') // => '/api/v1'
 */
function normalizePath(pathStr: string): string {
  if (pathStr === '/' || pathStr.length <= 1) {
    return pathStr;
  }

  return pathStr.endsWith('/') ? pathStr.slice(0, -1) : pathStr;
}

/**
 * Recursively strip keys whose value is `undefined` from plain objects.
 * Ensures ArkType optional-field validation treats missing values
 * as absent rather than present-but-undefined.
 */
function stripUndefined(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined);
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }

    return result;
  }

  return obj;
}

const EMPTY_QUERY_PARAMS: Record<string, string | string[]> = Object.freeze({});

/**
 * Extract query parameters from a raw URL string without `new URL()`.
 * Uses indexOf + URLSearchParams on the query portion only — avoids
 * full URL parsing (protocol, host, path) which is expensive.
 *
 * @param rawUrl - The raw request URL string (e.g. 'http://host/path?a=1&b=2')
 * @returns Record of parameter names to values (string for single, string[] for repeated/array notation)
 * @example
 * extractQueryParams('http://x.com/?a=1&b=2')     // { a: '1', b: '2' }
 * extractQueryParams('http://x.com/?tag=a&tag=b')  // { tag: ['a', 'b'] }
 * extractQueryParams('http://x.com/?tag[]=a')       // { tag: ['a'] }
 * extractQueryParams('http://x.com/users')          // {} (frozen empty object, zero alloc)
 */
function extractQueryParams(rawUrl: string): Record<string, string | string[]> {
  const qIdx = rawUrl.indexOf('?');
  if (qIdx === -1) {
    return EMPTY_QUERY_PARAMS;
  }

  const queryParams: Record<string, string | string[]> = {};
  const searchParams = new URLSearchParams(rawUrl.slice(qIdx + 1));

  for (const [rawKey, value] of searchParams.entries()) {
    // Handle array notation: tag[] -> tag (as array)
    const isArrayNotation = rawKey.endsWith('[]');
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    const key = isArrayNotation ? rawKey.slice(0, -2) : rawKey;

    const existing = queryParams[key];
    if (existing !== undefined) {
      // Handle multiple values with same key (e.g., ?tag=a&tag=b or ?tag[]=a&tag[]=b)
      queryParams[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else if (isArrayNotation) {
      // Array notation always creates an array, even with single value
      queryParams[key] = [value];
    } else {
      queryParams[key] = value;
    }
  }

  return queryParams;
}

/**
 * Resolve port from options, environment variable, or default.
 * Priority: explicit option > PORT env > default (3000)
 */
function resolvePort(explicitPort: number | undefined): number {
  if (explicitPort !== undefined) {
    return explicitPort;
  }
  const envPort = process.env.PORT;
  if (envPort !== undefined && envPort !== '') {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 3000;
}

/**
 * Resolve host from options, environment variable, or default.
 * Priority: explicit option > HOST env > default ('0.0.0.0')
 */
function resolveHost(explicitHost: string | undefined): string {
  if (explicitHost !== undefined) {
    return explicitHost;
  }
  const envHost = process.env.HOST;
  if (envHost !== undefined && envHost !== '') {
    return envHost;
  }

  return '0.0.0.0';
}

/** Default TTL for static file existence cache (ms) when not specified */
const DEFAULT_STATIC_FILE_EXISTENCE_CACHE_TTL_MS = 60_000;

/** Cache key prefix for static file existence in CacheService */
const STATIC_EXISTS_CACHE_PREFIX = 'onebun:static:exists:';

/**
 * Resolve a relative path under a root directory and ensure the result stays inside the root (path traversal protection).
 * @param rootDir - Absolute path to the static root directory
 * @param relativePath - URL path segment (e.g. from request path after prefix); must not contain '..' that escapes root
 * @returns Absolute path if under root, otherwise null
 */
function resolvePathUnderRoot(rootDir: string, relativePath: string): string | null {
  const normalized = path.join(rootDir, relativePath.startsWith('/') ? relativePath.slice(1) : relativePath);
  const resolved = path.resolve(normalized);
  const rootResolved = path.resolve(rootDir);
  if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) {
    return resolved;
  }

  return null;
}

/**
 * OneBun Application
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class OneBunApplication<QA extends import('../queue/types').QueueAdapterConstructor<any> = import('../queue/types').QueueAdapterConstructor> {
  private rootModule: ModuleInstance | null = null;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private options: ApplicationOptions;
  private logger: SyncLogger;
  private config: IConfig<OneBunAppConfig>;
  private configService: ConfigServiceImpl | null = null;
  private moduleClass: new (...args: unknown[]) => object;
  private loggerLayer: Layer.Layer<never, never, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metricsService: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private traceService: any = null;
  private wsHandler: WsHandler | null = null;
  private queueService: QueueService | null = null;
  private queueAdapter: QueueAdapter | null = null;
  private queueServiceProxy: QueueServiceProxy | null = null;
  // Docs (OpenAPI/Swagger) - generated on start()
  private openApiSpec: Record<string, unknown> | null = null;
  private swaggerHtml: string | null = null;
  // Internal profiling
  private profilingReports: import('../profiler').ProfileReport[] = [];

  /**
   * Create application instance
   */
  constructor(
    moduleClass: new (...args: unknown[]) => object,
    options?: Partial<ApplicationOptions<QA>>,
  ) {
    this.moduleClass = moduleClass;

    // Resolve port and host with priority: explicit > env > default
    this.options = {
      port: resolvePort(options?.port),
      host: resolveHost(options?.host),
      development: options?.development ?? process.env.NODE_ENV !== 'production',
      ...options,
    };

    // Initialize configuration - TypedEnv if schema provided, otherwise NotInitializedConfig
    if (this.options.envSchema) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.config = TypedEnv.create(this.options.envSchema as any, this.options.envOptions);
    } else {
      this.config = new NotInitializedConfig();
    }

    // Use provided logger layer, or create from options, or use default
    // Priority: loggerLayer > loggerOptions > env variables > NODE_ENV defaults
    // Auto-populate OTLP resource attributes from tracing config if available
    const loggerOptions = this.options.loggerOptions
      ? {
        ...this.options.loggerOptions,
        otlpResourceAttributes: this.options.loggerOptions.otlpResourceAttributes ?? (
          this.options.loggerOptions.otlpEndpoint && this.options.tracing
            ? {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'service.name': this.options.tracing.serviceName ?? 'onebun-service',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'service.version': this.options.tracing.serviceVersion ?? '1.0.0',
            }
            : undefined
        ),
      }
      : undefined;

    this.loggerLayer = this.options.loggerLayer
      ?? (loggerOptions
        ? makeLoggerFromOptions(loggerOptions)
        : makeLogger());

    // Initialize logger with application class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (logger: Logger) =>
          logger.child({ className: 'OneBunApplication' }),
        ),
        this.loggerLayer,
      ) as Effect.Effect<Logger, never, never>,
    ) as Logger;
    this.logger = createSyncLogger(effectLogger);

    // Create configuration service eagerly if config exists (it stores a reference,
    // doesn't call config.get(), so safe before initialization)
    if (!(this.config instanceof NotInitializedConfig)) {
      this.configService = new ConfigServiceImpl(this.logger, this.config);
    }

    // Initialize metrics if enabled and available
    if (this.options.metrics?.enabled !== false && createMetricsService) {
      try {
        this.logger.debug('Attempting to initialize metrics service');
        this.logger.debug('Metrics options:', this.options.metrics);

        this.metricsService = Effect.runSync(createMetricsService(this.options.metrics || {}));

        this.logger.debug('Metrics service Effect run successfully');

        // Make metrics service globally available (temporary solution)
        if (typeof globalThis !== 'undefined') {
          (globalThis as Record<string, unknown>).__onebunMetricsService = this.metricsService;
        }

        this.logger.info('Metrics service initialized successfully');
      } catch (error) {
        this.logger.error(
          'Failed to initialize metrics service:',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.logger.debug('Full error details:', {
          error,
          stack: error instanceof Error ? error.stack : 'No stack',
        });
      }
    } else if (this.options.metrics?.enabled !== false) {
      this.logger.debug('createMetricsService not available, metrics will be disabled');
    }

    // Initialize tracing if enabled (lazy import to avoid loading OTEL at startup when not needed)
    if (this.options.tracing?.enabled !== false) {
      try {
        this.logger.debug('Attempting to initialize trace service');
        this.logger.debug('Tracing options:', this.options.tracing);

        const trace = require('@onebun/trace') as typeof import('@onebun/trace');
        const traceLayer = trace.makeTraceService(this.options.tracing || {});
        this.traceService = Effect.runSync(Effect.provide(trace.TraceService, traceLayer));

        this.logger.debug('Trace service Effect run successfully');

        // Make trace service globally available (temporary solution)
        if (typeof globalThis !== 'undefined') {
          (globalThis as Record<string, unknown>).__onebunTraceService = this.traceService;
        }

        this.logger.info('Trace service initialized successfully');
      } catch (error) {
        this.logger.error(
          'Failed to initialize trace service:',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.logger.debug('Full error details:', {
          error,
          stack: error instanceof Error ? error.stack : 'No stack',
        });
      }
    }

    // Initialize profiler from options (env-based init happens at module load in profiler.ts)
    if (this.options.profiling?.enabled && !getProfiler()) {
      setProfiler(this.options.profiling.profiler ?? new DefaultProfiler());
    } else if (this.options.profiling?.profiler) {
      setProfiler(this.options.profiling.profiler);
    }

    // Note: root module creation is deferred to start() to ensure
    // config is fully initialized before services are created.
  }

  /**
   * Get configuration service with full type inference.
   * Uses module augmentation of OneBunAppConfig for type-safe access.
   *
   * @example
   * // With module augmentation:
   * declare module '@onebun/core' {
   *   interface OneBunAppConfig {
   *     server: { port: number; host: string };
   *   }
   * }
   *
   * const config = app.getConfig();
   * const port = config.get('server.port'); // number
   */
  getConfig(): IConfig<OneBunAppConfig> {
    if (!this.configService) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configService;
  }

  /**
   * Get configuration value by path (convenience method) with full type inference.
   * Uses module augmentation of OneBunAppConfig for type-safe access.
   *
   * @example
   * // With module augmentation:
   * declare module '@onebun/core' {
   *   interface OneBunAppConfig {
   *     server: { port: number; host: string };
   *   }
   * }
   *
   * const port = app.getConfigValue('server.port'); // number
   * const host = app.getConfigValue('server.host'); // string
   */
  getConfigValue<P extends DeepPaths<OneBunAppConfig>>(pathKey: P): DeepValue<OneBunAppConfig, P>;
  /** Fallback for dynamic paths */
  getConfigValue<T = unknown>(pathKey: string): T;
  getConfigValue(pathKey: string): unknown {
    return this.getConfig().get(pathKey);
  }

  /**
   * Ensure root module is created (i.e., start() has been called).
   * Throws if called before start().
   */
  private ensureModule(): ModuleInstance {
    if (!this.rootModule) {
      throw new Error('Application not started. Call start() before accessing the module.');
    }

    return this.rootModule;
  }

  /**
   * Get root module layer
   */
  getLayer(): Layer.Layer<never, never, unknown> {
    return this.ensureModule().getLayer();
  }

  /**
   * Map HTTP method string to Bun's HttpMethod
   */
  private mapHttpMethod(method: HttpMethod): string {
    return method.toString();
  }

  /**
   * Build path prefix from routePrefix and basePath options.
   * The resulting prefix will be prepended to all controller routes.
   *
   * @returns Path prefix string (e.g., '/users/api/v1')
   */
  private buildPathPrefix(): string {
    let prefix = '';

    // Add routePrefix first (typically service name)
    if (this.options.routePrefix) {
      const routePrefix = this.options.routePrefix.startsWith('/')
        ? this.options.routePrefix
        : `/${this.options.routePrefix}`;
      prefix += routePrefix;
    }

    // Add basePath after routePrefix
    if (this.options.basePath) {
      const basePath = this.options.basePath.startsWith('/')
        ? this.options.basePath
        : `/${this.options.basePath}`;
      prefix += basePath;
    }

    return prefix;
  }

  /**
   * Start the application
   * This method now handles all the Effect.js calls internally
   */
  async start(): Promise<void> {
    // Default exception filter respects httpEnvelope option
    const appDefaultExceptionFilter = createDefaultExceptionFilter({
      httpEnvelope: this.options.httpEnvelope,
    });

    try {
      // Initialize configuration if schema was provided
      let profileMark: ProfileMark | undefined;
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'config:init');
      }
      if (!(this.config instanceof NotInitializedConfig)) {
        await this.config.initialize();
        this.logger.info('Application configuration initialized');
      }
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Register QueueService proxy in global registry BEFORE creating the root module,
      // so all modules (including child modules) pick it up via PHASE 0 of initModule().
      // After initializeQueue(), setDelegate(real) is called when queue is enabled.
      this.queueServiceProxy = new QueueServiceProxy();
      registerGlobalService(
        QueueServiceTag as Context.Tag<unknown, QueueService>,
        this.queueServiceProxy as unknown as QueueService,
      );

      // Create the root module AFTER config is initialized and QueueService proxy is registered,
      // so services can safely use this.config.get() in their constructors
      // and inject QueueService in any module depth.
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'module:create');
      }
      this.rootModule = OneBunModule.create(
        this.moduleClass, this.loggerLayer, this.config,
        this.options.tracing?.traceAll
          ? { traceAll: true, traceFilter: this.options.tracing.traceFilter }
          : undefined,
      );
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Register test provider overrides (must happen before setup() so controllers receive mocks)
      if (this.options._testProviders) {
        for (const { tag, value } of this.options._testProviders) {
          this.ensureModule().registerService?.(tag, value);
        }
      }

      // Start metrics collection if enabled
      if (this.metricsService && this.metricsService.startSystemMetricsCollection) {
        this.metricsService.startSystemMetricsCollection();
        this.logger.info('System metrics collection started');
      }

      // Setup the module and create controller instances
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'module:setup');
      }
      await Effect.runPromise(this.ensureModule().setup() as Effect.Effect<unknown, never, never>);
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Get all controllers from the root module
      const controllers = this.ensureModule().getControllers();
      this.logger.debug(`Loaded ${controllers.length} controllers`);

      // Initialize WebSocket handler and detect gateways
      this.wsHandler = new WsHandler(this.logger, this.options.websocket);

      // Register WebSocket gateways (they are in controllers array but decorated with @WebSocketGateway)
      for (const controllerClass of controllers) {
        if (isWebSocketGateway(controllerClass)) {
          const instance = this.ensureModule().getControllerInstance?.(controllerClass);
          if (instance) {
            this.wsHandler.registerGateway(controllerClass, instance as import('../websocket/ws-base-gateway').BaseWebSocketGateway);
            this.logger.info(`Registered WebSocket gateway: ${controllerClass.name}`);
          }
        }
      }

      // Initialize Queue system if configured or handlers exist
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'queue:init');
      }
      await this.initializeQueue(controllers);
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Initialize Docs (OpenAPI/Swagger) if enabled and available
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'docs:init');
      }
      await this.initializeDocs(controllers);
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Create server context binding (used by route handlers and executeHandler)
      const app = this;

      // Path constants for framework endpoints
      const metricsPath = this.options.metrics?.path || '/metrics';
      const docsPath = this.options.docs?.path || '/docs';
      const openApiPath = this.options.docs?.jsonPath || '/openapi.json';

      // Build application-level path prefix from options
      const appPrefix = this.buildPathPrefix();

      // Build Bun routes object: { "/path": { GET: handler, POST: handler } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bunRoutes: Record<string, any> = {};

      /**
       * Create a route handler with the full OneBun request lifecycle:
       * tracing setup → per-request timeout → middleware chain → executeHandler → metrics → tracing end
       */
      function createRouteHandler(
        routeMeta: RouteMetadata,
        boundHandler: Function,
        controller: Controller,
        fullPath: string,
        method: string,
      ): (req: OneBunRequest, server: ReturnType<typeof Bun.serve>) => Promise<Response> {
        // Determine the effective timeout for this route:
        // SSE endpoints check @Sse({ timeout }) first, then route-level, then DEFAULT_SSE_TIMEOUT
        // Normal endpoints use route-level timeout only (undefined = use global idleTimeout)
        // Pre-compute route metadata at registration time (not per-request)
        const controllerProto = Object.getPrototypeOf(controller);
        const controllerName = controller.constructor.name;
        const sseDecoratorOptions: SseDecoratorOptions | undefined = routeMeta.handler
          ? getSseMetadata(controllerProto, routeMeta.handler)
          : undefined;
        const isSse = sseDecoratorOptions !== undefined;
        const effectiveTimeout: number | undefined = isSse
          ? (sseDecoratorOptions?.timeout ?? routeMeta.timeout ?? DEFAULT_SSE_TIMEOUT)
          : routeMeta.timeout;
        const isFastPath = (!routeMeta.params || routeMeta.params.length === 0) && !routeMeta.responseSchemas?.length;
        const needsQueryParams = routeMeta.params?.some((p) => p.type === ParamType.QUERY) ?? false;

        return async (req, server) => {
          // Capture outermost timestamp before any closure/ALS overhead
          const profiler = PROFILING_ENABLED ? getProfiler() : null;
          const outerStartNs = profiler ? Bun.nanoseconds() : 0;

          const requestHandler = async (): Promise<Response> => {
            // Only measure time when metrics or tracing need it
            const startTime = (app.metricsService || app.traceService) ? Date.now() : 0;

            // Apply per-request idle timeout if configured
            if (effectiveTimeout !== undefined) {
              server.timeout(req, effectiveTimeout);
            }

            // Setup tracing context if available and enabled
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let traceSpan: any = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let traceContext: any = null;

            let pMark: ProfileMark | undefined;
            if (profiler && app.traceService) {
              pMark = profiler.start('framework', 'trace:setup');
            }
            if (app.traceService && app.options.tracing?.traceHttpRequests !== false) {
              try {
                // Extract only the trace propagation headers we need
                const traceparent = req.headers.get('traceparent') ?? undefined;
                const xTraceId = req.headers.get('x-trace-id') ?? undefined;
                const xSpanId = req.headers.get('x-span-id') ?? undefined;

                // Sync hot path: no Effect.runPromise overhead
                traceContext = app.traceService.extractFromHeadersSync({
                  traceparent,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'x-trace-id': xTraceId,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'x-span-id': xSpanId,
                }) || app.traceService.generateTraceContextSync();

                const contentLengthHeader = req.headers.get('content-length');
                traceSpan = app.traceService.startHttpTraceSync({
                  method,
                  url: req.url,
                  route: fullPath,
                  userAgent: req.headers.get('user-agent') ?? undefined,
                  remoteAddr: req.headers.get('x-forwarded-for')
                    || req.headers.get('x-real-ip')
                    || undefined,
                  requestSize: contentLengthHeader
                    ? parseInt(contentLengthHeader, 10)
                    : undefined,
                });

                // Set global trace context for logger integration
                if (typeof globalThis !== 'undefined') {
                  (globalThis as Record<string, unknown>).__onebunCurrentTraceContext = traceContext;
                }
              } catch (error) {
                app.logger.error(
                  'Failed to setup tracing:',
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
            }

            if (pMark) {
              profiler!.end(pMark);
            }

            // Extract query parameters only when route uses @Query (avoids overhead for simple routes)
            if (profiler && needsQueryParams) {
              pMark = profiler.start('framework', 'url:parse');
            }
            const queryParams = needsQueryParams ? extractQueryParams(req.url) : EMPTY_QUERY_PARAMS;
            if (pMark) {
              profiler!.end(pMark);
            }

            try {
              let response: Response;

              // Fast path: no params, no response schemas — inline handler call, skip executeHandler entirely
              // Full path: delegate to executeHandler for param extraction, validation, response wrapping
              const callHandler = isFastPath
                ? async (): Promise<Response> => {
                  let hMark: ProfileMark | undefined;
                  if (profiler) {
                    hMark = profiler.start('handler', `${controllerName}.${routeMeta.handler ?? 'unknown'}`);
                  }
                  const result = await boundHandler(req);
                  if (hMark) {
                    profiler!.end(hMark);
                  }
                  if (sseDecoratorOptions) {
                    return createSseResponseFromResult(result, sseDecoratorOptions);
                  }

                  if (result instanceof Response) {
                    return result;
                  }

                  const successResponse = createSuccessResponse(result);

                  return new Response(JSON.stringify(successResponse), {
                    status: HttpStatusCode.OK,
                    headers: {
                      // eslint-disable-next-line @typescript-eslint/naming-convention
                      'Content-Type': 'application/json',
                    },
                  });
                }
                : (): Promise<Response> => executeHandler(
                  boundHandler, routeMeta, controller, controllerName,
                  sseDecoratorOptions, req, queryParams, profiler,
                );

              // Execute middleware chain if any, then guards + handler
              if (routeMeta.middleware && routeMeta.middleware.length > 0) {
                const guardedHandler = async (): Promise<Response> => {
                  if (routeMeta.guards && routeMeta.guards.length > 0) {
                    let guardMark: ProfileMark | undefined;
                    if (profiler) {
                      guardMark = profiler.start('guard', fullPath);
                    }
                    const guardCtx = new HttpExecutionContextImpl(
                      req,
                      routeMeta.handler,
                      controller.constructor.name,
                    );
                    const allowed = await executeHttpGuards(routeMeta.guards, guardCtx);
                    if (guardMark) {
                      profiler!.end(guardMark);
                    }

                    if (!allowed) {
                      return new Response(
                        JSON.stringify(
                          createErrorResponse(
                            'Forbidden',
                            HttpStatusCode.FORBIDDEN,
                          ),
                        ),
                        {
                          status: HttpStatusCode.OK,
                          headers: {
                          // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Content-Type': 'application/json',
                          },
                        },
                      );
                    }
                  }

                  return await callHandler();
                };

                const next = async (index: number): Promise<Response> => {
                  if (index >= routeMeta.middleware!.length) {
                    return await guardedHandler();
                  }

                  const middleware = routeMeta.middleware![index];
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const mwName = (middleware as any)._middlewareName
                  || middleware.name
                  || `middleware[${index}]`;

                  if (profiler) {
                    const mwMark = profiler.start('middleware', mwName);
                    const result = await middleware(req, () => next(index + 1));
                    profiler.end(mwMark);

                    return result;
                  }

                  return await middleware(req, () => next(index + 1));
                };

                response = await next(0);
              } else {
                // No middleware — run guards inline (no extra closure)
                if (routeMeta.guards && routeMeta.guards.length > 0) {
                  let guardMark: ProfileMark | undefined;
                  if (profiler) {
                    guardMark = profiler.start('guard', fullPath);
                  }
                  const guardCtx = new HttpExecutionContextImpl(
                    req,
                    routeMeta.handler,
                    controller.constructor.name,
                  );
                  const allowed = await executeHttpGuards(routeMeta.guards, guardCtx);
                  if (guardMark) {
                    profiler!.end(guardMark);
                  }

                  if (!allowed) {
                    response = new Response(
                      JSON.stringify(
                        createErrorResponse(
                          'Forbidden',
                          HttpStatusCode.FORBIDDEN,
                        ),
                      ),
                      {
                        status: HttpStatusCode.OK,
                        headers: {
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                          'Content-Type': 'application/json',
                        },
                      },
                    );
                  } else {
                    response = await callHandler();
                  }
                } else {
                  response = await callHandler();
                }
              }

              // Skip Date.now() when neither metrics nor tracing need duration
              const duration = (app.metricsService || traceSpan)
                ? Date.now() - startTime
                : 0;

              // Record metrics and end trace
              if (profiler) {
                pMark = profiler.start('framework', 'metrics+trace');
              }
              if (app.metricsService && app.metricsService.recordHttpRequest) {
                const durationSeconds = duration / 1000;
                app.metricsService.recordHttpRequest({
                  method,
                  route: fullPath,
                  statusCode: response?.status || HttpStatusCode.OK,
                  duration: durationSeconds,
                  controller: controller.constructor.name,
                  action: 'unknown',
                });
              }

              // End trace (sync — no Effect.runPromise overhead)
              if (traceSpan && app.traceService) {
                try {
                  app.traceService.endHttpTraceSync(traceSpan, {
                    statusCode: response?.status || HttpStatusCode.OK,
                    responseSize: response?.headers?.get('content-length')
                      ? parseInt(response.headers.get('content-length')!, 10)
                      : undefined,
                    duration,
                  });
                } catch (traceError) {
                  app.logger.error(
                    'Failed to end trace:',
                    traceError instanceof Error ? traceError : new Error(String(traceError)),
                  );
                }
              }

              // Clear trace context after request
              clearGlobalTraceContext();
              if (pMark) {
                profiler!.end(pMark);
              }

              return response;
            } catch (error) {
              app.logger.error(
                'Request handling error:',
                error instanceof Error ? error : new Error(String(error)),
              );
              const response = new Response('Internal Server Error', {
                status: HttpStatusCode.INTERNAL_SERVER_ERROR,
              });
              const duration = Date.now() - startTime;

              // Record error metrics
              if (app.metricsService && app.metricsService.recordHttpRequest) {
                const durationSeconds = duration / 1000;
                app.metricsService.recordHttpRequest({
                  method,
                  route: fullPath,
                  statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                  duration: durationSeconds,
                  controller: controller.constructor.name,
                  action: 'unknown',
                });
              }

              // End trace with error (sync)
              if (traceSpan && app.traceService) {
                try {
                  traceSpan.events.push({
                    name: 'error',
                    timestamp: Date.now(),
                    attributes: {
                      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                      errorMessage: error instanceof Error ? error.message : String(error),
                    },
                  });
                  app.traceService.endHttpTraceSync(traceSpan, {
                    statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                    duration,
                  });
                } catch (traceError) {
                  app.logger.error(
                    'Failed to end trace with error:',
                    traceError instanceof Error ? traceError : new Error(String(traceError)),
                  );
                }
              }

              // Clear trace context after error
              clearGlobalTraceContext();

              return response;
            }
          };

          // Wrap in profiling scope for per-request mark isolation
          let response: Response;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let innerReport: any = null;
          if (profiler) {
            response = await runProfileScope(async () => {
              const res = await requestHandler();
              // Flush inside ALS scope to capture request-scoped marks
              innerReport = profiler.flush({ route: fullPath, method });

              return res;
            });
            // Inject outer total mark that spans everything (ALS overhead + requestHandler)
            const outerEndNs = Bun.nanoseconds();
            const totalDurationNs = outerEndNs - outerStartNs;
            if (innerReport) {
              innerReport.marks.unshift({
                category: 'request',
                label: 'total',
                startNs: outerStartNs,
                endNs: outerEndNs,
                durationNs: totalDurationNs,
              });
              innerReport.totalNs = totalDurationNs;
              app.handleProfileReport(innerReport);
            }
          } else {
            response = await requestHandler();
          }

          return response;
        };
      }

      // Build auto-configured security middleware from shorthand options.
      // These are prepended/appended in a fixed order: CORS → RateLimit → [user] → Security.
      const autoPrefix: Function[] = [];
      const autoSuffix: Function[] = [];

      if (this.options.cors) {
        const corsOpts = this.options.cors === true ? {} : this.options.cors;
        autoPrefix.push(CorsMiddleware.configure(corsOpts));
      }

      if (this.options.rateLimit) {
        const rlOpts = this.options.rateLimit === true ? {} : this.options.rateLimit;
        autoPrefix.push(RateLimitMiddleware.configure(rlOpts));
      }

      if (this.options.security) {
        const secOpts = this.options.security === true ? {} : this.options.security;
        autoSuffix.push(SecurityHeadersMiddleware.configure(secOpts));
      }

      // Application-wide middleware — resolve class constructors via root module DI
      const userMiddlewareClasses = (this.options.middleware as Function[] | undefined) ?? [];
      const allGlobalClasses = [...autoPrefix, ...userMiddlewareClasses, ...autoSuffix];
      const globalMiddleware: Function[] = allGlobalClasses.length > 0
        ? (this.ensureModule().resolveMiddleware?.(allGlobalClasses) ?? [])
        : [];

      // Add routes from controllers
      for (const controllerClass of controllers) {
        const controllerMetadata = getControllerMetadata(controllerClass);
        if (!controllerMetadata) {
          this.logger.warn(`No metadata found for controller: ${controllerClass.name}`);
          continue;
        }

        // Get controller instance from module
        if (!this.ensureModule().getControllerInstance) {
          this.logger.warn(
            `Module does not support getControllerInstance for ${controllerClass.name}`,
          );
          continue;
        }

        const controller = this.ensureModule().getControllerInstance!(controllerClass) as Controller;
        if (!controller) {
          this.logger.warn(`Controller instance not found for ${controllerClass.name}`);
          continue;
        }

        const controllerPath = controllerMetadata.path;

        // Module-level middleware (already resolved bound functions)
        const moduleMiddleware = this.ensureModule().getModuleMiddleware?.(controllerClass) ?? [];

        // Resolve controller-level and route-level middleware with the owner module's DI
        const ownerModule =
          this.ensureModule().getOwnerModuleForController?.(controllerClass) ?? this.ensureModule();

        // Controller-level middleware — resolve via owner module DI
        const ctrlMiddlewareClasses = getControllerMiddleware(controllerClass);
        const ctrlMiddleware: Function[] = ctrlMiddlewareClasses.length > 0
          ? (ownerModule.resolveMiddleware?.(ctrlMiddlewareClasses) ?? [])
          : [];

        for (const route of controllerMetadata.routes) {
          // Combine: appPrefix + controllerPath + routePath
          // Normalize to ensure consistent matching (e.g., '/api/users/' -> '/api/users')
          const fullPath = normalizePath(`${appPrefix}${controllerPath}${route.path}`);
          const method = this.mapHttpMethod(route.method);
          const handler = (controller as unknown as Record<string, Function>)[route.handler].bind(
            controller,
          );

          // Route-level middleware — resolve via owner module DI
          const routeMiddlewareClasses = route.middleware ?? [];
          const routeMiddleware: Function[] = routeMiddlewareClasses.length > 0
            ? (ownerModule.resolveMiddleware?.(routeMiddlewareClasses) ?? [])
            : [];

          // Merge middleware: global → module → controller → route
          const mergedMiddleware = [
            ...globalMiddleware,
            ...moduleMiddleware,
            ...ctrlMiddleware,
            ...routeMiddleware,
          ];

          // Merge guards: controller-level first, then route-level
          const ctrlGuards = getControllerGuards(controllerClass);
          const routeGuards = route.guards ?? [];
          const mergedGuards = [...ctrlGuards, ...routeGuards];

          // Merge exception filters: global → controller → route (route has highest priority)
          const globalFilters = (this.options.filters as ExceptionFilter[] | undefined) ?? [];
          const ctrlFilters = getControllerFilters(controllerClass);
          const routeFilters = route.filters ?? [];
          const mergedFilters = [...globalFilters, ...ctrlFilters, ...routeFilters];

          const routeWithMergedMiddleware: RouteMetadata = {
            ...route,
            middleware: mergedMiddleware.length > 0 ? mergedMiddleware : undefined,
            guards: mergedGuards.length > 0 ? mergedGuards : undefined,
            filters: mergedFilters.length > 0 ? mergedFilters : undefined,
          };

          // Create wrapped handler with full OneBun lifecycle (tracing, metrics, middleware)
          const wrappedHandler = createRouteHandler(routeWithMergedMiddleware, handler, controller, fullPath, method);

          // Add to bunRoutes grouped by path and method
          if (!bunRoutes[fullPath]) {
            bunRoutes[fullPath] = {};
          }
          bunRoutes[fullPath][method] = wrappedHandler;

          // Register trailing slash variant for consistent matching
          // (e.g., /api/users and /api/users/ both map to the same handler)
          if (fullPath.length > 1 && !fullPath.endsWith('/')) {
            const trailingPath = fullPath + '/';
            if (!bunRoutes[trailingPath]) {
              bunRoutes[trailingPath] = {};
            }
            bunRoutes[trailingPath][method] = wrappedHandler;
          }
        }
      }

      // Add framework endpoints to routes (docs, metrics)
      if (app.options.docs?.enabled !== false && app.openApiSpec) {
        if (app.swaggerHtml) {
          bunRoutes[docsPath] = {

            GET: () => new Response(app.swaggerHtml!, {
              headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': 'text/html; charset=utf-8',
              },
            }),
          };
        }
        bunRoutes[openApiPath] = {

          GET: () => new Response(JSON.stringify(app.openApiSpec, null, 2), {
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
          }),
        };
      }

      if (app.metricsService) {
        bunRoutes[metricsPath] = {

          async GET() {
            try {
              const metrics = await app.metricsService.getMetrics();

              return new Response(metrics, {
                headers: {
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'Content-Type': app.metricsService.getContentType(),
                },
              });
            } catch (error) {
              app.logger.error(
                'Failed to get metrics:',
                error instanceof Error ? error : new Error(String(error)),
              );

              return new Response('Internal Server Error', {
                status: HttpStatusCode.INTERNAL_SERVER_ERROR,
              });
            }
          },
        };
      }

      // Log all routes
      for (const controllerClass of controllers) {
        const metadata = getControllerMetadata(controllerClass);
        if (!metadata) {
          continue;
        }

        for (const route of metadata.routes) {
          const fullPath = normalizePath(`${appPrefix}${metadata.path}${route.path}`);
          const method = this.mapHttpMethod(route.method);
          this.logger.info(`Mapped {${method}} route: ${fullPath}`);
        }
      }

      // Call onApplicationInit lifecycle hook for all services and controllers
      if (this.ensureModule().callOnApplicationInit) {
        await this.ensureModule().callOnApplicationInit!();
        this.logger.debug('Application initialization hooks completed');
      }

      const hasWebSocketGateways = this.wsHandler?.hasGateways() ?? false;

      // Prepare WebSocket handlers if gateways exist
      // When no gateways, use no-op handlers (required by Bun.serve)
      const wsHandlers = hasWebSocketGateways ? this.wsHandler!.createWebSocketHandlers() : {

        open() { /* no-op */ },

        message() { /* no-op */ },

        close() { /* no-op */ },

        drain() { /* no-op */ },
      };

      // Static file serving: resolve root and setup existence cache (CacheService or in-memory Map)
      const staticOpts = this.options.static;
      let staticRootResolved: string | null = null;
      let staticPathPrefix: string | undefined;
      let staticFallbackFile: string | undefined;
      let staticCacheTtlMs = 0;
      // Cache interface: get(key) => value | undefined, set(key, value, ttlMs)
      type StaticExistsCache = {
        get(key: string): Promise<boolean | undefined>;
        set(key: string, value: boolean, ttlMs: number): Promise<void>;
      };
      let staticExistsCache: StaticExistsCache | null = null;

      if (staticOpts?.root) {
        staticRootResolved = path.resolve(staticOpts.root);
        staticPathPrefix = staticOpts.pathPrefix;
        staticFallbackFile = staticOpts.fallbackFile;
        staticCacheTtlMs = staticOpts.fileExistenceCacheTtlMs ?? DEFAULT_STATIC_FILE_EXISTENCE_CACHE_TTL_MS;

        if (staticCacheTtlMs > 0) {
          if (cacheServiceClass) {
            try {
              const cacheService = this.ensureModule().getServiceByClass?.(cacheServiceClass);
              if (cacheService && typeof cacheService.get === 'function' && typeof cacheService.set === 'function') {
                staticExistsCache = {
                  get: (key: string) => cacheService.get(STATIC_EXISTS_CACHE_PREFIX + key),
                  set: (key: string, value: boolean, ttlMs: number) =>
                    cacheService.set(STATIC_EXISTS_CACHE_PREFIX + key, value, { ttl: ttlMs }),
                };
                this.logger.debug('Static file existence cache using CacheService');
              }
            } catch {
              // CacheService not in module, use fallback
            }
          }
          if (!staticExistsCache) {
            const map = new Map<string, { exists: boolean; expiresAt: number }>();
            staticExistsCache = {
              async get(key: string): Promise<boolean | undefined> {
                const entry = map.get(key);
                if (!entry) {
                  return undefined;
                }
                if (staticCacheTtlMs > 0 && Date.now() > entry.expiresAt) {
                  map.delete(key);

                  return undefined;
                }

                return entry.exists;
              },
              async set(key: string, value: boolean, ttlMs: number): Promise<void> {
                map.set(key, {
                  exists: value,
                  expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER,
                });
              },
            };
            this.logger.debug('Static file existence cache using in-memory Map');
          }
        }
      }

      // Flush bootstrap profiling report
      if (PROFILING_ENABLED) {
        const profiler = getProfiler()!;
        const bootstrapReport = profiler.flush({ route: 'bootstrap' });
        this.handleProfileReport(bootstrapReport);
      }

      // Register profiling diagnostic endpoint
      if (PROFILING_ENABLED && this.options.profiling?.endpoint) {
        const profilePath = this.options.profiling.endpoint;
        bunRoutes[profilePath] = {
           
          GET: () => new Response(JSON.stringify(this.profilingReports), {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'Content-Type': 'application/json' },
          }),
        };
      }

      this.server = Bun.serve<WsClientData>({
        port: this.options.port,
        hostname: this.options.host,
        // Idle timeout (seconds) — default 120s to support SSE and long-running requests
        idleTimeout: this.options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
        // WebSocket handlers
        websocket: wsHandlers,
        // Bun routes API: all endpoints are handled here
        routes: bunRoutes,
        // Fallback: only WebSocket upgrade and 404
        async fetch(req, server) {
          // Handle WebSocket upgrade if gateways exist
          if (hasWebSocketGateways && app.wsHandler) {
            const upgradeHeader = req.headers.get('upgrade')?.toLowerCase();
            const socketioEnabled = app.options.websocket?.socketio?.enabled ?? false;
            const socketioPath = app.options.websocket?.socketio?.path ?? '/socket.io';

            const url = new URL(req.url);
            const requestPath = normalizePath(url.pathname);
            const isSocketIoPath = socketioEnabled && requestPath.startsWith(socketioPath);
            if (upgradeHeader === 'websocket' || isSocketIoPath) {
              const response = await app.wsHandler.handleUpgrade(req, server);
              if (response === undefined) {
                return undefined; // Successfully upgraded
              }

              return response;
            }
          }

          // Static file serving (GET/HEAD only)
          if (staticRootResolved && (req.method === 'GET' || req.method === 'HEAD')) {
            const requestPath = normalizePath(new URL(req.url).pathname);
            const prefix = staticPathPrefix ?? '/';
            const hasPrefix = prefix !== '' && prefix !== '/';
            if (hasPrefix && !requestPath.startsWith(prefix)) {
              return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
            }
            const relativePath = hasPrefix ? requestPath.slice(prefix.length) || '/' : requestPath;
            const resolvedPath = resolvePathUnderRoot(staticRootResolved, relativePath);
            if (resolvedPath === null) {
              return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
            }

            const cache = staticCacheTtlMs > 0 ? staticExistsCache : null;
            const cacheKey = resolvedPath;
            if (cache) {
              const cached = await cache.get(cacheKey);
              if (cached === true) {
                return new Response(Bun.file(resolvedPath));
              }
              if (cached === false) {
                if (staticFallbackFile) {
                  const fallbackResolved = resolvePathUnderRoot(staticRootResolved, staticFallbackFile);
                  if (fallbackResolved !== null) {
                    return new Response(Bun.file(fallbackResolved));
                  }
                }

                return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
              }
            }

            const file = Bun.file(resolvedPath);
            const exists = await file.exists();
            if (cache && staticCacheTtlMs > 0) {
              await cache.set(cacheKey, exists, staticCacheTtlMs);
            }
            if (exists) {
              return new Response(file);
            }
            if (staticFallbackFile) {
              const fallbackResolved = resolvePathUnderRoot(staticRootResolved, staticFallbackFile);
              if (fallbackResolved !== null) {
                const fallbackFile = Bun.file(fallbackResolved);
                if (await fallbackFile.exists()) {
                  return new Response(fallbackFile);
                }
              }
            }

            return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
          }

          // 404 for everything not matched by routes
          return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
        },
      });

      // Initialize WebSocket gateways with server
      if (hasWebSocketGateways && this.wsHandler && this.server) {
        this.wsHandler.initializeGateways(this.server);
        this.logger.info(
          `WebSocket server (native) enabled at ws://${this.options.host}:${this.options.port}`,
        );
        const socketioEnabled = this.options.websocket?.socketio?.enabled ?? false;
        if (socketioEnabled) {
          const sioPath = this.options.websocket?.socketio?.path ?? '/socket.io';
          this.logger.info(
            `WebSocket server (Socket.IO) enabled at ws://${this.options.host}:${this.options.port}${sioPath}`,
          );
        }
      }

      this.logger.info(`Server started on http://${this.options.host}:${this.options.port}`);
      if (staticRootResolved) {
        this.logger.info(`Static files served from ${staticRootResolved}`);
      }
      if (this.metricsService) {
        this.logger.info(
          `Metrics available at http://${this.options.host}:${this.options.port}${metricsPath}`,
        );
      } else if (this.options.metrics?.enabled !== false) {
        this.logger.warn(
          'Metrics enabled but @onebun/metrics module not available. Install with: bun add @onebun/metrics',
        );
      }

      // Enable graceful shutdown by default (can be disabled with gracefulShutdown: false)
      if (this.options.gracefulShutdown !== false) {
        this.enableGracefulShutdown();
      }
    } catch (error) {
      this.logger.error(
        'Failed to start application:',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }

    /**
     * Extract an OneBunFile from a JSON value.
     * Supports two formats:
     * - String: raw base64 data
     * - Object: { data: string, filename?: string, mimeType?: string }
     */
    function extractFileFromJsonValue(value: unknown): OneBunFile | undefined {
      if (typeof value === 'string' && value.length > 0) {
        return OneBunFile.fromBase64(value);
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        if (typeof obj.data === 'string' && obj.data.length > 0) {
          return OneBunFile.fromBase64(
            obj.data,
            typeof obj.filename === 'string' ? obj.filename : undefined,
            typeof obj.mimeType === 'string' ? obj.mimeType : undefined,
          );
        }
      }

      return undefined;
    }

    /**
     * Extract a file from a JSON body by field name
     */
    function extractFileFromJson(
      jsonBody: Record<string, unknown>,
      fieldName: string,
    ): OneBunFile | undefined {
      const fieldValue = jsonBody[fieldName];

      return extractFileFromJsonValue(fieldValue);
    }

    /**
     * Execute route handler with parameter injection and validation.
     * Path parameters come from BunRequest.params (populated by Bun routes API).
     * Query parameters are extracted separately from the URL.
     */
    /**
     * Execute route handler with parameter injection, validation, and response wrapping.
     * Called only for routes with params or response schemas (full path).
     * Simple routes use the inline fast path in createRouteHandler.
     */
    async function executeHandler(
      boundHandler: Function,
      routeMeta: RouteMetadata,
      controller: Controller,
      controllerName: string,
      sseOptions: SseDecoratorOptions | undefined,
      req: OneBunRequest,
      queryParams: Record<string, string | string[]>,
      profiler: import('../profiler').Profiler | null,
    ): Promise<Response> {
      try {
      // Prepare arguments array based on parameter metadata
        const args: unknown[] = [];

        // Sort params by index to ensure correct order
        const sortedParams = [...(routeMeta.params || [])].sort((a, b) => a.index - b.index);

        // Pre-parse body for file upload params (FormData or JSON, cached for all params)
        const needsFileData = sortedParams.some(
          (p) =>
            p.type === ParamType.FILE ||
          p.type === ParamType.FILES ||
          p.type === ParamType.FORM_FIELD,
        );

        // Validate that @Body and file decorators are not used on the same method
        if (needsFileData) {
          const hasBody = sortedParams.some((p) => p.type === ParamType.BODY);
          if (hasBody) {
            throw new HttpException(
              HttpStatusCode.BAD_REQUEST,
              'Cannot use @Body() together with @UploadedFile/@UploadedFiles/@FormField on the same method. ' +
            'Both consume the request body. Use file decorators for multipart/base64 uploads.',
            );
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let formData: any = null;
        let jsonBody: Record<string, unknown> | null = null;
        let isMultipart = false;

        if (needsFileData) {
          const contentType = req.headers.get('content-type') || '';

          if (contentType.includes('multipart/form-data')) {
            isMultipart = true;
            try {
              formData = await req.formData();
            } catch {
              formData = null;
            }
          } else if (contentType.includes('application/json')) {
            try {
              const parsed = await req.json();
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                jsonBody = parsed as Record<string, unknown>;
              }
            } catch {
              jsonBody = null;
            }
          }
        }

        let paramsMark: ProfileMark | undefined;
        if (profiler) {
          paramsMark = profiler.start('handler', 'params:extract');
        }
        for (const param of sortedParams) {
          switch (param.type) {
            case ParamType.PATH:
            // Use req.params from BunRequest (natively populated by Bun routes API)
              args[param.index] = param.name
                ? (req.params as Record<string, string>)[param.name]
                : undefined;
              break;

            case ParamType.QUERY:
              args[param.index] = param.name ? queryParams[param.name] : undefined;
              break;

            case ParamType.BODY:
              try {
                args[param.index] = await req.json();
              } catch {
                args[param.index] = undefined;
              }
              break;

            case ParamType.HEADER:
              args[param.index] = param.name ? req.headers.get(param.name) : undefined;
              break;

            case ParamType.COOKIE:
              args[param.index] = param.name ? req.cookies.get(param.name) ?? undefined : undefined;
              break;

            case ParamType.REQUEST:
              args[param.index] = req;
              break;

            case ParamType.RESPONSE:
            // For now, we don't support direct response manipulation
              args[param.index] = undefined;
              break;

            case ParamType.FILE: {
              let file: OneBunFile | undefined;

              if (isMultipart && formData && param.name) {
                const entry = formData.get(param.name);
                if (entry instanceof File) {
                  file = new OneBunFile(entry);
                }
              } else if (jsonBody && param.name) {
                file = extractFileFromJson(jsonBody, param.name);
              }

              if (file && param.fileOptions) {
                validateFile(file, param.fileOptions, param.name);
              }

              args[param.index] = file;
              break;
            }

            case ParamType.FILES: {
              let files: OneBunFile[] = [];

              if (isMultipart && formData) {
                if (param.name) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const entries: any[] = formData.getAll(param.name);
                  files = entries
                    .filter((entry: unknown): entry is File => entry instanceof File)
                    .map((f: File) => new OneBunFile(f));
                } else {
                // Get all files from all fields
                  for (const [, value] of formData.entries()) {
                    if (value instanceof File) {
                      files.push(new OneBunFile(value));
                    }
                  }
                }
              } else if (jsonBody) {
                if (param.name) {
                  const fieldValue = jsonBody[param.name];
                  if (Array.isArray(fieldValue)) {
                    files = fieldValue
                      .map((item) => extractFileFromJsonValue(item))
                      .filter((f): f is OneBunFile => f !== undefined);
                  }
                } else {
                // Extract all file-like values from JSON
                  for (const [, value] of Object.entries(jsonBody)) {
                    const file = extractFileFromJsonValue(value);
                    if (file) {
                      files.push(file);
                    }
                  }
                }
              }

              // Validate maxCount
              if (param.fileOptions?.maxCount !== undefined && files.length > param.fileOptions.maxCount) {
                throw new HttpException(
                  HttpStatusCode.BAD_REQUEST,
                  `Too many files for "${param.name || 'upload'}". Got ${files.length}, max is ${param.fileOptions.maxCount}`,
                );
              }

              // Validate each file
              if (param.fileOptions) {
                for (const file of files) {
                  validateFile(file, param.fileOptions, param.name);
                }
              }

              args[param.index] = files;
              break;
            }

            case ParamType.FORM_FIELD: {
              let value: string | undefined;

              if (isMultipart && formData && param.name) {
                const entry = formData.get(param.name);
                if (typeof entry === 'string') {
                  value = entry;
                }
              } else if (jsonBody && param.name) {
                const jsonValue = jsonBody[param.name];
                if (jsonValue !== undefined && jsonValue !== null) {
                  value = String(jsonValue);
                }
              }

              args[param.index] = value;
              break;
            }

            default:
              args[param.index] = undefined;
          }

          // Validate parameter if required
          if (param.isRequired && (args[param.index] === undefined || args[param.index] === null)) {
            throw new HttpException(HttpStatusCode.BAD_REQUEST, `Required parameter ${param.name || param.index} is missing`);
          }

          // For FILES type, also check for empty array when required
          if (
            param.isRequired &&
          param.type === ParamType.FILES &&
          Array.isArray(args[param.index]) &&
          (args[param.index] as unknown[]).length === 0
          ) {
            throw new HttpException(HttpStatusCode.BAD_REQUEST, `Required parameter ${param.name || param.index} is missing`);
          }

          // Apply arktype schema validation if provided
          if (param.schema && args[param.index] !== undefined) {
            try {
              args[param.index] = validateOrThrow(param.schema, args[param.index]);
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              throw new HttpException(
                HttpStatusCode.BAD_REQUEST,
                `Parameter ${param.name || param.index} validation failed: ${errorMessage}`,
              );
            }
          }
        }
        if (paramsMark) {
          profiler!.end(paramsMark);
        }
        // Call handler with injected parameters
        let handlerMark: ProfileMark | undefined;
        if (profiler) {
          handlerMark = profiler.start('handler', `${controllerName}.${routeMeta.handler ?? 'unknown'}`);
        }
        const result = await boundHandler(...args);
        if (handlerMark) {
          profiler!.end(handlerMark);
        }

        // Handle SSE response - wrap async generator in SSE Response
        if (sseOptions !== undefined) {
          return createSseResponseFromResult(result, sseOptions);
        }

        // Initialize variables for response validation
        let validatedResult = result;
        let responseStatusCode = HttpStatusCode.OK;

        // If the result is already a Response object, extract body and validate it
        if (result instanceof Response) {
          responseStatusCode = result.status;

          // Extract and parse response body for validation
          const contentType = result.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              // Clone response to avoid consuming the body
              const clonedResponse = result.clone();
              const bodyText = await clonedResponse.text();
              const bodyData = bodyText ? JSON.parse(bodyText) : null;

              // Validate response body if schema is provided
              if (routeMeta.responseSchemas && routeMeta.responseSchemas.length > 0) {
                const responseSchema = routeMeta.responseSchemas.find(
                  (rs) => rs.statusCode === responseStatusCode,
                ) || routeMeta.responseSchemas.find(
                  (rs) => rs.statusCode === HttpStatusCode.OK,
                ) || routeMeta.responseSchemas[0];

                if (responseSchema?.schema) {
                  try {
                    validatedResult = validateOrThrow(responseSchema.schema, stripUndefined(bodyData));
                  } catch (error) {
                    const errorMessage =
                      error instanceof Error ? error.message : String(error);
                    throw new Error(`Response validation failed: ${errorMessage}`);
                  }
                } else {
                  validatedResult = bodyData;
                }
              } else {
                validatedResult = bodyData;
              }

              // Preserve all original headers (including multiple Set-Cookie)
              // using new Headers() constructor instead of Object.fromEntries()
              // which would lose duplicate header keys
              const newHeaders = new Headers(result.headers);
              newHeaders.set('Content-Type', 'application/json');

              // Create new Response with validated data
              return new Response(JSON.stringify(validatedResult), {
                status: responseStatusCode,
                headers: newHeaders,
              });
            } catch {
              // If parsing fails, return original response
              return result;
            }
          } else {
            // For non-JSON responses, return as-is (can't validate)
            return result;
          }
        }

        // Validate response against schema if provided
        if (routeMeta.responseSchemas && routeMeta.responseSchemas.length > 0) {
          // Find matching response schema (default to 200 if not found)
          const responseSchema = routeMeta.responseSchemas.find(
            (rs) => rs.statusCode === HttpStatusCode.OK,
          ) || routeMeta.responseSchemas[0];

          if (responseSchema?.schema) {
            try {
              validatedResult = validateOrThrow(responseSchema.schema, stripUndefined(validatedResult));
              responseStatusCode = responseSchema.statusCode;
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              throw new Error(`Response validation failed: ${errorMessage}`);
            }
          }
        }

        // If the result is already in standardized format, return it as JSON
        if (
          typeof validatedResult === 'object' &&
          validatedResult !== null &&
          'success' in validatedResult
        ) {
          let serMark: ProfileMark | undefined;
          if (profiler) {
            serMark = profiler.start('framework', 'response:serialize');
          }
          const resp = new Response(JSON.stringify(validatedResult), {
            status: responseStatusCode,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
          });
          if (serMark) {
            profiler!.end(serMark);
          }

          return resp;
        }

        // Otherwise, wrap in standardized success response
        let serializeMark: ProfileMark | undefined;
        if (profiler) {
          serializeMark = profiler.start('framework', 'response:serialize');
        }
        const successResponse = createSuccessResponse(validatedResult);

        const resp = new Response(JSON.stringify(successResponse), {
          status: responseStatusCode,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
        if (serializeMark) {
          profiler!.end(serializeMark);
        }

        return resp;
      } catch (error) {
        // Run through exception filters (route → controller → global), then default
        const filters = routeMeta.filters ?? [];

        if (filters.length > 0) {
          const guardCtx = new HttpExecutionContextImpl(
            req,
            routeMeta.handler ?? '',
            controllerName,
          );

          // Last filter wins (route-level filters were appended last and take highest priority)
          return await filters[filters.length - 1].catch(error, guardCtx);
        }

        return await appDefaultExceptionFilter.catch(error, new HttpExecutionContextImpl(
          req,
          routeMeta.handler ?? '',
          controllerName,
        ));
      }
    }

    /**
     * Create SSE Response from handler result
     * Handles both async generators and already-created Responses
     */
    function createSseResponseFromResult(
      result: unknown,
      options: SseDecoratorOptions,
    ): Response {
      // If result is already a Response (e.g., from controller.sse()), return it
      if (result instanceof Response) {
        return result;
      }

      // Check if result is an async iterable (generator)
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // Apply default heartbeat if none specified to keep the connection alive
        const effectiveOptions = {
          ...options,
          heartbeat: options.heartbeat ?? DEFAULT_SSE_HEARTBEAT_MS,
        };
        const stream = createSseStream(
          result as AsyncIterable<unknown>,
          effectiveOptions,
        );

        return new Response(stream, {
          status: HttpStatusCode.OK,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'text/event-stream',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Cache-Control': 'no-cache',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Connection': 'keep-alive',
          },
        });
      }

      // Fallback: return error if result is not valid for SSE
      throw new Error(
        'SSE endpoint must return an async generator or a Response object. ' +
        'Use "async *methodName()" or return this.sse(generator).',
      );
    }
  }

  /**
   * Stop the application with graceful shutdown
   * @param options - Shutdown options
   */
  async stop(options?: { closeSharedRedis?: boolean; signal?: string }): Promise<void> {
    const closeRedis = options?.closeSharedRedis ?? true;
    const signal = options?.signal;

    this.logger.info('Stopping OneBun application...');

    // Call beforeApplicationDestroy lifecycle hook
    if (this.rootModule?.callBeforeApplicationDestroy) {
      this.logger.debug('Calling beforeApplicationDestroy hooks');
      await this.rootModule.callBeforeApplicationDestroy(signal);
    }

    // Cleanup WebSocket resources
    if (this.wsHandler) {
      this.logger.debug('Cleaning up WebSocket handler');
      await this.wsHandler.cleanup();
      this.wsHandler = null;
    }

    // Stop queue service
    if (this.queueService) {
      this.logger.debug('Stopping queue service');
      await this.queueService.stop();
      this.queueService = null;
    }
    this.queueServiceProxy?.setDelegate(null);

    // Disconnect queue adapter
    if (this.queueAdapter) {
      this.logger.debug('Disconnecting queue adapter');
      await this.queueAdapter.disconnect();
      this.queueAdapter = null;
    }

    // Stop HTTP server
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.logger.debug('HTTP server stopped');
    }

    // Shutdown trace service — flush pending spans before module destroy
    if (this.traceService?.shutdown) {
      this.logger.debug('Shutting down trace service');
      await this.traceService.shutdown();
    }

    // Call onModuleDestroy lifecycle hook
    if (this.rootModule?.callOnModuleDestroy) {
      this.logger.debug('Calling onModuleDestroy hooks');
      await this.rootModule.callOnModuleDestroy();
    }

    // Close shared Redis connection if configured and requested
    if (closeRedis && SharedRedisProvider.isConnected()) {
      this.logger.debug('Disconnecting shared Redis');
      await SharedRedisProvider.disconnect();
    }

    // Call onApplicationDestroy lifecycle hook
    if (this.rootModule?.callOnApplicationDestroy) {
      this.logger.debug('Calling onApplicationDestroy hooks');
      await this.rootModule.callOnApplicationDestroy(signal);
    }

    this.logger.info('OneBun application stopped');

    // Shutdown logger transport LAST — flush OTLP log batches after final log message
    await shutdownLogger();
  }

  /**
   * Initialize the queue system based on configuration and detected handlers
   */
  private async initializeQueue(controllers: Function[]): Promise<void> {
    const queueOptions = this.options.queue;

    // Check if any controller has queue-related decorators
    const hasQueueHandlers = controllers.some(controller => {
      const instance = this.ensureModule().getControllerInstance?.(controller);
      if (!instance) {
        return false;
      }

      return hasQueueDecorators(controller) || hasQueueDecorators(instance.constructor);
    });

    // Determine if queue should be enabled
    const shouldEnableQueue = queueOptions?.enabled ?? hasQueueHandlers;
    if (!shouldEnableQueue) {
      this.logger.debug('Queue system not enabled (no handlers detected or explicitly disabled)');

      return;
    }

    // Create the appropriate adapter
    const adapterOpt = queueOptions?.adapter ?? 'memory';

    if (typeof adapterOpt === 'function') {
      // Custom adapter constructor (e.g. NATS JetStream)
      const adapterCtor = adapterOpt;
      this.queueAdapter = new adapterCtor(queueOptions?.options);
      await this.queueAdapter.connect();
      this.logger.info(`Queue system initialized with custom adapter: ${this.queueAdapter.name}`);
    } else {
      const adapterType = adapterOpt;
      if (adapterType === 'memory') {
        this.queueAdapter = new InMemoryQueueAdapter();
        this.logger.info('Queue system initialized with in-memory adapter');
      } else if (adapterType === 'redis') {
        const redisOptions = queueOptions?.redis ?? {};
        if (redisOptions.useSharedProvider !== false) {
          // Use shared Redis provider
          this.queueAdapter = new RedisQueueAdapter({
            useSharedClient: true,
            keyPrefix: redisOptions.prefix ?? 'onebun:queue:',
          });
          this.logger.info('Queue system initialized with Redis adapter (shared provider)');
        } else if (redisOptions.url) {
          // Create dedicated Redis connection
          this.queueAdapter = new RedisQueueAdapter({
            useSharedClient: false,
            url: redisOptions.url,
            keyPrefix: redisOptions.prefix ?? 'onebun:queue:',
          });
          this.logger.info('Queue system initialized with Redis adapter (dedicated connection)');
        } else {
          throw new Error('Redis queue adapter requires either useSharedProvider: true or a url');
        }
      } else {
        throw new Error(`Unknown queue adapter type: ${adapterType}`);
      }

      // Connect the adapter
      await this.queueAdapter.connect();
    }

    // Create queue service with config
    const queueServiceConfig: QueueConfig = {
      adapter:
        typeof adapterOpt === 'function' ? this.queueAdapter.type : adapterOpt,
      options:
        typeof adapterOpt === 'function'
          ? (queueOptions?.options as Record<string, unknown> | undefined)
          : queueOptions?.redis,
    };
    this.queueService = new QueueService(queueServiceConfig);

    // Initialize with the adapter
    await this.queueService.initialize(this.queueAdapter);

    // Wire scheduler error handler so failed jobs are logged
    this.queueService.getScheduler().setErrorHandler((jobName, error) => {
      this.logger.warn(`Scheduled job "${jobName}" failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Register handlers from controllers using registerService
    for (const controllerClass of controllers) {
      const instance = this.ensureModule().getControllerInstance?.(controllerClass);
      if (!instance) {
        this.logger.debug(`Queue: skipping controller ${controllerClass.name} (no instance found)`);
        continue;
      }

      // Check both controllerClass and instance.constructor for queue decorators
      // These should be identical, but if @Controller wrapping produces a different reference,
      // we check both to be safe
      const hasDecorators =
        hasQueueDecorators(controllerClass) || hasQueueDecorators(instance.constructor);

      if (hasDecorators) {
        // Use whichever reference has the metadata for registration
        const registrationClass = hasQueueDecorators(controllerClass)
          ? controllerClass
          : instance.constructor;
        await this.queueService.registerService(
          instance,
          registrationClass as new (...args: unknown[]) => unknown,
        );
        this.logger.debug(`Registered queue handlers for controller: ${controllerClass.name}`);
      } else {
        this.logger.debug(`Queue: controller ${controllerClass.name} has no queue decorators`);
      }
    }

    // Start the queue service
    await this.queueService.start();
    this.logger.info('Queue service started');

    // Wire the real QueueService into the DI proxy so injected consumers use it
    this.queueServiceProxy?.setDelegate(this.queueService);
  }

  /**
   * Get the queue service instance
   * @returns The queue service or null if not enabled
   */
  getQueueService(): QueueService | null {
    return this.queueService;
  }

  /**
   * Initialize the documentation system (OpenAPI/Swagger)
   */
  private async initializeDocs(controllers: Function[]): Promise<void> {
    const docsOptions = this.options.docs;

    // Skip if docs are explicitly disabled or @onebun/docs is not available
    if (docsOptions?.enabled === false) {
      this.logger.debug('Documentation explicitly disabled');

      return;
    }

    if (!generateOpenApiSpec || !generateSwaggerUiHtml) {
      if (docsOptions?.enabled === true) {
        this.logger.warn(
          'Documentation enabled but @onebun/docs module not available. Install with: bun add @onebun/docs',
        );
      } else {
        this.logger.debug('@onebun/docs module not available, documentation disabled');
      }

      return;
    }

    try {
      // Generate OpenAPI spec from controllers
      this.openApiSpec = generateOpenApiSpec(controllers, {
        title: docsOptions?.title || this.options.name || 'OneBun API',
        version: docsOptions?.version || '1.0.0',
        description: docsOptions?.description,
      });

      // Add additional OpenAPI info if provided
      if (this.openApiSpec && docsOptions?.contact) {
        (this.openApiSpec.info as Record<string, unknown>).contact = docsOptions.contact;
      }
      if (this.openApiSpec && docsOptions?.license) {
        (this.openApiSpec.info as Record<string, unknown>).license = docsOptions.license;
      }
      if (this.openApiSpec && docsOptions?.externalDocs) {
        this.openApiSpec.externalDocs = docsOptions.externalDocs;
      }
      if (this.openApiSpec && docsOptions?.servers && docsOptions.servers.length > 0) {
        this.openApiSpec.servers = docsOptions.servers;
      }

      // Generate Swagger UI HTML
      const openApiPath = docsOptions?.jsonPath || '/openapi.json';
      this.swaggerHtml = generateSwaggerUiHtml(openApiPath);

      const docsPath = docsOptions?.path || '/docs';
      this.logger.info(
        `Documentation available at http://${this.options.host}:${this.options.port}${docsPath}`,
      );
      this.logger.info(
        `OpenAPI spec available at http://${this.options.host}:${this.options.port}${openApiPath}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to initialize documentation:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get the OpenAPI specification
   * @returns The OpenAPI spec or null if not generated
   */
  getOpenApiSpec(): Record<string, unknown> | null {
    return this.openApiSpec;
  }

  /**
   * Register signal handlers for graceful shutdown
   * Call this after start() to enable automatic shutdown on SIGTERM/SIGINT
   *
   * @example
   * ```typescript
   * const app = new OneBunApplication(AppModule, options);
   * await app.start();
   * app.enableGracefulShutdown();
   * ```
   */
  enableGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
      await this.stop({ signal });
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    this.logger.debug('Graceful shutdown handlers registered');
  }

  /**
   * Get the application logger
   * @returns The logger instance
   */
  getLogger(context?: Record<string, unknown>): SyncLogger {
    if (context) {
      return this.logger.child(context);
    }

    return this.logger;
  }

  /**
   * Get the actual port the server is listening on.
   * When `port: 0` is passed, the OS assigns a free port — use this method
   * to obtain the real port after `start()`.
   * @returns Actual listening port, or the configured port if not yet started
   */
  getPort(): number {
    return this.server?.port ?? this.options.port ?? 3000;
  }

  /**
   * Store a profile report and deliver it via configured channels.
   * @internal
   */
  private handleProfileReport(report: import('../profiler').ProfileReport): void {
    const maxReports = this.options.profiling?.maxReports ?? 100;
    this.profilingReports.push(report);
    if (this.profilingReports.length > maxReports) {
      this.profilingReports.shift();
    }
    if (this.options.profiling?.onProfile) {
      this.options.profiling.onProfile(report);
    }
    if (this.options.profiling?.logReport) {
      this.logger.debug('Profile report', report as unknown as Record<string, unknown>);
    }
  }

  /**
   * Get the underlying Bun server instance.
   * Use this to dispatch requests directly (bypassing the global `fetch`) e.g. in tests.
   * @internal
   */
  getServer(): ReturnType<typeof Bun.serve> | null {
    return this.server;
  }

  /**
   * Get the HTTP URL where the application is listening
   * @returns The HTTP URL
   */
  getHttpUrl(): string {
    return `http://${this.options.host ?? '0.0.0.0'}:${this.getPort()}`;
  }

  /**
   * Get a service instance by class from the module container.
   * Useful for accessing services outside of the request context.
   *
   * @param serviceClass - The service class to get
   * @returns The service instance
   * @throws Error if service is not found
   *
   * @example
   * ```typescript
   * const app = new OneBunApplication(AppModule, options);
   * await app.start();
   *
   * const userService = app.getService(UserService);
   * await userService.performBackgroundTask();
   * ```
   */
  getService<T>(serviceClass: new (...args: unknown[]) => T): T {
    if (!this.ensureModule().getServiceByClass) {
      throw new Error('Module does not support getServiceByClass');
    }

    const service = this.ensureModule().getServiceByClass!(serviceClass);
    if (!service) {
      throw new Error(
        `Service ${serviceClass.name} not found. Make sure it's registered in the module's providers.`,
      );
    }

    return service;
  }
}

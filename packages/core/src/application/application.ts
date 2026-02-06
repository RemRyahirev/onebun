import { Effect, type Layer } from 'effect';

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
  type SyncLogger,
} from '@onebun/logger';
import {
  type ApiResponse,
  createErrorResponse,
  createSuccessResponse,
  HttpStatusCode,
  OneBunBaseError,
} from '@onebun/requests';
import { makeTraceService, TraceService } from '@onebun/trace';

import {
  getControllerMetadata,
  getSseMetadata,
  type SseDecoratorOptions,
} from '../decorators/decorators';
import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from '../module/config.interface';
import { ConfigServiceImpl } from '../module/config.service';
import { createSseStream } from '../module/controller';
import { OneBunModule } from '../module/module';
import { QueueService, type QueueAdapter } from '../queue';
import { InMemoryQueueAdapter } from '../queue/adapters/memory.adapter';
import { RedisQueueAdapter } from '../queue/adapters/redis.adapter';
import { hasQueueDecorators } from '../queue/decorators';
import { SharedRedisProvider } from '../redis/shared-redis';
import {
  type ApplicationOptions,
  type HttpMethod,
  type ModuleInstance,
  type ParamMetadata,
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

// Import tracing modules directly

// Global trace context for current request
let globalCurrentTraceContext: unknown = null;

// Helper function to clear trace context
function clearGlobalTraceContext(): void {
  globalCurrentTraceContext = null;
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
function normalizePath(path: string): string {
  if (path === '/' || path.length <= 1) {
    return path;
  }

  return path.endsWith('/') ? path.slice(0, -1) : path;
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

/**
 * OneBun Application
 */
export class OneBunApplication {
  private rootModule: ModuleInstance;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private options: ApplicationOptions;
  private logger: SyncLogger;
  private config: IConfig<OneBunAppConfig>;
  private configService: ConfigServiceImpl | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metricsService: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private traceService: any = null;
  private wsHandler: WsHandler | null = null;
  private queueService: QueueService | null = null;
  private queueAdapter: QueueAdapter | null = null;
  // Docs (OpenAPI/Swagger) - generated on start()
  private openApiSpec: Record<string, unknown> | null = null;
  private swaggerHtml: string | null = null;

  /**
   * Create application instance
   */
  constructor(
    moduleClass: new (...args: unknown[]) => object,
    options?: Partial<ApplicationOptions>,
  ) {
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
    const loggerLayer = this.options.loggerLayer
      ?? (this.options.loggerOptions
        ? makeLoggerFromOptions(this.options.loggerOptions)
        : makeLogger());

    // Initialize logger with application class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (logger: Logger) =>
          logger.child({ className: 'OneBunApplication' }),
        ),
        loggerLayer,
      ),
    ) as Logger;
    this.logger = createSyncLogger(effectLogger);

    // Create configuration service if config is initialized
    if (this.config.isInitialized || !(this.config instanceof NotInitializedConfig)) {
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

    // Initialize tracing if enabled
    if (this.options.tracing?.enabled !== false) {
      try {
        this.logger.debug('Attempting to initialize trace service');
        this.logger.debug('Tracing options:', this.options.tracing);

        const traceLayer = makeTraceService(this.options.tracing || {});
        this.traceService = Effect.runSync(Effect.provide(TraceService, traceLayer));

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

    // Create the root module with logger layer and config
    this.rootModule = OneBunModule.create(moduleClass, loggerLayer, this.config);
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
  getConfigValue<P extends DeepPaths<OneBunAppConfig>>(path: P): DeepValue<OneBunAppConfig, P>;
  /** Fallback for dynamic paths */
  getConfigValue<T = unknown>(path: string): T;
  getConfigValue(path: string): unknown {
    return this.getConfig().get(path);
  }

  /**
   * Get root module layer
   */
  getLayer(): Layer.Layer<never, never, unknown> {
    return this.rootModule.getLayer();
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
    try {
      // Initialize configuration if schema was provided
      if (!(this.config instanceof NotInitializedConfig)) {
        await this.config.initialize();
        this.logger.info('Application configuration initialized');
      }

      // Start metrics collection if enabled
      if (this.metricsService && this.metricsService.startSystemMetricsCollection) {
        this.metricsService.startSystemMetricsCollection();
        this.logger.info('System metrics collection started');
      }

      // Setup the module and create controller instances
      await Effect.runPromise(this.rootModule.setup() as Effect.Effect<unknown, never, never>);

      // Get all controllers from the root module
      const controllers = this.rootModule.getControllers();
      this.logger.debug(`Loaded ${controllers.length} controllers`);

      // Initialize WebSocket handler and detect gateways
      this.wsHandler = new WsHandler(this.logger, this.options.websocket);
      
      // Register WebSocket gateways (they are in controllers array but decorated with @WebSocketGateway)
      for (const controllerClass of controllers) {
        if (isWebSocketGateway(controllerClass)) {
          const instance = this.rootModule.getControllerInstance?.(controllerClass);
          if (instance) {
            this.wsHandler.registerGateway(controllerClass, instance as import('../websocket/ws-base-gateway').BaseWebSocketGateway);
            this.logger.info(`Registered WebSocket gateway: ${controllerClass.name}`);
          }
        }
      }

      // Initialize Queue system if configured or handlers exist
      await this.initializeQueue(controllers);

      // Initialize Docs (OpenAPI/Swagger) if enabled and available
      await this.initializeDocs(controllers);

      // Create a map of routes with metadata
      const routes = new Map<
        string,
        {
          method: string;
          handler: Function;
          handlerName: string;
          controller: Controller;
          params?: ParamMetadata[];
          middleware?: Function[];
          pathPattern?: RegExp;
          pathParams?: string[];
          responseSchemas?: RouteMetadata['responseSchemas'];
        }
      >();

      // Build application-level path prefix from options
      const appPrefix = this.buildPathPrefix();

      // Add routes from controllers
      for (const controllerClass of controllers) {
        const controllerMetadata = getControllerMetadata(controllerClass);
        if (!controllerMetadata) {
          this.logger.warn(`No metadata found for controller: ${controllerClass.name}`);
          continue;
        }

        // Get controller instance from module
        if (!this.rootModule.getControllerInstance) {
          this.logger.warn(
            `Module does not support getControllerInstance for ${controllerClass.name}`,
          );
          continue;
        }

        const controller = this.rootModule.getControllerInstance(controllerClass) as Controller;
        if (!controller) {
          this.logger.warn(`Controller instance not found for ${controllerClass.name}`);
          continue;
        }

        const controllerPath = controllerMetadata.path;

        for (const route of controllerMetadata.routes) {
          // Combine: appPrefix + controllerPath + routePath
          // Normalize to ensure consistent matching (e.g., '/api/users/' -> '/api/users')
          const fullPath = normalizePath(`${appPrefix}${controllerPath}${route.path}`);
          const method = this.mapHttpMethod(route.method);
          const handler = (controller as unknown as Record<string, Function>)[route.handler].bind(
            controller,
          );

          // Process path parameters
          const pathParams: string[] = [];
          let pathPattern: RegExp | undefined;

          // Check if path contains parameters like :id
          if (fullPath.includes(':')) {
            // Convert path to regex pattern
            const pattern = fullPath.replace(/:([^/]+)/g, (_, paramName) => {
              pathParams.push(paramName);

              return '([^/]+)';
            });
            pathPattern = new RegExp(`^${pattern}$`);
          }

          // Use method and path as key to avoid conflicts between different HTTP methods
          const _routeKey = `${method}:${fullPath}`;
          routes.set(_routeKey, {
            method,
            handler,
            handlerName: route.handler,
            controller,
            params: route.params,
            middleware: route.middleware,
            pathPattern,
            pathParams,
            responseSchemas: route.responseSchemas,
          });
        }
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
      if (this.rootModule.callOnApplicationInit) {
        await this.rootModule.callOnApplicationInit();
        this.logger.debug('Application initialization hooks completed');
      }

      // Get metrics path
      const metricsPath = this.options.metrics?.path || '/metrics';

      // Get docs paths
      const docsPath = this.options.docs?.path || '/docs';
      const openApiPath = this.options.docs?.jsonPath || '/openapi.json';

      // Create server with proper context binding
      const app = this;
      const hasWebSocketGateways = this.wsHandler?.hasGateways() ?? false;
      
      // Prepare WebSocket handlers if gateways exist
      // When no gateways, use no-op handlers (required by Bun.serve)
      const wsHandlers = hasWebSocketGateways ? this.wsHandler!.createWebSocketHandlers() : {
         
        open() { /* no-op */ },
         
        message() { /* no-op */ },
         
        close() { /* no-op */ },
         
        drain() { /* no-op */ },
      };
      
      this.server = Bun.serve<WsClientData>({
        port: this.options.port,
        hostname: this.options.host,
        // WebSocket handlers
        websocket: wsHandlers,
        async fetch(req, server) {
          const url = new URL(req.url);
          const rawPath = url.pathname;
          // Normalize path to ensure consistent routing and metrics
          // (removes trailing slash except for root path)
          const path = normalizePath(rawPath);
          const method = req.method;
          const startTime = Date.now();

          // Handle WebSocket upgrade if gateways exist
          if (hasWebSocketGateways && app.wsHandler) {
            const upgradeHeader = req.headers.get('upgrade')?.toLowerCase();
            const socketioEnabled = app.options.websocket?.socketio?.enabled ?? false;
            const socketioPath = app.options.websocket?.socketio?.path ?? '/socket.io';

            const isSocketIoPath = socketioEnabled && path.startsWith(socketioPath);
            if (upgradeHeader === 'websocket' || isSocketIoPath) {
              const response = await app.wsHandler.handleUpgrade(req, server);
              if (response === undefined) {
                return undefined; // Successfully upgraded
              }

              return response;
            }
          }

          // Setup tracing context if available and enabled
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let traceSpan: any = null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let traceContext: any = null;

          if (app.traceService && app.options.tracing?.traceHttpRequests !== false) {
            try {
              // Extract trace headers
              const headers = Object.fromEntries(req.headers.entries());
              const traceHeaders = {
                traceparent: headers.traceparent,
                tracestate: headers.tracestate,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'x-trace-id': headers['x-trace-id'],
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'x-span-id': headers['x-span-id'],
              };

              // Extract or generate trace context
              const extractedContext = await Effect.runPromise(
                app.traceService.extractFromHeaders(traceHeaders),
              );

              if (extractedContext) {
                traceContext = extractedContext;
                await Effect.runPromise(app.traceService.setContext(extractedContext));
              } else {
                // Generate new trace context
                traceContext = await Effect.runPromise(app.traceService.generateTraceContext());
                await Effect.runPromise(app.traceService.setContext(traceContext));
              }

              // Start HTTP trace span
              const httpData = {
                method,
                url: req.url,
                route: path,
                userAgent: headers['user-agent'],
                remoteAddr: headers['x-forwarded-for'] || headers['x-real-ip'],
                requestSize: headers['content-length']
                  ? parseInt(headers['content-length'], 10)
                  : undefined,
              };

              traceSpan = await Effect.runPromise(app.traceService.startHttpTrace(httpData));

              // Set global trace context for this request
              globalCurrentTraceContext = {
                traceId: traceContext.traceId,
                spanId: traceContext.spanId,
                parentSpanId: traceContext.parentSpanId,
              };

              // Also set it globally for logger
              if (typeof globalThis !== 'undefined') {
                (globalThis as Record<string, unknown>).__onebunCurrentTraceContext =
                  globalCurrentTraceContext;
              }

              // Propagate trace context to logger
              // Note: FiberRef.set should be used within Effect context
            } catch (error) {
              app.logger.error(
                'Failed to setup tracing:',
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          }

          // Handle docs endpoints (OpenAPI/Swagger)
          if (app.options.docs?.enabled !== false && app.openApiSpec) {
            // Serve Swagger UI HTML
            if (path === docsPath && method === 'GET' && app.swaggerHtml) {
              return new Response(app.swaggerHtml, {
                headers: {
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'Content-Type': 'text/html; charset=utf-8',
                },
              });
            }

            // Serve OpenAPI JSON spec
            if (path === openApiPath && method === 'GET') {
              return new Response(JSON.stringify(app.openApiSpec, null, 2), {
                headers: {
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'Content-Type': 'application/json',
                },
              });
            }
          }

          // Handle metrics endpoint
          if (path === metricsPath && method === 'GET' && app.metricsService) {
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
          }

          // Find exact match first using method and path
          const exactRouteKey = `${method}:${path}`;
          let route = routes.get(exactRouteKey);
          const paramValues: Record<string, string | string[]> = {};

          // Extract query parameters from URL
          for (const [rawKey, value] of url.searchParams.entries()) {
            // Handle array notation: tag[] -> tag (as array)
            const isArrayNotation = rawKey.endsWith('[]');
            const key = isArrayNotation ? rawKey.replace('[]', '') : rawKey;

            const existing = paramValues[key];
            if (existing !== undefined) {
              // Handle multiple values with same key (e.g., ?tag=a&tag=b or ?tag[]=a&tag[]=b)
              paramValues[key] = Array.isArray(existing)
                ? [...existing, value]
                : [existing, value];
            } else if (isArrayNotation) {
              // Array notation always creates an array, even with single value
              paramValues[key] = [value];
            } else {
              paramValues[key] = value;
            }
          }

          // If no exact match, try pattern matching
          if (!route) {
            for (const [_routeKey, routeData] of routes) {
              // Check if this route matches the method and has a pattern
              if (routeData.pathPattern && routeData.method === method) {
                const match = path.match(routeData.pathPattern);
                if (match) {
                  route = routeData;
                  // Extract parameter values
                  for (let i = 0; i < routeData.pathParams!.length; i++) {
                    paramValues[routeData.pathParams![i]] = match[i + 1];
                  }
                  break;
                }
              }
            }
          }

          if (!route) {
            const response = new Response('Not Found', {
              status: HttpStatusCode.NOT_FOUND,
            });
            const duration = Date.now() - startTime;

            // Record metrics for 404
            if (app.metricsService && app.metricsService.recordHttpRequest) {
              const durationSeconds = duration / 1000;
              app.metricsService.recordHttpRequest({
                method,
                route: path,
                statusCode: HttpStatusCode.NOT_FOUND,
                duration: durationSeconds,
                controller: 'unknown',
                action: 'unknown',
              });
            }

            // End trace for 404
            if (traceSpan && app.traceService) {
              try {
                await Effect.runPromise(
                  app.traceService.endHttpTrace(traceSpan, {
                    statusCode: HttpStatusCode.NOT_FOUND,
                    duration,
                  }),
                );
              } catch (traceError) {
                app.logger.error(
                  'Failed to end trace for 404:',
                  traceError instanceof Error ? traceError : new Error(String(traceError)),
                );
              }
            }

            // Clear trace context after 404
            clearGlobalTraceContext();

            return response;
          }

          try {
            // Execute middleware if any
            if (route.middleware && route.middleware.length > 0) {
              const next = async (index: number): Promise<Response> => {
                if (index >= route!.middleware!.length) {
                  return await executeHandler(route!, req, paramValues);
                }

                const middleware = route!.middleware![index];

                return await middleware(req, () => next(index + 1));
              };

              const response = await next(0);
              const duration = Date.now() - startTime;

              // Record metrics
              if (app.metricsService && app.metricsService.recordHttpRequest) {
                const durationSeconds = duration / 1000;
                app.metricsService.recordHttpRequest({
                  method,
                  route: path,
                  statusCode: response?.status || HttpStatusCode.OK,
                  duration: durationSeconds,
                  controller: route.controller.constructor.name,
                  action: 'unknown',
                });
              }

              // End trace
              if (traceSpan && app.traceService) {
                try {
                  await Effect.runPromise(
                    app.traceService.endHttpTrace(traceSpan, {
                      statusCode: response?.status || HttpStatusCode.OK,
                      responseSize: response?.headers?.get('content-length')
                        ? parseInt(response.headers.get('content-length')!, 10)
                        : undefined,
                      duration,
                    }),
                  );
                } catch (traceError) {
                  app.logger.error(
                    'Failed to end trace:',
                    traceError instanceof Error ? traceError : new Error(String(traceError)),
                  );
                }
              }

              // Clear trace context after request
              clearGlobalTraceContext();

              return response;
            } else {
              const response = await executeHandler(route, req, paramValues);
              const duration = Date.now() - startTime;

              // Record metrics
              if (app.metricsService && app.metricsService.recordHttpRequest) {
                const durationSeconds = duration / 1000;
                app.metricsService.recordHttpRequest({
                  method,
                  route: path,
                  statusCode: response?.status || HttpStatusCode.OK,
                  duration: durationSeconds,
                  controller: route.controller.constructor.name,
                  action: 'unknown',
                });
              }

              // End trace
              if (traceSpan && app.traceService) {
                try {
                  await Effect.runPromise(
                    app.traceService.endHttpTrace(traceSpan, {
                      statusCode: response?.status || HttpStatusCode.OK,
                      responseSize: response?.headers?.get('content-length')
                        ? parseInt(response.headers.get('content-length')!, 10)
                        : undefined,
                      duration,
                    }),
                  );
                } catch (traceError) {
                  app.logger.error(
                    'Failed to end trace:',
                    traceError instanceof Error ? traceError : new Error(String(traceError)),
                  );
                }
              }

              // Clear trace context after request
              clearGlobalTraceContext();

              return response;
            }
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
                route: path,
                statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                duration: durationSeconds,
                controller: route?.controller.constructor.name || 'unknown',
                action: 'unknown',
              });
            }

            // End trace with error
            if (traceSpan && app.traceService) {
              try {
                await Effect.runPromise(
                  app.traceService.addEvent('error', {
                    errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                    errorMessage: error instanceof Error ? error.message : String(error),
                  }),
                );
                await Effect.runPromise(
                  app.traceService.endHttpTrace(traceSpan, {
                    statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                    duration,
                  }),
                );
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
     * Execute route handler with parameter injection and validation
     */
    async function executeHandler(
      route: {
        handler: Function;
        handlerName?: string;
        controller: Controller;
        params?: ParamMetadata[];
        responseSchemas?: RouteMetadata['responseSchemas'];
      },
      req: Request,
      paramValues: Record<string, string | string[]>,
    ): Promise<Response> {
      // Check if this is an SSE endpoint
      let sseOptions: SseDecoratorOptions | undefined;
      if (route.handlerName) {
        sseOptions = getSseMetadata(Object.getPrototypeOf(route.controller), route.handlerName);
      }

      // If no parameter metadata, just call the handler with the request
      if (!route.params || route.params.length === 0) {
        const result = await route.handler(req);

        // Handle SSE response
        if (sseOptions !== undefined) {
          return createSseResponseFromResult(result, sseOptions);
        }

        return result;
      }

      // Prepare arguments array based on parameter metadata
      const args: unknown[] = [];

      // Sort params by index to ensure correct order
      const sortedParams = [...(route.params || [])].sort((a, b) => a.index - b.index);

      for (const param of sortedParams) {
        switch (param.type) {
          case ParamType.PATH:
            args[param.index] = param.name ? paramValues[param.name] : undefined;
            break;

          case ParamType.QUERY:
            args[param.index] = param.name ? paramValues[param.name] : undefined;
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

          case ParamType.REQUEST:
            args[param.index] = req;
            break;

          case ParamType.RESPONSE:
            // For now, we don't support direct response manipulation
            args[param.index] = undefined;
            break;

          default:
            args[param.index] = undefined;
        }

        // Validate parameter if required
        if (param.isRequired && (args[param.index] === undefined || args[param.index] === null)) {
          throw new Error(`Required parameter ${param.name || param.index} is missing`);
        }

        // Apply arktype schema validation if provided
        if (param.schema && args[param.index] !== undefined) {
          try {
            args[param.index] = validateOrThrow(param.schema, args[param.index]);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `Parameter ${param.name || param.index} validation failed: ${errorMessage}`,
            );
          }
        }
      }

      try {
        // Call handler with injected parameters
        const result = await route.handler(...args);

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
          const responseHeaders = Object.fromEntries(result.headers.entries());

          // Extract and parse response body for validation
          const contentType = result.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              // Clone response to avoid consuming the body
              const clonedResponse = result.clone();
              const bodyText = await clonedResponse.text();
              const bodyData = bodyText ? JSON.parse(bodyText) : null;

              // Validate response body if schema is provided
              if (route.responseSchemas && route.responseSchemas.length > 0) {
                const responseSchema = route.responseSchemas.find(
                  (rs) => rs.statusCode === responseStatusCode,
                ) || route.responseSchemas.find(
                  (rs) => rs.statusCode === HttpStatusCode.OK,
                ) || route.responseSchemas[0];

                if (responseSchema?.schema) {
                  try {
                    validatedResult = validateOrThrow(responseSchema.schema, bodyData);
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

              // Create new Response with validated data
              return new Response(JSON.stringify(validatedResult), {
                status: responseStatusCode,
                headers: {
                  ...responseHeaders,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'Content-Type': 'application/json',
                },
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
        if (route.responseSchemas && route.responseSchemas.length > 0) {
          // Find matching response schema (default to 200 if not found)
          const responseSchema = route.responseSchemas.find(
            (rs) => rs.statusCode === HttpStatusCode.OK,
          ) || route.responseSchemas[0];

          if (responseSchema?.schema) {
            try {
              validatedResult = validateOrThrow(responseSchema.schema, validatedResult);
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
          return new Response(JSON.stringify(validatedResult), {
            status: responseStatusCode,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
          });
        }

        // Otherwise, wrap in standardized success response
        const successResponse = createSuccessResponse(validatedResult);

        return new Response(JSON.stringify(successResponse), {
          status: responseStatusCode,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        // Convert any thrown errors to standardized error response
        let errorResponse: ApiResponse<never>;

        if (error instanceof OneBunBaseError) {
          errorResponse = error.toErrorResponse();
        } else {
          const message = error instanceof Error ? error.message : String(error);
          const code =
            error instanceof Error && 'code' in error
              ? Number((error as { code: unknown }).code)
              : HttpStatusCode.INTERNAL_SERVER_ERROR;
          errorResponse = createErrorResponse(message, code, message, undefined, {
            originalErrorName: error instanceof Error ? error.name : 'UnknownError',
            stack: error instanceof Error ? error.stack : undefined,
          });
        }

        // Always return 200 for consistency with API response format
        return new Response(JSON.stringify(errorResponse), {
          status: HttpStatusCode.OK,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
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
        const stream = createSseStream(
          result as AsyncIterable<unknown>,
          options,
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
    if (this.rootModule.callBeforeApplicationDestroy) {
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

    // Call onModuleDestroy lifecycle hook
    if (this.rootModule.callOnModuleDestroy) {
      this.logger.debug('Calling onModuleDestroy hooks');
      await this.rootModule.callOnModuleDestroy();
    }

    // Close shared Redis connection if configured and requested
    if (closeRedis && SharedRedisProvider.isConnected()) {
      this.logger.debug('Disconnecting shared Redis');
      await SharedRedisProvider.disconnect();
    }

    // Call onApplicationDestroy lifecycle hook
    if (this.rootModule.callOnApplicationDestroy) {
      this.logger.debug('Calling onApplicationDestroy hooks');
      await this.rootModule.callOnApplicationDestroy(signal);
    }

    this.logger.info('OneBun application stopped');
  }

  /**
   * Initialize the queue system based on configuration and detected handlers
   */
  private async initializeQueue(controllers: Function[]): Promise<void> {
    const queueOptions = this.options.queue;
    
    // Check if any controller has queue-related decorators
    const hasQueueHandlers = controllers.some(controller => {
      const instance = this.rootModule.getControllerInstance?.(controller);
      if (!instance) {
        return false;
      }

      return hasQueueDecorators(instance.constructor);
    });

    // Determine if queue should be enabled
    const shouldEnableQueue = queueOptions?.enabled ?? hasQueueHandlers;
    if (!shouldEnableQueue) {
      this.logger.debug('Queue system not enabled (no handlers detected or explicitly disabled)');

      return;
    }

    // Create the appropriate adapter
    const adapterType = queueOptions?.adapter ?? 'memory';
    
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

    // Create queue service with config
    this.queueService = new QueueService({
      adapter: adapterType,
      options: queueOptions?.redis,
    });
    
    // Initialize with the adapter
    await this.queueService.initialize(this.queueAdapter);

    // Register handlers from controllers using registerService
    for (const controllerClass of controllers) {
      const instance = this.rootModule.getControllerInstance?.(controllerClass);
      if (!instance) {
        continue;
      }
      
      // Only register if the controller has queue decorators
      if (hasQueueDecorators(controllerClass)) {
        await this.queueService.registerService(
          instance,
          controllerClass as new (...args: unknown[]) => unknown,
        );
        this.logger.debug(`Registered queue handlers for controller: ${controllerClass.name}`);
      }
    }

    // Start the queue service
    await this.queueService.start();
    this.logger.info('Queue service started');
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
   * Get the HTTP URL where the application is listening
   * @returns The HTTP URL
   */
  getHttpUrl(): string {
    return `http://${this.options.host}:${this.options.port}`;
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
    if (!this.rootModule.getServiceByClass) {
      throw new Error('Module does not support getServiceByClass');
    }

    const service = this.rootModule.getServiceByClass(serviceClass);
    if (!service) {
      throw new Error(
        `Service ${serviceClass.name} not found. Make sure it's registered in the module's providers.`,
      );
    }

    return service;
  }
}

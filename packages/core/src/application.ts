import { Effect, Layer, pipe } from 'effect';
import { getControllerMetadata } from './decorators';
import { OneBunModule } from './module';
import { ApplicationOptions, HttpMethod, Module, ParamType, ParamMetadata } from './types';
import { Controller } from './controller';
import { Logger, SyncLogger, LoggerService, makeLogger, createSyncLogger } from '@onebun/logger';
import { TypedEnv } from '@onebun/envs';
import { ConfigServiceImpl } from './config.service';

// Conditionally import metrics
let MetricsService: any;
let createMetricsService: any;
let HttpMetricsData: any;

try {
  const metricsModule = require('@onebun/metrics');
  MetricsService = metricsModule.MetricsService;
  createMetricsService = metricsModule.createMetricsService;
  HttpMetricsData = metricsModule.HttpMetricsData;
} catch (error) {
  // Metrics module not available - this is optional
  // console.warn('Metrics module not available');
}

/**
 * OneBun Application
 */
export class OneBunApplication {
  private rootModule: Module;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private options: ApplicationOptions = {
    port: 3000,
    host: '0.0.0.0',
    development: process.env.NODE_ENV !== 'production'
  };
  private logger: SyncLogger;
  private config: any = null;
  private configService: ConfigServiceImpl | null = null;
  private metricsService: any = null;

  /**
   * Create application instance
   */
  constructor(moduleClass: new (...args: unknown[]) => object, options?: Partial<ApplicationOptions>) {
    if (options) {
      this.options = { ...this.options, ...options };
    }

    // Initialize configuration if schema is provided
    if (this.options.envSchema) {
      this.config = TypedEnv.create(this.options.envSchema, this.options.envOptions);
    }

    // Use provided logger layer or create a default one
    const loggerLayer = this.options.loggerLayer || makeLogger();

    // Initialize logger with application class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(
          LoggerService,
          (logger: Logger) => logger.child({ className: 'OneBunApplication' })
        ),
        loggerLayer
      ) as any
    ) as Logger;
    this.logger = createSyncLogger(effectLogger);

    // Create configuration service if config is available
    if (this.config) {
      this.configService = new ConfigServiceImpl(this.logger, this.config);
    }

    // Initialize metrics if enabled and available
    if (this.options.metrics?.enabled !== false && createMetricsService) {
      try {
        this.logger.info('Attempting to initialize metrics service');
        this.logger.debug('Metrics options:', this.options.metrics);
        
        this.metricsService = Effect.runSync(
          createMetricsService(this.options.metrics || {})
        );
        
        this.logger.debug('Metrics service Effect run successfully');
        
        // Make metrics service globally available (temporary solution)
        if (typeof globalThis !== 'undefined') {
          (globalThis as any).__onebunMetricsService = this.metricsService;
        }
        
        this.logger.info('Metrics service initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize metrics service:', error instanceof Error ? error : new Error(String(error)));
        this.logger.debug('Full error details:', { error, stack: error instanceof Error ? error.stack : 'No stack' });
      }
    } else if (this.options.metrics?.enabled !== false) {
      this.logger.debug('createMetricsService not available, metrics will be disabled');
    }

    // Create the root module with logger layer and config
    this.rootModule = OneBunModule.create(moduleClass, loggerLayer, this.config);
  }

  /**
   * Get configuration service
   */
  getConfig(): ConfigServiceImpl {
    if (!this.configService) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }
    return this.configService;
  }

  /**
   * Get configuration value by path (convenience method)
   */
  getConfigValue<T = any>(path: string): T {
    return this.getConfig().get<T>(path);
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
   * Start the application
   * This method now handles all the Effect.js calls internally
   */
  async start(): Promise<void> {
    try {
      // Initialize configuration if provided
      if (this.config) {
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
      this.logger.info(`Loaded ${controllers.length} controllers`);

      // Create a map of routes with metadata
      const routes = new Map<string, {
        method: string,
        handler: Function,
        controller: Controller,
        params?: ParamMetadata[],
        middleware?: Function[],
        pathPattern?: RegExp,
        pathParams?: string[]
      }>();

      // Add routes from controllers
      for (const ControllerClass of controllers) {
        const controllerMetadata = getControllerMetadata(ControllerClass);
        if (!controllerMetadata) {
          this.logger.warn(`No metadata found for controller: ${ControllerClass.name}`);
          continue;
        }

        // Get controller instance from module
        if (!this.rootModule.getControllerInstance) {
          this.logger.warn(`Module does not support getControllerInstance for ${ControllerClass.name}`);
          continue;
        }

        const controller = this.rootModule.getControllerInstance(ControllerClass);
        if (!controller) {
          this.logger.warn(`Controller instance not found for ${ControllerClass.name}`);
          continue;
        }

        const basePath = controllerMetadata.path;

        for (const route of controllerMetadata.routes) {
          const fullPath = `${basePath}${route.path}`;
          const method = this.mapHttpMethod(route.method);
          const handler = (controller as any)[route.handler].bind(controller);

          // Process path parameters
          const pathParams: string[] = [];
          let pathPattern: RegExp | undefined = undefined;

          // Check if path contains parameters like :id
          if (fullPath.includes(':')) {
            // Convert path to regex pattern
            const pattern = fullPath.replace(
              /:([^/]+)/g,
              (_, paramName) => {
                pathParams.push(paramName);
                return '([^/]+)';
              }
            );
            pathPattern = new RegExp(`^${pattern}$`);
          }


          routes.set(fullPath, {
            method,
            handler,
            controller,
            params: route.params,
            middleware: route.middleware,
            pathPattern,
            pathParams
          });
        }
      }

      // Log all routes
      for (const ControllerClass of controllers) {
        const metadata = getControllerMetadata(ControllerClass);
        if (!metadata) continue;

        for (const route of metadata.routes) {
          const fullPath = `${metadata.path}${route.path}`;
          const method = this.mapHttpMethod(route.method);
          this.logger.info(`Mapped {${method}} route: ${fullPath}`);
        }
      }

      // Get metrics path
      const metricsPath = this.options.metrics?.path || '/metrics';

      // Create server with proper context binding
      const app = this;
      this.server = Bun.serve({
        port: this.options.port,
        hostname: this.options.host,
        async fetch(req) {
          const url = new URL(req.url);
          const path = url.pathname;
          const method = req.method;
          const startTime = Date.now();

          // Handle metrics endpoint
          if (path === metricsPath && method === 'GET' && app.metricsService) {
            try {
              const metrics = await app.metricsService.getMetrics();
              return new Response(metrics, {
                headers: {
                  'Content-Type': app.metricsService.getContentType()
                }
              });
            } catch (error) {
              console.error('Failed to get metrics:', error);
              return new Response('Internal Server Error', { status: 500 });
            }
          }

          // Find exact match first
          let route = routes.get(path);
          let paramValues: Record<string, string | string[]> = {};

          // If no exact match, try pattern matching
          if (!route) {
            for (const [routePath, routeData] of routes) {
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

          if (!route || route.method !== method) {
            const response = new Response('Not Found', { status: 404 });
            
            // Record metrics for 404
            if (app.metricsService && app.metricsService.recordHttpRequest) {
              const duration = (Date.now() - startTime) / 1000;
              app.metricsService.recordHttpRequest({
                method: method,
                route: path,
                statusCode: 404,
                duration,
                controller: 'unknown',
                action: 'unknown'
              });
            }
            
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
              
              // Record metrics
              if (app.metricsService && app.metricsService.recordHttpRequest) {
                const duration = (Date.now() - startTime) / 1000;
                app.metricsService.recordHttpRequest({
                  method: method,
                  route: path,
                  statusCode: response.status,
                  duration,
                  controller: route.controller.constructor.name,
                  action: 'unknown'
                });
              }
              
              return response;
            } else {
              const response = await executeHandler(route, req, paramValues);
              
              // Record metrics
              if (app.metricsService && app.metricsService.recordHttpRequest) {
                const duration = (Date.now() - startTime) / 1000;
                app.metricsService.recordHttpRequest({
                  method: method,
                  route: path,
                  statusCode: response.status,
                  duration,
                  controller: route.controller.constructor.name,
                  action: 'unknown'
                });
              }
              
              return response;
            }
          } catch (error) {
            console.error('Request handling error:', error);
            const response = new Response('Internal Server Error', { status: 500 });
            
                         // Record error metrics
             if (app.metricsService && app.metricsService.recordHttpRequest) {
               const duration = (Date.now() - startTime) / 1000;
               app.metricsService.recordHttpRequest({
                method: method,
                route: path,
                statusCode: 500,
                duration,
                controller: route.controller.constructor.name,
                action: 'unknown'
              });
            }
            
            return response;
           }
         }
       });

      this.logger.info(`Server started on http://${this.options.host}:${this.options.port}`);
      if (this.metricsService) {
        this.logger.info(`Metrics available at http://${this.options.host}:${this.options.port}${metricsPath}`);
      } else if (this.options.metrics?.enabled !== false) {
        this.logger.warn('Metrics enabled but @onebun/metrics module not available. Install with: bun add @onebun/metrics');
      }
    } catch (error) {
      this.logger.error('Failed to start application:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    /**
     * Execute route handler with parameter injection
     */
    async function executeHandler(
      route: { handler: Function, controller: Controller, params?: ParamMetadata[] },
      req: Request,
      paramValues: Record<string, string | string[]>
    ): Promise<Response> {
      // If no parameter metadata, just call the handler with the request
      if (!route.params || route.params.length === 0) {
        return await route.handler(req);
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
            } catch (e: unknown) {
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

        // Apply validator if provided
        if (param.validator && args[param.index] !== undefined) {
          const isValid = await param.validator(args[param.index]);
          if (!isValid) {
            throw new Error(`Parameter ${param.name || param.index} failed validation`);
          }
        }
      }

      try {
        // Call handler with injected parameters
        return await route.handler(...args);
      } catch (error) {
        // Convert any thrown errors to standardized error response
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof Error && 'code' in error ? Number((error as any).code) : 500;

        return route.controller.error(message, code, code);
      }
    }
  }

  /**
   * Stop the application
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.logger.info('OneBun application stopped');
    }
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
}

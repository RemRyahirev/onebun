import { Effect, Layer, pipe } from 'effect';
import { getControllerMetadata } from './decorators';
import { OneBunModule } from './module';
import { ApplicationOptions, HttpMethod, Module, ParamType, ParamMetadata } from './types';
import { Controller } from './controller';

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

  /**
   * Create application instance
   */
  constructor(moduleClass: new (...args: unknown[]) => object, options?: Partial<ApplicationOptions>) {
    this.rootModule = OneBunModule.create(moduleClass);

    if (options) {
      this.options = { ...this.options, ...options };
    }
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
      // Setup the module and create controller instances
      await Effect.runPromise(this.rootModule.setup() as Effect.Effect<unknown, never, never>);

      // Get all controllers from the root module
      const controllers = this.rootModule.getControllers();
      console.log(`Loaded ${controllers.length} controllers`);

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
        console.log(`Processing controller: ${ControllerClass.name}`);

        // Log controller details for debugging
        console.log(`Controller constructor: ${ControllerClass.constructor?.name || 'undefined'}`);
        console.log(`Controller prototype: ${Object.getPrototypeOf(ControllerClass)?.name || 'undefined'}`);

        const controllerMetadata = getControllerMetadata(ControllerClass);
        if (!controllerMetadata) {
          console.warn(`No metadata found for controller: ${ControllerClass.name}`);
          continue;
        }
        console.log(`Found metadata for controller: ${ControllerClass.name}, path: ${controllerMetadata.path}, routes: ${controllerMetadata.routes.length}`);

        // Get controller instance from module
        if (!this.rootModule.getControllerInstance) {
          console.warn(`Module does not support getControllerInstance for ${ControllerClass.name}`);
          continue;
        }

        console.log(`Getting controller instance for ${ControllerClass.name}`);
        const controller = this.rootModule.getControllerInstance(ControllerClass);
        if (!controller) {
          console.warn(`Controller instance not found for ${ControllerClass.name}`);
          continue;
        }
        console.log(`Got controller instance for ${ControllerClass.name}`);

        // Check if controller has metadata after getting instance
        const controllerMetadataAfterInstance = getControllerMetadata(ControllerClass);
        if (controllerMetadataAfterInstance) {
          console.log(`Found metadata for controller ${ControllerClass.name} after getting instance, routes: ${controllerMetadataAfterInstance.routes.length}`);
        } else {
          console.warn(`No metadata found for controller ${ControllerClass.name} after getting instance`);
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

          console.log(`Registering route: ${method} ${fullPath}`);
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
          console.log(`Mapped {${method}} route: ${fullPath}`);
        }
      }

      // Create server
      this.server = Bun.serve({
        port: this.options.port,
        hostname: this.options.host,
        async fetch(req) {
          const url = new URL(req.url);
          const path = url.pathname;
          const method = req.method;

          console.log(`Request: ${method} ${path}`);

          // First try exact path match
          let route = routes.get(path);
          let pathValues: string[] = [];

          // If no exact match, try regex patterns for path params
          if (!route) {
            for (const [routePath, routeData] of routes.entries()) {
              if (routeData.pathPattern) {
                const match = path.match(routeData.pathPattern);
                if (match) {
                  route = routeData;
                  // Extract path parameter values (skip the first element which is the full match)
                  pathValues = match.slice(1);
                  break;
                }
              }
            }
          }

          if (route && (route.method === method || route.method === HttpMethod.ALL)) {
            try {
              // Create parameter values object
              const paramValues: Record<string, string | string[]> = {};

              // Process path parameters
              if (route.pathParams && route.pathParams.length > 0) {
                route.pathParams.forEach((paramName, index) => {
                  paramValues[paramName] = pathValues[index];
                });
              }

              // Process query parameters
              for (const [key, value] of url.searchParams.entries()) {
                paramValues[key] = value;
              }

              // Apply middleware if any
              if (route.middleware && route.middleware.length > 0) {
                let currentIndex = 0;

                // Create next function for middleware chain
                const next = async (index: number): Promise<Response> => {
                  if (index >= (route?.middleware?.length || 0)) {
                    // All middleware executed, call the handler
                    return await executeHandler(route!, req, paramValues);
                  }

                  // Execute current middleware
                  const middleware = route!.middleware![index];
                  return await middleware(req, () => next(index + 1));
                };

                // Start middleware chain
                return await next(0);
              }

              // No middleware, directly execute handler
              return await executeHandler(route, req, paramValues);
            } catch (error: unknown) {
              // Use standardized error response format
              return new Response(
                JSON.stringify({
                  success: false,
                  code: 500,
                  message: error instanceof Error ? error.message : String(error)
                }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
              );
            }
          }

          // Use standardized error response format for 404
          return new Response(
            JSON.stringify({ success: false, code: 404, message: 'Not Found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }
      });

      console.log(`OneBun application listening on http://${this.options.host}:${this.options.port}`);
    } catch (error) {
      console.error('Failed to start application:', error);
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
      console.log('OneBun application stopped');
    }
  }
}

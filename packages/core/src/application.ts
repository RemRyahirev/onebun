import { Context, Effect, Layer, pipe, Console } from 'effect';
import { getControllerMetadata } from './decorators';
import { OneBunModule } from './module';
import { ApplicationOptions, HttpMethod, Module } from './types';

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
  constructor(moduleClass: any, options?: Partial<ApplicationOptions>) {
    this.rootModule = OneBunModule.create(moduleClass);
    
    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * Get root module layer
   */
  getLayer(): Layer.Layer<any> {
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
   */
  start(): Effect.Effect<void, Error> {
    const app = this; // Store reference to this for closure

    // Get all controllers from the root module
    const controllers = app.rootModule.getControllers();
    console.log(`Loaded ${controllers.length} controllers`);
    
    // Create a map of routes
    const routes = new Map<string, { method: string, handler: Function }>();
    
    // Add routes from controllers
    for (const ControllerClass of controllers) {
      const controllerMetadata = getControllerMetadata(ControllerClass);
      console.log('Controller metadata:', controllerMetadata);
      if (!controllerMetadata) continue;
      
      const controller = new ControllerClass();
      const basePath = controllerMetadata.path;
      
      for (const route of controllerMetadata.routes) {
        const fullPath = `${basePath}${route.path}`;
        const method = app.mapHttpMethod(route.method);
        const handler = controller[route.handler].bind(controller);
        
        console.log(`Registering route: ${method} ${fullPath}`);
        routes.set(fullPath, { method, handler });
      }
    }

    // Log all routes
    const logRoutes = pipe(
      controllers,
      Effect.forEach((ControllerClass) => {
        const metadata = getControllerMetadata(ControllerClass);
        if (!metadata) return Effect.succeed(undefined);
        
        return pipe(
          metadata.routes,
          Effect.forEach((route) => {
            const fullPath = `${metadata.path}${route.path}`;
            const method = app.mapHttpMethod(route.method);
            return Effect.log(`Mapped {${method}} route: ${fullPath}`);
          })
        );
      })
    );
    
    // Create server
    const createServer = Effect.sync(() => {
      app.server = Bun.serve({
        port: app.options.port,
        hostname: app.options.host,
        async fetch(req) {
          const url = new URL(req.url);
          const path = url.pathname;
          const method = req.method;
          
          console.log(`Request: ${method} ${path}`);
          console.log('Available routes:', Array.from(routes.keys()));
          
          const route = routes.get(path);
          if (route && (route.method === method || route.method === HttpMethod.ALL)) {
            try {
              return await route.handler(req);
            } catch (error) {
              return new Response(
                JSON.stringify({ error: (error as Error).message }), 
                { status: 500, headers: { 'Content-Type': 'application/json' } }
              );
            }
          }
          
          return new Response('Not Found', { status: 404 });
        }
      });
    });
    
    const logStarted = Effect.log(
      `OneBun application listening on http://${app.options.host}:${app.options.port}`
    );
    
    return pipe(
      logRoutes,
      Effect.flatMap(() => createServer),
      Effect.flatMap(() => logStarted),
      Effect.map(() => undefined)
    );
  }

  /**
   * Stop the application
   */
  stop(): Effect.Effect<void> {
    return pipe(
      Effect.sync(() => {
        if (this.server) {
          this.server.stop();
          this.server = null;
          console.log('OneBun application stopped');
        }
      })
    );
  }
} 
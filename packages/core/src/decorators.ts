import { Reflect } from './metadata';
import { ControllerMetadata, HttpMethod, RouteMetadata, ParamType, ParamMetadata } from './types';

/**
 * Metadata storage for controllers
 */
const META_CONTROLLERS = new Map<Function, ControllerMetadata>();

/**
 * Controller decorator
 * @param basePath Base path for all routes in controller
 */
export function ControllerDecorator(basePath: string = '') {
  return function<T extends new (...args: any[]) => any>(target: T): T {
    console.log(`Applying ControllerDecorator to ${target.name} with path: ${basePath}`);

    // Log target details for debugging
    console.log(`Target constructor: ${target.constructor?.name || 'undefined'}`);
    console.log(`Target prototype: ${Object.getPrototypeOf(target)?.name || 'undefined'}`);

    const metadata: ControllerMetadata = {
      path: basePath.startsWith('/') ? basePath : `/${basePath}`,
      routes: []
    };

    // Check if there's already metadata for this controller
    const existingMetadata = META_CONTROLLERS.get(target);
    if (existingMetadata) {
      console.log(`Found existing metadata for ${target.name}, routes: ${existingMetadata.routes.length}`);
      // Preserve existing routes if any
      metadata.routes = existingMetadata.routes;
    }

    META_CONTROLLERS.set(target, metadata);
    console.log(`Stored metadata for ${target.name}, META_CONTROLLERS size: ${META_CONTROLLERS.size}`);

    // Log all keys in META_CONTROLLERS for debugging
    console.log(`META_CONTROLLERS keys after storing: ${Array.from(META_CONTROLLERS.keys()).map(k => k.name).join(', ')}`);

    return target;
  };
}

// Алиас для обратной совместимости
export const Controller = ControllerDecorator;

/**
 * Get controller metadata
 */
export function getControllerMetadata(target: Function): ControllerMetadata | undefined {
  console.log(`Getting metadata for ${target.name}, META_CONTROLLERS size: ${META_CONTROLLERS.size}`);

  // Log all keys in META_CONTROLLERS for debugging
  console.log(`META_CONTROLLERS keys: ${Array.from(META_CONTROLLERS.keys()).map(k => k.name).join(', ')}`);

  const metadata = META_CONTROLLERS.get(target);
  if (metadata) {
    console.log(`Found metadata for ${target.name}, path: ${metadata.path}, routes: ${metadata.routes.length}`);
  } else {
    console.warn(`No metadata found for ${target.name}`);
  }
  return metadata;
}

/**
 * Metadata key for parameters
 */
const PARAMS_METADATA = 'onebun:params';

/**
 * Metadata key for middleware
 */
const MIDDLEWARE_METADATA = 'onebun:middleware';

/**
 * Base route decorator factory
 */
function createRouteDecorator(method: HttpMethod) {
  return function(path: string = '') {
    return function(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
      const controllerClass = target.constructor as Function;
      console.log(`Applying route decorator ${method} to ${controllerClass.name}.${propertyKey} with path: ${path}`);

      // Get existing metadata or create a new one
      let metadata = META_CONTROLLERS.get(controllerClass);

      // If no metadata exists, create a default one
      if (!metadata) {
        console.log(`No metadata found for ${controllerClass.name}, creating default metadata`);
        metadata = {
          path: '/',
          routes: []
        };
      }

      const routePath = path.startsWith('/') ? path : `/${path}`;

      // Get parameter metadata if exists
      const params: ParamMetadata[] = Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

      // Get middleware metadata if exists
      const middleware: Function[] = Reflect.getMetadata(MIDDLEWARE_METADATA, target, propertyKey) || [];

      metadata.routes.push({
        path: routePath,
        method,
        handler: propertyKey,
        params,
        middleware
      });

      META_CONTROLLERS.set(controllerClass, metadata);
      console.log(`Added route ${method} ${routePath} to ${controllerClass.name}, total routes: ${metadata.routes.length}`);
      return descriptor;
    };
  };
}

/**
 * Create parameter decorator factory
 */
function createParamDecorator(type: ParamType) {
  return function(name?: string, options: { required?: boolean, validator?: (value: unknown) => boolean | Promise<boolean> } = {}) {
    return function(target: object, propertyKey: string, parameterIndex: number) {
      const params: ParamMetadata[] = Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

      params.push({
        type,
        name: name || '',
        index: parameterIndex,
        isRequired: options.required,
        validator: options.validator
      });

      Reflect.defineMetadata(PARAMS_METADATA, params, target, propertyKey);
    };
  };
}

/**
 * Path parameter decorator
 * @example @Param('id')
 */
export const Param = createParamDecorator(ParamType.PATH);

/**
 * Query parameter decorator
 * @example @Query('filter')
 */
export const Query = createParamDecorator(ParamType.QUERY);

/**
 * Body parameter decorator
 * @example @Body()
 */
export const Body = createParamDecorator(ParamType.BODY);

/**
 * Header parameter decorator
 * @example @Header('Authorization')
 */
export const Header = createParamDecorator(ParamType.HEADER);

/**
 * Request object decorator
 * @example @Req()
 */
export const Req = createParamDecorator(ParamType.REQUEST);

/**
 * Response object decorator
 * @example @Res()
 */
export const Res = createParamDecorator(ParamType.RESPONSE);

/**
 * Middleware decorator
 * @example @UseMiddleware(authMiddleware)
 */
export function UseMiddleware(...middleware: Function[]) {
  return function(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    const existingMiddleware: Function[] = Reflect.getMetadata(MIDDLEWARE_METADATA, target, propertyKey) || [];
    Reflect.defineMetadata(MIDDLEWARE_METADATA, [...existingMiddleware, ...middleware], target, propertyKey);
    return descriptor;
  };
}

/**
 * HTTP GET decorator
 */
export const Get = createRouteDecorator(HttpMethod.GET);

/**
 * HTTP POST decorator
 */
export const Post = createRouteDecorator(HttpMethod.POST);

/**
 * HTTP PUT decorator
 */
export const Put = createRouteDecorator(HttpMethod.PUT);

/**
 * HTTP DELETE decorator
 */
export const Delete = createRouteDecorator(HttpMethod.DELETE);

/**
 * HTTP PATCH decorator
 */
export const Patch = createRouteDecorator(HttpMethod.PATCH);

/**
 * HTTP OPTIONS decorator
 */
export const Options = createRouteDecorator(HttpMethod.OPTIONS);

/**
 * HTTP HEAD decorator
 */
export const Head = createRouteDecorator(HttpMethod.HEAD);

/**
 * All HTTP methods decorator
 */
export const All = createRouteDecorator(HttpMethod.ALL);

/**
 * Module decorator metadata
 */
const META_MODULES = new Map<Function, { imports?: Function[], controllers?: Function[], providers?: unknown[], exports?: unknown[] }>();

/**
 * Module decorator
 */
export function Module(options: {
  imports?: Function[],
  controllers?: Function[],
  providers?: unknown[],
  exports?: unknown[]
}) {
  return function<T extends new (...args: any[]) => any>(target: T): T {
    console.log(`Applying Module decorator to ${target.name}`);
    console.log(`Module options: imports: ${options.imports?.length || 0}, controllers: ${options.controllers?.length || 0}, providers: ${options.providers?.length || 0}, exports: ${options.exports?.length || 0}`);

    if (options.controllers) {
      for (const controller of options.controllers) {
        console.log(`Module ${target.name} includes controller: ${controller.name}`);
      }
    }

    META_MODULES.set(target, options);
    console.log(`Stored module metadata for ${target.name}`);
    return target;
  };
}

/**
 * Get module metadata
 */
export function getModuleMetadata(target: Function): { imports?: Function[], controllers?: Function[], providers?: unknown[], exports?: unknown[] } | undefined {
  console.log(`Getting module metadata for ${target.name}`);
  const metadata = META_MODULES.get(target);
  if (metadata) {
    console.log(`Found module metadata for ${target.name}, controllers: ${metadata.controllers?.length || 0}, providers: ${metadata.providers?.length || 0}`);
    if (metadata.controllers) {
      for (const controller of metadata.controllers) {
        console.log(`Module ${target.name} includes controller: ${controller.name}`);
      }
    }
  } else {
    console.warn(`No module metadata found for ${target.name}`);
  }
  return metadata;
}

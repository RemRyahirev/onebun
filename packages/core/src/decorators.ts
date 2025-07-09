import './metadata'; // Import polyfill first
import { Reflect, getConstructorParamTypes as getDesignParamTypes } from './metadata';
import {
  ControllerMetadata,
  HttpMethod,
  RouteMetadata,
  ParamType,
  ParamMetadata,
} from './types';

/**
 * Metadata storage for controllers
 */
const META_CONTROLLERS = new Map<Function, ControllerMetadata>();

/**
 * Metadata storage for automatically detected constructor parameters
 */
const META_CONSTRUCTOR_PARAMS = new Map<Function, Function[]>();

/**
 * Injectable decorator for controllers and services
 * This decorator enables automatic dependency injection by registering the class for DI
 */
export function Injectable() {
  return function<T extends new (...args: any[]) => any>(target: T): T {
    // The class is now marked as injectable
    return target;
  };
}

/**
 * Automatic dependency detection through smart constructor analysis
 * This function analyzes constructor parameters and matches them with available services
 */
function autoDetectDependencies(target: Function, availableServices: Map<string, Function>): Function[] {
  // First, try to get types from TypeScript's design:paramtypes
  const designTypes = getDesignParamTypes(target);
  if (designTypes && designTypes.length > 0) {
    return designTypes;
  }
  
  // Fallback: analyze constructor source code
  const constructorStr = target.toString();
  const constructorMatch = constructorStr.match(/constructor\s*\(([^)]*)\)/);
  
  if (!constructorMatch || !constructorMatch[1]) {
    return [];
  }

  const paramsStr = constructorMatch[1];
  const params = paramsStr.split(',').map(p => p.trim());
  const dependencies: Function[] = [];

  for (const param of params) {
    // Skip logger and config parameters
    if (param.includes('logger') || param.includes('config')) {
      continue;
    }

    // Try to extract type information
    // Look for patterns like: "private counterService: CounterService"
    const typeMatch = param.match(/:\s*([A-Za-z][A-Za-z0-9]*)/);
    if (typeMatch) {
      const typeName = typeMatch[1];
      const serviceType = availableServices.get(typeName);
      
      if (serviceType) {
        dependencies.push(serviceType);
      }
    } else {
      // Try to guess from parameter name
      const paramNameMatch = param.match(/([a-zA-Z][a-zA-Z0-9]*)/);
      if (paramNameMatch) {
        const paramName = paramNameMatch[1];
        
        // Convert camelCase service name to PascalCase class name
        // e.g., counterService -> CounterService
        const guessedTypeName = paramName
          .replace(/Service$/, '') // Remove Service suffix if present
          .replace(/^[a-z]/, c => c.toUpperCase()) + 'Service';
        
        const serviceType = availableServices.get(guessedTypeName);
        if (serviceType) {
          dependencies.push(serviceType);
        }
      }
    }
  }

  return dependencies;
}

/**
 * Register dependencies for a controller automatically
 */
export function registerControllerDependencies(target: Function, availableServices: Map<string, Function>): void {
  const dependencies = autoDetectDependencies(target, availableServices);
  
  if (dependencies.length > 0) {
    META_CONSTRUCTOR_PARAMS.set(target, dependencies);
  }
}

/**
 * Get constructor parameter types (automatically detected or explicitly set)
 */
export function getConstructorParamTypes(target: Function): Function[] | undefined {
  return META_CONSTRUCTOR_PARAMS.get(target);
}

/**
 * Hidden decorator to force TypeScript to emit design:paramtypes
 * This is the key to making automatic dependency injection work
 */
function ForceMetadataEmission(target: any, propertyKey?: string, parameterIndex?: number) {
  // This decorator exists only to trigger TypeScript's emitDecoratorMetadata
  // When applied to constructor parameters, TypeScript will emit design:paramtypes
}

/**
 * Controller decorator with automatic dependency detection
 * @param basePath Base path for all routes in controller
 */
export function ControllerDecorator(basePath: string = '') {
  return function<T extends new (...args: any[]) => any>(target: T): T {
    const metadata: ControllerMetadata = {
      path: basePath.startsWith('/') ? basePath : `/${basePath}`,
      routes: [],
    };

    // Check if there's already metadata for this controller
    const existingMetadata = META_CONTROLLERS.get(target);
    if (existingMetadata) {
      // Preserve existing routes if any
      metadata.routes = existingMetadata.routes;
    }

    META_CONTROLLERS.set(target, metadata);

    // Mark controller as injectable automatically
    Injectable()(target);

    return target;
  };
}

/**
 * Decorator for explicit dependency injection (for complex cases)
 * Usage: constructor(@Inject(CounterService) private counterService: CounterService)
 */
export function Inject<T>(type: new (...args: any[]) => T) {
  return function(target: any, propertyKey: string | symbol | undefined, parameterIndex: number): void {
    // Get existing dependencies or create new array
    const existingDeps = META_CONSTRUCTOR_PARAMS.get(target) || [];
    
    // Ensure array is large enough
    while (existingDeps.length <= parameterIndex) {
      existingDeps.push(undefined as any);
    }
    
    // Set the explicit type
    existingDeps[parameterIndex] = type;
    META_CONSTRUCTOR_PARAMS.set(target, existingDeps);
  };
}

/**
 * Register dependencies manually (fallback method)
 */
export function registerDependencies(target: Function, dependencies: Function[]): void {
  META_CONSTRUCTOR_PARAMS.set(target, dependencies);
}

// Алиас для обратной совместимости
export const Controller = ControllerDecorator;

/**
 * Get controller metadata
 */
export function getControllerMetadata(target: Function): ControllerMetadata | undefined {
  const metadata = META_CONTROLLERS.get(target);

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

      // Get existing metadata or create a new one
      let metadata = META_CONTROLLERS.get(controllerClass);

      // If no metadata exists, create a default one
      if (!metadata) {
        metadata = {
          path: '/',
          routes: [],
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
        middleware,
      });

      META_CONTROLLERS.set(controllerClass, metadata);

      return descriptor;
    };
  };
}

/**
 * Create parameter decorator factory
 */
function createParamDecorator(type: ParamType) {
  return function(name?: string, options: { required?: boolean; validator?: (value: unknown) => boolean | Promise<boolean> } = {}) {
    return function(target: object, propertyKey: string, parameterIndex: number) {
      const params: ParamMetadata[] = Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

      params.push({
        type,
        name: name || '',
        index: parameterIndex,
        isRequired: options.required,
        validator: options.validator,
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
const META_MODULES = new Map<Function, { imports?: Function[]; controllers?: Function[]; providers?: unknown[]; exports?: unknown[] }>();

/**
 * Module decorator
 */
export function Module(options: {
  imports?: Function[];
  controllers?: Function[];
  providers?: unknown[];
  exports?: unknown[];
}) {
  return function<T extends new (...args: any[]) => any>(target: T): T {
    META_MODULES.set(target, options);

    return target;
  };
}

/**
 * Get module metadata
 */
export function getModuleMetadata(target: Function): { imports?: Function[]; controllers?: Function[]; providers?: unknown[]; exports?: unknown[] } | undefined {
  const metadata = META_MODULES.get(target);

  return metadata;
}

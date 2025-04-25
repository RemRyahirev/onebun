import 'reflect-metadata';
import { ControllerMetadata, HttpMethod, RouteMetadata } from './types';

/**
 * Metadata storage for controllers
 */
const META_CONTROLLERS = new Map<any, ControllerMetadata>();

/**
 * Controller decorator
 * @param basePath Base path for all routes in controller
 */
export function ControllerDecorator(basePath: string = '') {
  return function(target: any) {
    const metadata: ControllerMetadata = {
      path: basePath.startsWith('/') ? basePath : `/${basePath}`,
      routes: []
    };
    
    META_CONTROLLERS.set(target, metadata);
    return target;
  };
}

// Алиас для обратной совместимости
export const Controller = ControllerDecorator;

/**
 * Get controller metadata
 */
export function getControllerMetadata(target: any): ControllerMetadata | undefined {
  return META_CONTROLLERS.get(target);
}

/**
 * Base route decorator factory
 */
function createRouteDecorator(method: HttpMethod) {
  return function(path: string = '') {
    return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
      const controllerClass = target.constructor;
      const metadata = META_CONTROLLERS.get(controllerClass) || {
        path: '/',
        routes: []
      };
      
      const routePath = path.startsWith('/') ? path : `/${path}`;
      
      metadata.routes.push({
        path: routePath,
        method,
        handler: propertyKey
      });
      
      META_CONTROLLERS.set(controllerClass, metadata);
      return descriptor;
    };
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
const META_MODULES = new Map<any, any>();

/**
 * Module decorator
 */
export function Module(options: {
  imports?: any[],
  controllers?: any[],
  providers?: any[],
  exports?: any[]
}) {
  return function(target: any) {
    META_MODULES.set(target, options);
    return target;
  };
}

/**
 * Get module metadata
 */
export function getModuleMetadata(target: any): any {
  return META_MODULES.get(target);
} 
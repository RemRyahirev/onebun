import './metadata'; // Import polyfill first
import type { Type } from 'arktype';

import {
  type ControllerMetadata,
  HttpMethod,
  type ParamMetadata,
  ParamType,
} from '../types';

import { getConstructorParamTypes as getDesignParamTypes, Reflect } from './metadata';

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
export function injectable() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends new (...args: any[]) => any>(target: T): T => {
    // The class is now marked as injectable
    return target;
  };
}

/**
 * Automatic dependency detection through smart constructor analysis
 * This function analyzes constructor parameters and matches them with available services
 */
export function autoDetectDependencies(
  target: Function,
  availableServices: Map<string, Function>,
): Function[] {
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
  const params = paramsStr.split(',').map((p) => p.trim());
  const dependencies: Function[] = [];

  for (const param of params) {
    // Skip logger and config parameters
    if (param.includes('logger') || param.includes('config')) {
      continue;
    }

    // Try to extract type information
    // Look for patterns like: "private counterService: CounterService"
    // or "drizzleService" (just the name)
    const typeMatch = param.match(/:\s*([A-Za-z][A-Za-z0-9]*)/);
    if (typeMatch) {
      const typeName = typeMatch[1];
      const serviceType = availableServices.get(typeName);

      if (serviceType) {
        dependencies.push(serviceType);
      }
    }

    // Always try to guess from parameter name as well
    const paramNameMatch = param.match(/([a-zA-Z][a-zA-Z0-9]*)/);
    if (paramNameMatch) {
      const paramName = paramNameMatch[1];

      // Convert camelCase service name to PascalCase class name
      // e.g., drizzleService -> DrizzleService
      let guessedTypeName = paramName;

      // If it ends with Service, capitalize first letter
      if (paramName.endsWith('Service')) {
        guessedTypeName = paramName.replace(/^[a-z]/, (c) => c.toUpperCase());
      } else {
        // Add Service suffix and capitalize
        guessedTypeName =
          paramName.replace(/^[a-z]/, (c) => c.toUpperCase()) + 'Service';
      }

      const serviceType = availableServices.get(guessedTypeName);
      if (serviceType && !dependencies.includes(serviceType)) {
        dependencies.push(serviceType);
      }
    }
  }

  return dependencies;
}

/**
 * Register dependencies for a controller automatically
 */
export function registerControllerDependencies(
  target: Function,
  availableServices: Map<string, Function>,
): void {
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function forceMetadataEmission(
  _target: unknown,
  _propertyKey?: string,
  _parameterIndex?: number,
): void {
  // This decorator exists only to trigger TypeScript's emitDecoratorMetadata
  // When applied to constructor parameters, TypeScript will emit design:paramtypes
}

/**
 * Controller decorator with automatic dependency detection and constructor wrapping
 * @param basePath - Base path for all routes in controller
 */
export function controllerDecorator(basePath: string = '') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends new (...args: any[]) => any>(target: T): T => {
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

    // Create wrapped controller class that automatically handles constructor arguments
    class WrappedController extends target {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-useless-constructor
      constructor(...allArgs: any[]) {
        // Pass all arguments to the parent constructor
        // The module will provide [dependency1, dependency2, ..., logger, config]
        // The parent class needs all these arguments to work correctly
        super(...allArgs);
      }
    }

    // Copy metadata and static properties
    META_CONTROLLERS.set(WrappedController, metadata);
    META_CONTROLLERS.set(target, metadata); // Keep original for compatibility

    // Copy static properties if they exist
    Object.setPrototypeOf(WrappedController, target);
    Object.defineProperty(WrappedController, 'name', {
      value: target.name,
      configurable: true,
    });

    // Mark controller as injectable automatically
    injectable()(WrappedController);

    return WrappedController as T;
  };
}

/**
 * Decorator for explicit dependency injection (for complex cases)
 * Usage: constructor(\@Inject(CounterService) private counterService: CounterService)
 */
// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
export function Inject<T>(type: new (...args: any[]) => T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number): void => {
    // Get existing dependencies or create new array
    const existingDeps = META_CONSTRUCTOR_PARAMS.get(target) || [];

    // Ensure array is large enough
    while (existingDeps.length <= parameterIndex) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Controller = controllerDecorator;

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
 * Metadata key for response schemas
 */
const RESPONSE_SCHEMAS_METADATA = 'onebun:responseSchemas';

/**
 * Base route decorator factory
 */
function createRouteDecorator(method: HttpMethod) {
  return (path: string = '') =>
    (target: object, propertyKey: string, descriptor: PropertyDescriptor) => {
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
      const params: ParamMetadata[] =
        Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

      // Get middleware metadata if exists
      const middleware: Function[] =
        Reflect.getMetadata(MIDDLEWARE_METADATA, target, propertyKey) || [];

      // Get response schemas metadata if exists
      const responseSchemas: Array<{
        statusCode: number;
        schema?: Type<unknown>;
        description?: string;
      }> = Reflect.getMetadata(RESPONSE_SCHEMAS_METADATA, target, propertyKey) || [];

      metadata.routes.push({
        path: routePath,
        method,
        handler: propertyKey,
        params,
        middleware,
        responseSchemas: responseSchemas.map((rs) => ({
          statusCode: rs.statusCode,
          schema: rs.schema,
          description: rs.description,
        })),
      });

      META_CONTROLLERS.set(controllerClass, metadata);

      return descriptor;
    };
}

/**
 * Create parameter decorator factory
 * Supports \@Body(schema), \@Query(schema), \@Param('id', schema) or \@Param('id') for simple cases
 */
function createParamDecorator(paramType: ParamType) {
  return (
    nameOrSchema?: string | Type<unknown>,
    schema?: Type<unknown>,
  ) =>
    (target: object, propertyKey: string, parameterIndex: number) => {
      const params: ParamMetadata[] =
        Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

      let metadata: ParamMetadata;

      // Helper function to check if value is an arktype schema
      const isArkTypeSchema = (value: unknown): value is Type<unknown> => {
        if (!value) {
          return false;
        }

        // ArkType schemas are functions with 'kind' property
        return (
          typeof value === 'function' &&
          ('kind' in value || 'impl' in value || typeof (value as Type<unknown>)({}) !== 'undefined')
        );
      };

      // @Body(schema) or @Query(schema) - first argument is a schema
      if (isArkTypeSchema(nameOrSchema)) {
        const schemaValue = nameOrSchema as Type<unknown>;
        metadata = {
          type: paramType,
          name: '',
          index: parameterIndex,
          schema: schemaValue,
          isRequired: true,
        };
      } else if (typeof nameOrSchema === 'string' && isArkTypeSchema(schema)) {
        // @Param('id', schema) or @Query('filter', schema)
        metadata = {
          type: paramType,
          name: nameOrSchema,
          index: parameterIndex,
          schema: schema as Type<unknown>,
          isRequired: true,
        };
      } else {
        // Simple case: @Param('id') or @Query('filter') - no schema, no validation
        const name = typeof nameOrSchema === 'string' ? nameOrSchema : '';
        metadata = {
          type: paramType,
          name,
          index: parameterIndex,
        };
      }

      params.push(metadata);

      Reflect.defineMetadata(PARAMS_METADATA, params, target, propertyKey);
    };
}

/**
 * Path parameter decorator
 * @example \@Param('id')
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Param = createParamDecorator(ParamType.PATH);

/**
 * Query parameter decorator
 * @example \@Query('filter')
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Query = createParamDecorator(ParamType.QUERY);

/**
 * Body parameter decorator
 * @example \@Body()
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Body = createParamDecorator(ParamType.BODY);

/**
 * Header parameter decorator
 * @example \@Header('Authorization')
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Header = createParamDecorator(ParamType.HEADER);

/**
 * Request object decorator
 * @example \@Req()
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Req = createParamDecorator(ParamType.REQUEST);

/**
 * Response object decorator
 * @example \@Res()
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Res = createParamDecorator(ParamType.RESPONSE);

/**
 * Middleware decorator
 * @example \@UseMiddleware(authMiddleware)
 */

export function UseMiddleware(...middleware: Function[]): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const existingMiddleware: Function[] =
      Reflect.getMetadata(MIDDLEWARE_METADATA, target, propertyKey) || [];
    Reflect.defineMetadata(
      MIDDLEWARE_METADATA,
      [...existingMiddleware, ...middleware],
      target,
      propertyKey,
    );

    return descriptor;
  };
}

/**
 * HTTP GET decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Get = createRouteDecorator(HttpMethod.GET);

/**
 * HTTP POST decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Post = createRouteDecorator(HttpMethod.POST);

/**
 * HTTP PUT decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Put = createRouteDecorator(HttpMethod.PUT);

/**
 * HTTP DELETE decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Delete = createRouteDecorator(HttpMethod.DELETE);

/**
 * HTTP PATCH decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Patch = createRouteDecorator(HttpMethod.PATCH);

/**
 * HTTP OPTIONS decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Options = createRouteDecorator(HttpMethod.OPTIONS);

/**
 * HTTP HEAD decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Head = createRouteDecorator(HttpMethod.HEAD);

/**
 * All HTTP methods decorator
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const All = createRouteDecorator(HttpMethod.ALL);

/**
 * Module decorator metadata
 */
const META_MODULES = new Map<
  Function,
  {
    imports?: Function[];
    controllers?: Function[];
    providers?: unknown[];
    exports?: unknown[];
  }
>();

/**
 * Module decorator
 */
export function Module(options: {
  imports?: Function[];
  controllers?: Function[];
  providers?: unknown[];
  exports?: unknown[];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends new (...args: any[]) => any>(target: T): T => {
    META_MODULES.set(target, options);

    return target;
  };
}

/**
 * Get module metadata
 */
export function getModuleMetadata(target: Function):
  | {
    imports?: Function[];
    controllers?: Function[];
    providers?: unknown[];
    exports?: unknown[];
  }
  | undefined {
  const metadata = META_MODULES.get(target);

  return metadata;
}

/**
 * Response schema decorator for API documentation and validation
 * @param statusCode - HTTP status code (e.g., 200, 201, 404)
 * @param options - Response schema options
 * @example
 * ```typescript
 * @Get('/users')
 * @ApiResponse(200, { schema: userSchema.array() })
 * async getUsers(): Promise<User[]> {
 *   return users;
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function ApiResponse(
  statusCode: number,
  options?: {
    schema?: Type<unknown>;
    description?: string;
  },
): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existingSchemas: Array<{
      statusCode: number;
      schema?: Type<unknown>;
      description?: string;
    }> = Reflect.getMetadata(RESPONSE_SCHEMAS_METADATA, target, propertyKey) || [];

    existingSchemas.push({
      statusCode,
      schema: options?.schema,
      description: options?.description,
    });

    Reflect.defineMetadata(RESPONSE_SCHEMAS_METADATA, existingSchemas, target, propertyKey);
  };
}

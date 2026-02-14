import './metadata'; // Import polyfill first
import { type, type Type } from 'arktype';

import {
  type ControllerMetadata,
  type FileUploadOptions,
  type FilesUploadOptions,
  HttpMethod,
  type ParamDecoratorOptions,
  type ParamMetadata,
  ParamType,
  type RouteOptions,
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
    // Extract parameter name first (before the colon, handling modifiers like private/public)
    // Pattern: "private configService: ConfigService" -> "configService"
    const paramNameMatch = param.match(/^\s*(?:private|protected|public|readonly|\s)*(\w+)/);
    if (!paramNameMatch) {
      continue;
    }
    const paramName = paramNameMatch[1];

    // Skip only if parameter name is exactly 'logger' or 'config'
    if (paramName === 'logger' || paramName === 'config') {
      continue;
    }

    // Try to extract type information
    // Look for patterns like: "private counterService: CounterService"
    const typeMatch = param.match(/:\s*([A-Za-z][A-Za-z0-9]*)/);
    if (typeMatch) {
      const typeName = typeMatch[1];

      // Skip framework types (logger, config, etc.)
      if (typeName === 'SyncLogger' || typeName === 'Logger' || typeName === 'unknown') {
        continue;
      }

      // Try to find service by exact type name
      const serviceType = availableServices.get(typeName);
      if (serviceType) {
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
 * Priority: 1) Explicit @Inject registrations, 2) TypeScript's design:paramtypes
 */
export function getConstructorParamTypes(target: Function): Function[] | undefined {
  // First check explicit @Inject registrations
  const explicitDeps = META_CONSTRUCTOR_PARAMS.get(target);
  if (explicitDeps && explicitDeps.length > 0) {
    return explicitDeps;
  }

  // Fallback to TypeScript's design:paramtypes (automatic DI)
  return getDesignParamTypes(target);
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

    // Copy design:paramtypes from original class to wrapped class
    // This enables automatic DI without @Inject when emitDecoratorMetadata is enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const designParamTypes = (globalThis as any).Reflect?.getMetadata?.('design:paramtypes', target);
    if (designParamTypes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Reflect?.defineMetadata?.('design:paramtypes', designParamTypes, WrappedController);
    }

    // Copy constructor params metadata from original class to wrapped class
    // This is needed for @Inject decorator to work correctly with @Controller wrapping
    const existingDeps = META_CONSTRUCTOR_PARAMS.get(target);
    if (existingDeps) {
      META_CONSTRUCTOR_PARAMS.set(WrappedController, existingDeps);
    }

    // Copy controller-level middleware from original class to wrapped class
    // This ensures @UseMiddleware works regardless of decorator order
    const existingControllerMiddleware: Function[] | undefined =
      Reflect.getMetadata(CONTROLLER_MIDDLEWARE_METADATA, target);
    if (existingControllerMiddleware) {
      Reflect.defineMetadata(
        CONTROLLER_MIDDLEWARE_METADATA,
        existingControllerMiddleware,
        WrappedController,
      );
    }

    return WrappedController as T;
  };
}

/**
 * Decorator for explicit dependency injection (for complex cases)
 * Usage: constructor(\@Inject(CounterService) private counterService: CounterService)
 */
// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any
export function Inject<T>(serviceType: new (...args: any[]) => T) {
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
    existingDeps[parameterIndex] = serviceType;
    META_CONSTRUCTOR_PARAMS.set(target, existingDeps);
  };
}

/**
 * Class decorator for middleware. Apply to classes that extend BaseMiddleware so that
 * TypeScript emits design:paramtypes and constructor dependencies are resolved automatically
 * by the framework (no need for @Inject on each parameter). You can still use @Inject when needed.
 *
 * @example
 * ```ts
 * @Middleware()
 * class AuthMiddleware extends BaseMiddleware {
 *   constructor(private authService: AuthService) {
 *     super();
 *   }
 *   async use(req, next) { ... }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Middleware(): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any): any => {
    injectable()(target);

    return target;
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
  return (path: string = '', options?: RouteOptions) =>
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
        ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
      });

      META_CONTROLLERS.set(controllerClass, metadata);

      return descriptor;
    };
}

/**
 * Helper function to check if a schema accepts undefined
 * Used to determine if @Body is required by default
 */
function schemaAcceptsUndefined(schema: Type<unknown>): boolean {
  return !(schema(undefined) instanceof type.errors);
}

/**
 * Helper function to check if value is an arktype schema
 */
function isArkTypeSchema(value: unknown): value is Type<unknown> {
  if (!value) {
    return false;
  }

  // ArkType schemas are functions with 'kind' property
  return (
    typeof value === 'function' &&
    ('kind' in value || 'impl' in value || typeof (value as Type<unknown>)({}) !== 'undefined')
  );
}

/**
 * Helper function to check if value is options object
 */
function isOptions(value: unknown): value is ParamDecoratorOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }
  // Options object has 'required' property or is an empty object
  const keys = Object.keys(value);

  return keys.length === 0 || keys.every((k) => k === 'required');
}

/**
 * Determine isRequired based on param type and options
 * - PATH: always true (OpenAPI spec)
 * - BODY: options?.required ?? !schemaAcceptsUndefined(schema) (determined from schema)
 * - QUERY, HEADER: options?.required ?? false (optional by default)
 */
function determineIsRequired(
  paramType: ParamType,
  schema: Type<unknown> | undefined,
  options: ParamDecoratorOptions | undefined,
): boolean {
  // PATH parameters are always required per OpenAPI spec
  if (paramType === ParamType.PATH) {
    return true;
  }

  // If options explicitly set required, use that
  if (options?.required !== undefined) {
    return options.required;
  }

  // For BODY, determine from schema
  if (paramType === ParamType.BODY && schema) {
    return !schemaAcceptsUndefined(schema);
  }

  // QUERY, HEADER are optional by default
  return false;
}

/**
 * Create parameter decorator factory
 * Supports multiple signatures:
 * - \@Param('id') - path parameter (always required)
 * - \@Query('name') - optional by default
 * - \@Query('name', { required: true }) - explicitly required
 * - \@Query('name', schema) - with validation, optional by default
 * - \@Query('name', schema, { required: true }) - with validation, explicitly required
 * - \@Body(schema) - required determined from schema
 * - \@Body(schema, { required: false }) - explicitly optional
 * - \@Header('X-Token') - optional by default
 * - \@Header('X-Token', { required: true }) - explicitly required
 */
function createParamDecorator(paramType: ParamType) {
  return (
    nameOrSchema?: string | Type<unknown> | ParamDecoratorOptions,
    schemaOrOptions?: Type<unknown> | ParamDecoratorOptions,
    options?: ParamDecoratorOptions,
  ) =>
    (target: object, propertyKey: string, parameterIndex: number) => {
      const params: ParamMetadata[] =
        Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

      let metadata: ParamMetadata;
      let name = '';
      let schema: Type<unknown> | undefined;
      let opts: ParamDecoratorOptions | undefined;

      // Parse arguments based on their types
      // Case 1: @Body(schema) or @Body(schema, options)
      if (isArkTypeSchema(nameOrSchema)) {
        schema = nameOrSchema;
        if (isOptions(schemaOrOptions)) {
          opts = schemaOrOptions;
        }
      } else if (typeof nameOrSchema === 'string' && isOptions(schemaOrOptions)) {
        // Case 2: @Query('name', options) - name + options, no schema
        name = nameOrSchema;
        opts = schemaOrOptions;
      } else if (typeof nameOrSchema === 'string' && isArkTypeSchema(schemaOrOptions)) {
        // Case 3: @Query('name', schema) or @Query('name', schema, options)
        name = nameOrSchema;
        schema = schemaOrOptions;
        if (isOptions(options)) {
          opts = options;
        }
      } else if (typeof nameOrSchema === 'string') {
        // Case 4: @Query('name') or @Body() - simple case
        name = nameOrSchema;
      } else if (isOptions(nameOrSchema)) {
        // Case 5: @Query(options) - options only (edge case)
        opts = nameOrSchema;
      }

      const isRequired = determineIsRequired(paramType, schema, opts);

      metadata = {
        type: paramType,
        name,
        index: parameterIndex,
        schema,
        isRequired,
      };

      params.push(metadata);

      Reflect.defineMetadata(PARAMS_METADATA, params, target, propertyKey);
    };
}

/**
 * Path parameter decorator
 * Path parameters are always required per OpenAPI spec
 * @example \@Param('id')
 * @example \@Param('id', idSchema) - with validation
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Param = createParamDecorator(ParamType.PATH);

/**
 * Query parameter decorator
 * Optional by default, use { required: true } for required parameters
 * @example \@Query('filter') - optional
 * @example \@Query('filter', { required: true }) - required
 * @example \@Query('filter', schema) - optional with validation
 * @example \@Query('filter', schema, { required: true }) - required with validation
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Query = createParamDecorator(ParamType.QUERY);

/**
 * Body parameter decorator
 * Required is determined from schema (accepts undefined = optional)
 * @example \@Body(schema) - required if schema doesn't accept undefined
 * @example \@Body(schema.or(type.undefined)) - optional (schema accepts undefined)
 * @example \@Body(schema, { required: false }) - explicitly optional
 * @example \@Body(schema, { required: true }) - explicitly required
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Body = createParamDecorator(ParamType.BODY);

/**
 * Header parameter decorator
 * Optional by default, use { required: true } for required parameters
 * @example \@Header('Authorization') - optional
 * @example \@Header('Authorization', { required: true }) - required
 * @example \@Header('Authorization', schema) - optional with validation
 * @example \@Header('Authorization', schema, { required: true }) - required with validation
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Header = createParamDecorator(ParamType.HEADER);

/**
 * Cookie parameter decorator.
 * Extracts a cookie value by name using BunRequest.cookies (CookieMap).
 * Optional by default, use { required: true } for required cookies.
 * @example \@Cookie('session_id') - optional
 * @example \@Cookie('session_id', { required: true }) - required
 * @example \@Cookie('session_id', schema) - optional with validation
 * @example \@Cookie('session_id', schema, { required: true }) - required with validation
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Cookie = createParamDecorator(ParamType.COOKIE);

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

// =============================================================================
// File Upload Decorators
// =============================================================================

/**
 * Single file upload decorator.
 * Extracts a single file from the request (multipart/form-data or JSON base64).
 * Required by default.
 *
 * @param fieldName - Form field name to extract file from
 * @param options - File upload options (maxSize, mimeTypes, required)
 *
 * @example \@UploadedFile('avatar')
 * @example \@UploadedFile('avatar', { maxSize: 5 * 1024 * 1024 })
 * @example \@UploadedFile('avatar', { mimeTypes: [MimeType.PNG, MimeType.JPEG] })
 * @example \@UploadedFile('avatar', { maxSize: 5 * 1024 * 1024, mimeTypes: [MimeType.ANY_IMAGE] })
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function UploadedFile(fieldName?: string, options?: FileUploadOptions): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const params: ParamMetadata[] =
      Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

    const isRequired = options?.required ?? true;

    const metadata: ParamMetadata = {
      type: ParamType.FILE,
      name: fieldName || '',
      index: parameterIndex,
      isRequired,
      fileOptions: options ? {
        maxSize: options.maxSize,
        mimeTypes: options.mimeTypes,
        required: options.required,
      } : undefined,
    };

    params.push(metadata);
    Reflect.defineMetadata(PARAMS_METADATA, params, target, propertyKey as string);
  };
}

/**
 * Multiple file upload decorator.
 * Extracts multiple files from the request (multipart/form-data or JSON base64).
 * Required by default (at least one file expected).
 *
 * @param fieldName - Form field name to extract files from. If omitted, extracts all files.
 * @param options - File upload options (maxSize, mimeTypes, maxCount, required)
 *
 * @example \@UploadedFiles('documents')
 * @example \@UploadedFiles('documents', { maxCount: 5 })
 * @example \@UploadedFiles(undefined, { maxCount: 10 }) - all files
 * @example \@UploadedFiles('images', { mimeTypes: [MimeType.ANY_IMAGE], maxSize: 10 * 1024 * 1024 })
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function UploadedFiles(fieldName?: string, options?: FilesUploadOptions): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const params: ParamMetadata[] =
      Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

    const isRequired = options?.required ?? true;

    const metadata: ParamMetadata = {
      type: ParamType.FILES,
      name: fieldName || '',
      index: parameterIndex,
      isRequired,
      fileOptions: options ? {
        maxSize: options.maxSize,
        mimeTypes: options.mimeTypes,
        required: options.required,
        maxCount: options.maxCount,
      } : undefined,
    };

    params.push(metadata);
    Reflect.defineMetadata(PARAMS_METADATA, params, target, propertyKey as string);
  };
}

/**
 * Form field decorator.
 * Extracts a non-file field from the request (multipart/form-data or JSON body).
 * Optional by default.
 *
 * @param fieldName - Form field name to extract
 * @param options - Options (required)
 *
 * @example \@FormField('name')
 * @example \@FormField('name', { required: true })
 * @example \@FormField('email')
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function FormField(fieldName: string, options?: ParamDecoratorOptions): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const params: ParamMetadata[] =
      Reflect.getMetadata(PARAMS_METADATA, target, propertyKey) || [];

    const isRequired = options?.required ?? false;

    const metadata: ParamMetadata = {
      type: ParamType.FORM_FIELD,
      name: fieldName,
      index: parameterIndex,
      isRequired,
    };

    params.push(metadata);
    Reflect.defineMetadata(PARAMS_METADATA, params, target, propertyKey as string);
  };
}

/**
 * Metadata key for controller-level middleware
 */
const CONTROLLER_MIDDLEWARE_METADATA = 'onebun:controller_middleware';

/**
 * Middleware decorator — can be applied to both controllers (class) and individual routes (method).
 *
 * Pass middleware **class constructors** (extending `BaseMiddleware`), not instances.
 * The framework instantiates them once at startup with full DI support.
 *
 * When applied to a class, the middleware is added to **every** route in that controller
 * and runs after global and module-level middleware but before route-level middleware.
 *
 * When applied to a method, the middleware runs after controller-level middleware.
 *
 * Execution order: global → controller → route → handler
 *
 * @example Class-level (all routes)
 * ```typescript
 * \@Controller('/admin')
 * \@UseMiddleware(AuthMiddleware)
 * class AdminController extends BaseController { ... }
 * ```
 *
 * @example Method-level (single route)
 * ```typescript
 * \@Post('/action')
 * \@UseMiddleware(LogMiddleware)
 * action() { ... }
 * ```
 *
 * @example Combined
 * ```typescript
 * \@Controller('/admin')
 * \@UseMiddleware(AuthMiddleware)       // runs on every route
 * class AdminController extends BaseController {
 *   \@Get('/dashboard')
 *   \@UseMiddleware(CacheMiddleware)    // runs only on this route, after auth
 *   getDashboard() { ... }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function UseMiddleware(...middleware: Function[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function useMiddlewareDecorator(...args: any[]): any {
    // ---- Class decorator: target is a constructor function ----
    if (args.length === 1 && typeof args[0] === 'function') {
      const target = args[0] as Function;
      const existing: Function[] =
        Reflect.getMetadata(CONTROLLER_MIDDLEWARE_METADATA, target) || [];
      Reflect.defineMetadata(
        CONTROLLER_MIDDLEWARE_METADATA,
        [...existing, ...middleware],
        target,
      );

      return target;
    }

    // ---- Method decorator: (target, propertyKey, descriptor) ----
    const [target, propertyKey, descriptor] = args as [
      object,
      string | symbol,
      PropertyDescriptor,
    ];
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
 * Get controller-level middleware class constructors for a controller class.
 * Returns middleware registered via @UseMiddleware() applied to the class.
 *
 * @param target - Controller class (constructor)
 * @returns Array of middleware class constructors
 */
export function getControllerMiddleware(target: Function): Function[] {
  return Reflect.getMetadata(CONTROLLER_MIDDLEWARE_METADATA, target) || [];
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

// ============================================================================
// SSE (Server-Sent Events) Decorator
// ============================================================================

/**
 * Metadata key for SSE handler configuration
 */
export const SSE_METADATA = 'onebun:sse';

/**
 * SSE decorator options
 */
export interface SseDecoratorOptions {
  /**
   * Heartbeat interval in milliseconds.
   * When set, the server will send a comment (": heartbeat\n\n")
   * at this interval to keep the connection alive.
   * @defaultValue 30000 (30 seconds) when using @Sse() decorator
   */
  heartbeat?: number;

  /**
   * Per-request idle timeout in seconds for this SSE connection.
   * Overrides the global `idleTimeout` from `ApplicationOptions`.
   * Set to 0 to disable the timeout entirely.
   * @defaultValue 600 (10 minutes) for SSE endpoints
   */
  timeout?: number;
}

/**
 * SSE (Server-Sent Events) method decorator
 *
 * Marks a controller method as an SSE endpoint. The method should be an async generator
 * that yields SseEvent objects or raw data.
 *
 * @param options - SSE configuration options
 * @returns Method decorator
 *
 * @example Simple SSE endpoint
 * ```typescript
 * @Get('/events')
 * @Sse()
 * async *events(): SseGenerator {
 *   for (let i = 0; i < 10; i++) {
 *     await Bun.sleep(1000);
 *     yield { event: 'tick', data: { count: i } };
 *   }
 * }
 * ```
 *
 * @example SSE with heartbeat for long-lived connections
 * ```typescript
 * @Get('/live')
 * @Sse({ heartbeat: 15000 })  // Send heartbeat every 15 seconds
 * async *liveUpdates(): SseGenerator {
 *   while (true) {
 *     const data = await this.dataService.waitForUpdate();
 *     yield { event: 'update', data };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Sse(options?: SseDecoratorOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(SSE_METADATA, options ?? {}, target, propertyKey as string);

    return descriptor;
  };
}

/**
 * Check if a method is marked as SSE endpoint.
 * Traverses the prototype chain so that metadata stored on the original class
 * prototype is found even when `@Controller` wraps the class.
 *
 * @param target - Controller instance or prototype
 * @param methodName - Method name
 * @returns SSE options if method is SSE endpoint, undefined otherwise
 */
export function getSseMetadata(
  target: object,
  methodName: string,
): SseDecoratorOptions | undefined {
  let proto: object | null = target;
  while (proto) {
    const metadata = Reflect.getMetadata(SSE_METADATA, proto, methodName);
    if (metadata !== undefined) {
      return metadata;
    }
    proto = Object.getPrototypeOf(proto);
  }

  return undefined;
}

/**
 * Module decorator metadata
 * Stored on globalThis via Symbol.for() to survive package duplication in node_modules.
 * When multiple copies of @onebun/core exist, they share the same metadata storage.
 */
const META_MODULES: Map<
  Function,
  {
    imports?: Function[];
    controllers?: Function[];
    providers?: unknown[];
    exports?: unknown[];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> = ((globalThis as any)[Symbol.for('onebun:meta_modules')] ??= new Map());

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
 * Storage for global modules
 * Global modules export their providers to all modules automatically.
 * Stored on globalThis via Symbol.for() to survive package duplication in node_modules.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalModules: Set<Function> = ((globalThis as any)[Symbol.for('onebun:global_modules')] ??= new Set());

/**
 * @Global() decorator - marks module as global
 * Global modules export their providers to all modules automatically without explicit import.
 * This is useful for modules that provide cross-cutting concerns like database access.
 * 
 * @example
 * ```typescript
 * @Global()
 * @Module({
 *   providers: [DrizzleService],
 *   exports: [DrizzleService],
 * })
 * export class DrizzleModule {}
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Global() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <T extends new (...args: any[]) => any>(target: T): T => {
    globalModules.add(target);

    return target;
  };
}

/**
 * Check if a module is marked as global
 * @param target - Module class to check
 * @returns true if module is marked with @Global() decorator
 */
export function isGlobalModule(target: Function): boolean {
  return globalModules.has(target);
}

/**
 * Remove module from global registry
 * Used when module opts out of global registration (e.g., isGlobal: false)
 * @param target - Module class to remove from global registry
 */
export function removeFromGlobalModules(target: Function): void {
  globalModules.delete(target);
}

/**
 * Clear all global modules (useful for testing)
 * @internal
 */
export function clearGlobalModules(): void {
  globalModules.clear();
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

import { Effect, Context, Layer } from 'effect';

/**
 * Base interface for all OneBun services
 */
export interface Service {
  readonly [key: string]: any;
}

/**
 * Module provider config
 */
export interface ModuleProviders {
  /**
   * Services to provide
   */
  providers?: Service[];
  
  /**
   * Controllers to include
   */
  controllers?: any[];
  
  /**
   * Modules to import
   */
  imports?: Module[];
  
  /**
   * Services to export to parent modules
   */
  exports?: any[];
}

/**
 * Module interface
 */
export interface Module {
  /**
   * Setup the module
   */
  setup(): Effect.Effect<void>;
  
  /**
   * Get the Layer for this module
   */
  getLayer(): Layer.Layer<any>;
  
  /**
   * Get controllers
   */
  getControllers(): any[];
}

/**
 * Application options
 */
export interface ApplicationOptions {
  /**
   * Port to listen on
   * @default 3000
   */
  port?: number;
  
  /**
   * Host to listen on
   * @default "0.0.0.0"
   */
  host?: string;
  
  /**
   * Enable development mode
   * @default false
   */
  development?: boolean;
}

/**
 * HTTP method types
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
  ALL = 'ALL'
}

/**
 * Route metadata
 */
export interface RouteMetadata {
  path: string;
  method: HttpMethod;
  handler: string;
}

/**
 * Controller metadata
 */
export interface ControllerMetadata {
  path: string;
  routes: RouteMetadata[];
} 
import { Context } from 'effect';
import { SyncLogger } from '@onebun/logger';

/**
 * Base controller class that can be extended to add common functionality
 */
export class Controller {
  // Store service instances
  private services: Map<Context.Tag<any, any>, any> = new Map();

  // Logger instance with controller class name as context
  protected logger: SyncLogger;
  // Configuration instance for accessing environment variables
  protected config: any;

  constructor(logger?: SyncLogger, config?: any) {
    // Initialize logger with controller class name as context
    const className = this.constructor.name;

    if (logger) {
      // Use provided logger and create a child with the controller class name
      this.logger = logger.child({ className });
          } else {
        // This should never happen since OneBunApplication always provides a logger
        throw new Error(`Logger is required for controller ${className}. Make sure OneBunApplication is configured correctly.`);
      }

    // Set configuration instance
    this.config = config;
  }

  /**
   * Get a service instance by tag
   * @param tag The service tag
   * @returns The service instance
   */
  protected getService<T>(tag: Context.Tag<T, T>): T;
  /**
   * Get a service instance by class
   * @param serviceClass The service class
   * @returns The service instance
   */
  protected getService<T>(serviceClass: new (...args: any[]) => T): T;
  /**
   * Implementation of getService
   */
  protected getService<T>(tagOrClass: Context.Tag<T, T> | (new (...args: any[]) => T)): T {
    let tag: Context.Tag<any, any>;

    // If it's a class, get the tag from metadata
    if (typeof tagOrClass === 'function') {
      // Import here to avoid circular dependency
      const { getServiceTag } = require('./service');
      tag = getServiceTag(tagOrClass);
    } else {
      tag = tagOrClass;
    }

    // Try to get the service by tag
    let service = this.services.get(tag);

    // If not found, try to find by Identifier
    if (!service && 'Identifier' in tag) {
      for (const [key, value] of this.services.entries()) {
        if ('Identifier' in key && key.Identifier === tag.Identifier) {
          service = value;
          break;
        }
      }
    }

    if (!service) {
      const id = 'Identifier' in tag ? tag.Identifier : (tagOrClass as any).name;
      throw new Error(`Service ${id} not found. Make sure it's registered in the module.`);
    }

    return service as T;
  }

  /**
   * Set a service instance
   * @param tag The service tag
   * @param instance The service instance
   */
  setService<T>(tag: Context.Tag<T, T>, instance: T): void {
    this.services.set(tag, instance);
  }

  /**
   * Check if request has JSON content type
   */
  protected isJson(req: Request): boolean {
    return req.headers.get('Content-Type')?.includes('application/json') ?? false;
  }

  /**
   * Parse JSON from request body
   */
  protected async parseJson<T = unknown>(req: Request): Promise<T> {
    return await req.json() as T;
  }

  /**
   * Create standardized success response
   * @param result The result data
   * @param status The HTTP status code
   * @returns A Response object
   */
  protected success<T = unknown>(result: T, status: number = 200): Response {
    return new Response(JSON.stringify({ success: true, result }), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Create standardized error response
   * @param message The error message
   * @param code The error code
   * @param status The HTTP status code
   * @returns A Response object
   */
  public error(message: string, code: number = 500, status: number = 500): Response {
    return new Response(JSON.stringify({ success: false, code, message }), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Create JSON response (legacy method, use success() instead)
   */
  protected json<T = unknown>(data: T, status: number = 200): Response {
    return this.success(data, status);
  }

  /**
   * Create text response
   */
  protected text(data: string, status: number = 200): Response {
    return new Response(data, {
      status,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
}

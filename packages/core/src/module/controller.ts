import type { IConfig, OneBunAppConfig } from './config.interface';
import type { SseEvent, SseOptions } from '../types';
import type { Context } from 'effect';

import type { SyncLogger } from '@onebun/logger';
import { HttpStatusCode } from '@onebun/requests';

/**
 * Base controller class that can be extended to add common functionality
 */
export class Controller {
  // Store service instances
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private services: Map<Context.Tag<any, any>, unknown> = new Map();

  // Logger instance with controller class name as context
  protected logger!: SyncLogger;
  // Configuration instance for accessing environment variables
  protected config!: IConfig<OneBunAppConfig>;

  /**
   * Initialize controller with logger and config (called by the framework)
   * @internal
   */
  initializeController(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    const className = this.constructor.name;

    if (logger) {
      // Use provided logger and create a child with the controller class name
      this.logger = logger.child({ className });
    } else {
      throw new Error(
        `Logger is required for controller ${className}. Make sure OneBunApplication is configured correctly.`,
      );
    }

    // Set configuration instance
    this.config = config;

    this.logger.debug(`Controller ${className} initialized`);
  }

  /**
   * Get a service instance by tag
   * @param tag - The service tag
   * @returns The service instance
   */
  protected getService<T>(tag: Context.Tag<T, T>): T;
  /**
   * Get a service instance by class
   * @param serviceClass - The service class
   * @returns The service instance
   */
  protected getService<T>(serviceClass: new (...args: unknown[]) => T): T;
  /**
   * Implementation of getService
   */
  protected getService<T>(tagOrClass: Context.Tag<T, T> | (new (...args: unknown[]) => T)): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const id = 'Identifier' in tag ? tag.Identifier : (tagOrClass as Function).name;
      throw new Error(`Service ${id} not found. Make sure it's registered in the module.`);
    }

    return service as T;
  }

  /**
   * Set a service instance
   * @param tag - The service tag
   * @param instance - The service instance
   */
  setService<T>(tag: Context.Tag<T, T>, instance: T): void {
    this.services.set(tag, instance);
  }

  /**
   * Check if request has JSON content type
   */
  protected isJson(req: Request): boolean {
    return req.headers.get('content-type')?.includes('application/json') ?? false;
  }

  /**
   * Parse JSON from request body
   */
  protected async parseJson<T = unknown>(req: Request): Promise<T> {
    return (await req.json()) as T;
  }

  /**
   * Create standardized success response
   * @param result - The result data
   * @param status - The HTTP status code
   * @returns A Response object
   */
  protected success<T = unknown>(result: T, status: number = HttpStatusCode.OK): Response {
    return new Response(JSON.stringify({ success: true, result }), {
      status,
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Create standardized error response
   * @param message - The error message
   * @param code - The error code
   * @param status - The HTTP status code
   * @returns A Response object
   */
  public error(
    message: string,
    code: number = HttpStatusCode.INTERNAL_SERVER_ERROR,
    status: number = HttpStatusCode.INTERNAL_SERVER_ERROR,
  ): Response {
    return new Response(JSON.stringify({ success: false, code, message }), {
      status,
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Create JSON response (legacy method, use success() instead)
   * @param data - The data to return
   * @param status - The HTTP status code
   * @returns A Response object
   */
  protected json<T = unknown>(data: T, status: number = HttpStatusCode.OK): Response {
    return this.success(data, status);
  }

  /**
   * Create text response
   * @param data - The text data to return
   * @param status - The HTTP status code
   * @returns A Response object
   */
  protected text(data: string, status: number = HttpStatusCode.OK): Response {
    return new Response(data, {
      status,
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'text/plain',
      },
    });
  }

  // ===========================================================================
  // SSE (Server-Sent Events) Methods
  // ===========================================================================

  /**
   * Create an SSE (Server-Sent Events) response from an async iterable
   *
   * This method provides an alternative to the @Sse() decorator for creating
   * SSE responses programmatically.
   *
   * @param source - Async iterable that yields SseEvent objects or raw data
   * @param options - SSE options (heartbeat interval, etc.)
   * @returns A Response object with SSE content type
   *
   * @example Basic usage
   * ```typescript
   * @Get('/events')
   * events(): Response {
   *   return this.sse(async function* () {
   *     for (let i = 0; i < 10; i++) {
   *       await Bun.sleep(1000);
   *       yield { event: 'tick', data: { count: i } };
   *     }
   *   }());
   * }
   * ```
   *
   * @example With heartbeat
   * ```typescript
   * @Get('/live')
   * live(): Response {
   *   const updates = this.dataService.getUpdateStream();
   *   return this.sse(updates, { heartbeat: 15000 });
   * }
   * ```
   */
  protected sse(
    source: AsyncIterable<SseEvent | unknown>,
    options: SseOptions = {},
  ): Response {
    const stream = createSseStream(source, options);

    return new Response(stream, {
      status: HttpStatusCode.OK,
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'text/event-stream',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Cache-Control': 'no-cache',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Connection': 'keep-alive',
      },
    });
  }
}

// =============================================================================
// SSE Helper Functions (used by both Controller.sse() and executeHandler)
// =============================================================================

/**
 * Format an event object into SSE wire format
 *
 * @param event - Event object or raw data
 * @returns Formatted SSE string
 *
 * @example
 * ```typescript
 * formatSseEvent({ event: 'update', data: { count: 1 }, id: '123' })
 * // Returns: "event: update\nid: 123\ndata: {"count":1}\n\n"
 *
 * formatSseEvent({ count: 1 })
 * // Returns: "data: {"count":1}\n\n"
 * ```
 */
export function formatSseEvent(event: SseEvent | unknown): string {
  let result = '';

  // Check if this is an SseEvent object or raw data
  const isSseEvent =
    typeof event === 'object' &&
    event !== null &&
    'data' in event &&
    (('event' in event && typeof (event as SseEvent).event === 'string') ||
      ('id' in event && typeof (event as SseEvent).id === 'string') ||
      ('retry' in event && typeof (event as SseEvent).retry === 'number') ||
      Object.keys(event).every((k) => ['event', 'data', 'id', 'retry'].includes(k)));

  if (isSseEvent) {
    const sseEvent = event as SseEvent;

    // Add event name if specified
    if (sseEvent.event) {
      result += `event: ${sseEvent.event}\n`;
    }

    // Add event ID if specified
    if (sseEvent.id) {
      result += `id: ${sseEvent.id}\n`;
    }

    // Add retry interval if specified
    if (sseEvent.retry !== undefined) {
      result += `retry: ${sseEvent.retry}\n`;
    }

    // Add data (JSON serialized)
    const dataStr =
      typeof sseEvent.data === 'string' ? sseEvent.data : JSON.stringify(sseEvent.data);

    // Handle multi-line data by prefixing each line with "data: "
    const dataLines = dataStr.split('\n');
    for (const line of dataLines) {
      result += `data: ${line}\n`;
    }
  } else {
    // Raw data - serialize as JSON
    const dataStr = typeof event === 'string' ? event : JSON.stringify(event);
    const dataLines = dataStr.split('\n');
    for (const line of dataLines) {
      result += `data: ${line}\n`;
    }
  }

  // Add final newline to complete the event
  result += '\n';

  return result;
}

/**
 * Create a ReadableStream for SSE from an async iterable
 *
 * @param source - Async iterable that yields events
 * @param options - SSE options
 * @returns ReadableStream for Response body
 */
export function createSseStream(
  source: AsyncIterable<SseEvent | unknown>,
  options: SseOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let heartbeatTimer: Timer | null = null;
  let isCancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Set up heartbeat timer if specified
      if (options.heartbeat && options.heartbeat > 0) {
        heartbeatTimer = setInterval(() => {
          if (!isCancelled) {
            try {
              controller.enqueue(encoder.encode(': heartbeat\n\n'));
            } catch {
              // Controller might be closed, ignore
            }
          }
        }, options.heartbeat);
      }

      try {
        for await (const event of source) {
          if (isCancelled) {
            break;
          }
          const formatted = formatSseEvent(event);
          controller.enqueue(encoder.encode(formatted));
        }
      } catch (error) {
        // Log error but don't throw - stream should close gracefully
        // eslint-disable-next-line no-console
        console.error('[SSE] Stream error:', error);
      } finally {
        // Clean up heartbeat timer
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        // Close the stream
        if (!isCancelled) {
          try {
            controller.close();
          } catch {
            // Controller might already be closed
          }
        }
      }
    },

    cancel() {
      isCancelled = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
  });
}

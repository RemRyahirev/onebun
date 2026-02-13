import type { IConfig, OneBunAppConfig } from './config.interface';
import type {
  OneBunRequest,
  SseEvent,
  SseOptions,
} from '../types';
import type { Context } from 'effect';

import type { SyncLogger } from '@onebun/logger';
import { HttpStatusCode } from '@onebun/requests';

/**
 * Default idle timeout for HTTP connections (in seconds).
 * Bun.serve closes idle connections after this period.
 * @defaultValue 120
 */
export const DEFAULT_IDLE_TIMEOUT = 120;

/**
 * Default heartbeat interval for SSE connections (in milliseconds).
 * Sends a comment (`: heartbeat\n\n`) to keep the connection alive.
 * @defaultValue 30000 (30 seconds)
 */
export const DEFAULT_SSE_HEARTBEAT_MS = 30_000;

/**
 * Default per-request idle timeout for SSE connections (in seconds).
 * SSE connections are long-lived by nature, so they get a longer timeout.
 * @defaultValue 600 (10 minutes)
 */
export const DEFAULT_SSE_TIMEOUT = 600;

/**
 * Base controller class that can be extended to add common functionality.
 *
 * Controllers extending this class have `this.config` and `this.logger` available
 * immediately after `super()` in the constructor when created through the framework DI.
 * The framework sets an ambient init context before calling the constructor, and
 * the Controller base class reads from it in its constructor.
 *
 * @example
 * ```typescript
 * @Controller('/users')
 * class UserController extends BaseController {
 *   private readonly prefix: string;
 *
 *   constructor(private userService: UserService) {
 *     super();
 *     // this.config and this.logger are available here!
 *     this.prefix = this.config.get('api.prefix');
 *   }
 * }
 * ```
 */
export class Controller {
  // Store service instances
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private services: Map<Context.Tag<any, any>, unknown> = new Map();

  // Logger instance with controller class name as context
  protected logger!: SyncLogger;
  // Configuration instance for accessing environment variables
  protected config!: IConfig<OneBunAppConfig>;
  // Flag to track initialization status
  private _initialized = false;

  /**
   * Ambient init context set by the framework before controller construction.
   * This allows the Controller constructor to pick up logger and config
   * so they are available immediately after super() in subclass constructors.
   * @internal
   */
  private static _initContext: { logger: SyncLogger; config: IConfig<OneBunAppConfig> } | null =
    null;

  /**
   * Set the ambient init context before constructing a controller.
   * Called by the framework (OneBunModule) before `new ControllerClass(...)`.
   * @internal
   */
  static setInitContext(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    Controller._initContext = { logger, config };
  }

  /**
   * Clear the ambient init context after controller construction.
   * Called by the framework (OneBunModule) after `new ControllerClass(...)`.
   * @internal
   */
  static clearInitContext(): void {
    Controller._initContext = null;
  }

  constructor() {
    // Pick up logger and config from ambient init context if available.
    // This makes this.config and this.logger available immediately after super()
    // in subclass constructors.
    if (Controller._initContext) {
      const { logger, config } = Controller._initContext;
      const className = this.constructor.name;
      this.logger = logger.child({ className });
      this.config = config;
      this._initialized = true;
    }
  }

  /**
   * Initialize controller with logger and config (called by the framework).
   * This is a fallback for controllers not constructed through the DI system
   * (e.g., in tests or when created manually). If the controller was already
   * initialized via the constructor init context, this is a no-op.
   * @internal
   */
  initializeController(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    if (this._initialized) {
      return; // Already initialized (via constructor or previous call)
    }

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
    this._initialized = true;

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
  protected isJson(req: OneBunRequest | Request): boolean {
    return req.headers.get('content-type')?.includes('application/json') ?? false;
  }

  /**
   * Parse JSON from request body
   */
  protected async parseJson<T = unknown>(req: OneBunRequest | Request): Promise<T> {
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
   * @param source - Async iterable that yields SseEvent objects or raw data,
   *   or a factory function that receives an AbortSignal and returns an async iterable.
   *   The factory pattern is useful for SSE proxying -- pass the signal to `fetch()`
   *   to automatically abort upstream connections when the client disconnects.
   * @param options - SSE options (heartbeat interval, onAbort callback, etc.)
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
   * @example With heartbeat and onAbort callback
   * ```typescript
   * @Get('/live')
   * live(): Response {
   *   const updates = this.dataService.getUpdateStream();
   *   return this.sse(updates, {
   *     heartbeat: 15000,
   *     onAbort: () => this.dataService.unsubscribe(),
   *   });
   * }
   * ```
   *
   * @example Factory function with AbortSignal (SSE proxy)
   * ```typescript
   * @Get('/proxy')
   * proxy(): Response {
   *   return this.sse((signal) => this.proxyUpstream(signal));
   * }
   *
   * private async *proxyUpstream(signal: AbortSignal): SseGenerator {
   *   const response = await fetch('https://api.example.com/events', { signal });
   *   // parse and yield SSE events from upstream...
   *   // When client disconnects -> signal aborted -> fetch aborted automatically
   * }
   * ```
   */
  protected sse(
    source:
      | AsyncIterable<SseEvent | unknown>
      | ((signal: AbortSignal) => AsyncIterable<SseEvent | unknown>),
    options: SseOptions = {},
  ): Response {
    let iterable: AsyncIterable<SseEvent | unknown>;
    let onCancel: (() => void) | undefined;

    if (typeof source === 'function') {
      // Factory pattern: create an AbortController and pass its signal to the factory
      const ac = new AbortController();
      iterable = source(ac.signal);
      onCancel = () => ac.abort();
    } else {
      iterable = source;
    }

    const stream = createSseStream(iterable, { ...options, _onCancel: onCancel });

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
 * Internal options for createSseStream, extending public SseOptions
 * with private hooks used by controller.sse()
 */
interface CreateSseStreamOptions extends SseOptions {
  /**
   * Internal cancel hook used by controller.sse() to abort
   * the AbortController for factory-pattern SSE sources.
   * @internal
   */
  _onCancel?: () => void;
}

/**
 * Create a ReadableStream for SSE from an async iterable
 *
 * Uses a manual async iterator so that `iterator.return()` can be called
 * on stream cancellation, triggering the generator's `finally` blocks
 * for proper cleanup (e.g., aborting upstream SSE connections).
 *
 * @param source - Async iterable that yields events
 * @param options - SSE options (heartbeat, onAbort, etc.)
 * @returns ReadableStream for Response body
 */
export function createSseStream(
  source: AsyncIterable<SseEvent | unknown>,
  options: CreateSseStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let heartbeatTimer: Timer | null = null;
  let isCancelled = false;

  // Obtain manual iterator handle so we can call return() on cancel
  const iterator = source[Symbol.asyncIterator]();

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
        while (true) {
          if (isCancelled) {
            break;
          }
          const { value, done } = await iterator.next();
          if (done || isCancelled) {
            break;
          }
          const formatted = formatSseEvent(value);
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
      // Force-terminate the generator, triggering its finally blocks
      // This enables cleanup on client disconnect (e.g., aborting upstream SSE)
      iterator.return?.(undefined);
      // Fire user-provided onAbort callback
      options.onAbort?.();
      // Fire internal cancel hook (used by controller.sse() factory pattern)
      options._onCancel?.();
    },
  });
}

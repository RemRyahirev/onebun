import path from 'node:path';

import { trace as otelTrace } from '@opentelemetry/api';
import {
  type Context,
  Effect,
  Layer,
} from 'effect';

import type { Controller } from '../module/controller';
import type { ResolvedInterceptor } from '../types';
import type { MultiServiceOrchestrator } from './multi-service-orchestrator';
import type { MultiServiceApplicationOptions, ServicesMap } from './multi-service.types';
import type { WsClientData } from '../websocket/ws.types';
import type { Tracer } from '@opentelemetry/api';

import {
  type DeepPaths,
  type DeepValue,
  TypedEnv,
} from '@onebun/envs';
import {
  createSyncLogger,
  type Logger,
  type LoggerOptions,
  LoggerService,
  makeLoggerFromOptions,
  resolveOtlpLogEndpoint,
  shutdownLogger,
  type SyncLogger,
} from '@onebun/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  HttpStatusCode,
  OneBunBaseError,
  setTraceContextProvider,
} from '@onebun/requests';

import {
  getControllerFilters,
  getControllerGuards,
  getControllerInterceptors,
  getControllerMetadata,
  getControllerMiddleware,
  getSseMetadata,
  type SseDecoratorOptions,
} from '../decorators/decorators';
import { OneBunBootstrapError } from '../errors/dependency-errors';
import { createDefaultExceptionFilter, type ExceptionFilter } from '../exception-filters/exception-filters';
import { HttpException } from '../exception-filters/http-exception';
import { OneBunFile, validateFile } from '../file/onebun-file';
import { executeHttpGuards, HttpExecutionContextImpl } from '../http-guards/http-guards';
import { composeInterceptors } from '../interceptors/interceptors';
import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from '../module/config.interface';
import { ConfigServiceImpl } from '../module/config.service';
import {
  createSseStream,
  DEFAULT_IDLE_TIMEOUT,
  DEFAULT_SSE_HEARTBEAT_MS,
  DEFAULT_SSE_TIMEOUT,
} from '../module/controller';
import {
  createGlobalScope,
  type GlobalScope,
  OneBunModule,
} from '../module/module';
import { assertRegistrationsConfigured } from '../module/registration';
import { getServiceTag } from '../module/service';
import {
  type ProfileMark,
  PROFILING_ENABLED,
  getProfiler,
  setProfiler,
  runProfileScope,
  DefaultProfiler,
} from '../profiler';
import {
  QueueService,
  QueueServiceProxy,
  QueueServiceTag,
  type QueueAdapter,
  type QueueConfig,
} from '../queue';
import { InMemoryQueueAdapter } from '../queue/adapters/memory.adapter';
import { RedisQueueAdapter } from '../queue/adapters/redis.adapter';
import { hasQueueDecorators } from '../queue/decorators';
import { SharedRedisProvider } from '../redis/shared-redis';
import { getCurrentTraceContext, requestContextStore } from '../request-context';
import {
  bindClientAddress,
  createClientAddressBinding,
  getClientAddress,
  type ClientAddressBinding,
  type PeerAddressSource,
} from '../security/client-address';
import { CorsMiddleware } from '../security/cors-middleware';
import { RateLimitMiddleware } from '../security/rate-limit-middleware';
import { SecurityHeadersMiddleware } from '../security/security-headers-middleware';
import { inRootTraceScope } from '../trace-scope';
import {
  type ApplicationOptions,
  HttpMethod,
  type ModuleInstance,
  type OneBunRequest,
  type ResolvedMiddleware,
  ParamType,
  type RouteMetadata,
} from '../types';
import { validateOrThrow } from '../validation';
import { WsHandler, isWebSocketGateway } from '../websocket/ws-handler';

import {
  QUEUE_DISABLED_WITH_ADAPTER_WARNING,
  resolveQueueAdapterType,
  resolveQueueEnablement,
} from './queue-enablement';
import {
  createDeadline,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DRAIN_BUDGET_RATIO,
  describeRemaining,
  drainInFlight,
  type DrainReport,
  type InFlightSource,
} from './shutdown';

// Conditionally import metrics
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createMetricsService: any;

try {
  const metricsModule = require('@onebun/metrics');
  createMetricsService = metricsModule.createMetricsService;
} catch {
  // Metrics module not available - this is optional
}

// Conditionally import docs (optional dependency - not added to package.json to avoid circular deps)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generateOpenApiSpec: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generateSwaggerUiHtml: any;

try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const docsModule = require('@onebun/docs');
  generateOpenApiSpec = docsModule.generateOpenApiSpec;
  generateSwaggerUiHtml = docsModule.generateSwaggerUiHtml;
} catch {
  // Docs module not available - this is optional
}

// Optional CacheService for static file existence caching
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cacheServiceClass: new (...args: unknown[]) => any = null as any;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const cacheModule = require('@onebun/cache');
  cacheServiceClass = cacheModule.CacheService;
} catch {
  // @onebun/cache not available - use in-memory Map fallback
}

// Import tracing modules directly

/**
 * Normalize URL path by removing trailing slashes (except for root path).
 * This ensures consistent route matching and metrics collection.
 *
 * @param path - The URL path to normalize
 * @returns Normalized path without trailing slash
 * @example
 * normalizePath('/users/') // => '/users'
 * normalizePath('/users')  // => '/users'
 * normalizePath('/')       // => '/'
 * normalizePath('/api/v1/') // => '/api/v1'
 */
function normalizePath(pathStr: string): string {
  if (pathStr === '/' || pathStr.length <= 1) {
    return pathStr;
  }

  return pathStr.endsWith('/') ? pathStr.slice(0, -1) : pathStr;
}

/**
 * Compose a route path from a prefix, a controller path and a route path.
 *
 * Concatenating them naively is what made `@Controller('/')` unusable: with `@Get('/health')`
 * it produced `//health`, which matches NOTHING — neither `/health` nor `//health`. A whole
 * controller silently disappeared, and the startup log printed the broken path, confirming the
 * wrong route to whoever wrote it.
 *
 * `normalizePath` alone does not save this: it strips a TRAILING slash, and the duplicate is in
 * the middle. Runs of separators are collapsed first, then the trailing one is dropped.
 *
 * This is also the real cause of the reported "a root wildcard does not match nested paths"
 * gotcha. Raw `Bun.serve({ routes: { '/*': { OPTIONS } } })` matches them fine;
 * `@Controller('/') + @Options('/*')` composed to `//*`.
 *
 * @see docs:api/controllers.md
 */
export function joinRoutePath(...segments: string[]): string {
  return normalizePath(segments.join('').replace(/\/{2,}/g, '/'));
}

/**
 * Method keys Bun accepts inside the object form of a `routes` entry
 * (`{ '/x': { GET: handler } }`).
 *
 * MEASURED against Bun 1.3.14, not assumed: these nine are accepted, and every
 * other key — `ALL`, `PROPFIND`, `QUERY`, or any lowercase spelling — makes
 * `Bun.serve` throw a bare `TypeError` reading
 * `'routes' expects a Record<string, Response | HTMLBundle | {...}>`.
 * That message names neither the controller nor the handler, so registration
 * validates against this set first and raises `OneBunBootstrapError` instead.
 */
const BUN_ROUTE_METHOD_KEYS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD',
  'TRACE',
  'CONNECT',
]);

/**
 * Decorator names by `HttpMethod`, used to name the offending decorator in
 * bootstrap diagnostics.
 */
const ROUTE_DECORATOR_NAMES: Readonly<Record<string, string>> = {
  [HttpMethod.GET]: '@Get',
  [HttpMethod.POST]: '@Post',
  [HttpMethod.PUT]: '@Put',
  [HttpMethod.DELETE]: '@Delete',
  [HttpMethod.PATCH]: '@Patch',
  [HttpMethod.OPTIONS]: '@Options',
  [HttpMethod.HEAD]: '@Head',
  [HttpMethod.ALL]: '@All',
};

/**
 * A handler as Bun's `routes` option consumes it.
 */
type BunRouteHandler = (
  req: OneBunRequest,
  server: ReturnType<typeof Bun.serve>,
) => Promise<Response>;

/**
 * Everything registered for one concrete path, collected before anything is
 * handed to Bun so that precedence is decided by rule rather than by the order
 * in which controllers happened to be walked.
 */
interface PathRegistration {
  /** Handlers declared with a concrete verb decorator (`@Get`, `@Post`, …), keyed by uppercase verb. */
  methods: Map<string, BunRouteHandler>;
  /** Handler declared with `@All()` — the catch-all for every verb no concrete decorator claims. */
  catchAll?: BunRouteHandler;
}

/**
 * Recursively strip keys whose value is `undefined` from plain objects.
 * Ensures ArkType optional-field validation treats missing values
 * as absent rather than present-but-undefined.
 */
function stripUndefined(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined);
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }

    return result;
  }

  return obj;
}

const EMPTY_QUERY_PARAMS: Record<string, string | string[]> = Object.freeze({});

/**
 * Extract query parameters from a raw URL string without `new URL()`.
 * Uses indexOf + URLSearchParams on the query portion only — avoids
 * full URL parsing (protocol, host, path) which is expensive.
 *
 * @param rawUrl - The raw request URL string (e.g. 'http://host/path?a=1&b=2')
 * @returns Record of parameter names to values (string for single, string[] for repeated/array notation)
 * @example
 * extractQueryParams('http://x.com/?a=1&b=2')     // { a: '1', b: '2' }
 * extractQueryParams('http://x.com/?tag=a&tag=b')  // { tag: ['a', 'b'] }
 * extractQueryParams('http://x.com/?tag[]=a')       // { tag: ['a'] }
 * extractQueryParams('http://x.com/users')          // {} (frozen empty object, zero alloc)
 * extractQueryParams('http://x.com/?a=1#&a=9')      // { a: '1' } (fragment ignored, as the router does)
 */
function extractQueryParams(rawUrl: string): Record<string, string | string[]> {
  // The fragment is cut FIRST, before looking for the query. Skipping this made OneBun parse the
  // request target with two disagreeing parsers: the router uses `new URL()`, which drops
  // everything from `#`, while this one fed the fragment straight to URLSearchParams. Anyone able
  // to write a request target — an in-path attacker, or any client that is not a browser — could
  // therefore inject parameters the router never saw, and because URLSearchParams is last-wins,
  // OVERRIDE real ones: `/x?page=1#&page=99` routed as `page=1` and reached the handler as
  // `page=99`. Bun passes the fragment through verbatim, so nothing upstream removes it.
  const hashIdx = rawUrl.indexOf('#');
  const requestTarget = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx);

  const qIdx = requestTarget.indexOf('?');
  if (qIdx === -1) {
    return EMPTY_QUERY_PARAMS;
  }

  const queryParams: Record<string, string | string[]> = {};
  const searchParams = new URLSearchParams(requestTarget.slice(qIdx + 1));

  for (const [rawKey, value] of searchParams.entries()) {
    // Handle array notation: tag[] -> tag (as array)
    const isArrayNotation = rawKey.endsWith('[]');
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    const key = isArrayNotation ? rawKey.slice(0, -2) : rawKey;

    const existing = queryParams[key];
    if (existing !== undefined) {
      // Handle multiple values with same key (e.g., ?tag=a&tag=b or ?tag[]=a&tag[]=b)
      queryParams[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else if (isArrayNotation) {
      // Array notation always creates an array, even with single value
      queryParams[key] = [value];
    } else {
      queryParams[key] = value;
    }
  }

  return queryParams;
}

/**
 * Resolve port from options, environment variable, or default.
 * Priority: explicit option > PORT env > default (3000)
 */
function resolvePort(explicitPort: number | undefined): number {
  if (explicitPort !== undefined) {
    return explicitPort;
  }
  const envPort = process.env.PORT;
  if (envPort !== undefined && envPort !== '') {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 3000;
}

/**
 * Resolve host from options, environment variable, or default.
 * Priority: explicit option > HOST env > default ('0.0.0.0')
 */
function resolveHost(explicitHost: string | undefined): string {
  if (explicitHost !== undefined) {
    return explicitHost;
  }
  const envHost = process.env.HOST;
  if (envHost !== undefined && envHost !== '') {
    return envHost;
  }

  return '0.0.0.0';
}

/** Default TTL for static file existence cache (ms) when not specified */
const DEFAULT_STATIC_FILE_EXISTENCE_CACHE_TTL_MS = 60_000;

/** Cache key prefix for static file existence in CacheService */
const STATIC_EXISTS_CACHE_PREFIX = 'onebun:static:exists:';

/**
 * One `[ServiceClass, token]` pair for {@link OneBunApplication.getLayer}.
 *
 * A `Context` has one slot per service class, so an application holding two instances of one
 * class cannot be represented without saying which one takes the slot. This is how it is said —
 * the layer counterpart of `getService(Class, token)`.
 *
 * @see docs:api/core.md
 */
export type ServiceSelection = readonly [
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClass: new (...args: any[]) => unknown,
  token: symbol | string,
];

/**
 * Fallbacks for the OTLP `service.*` resource attributes. Deliberately the same strings
 * `initTracerProvider` uses, so logs and spans from an unconfigured service land under one name
 * in the backend instead of two.
 */
const DEFAULT_OTLP_SERVICE_NAME = 'onebun-service';
const DEFAULT_OTLP_SERVICE_VERSION = '1.0.0';

/**
 * Resolve a relative path under a root directory and ensure the result stays inside the root (path traversal protection).
 * @param rootDir - Absolute path to the static root directory
 * @param relativePath - URL path segment (e.g. from request path after prefix); must not contain '..' that escapes root
 * @returns Absolute path if under root, otherwise null
 */
function resolvePathUnderRoot(rootDir: string, relativePath: string): string | null {
  const normalized = path.join(rootDir, relativePath.startsWith('/') ? relativePath.slice(1) : relativePath);
  const resolved = path.resolve(normalized);
  const rootResolved = path.resolve(rootDir);
  if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) {
    return resolved;
  }

  return null;
}

/**
 * Body served to every request that arrives after the drain has begun. The listener stays
 * open on purpose: answering 503 is what tells a load balancer to stop routing here, and
 * it keeps the deadline enforceable — Bun ignores `stop(true)` once a graceful `stop()` is
 * pending, so closing the listener first would make the force-close unreachable.
 */
const SHUTDOWN_RESPONSE_BODY = JSON.stringify({
  success: false,
  error: 'Service Unavailable',
  message: 'Server is shutting down',
});

/** How the shutdown ended — the signal handler turns this into an exit code. */
interface ShutdownOutcome {
  /** The deadline expired before the sequence finished. */
  timedOut: boolean;
  /** What was running when the deadline expired, for the log line. */
  phase: string | null;
  /** Connections force-closed because the drain window expired. */
  forceClosed: number;
  /**
   * Phases that rejected. Every one of them was logged and the sequence carried on.
   *
   * Named rather than counted, because "the trace flush failed" and "the destroy hooks
   * failed" send an operator to entirely different places.
   */
  failures: string[];
}

/**
 * OneBun Application
 * @see docs:api/core.md
 * @see docs:getting-started.md
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class OneBunApplication<QA extends import('../queue/types').QueueAdapterConstructor<any> = import('../queue/types').QueueAdapterConstructor, TServices extends ServicesMap = ServicesMap> {
  private rootModule: ModuleInstance | null = null;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private options: ApplicationOptions;
  private logger: SyncLogger;
  private config: IConfig<OneBunAppConfig>;
  private configService: ConfigServiceImpl | null = null;
  private moduleClass: (new (...args: unknown[]) => object) | null;
  private loggerLayer: Layer.Layer<never, never, unknown>;
  // Multi-service mode
  private readonly multiServiceMode: boolean = false;
  private orchestrator: MultiServiceOrchestrator<TServices> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metricsService: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private traceService: any = null;
  private wsHandler: WsHandler | null = null;
  private queueService: QueueService | null = null;
  private queueAdapter: QueueAdapter | null = null;
  private queueServiceProxy: QueueServiceProxy | null = null;
  /**
   * DI state owned by THIS application: `@Global()` service instances, the modules already
   * processed, test overrides and dynamic-module option snapshots. Not on `ApplicationOptions`
   * on purpose — it is package-internal state, not something a caller configures.
   */
  private globalScope: GlobalScope | null = null;
  /**
   * The one shutdown latch. `stop()`, the SIGTERM handler and a second signal all go
   * through it, so a shutdown runs exactly once per application instance: a second call
   * awaits the first outcome instead of walking the destroy hooks again. Terminal on
   * purpose — it is never cleared, because "stopped" is not a state an application
   * returns from.
   */
  private shutdownPromise: Promise<ShutdownOutcome> | null = null;
  /** Signal handlers are installed at most once per instance. */
  private signalHandlersRegistered = false;
  // Docs (OpenAPI/Swagger) - generated on start()
  private openApiSpec: Record<string, unknown> | null = null;
  private swaggerHtml: string | null = null;
  // Internal profiling
  private profilingReports: import('../profiler').ProfileReport[] = [];

  /**
   * Create single-service application instance
   */
  constructor(
    moduleClass: new (...args: unknown[]) => object,
    options?: Partial<ApplicationOptions<QA>>,
  );
  /**
   * Create multi-service application instance
   */
  constructor(options: MultiServiceApplicationOptions<TServices>);
  constructor(
    moduleClassOrOptions: (new (...args: unknown[]) => object) | MultiServiceApplicationOptions<TServices>,
    options?: Partial<ApplicationOptions<QA>>,
  ) {
    if (typeof moduleClassOrOptions !== 'function') {
      // Multi-service mode
      this.multiServiceMode = true;
      this.moduleClass = null;
      // The only two single-service options that mean anything at the parent level: the
      // parent owns the process-wide signal handler and the shutdown budget for
      // `stopAll()`. Everything else about a child is configured per service.
      this.options = {
        gracefulShutdown: moduleClassOrOptions.gracefulShutdown,
        shutdownTimeout: moduleClassOrOptions.shutdownTimeout,
      } as ApplicationOptions;
      this.config = new NotInitializedConfig();

      // Initialize logger (simplified — no config/metrics/tracing at parent level, but the
      // OTLP environment variables still apply: an orchestrator whose own logs stop at stdout
      // while its children ship theirs is the half that breaks when something goes wrong)
      this.loggerLayer = makeLoggerFromOptions(this.resolveLoggerOptions());
      const effectLogger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (logger: Logger) =>
            logger.child({ className: 'OneBunApplication[multi]' }),
          ),
          this.loggerLayer,
        ) as Effect.Effect<Logger, never, never>,
      ) as Logger;
      this.logger = createSyncLogger(effectLogger, getCurrentTraceContext);

      // Eagerly create orchestrator (allows pre-start calls like getRunningServices())
      const { MultiServiceOrchestrator: orchestratorClass } = require('./multi-service-orchestrator') as {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        MultiServiceOrchestrator: new (
          opts: MultiServiceApplicationOptions<TServices>,
          log: SyncLogger,
        ) => MultiServiceOrchestrator<TServices>;
      };
      this.orchestrator = new orchestratorClass(moduleClassOrOptions, this.logger);

      return;
    }

    // Single-service mode
    this.multiServiceMode = false;
    this.moduleClass = moduleClassOrOptions;

    // Resolve port and host with priority: explicit > env > default
    this.options = {
      port: resolvePort(options?.port),
      host: resolveHost(options?.host),
      development: options?.development ?? process.env.NODE_ENV !== 'production',
      ...options,
    };

    // Initialize configuration - TypedEnv if schema provided, otherwise NotInitializedConfig
    if (this.options.envSchema) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.config = TypedEnv.create(this.options.envSchema as any, this.options.envOptions);
    } else {
      this.config = new NotInitializedConfig();
    }

    // Use provided logger layer, or create from options, or use default
    // Priority: loggerLayer > loggerOptions > env variables > NODE_ENV defaults
    this.loggerLayer = this.options.loggerLayer
      ?? makeLoggerFromOptions(this.resolveLoggerOptions());

    // Initialize logger with application class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (logger: Logger) =>
          logger.child({ className: 'OneBunApplication' }),
        ),
        this.loggerLayer,
      ) as Effect.Effect<Logger, never, never>,
    ) as Logger;
    this.logger = createSyncLogger(effectLogger, getCurrentTraceContext);

    // Create configuration service eagerly if config exists (it stores a reference,
    // doesn't call config.get(), so safe before initialization)
    if (!(this.config instanceof NotInitializedConfig)) {
      this.configService = new ConfigServiceImpl(this.logger, this.config);
    }

    // Initialize metrics if enabled and available
    if (this.options.metrics?.enabled !== false && createMetricsService) {
      try {
        this.logger.debug('Attempting to initialize metrics service');
        this.logger.debug('Metrics options:', this.options.metrics);

        this.metricsService = Effect.runSync(createMetricsService(this.options.metrics || {}));

        this.logger.debug('Metrics service Effect run successfully');

        // Make metrics service globally available (temporary solution)
        if (typeof globalThis !== 'undefined') {
          (globalThis as Record<string, unknown>).__onebunMetricsService = this.metricsService;
        }

        this.logger.info('Metrics service initialized successfully');
      } catch (error) {
        this.logger.error(
          'Failed to initialize metrics service:',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.logger.debug('Full error details:', {
          error,
          stack: error instanceof Error ? error.stack : 'No stack',
        });
      }
    } else if (this.options.metrics?.enabled !== false) {
      this.logger.debug('createMetricsService not available, metrics will be disabled');
    }

    // Initialize tracing if enabled (lazy import to avoid loading OTEL at startup when not needed)
    if (this.options.tracing?.enabled !== false) {
      try {
        this.logger.debug('Attempting to initialize trace service');
        this.logger.debug('Tracing options:', this.options.tracing);

        const trace = require('@onebun/trace') as typeof import('@onebun/trace');
        const traceLayer = trace.makeTraceService(this.resolveTracingOptions());
        this.traceService = Effect.runSync(Effect.provide(trace.TraceService, traceLayer));

        this.logger.debug('Trace service Effect run successfully');

        // Make trace service globally available (temporary solution)
        if (typeof globalThis !== 'undefined') {
          (globalThis as Record<string, unknown>).__onebunTraceService = this.traceService;
        }

        // Outgoing calls join the trace from here on. Wired next to the trace service because it
        // is the same capability seen from the other side, and because a failure above must not
        // leave the client emitting headers for a trace nothing is recording.
        this.wireOutgoingTraceContext();

        this.logger.info('Trace service initialized successfully');
      } catch (error) {
        this.logger.error(
          'Failed to initialize trace service:',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.logger.debug('Full error details:', {
          error,
          stack: error instanceof Error ? error.stack : 'No stack',
        });
      }
    }

    // Initialize profiler from options (env-based init happens at module load in profiler.ts)
    if (this.options.profiling?.enabled && !getProfiler()) {
      setProfiler(this.options.profiling.profiler ?? new DefaultProfiler());
    } else if (this.options.profiling?.profiler) {
      setProfiler(this.options.profiling.profiler);
    }

    // Note: root module creation is deferred to start() to ensure
    // config is fully initialized before services are created.
  }

  /**
   * Point `@onebun/requests` at this process's per-request trace context.
   *
   * `@onebun/requests` cannot import core — core depends on requests, not the reverse — so the
   * seam is a registered function. It used to be a process-global cell that nothing ever wrote,
   * which made every outgoing call leave untraced and silent; a single cell would have been the
   * wrong shape anyway, since concurrent requests share it and the last writer would win.
   *
   * The OpenTelemetry active span comes first when there is one: it is the innermost open span,
   * so a call made from inside a `@Traced` method hangs off that method rather than off the
   * request. `getCurrentTraceContext()` is the fallback, and covers the path where no exporter is
   * configured and therefore no OpenTelemetry span exists at all.
   */
  private wireOutgoingTraceContext(): void {
    setTraceContextProvider(() => {
      const activeSpan = otelTrace.getActiveSpan();

      if (activeSpan) {
        const spanContext = activeSpan.spanContext();

        return {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          traceFlags: spanContext.traceFlags,
        };
      }

      const traceContext = getCurrentTraceContext();

      return traceContext
        ? {
          traceId: traceContext.traceId,
          spanId: traceContext.spanId,
          traceFlags: traceContext.traceFlags,
        }
        : null;
    });
  }

  /**
   * The tracing options actually used, with a default reporter for abandoned span exports.
   *
   * An export that fails without a word is how tracing came to deliver nothing for so long, and
   * the exporter has no logger of its own. Anything the user supplied wins — this only fills the
   * gap where the alternative is silence.
   */
  private resolveTracingOptions(): NonNullable<ApplicationOptions['tracing']> {
    const tracing = this.options.tracing ?? {};

    if (!tracing.exportOptions?.endpoint || tracing.exportOptions.onExportFailure) {
      return tracing;
    }

    return {
      ...tracing,
      exportOptions: {
        ...tracing.exportOptions,
        onExportFailure: (error: Error, spanCount: number, attempts: number) => {
          this.logger.warn(
            `Dropped ${spanCount} span(s) after ${attempts} export attempt(s): ${error.message}`,
          );
        },
      },
    };
  }

  /**
   * The logger options actually used, with the OTLP resource attributes filled in.
   *
   * Every path goes through `makeLoggerFromOptions`, including the one where nothing was
   * configured, because it — and not `makeLogger` — is what reads
   * `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT`. Sending the
   * no-options case to `makeLogger` meant setting either variable did nothing whatsoever,
   * which defeats the reason the variables exist: one image promoted from dev to prod with
   * observability turned on by injection rather than by a code change.
   */
  private resolveLoggerOptions(): LoggerOptions | undefined {
    const configured = this.options.loggerOptions;
    const otlpEndpoint = resolveOtlpLogEndpoint(configured);

    if (!otlpEndpoint) {
      return configured;
    }

    return {
      ...configured,
      // Attached on whichever path enabled OTLP, not only the explicit-endpoint one. Records
      // that arrive with an empty resource cannot be attributed to a service, and telling the
      // services apart is most of what a log backend is for.
      otlpResourceAttributes: configured?.otlpResourceAttributes ?? {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'service.name': this.options.tracing?.serviceName
          ?? process.env.OTEL_SERVICE_NAME
          ?? DEFAULT_OTLP_SERVICE_NAME,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'service.version': this.options.tracing?.serviceVersion ?? DEFAULT_OTLP_SERVICE_VERSION,
      },
    };
  }

  /**
   * Get configuration service with full type inference.
   * Uses module augmentation of OneBunAppConfig for type-safe access.
   *
   * @example
   * // With module augmentation:
   * declare module '@onebun/core' {
   *   interface OneBunAppConfig {
   *     server: { port: number; host: string };
   *   }
   * }
   *
   * const config = app.getConfig();
   * const port = config.get('server.port'); // number
   */
  getConfig(): IConfig<OneBunAppConfig> {
    this.ensureSingleServiceMode('getConfig');
    if (!this.configService) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configService;
  }

  /**
   * Get configuration value by path (convenience method) with full type inference.
   * Uses module augmentation of OneBunAppConfig for type-safe access.
   *
   * @example
   * // With module augmentation:
   * declare module '@onebun/core' {
   *   interface OneBunAppConfig {
   *     server: { port: number; host: string };
   *   }
   * }
   *
   * const port = app.getConfigValue('server.port'); // number
   * const host = app.getConfigValue('server.host'); // string
   */
  getConfigValue<P extends DeepPaths<OneBunAppConfig>>(pathKey: P): DeepValue<OneBunAppConfig, P>;
  /** Fallback for dynamic paths */
  getConfigValue<T = unknown>(pathKey: string): T;
  getConfigValue(pathKey: string): unknown {
    this.ensureSingleServiceMode('getConfigValue');

    return this.getConfig().get(pathKey);
  }

  /**
   * Ensure root module is created (i.e., start() has been called).
   * Throws if called before start().
   */
  private ensureModule(): ModuleInstance {
    if (!this.rootModule) {
      throw new Error('Application not started. Call start() before accessing the module.');
    }

    return this.rootModule;
  }

  /**
   * The application's services as one Effect `Layer`, for composing them into a program from
   * outside the module tree — an Effect-native test, a script, an embedding host.
   *
   * A `Context` has exactly one slot per service class, so an application holding two instances
   * of one class does not fit in one and the untokened form refuses rather than handing back
   * whichever was merged last. `selections` is how you say which instance takes the slot — the
   * layer counterpart of `getService(Class, token)`, and the reason the refusal is not a dead
   * end. Every ambiguous class must be named; one left out still refuses, and names itself.
   *
   * Only ambiguous classes need naming. Selecting an unambiguous one is allowed and simply pins
   * what was already going to be there.
   *
   * @param selections - `[ServiceClass, token]` pairs choosing an instance per class.
   * @returns A layer providing every service the application built.
   * @throws If the application holds two instances of a class that `selections` does not name.
   *
   * @example
   * ```typescript
   * const layer = app.getLayer([[MailerService, PRIMARY_MAILER]]);
   * await Effect.runPromise(Effect.provide(program, layer));
   * ```
   *
   * @see docs:api/core.md
   */
  getLayer(selections?: ServiceSelection[]): Layer.Layer<never, never, unknown> {
    this.ensureSingleServiceMode('getLayer');

    const selected = selections ?? [];
    this.assertLayerUnambiguous(selected.map(([serviceClass]) => serviceClass.name));

    // Merged last, because that is what wins for a shared tag — the same rule that makes the
    // untokened form ambiguous in the first place is what lets a selection resolve it.
    return selected.reduce<Layer.Layer<never, never, unknown>>(
      (layer, [serviceClass, token]) => Layer.merge(
        layer,
        Layer.succeed(
          getServiceTag(serviceClass) as unknown as Context.Tag<unknown, unknown>,
          this.getService(serviceClass, token),
        ) as unknown as Layer.Layer<never, never, unknown>,
      ),
      this.ensureModule().getLayer(),
    );
  }

  /**
   * Map HTTP method string to Bun's HttpMethod
   */
  private mapHttpMethod(method: HttpMethod): string {
    return method.toString();
  }

  /**
   * Build path prefix from routePrefix and basePath options.
   * The resulting prefix will be prepended to all controller routes.
   *
   * @returns Path prefix string (e.g., '/users/api/v1')
   */
  private buildPathPrefix(): string {
    let prefix = '';

    // Add routePrefix first (typically service name)
    if (this.options.routePrefix) {
      const routePrefix = this.options.routePrefix.startsWith('/')
        ? this.options.routePrefix
        : `/${this.options.routePrefix}`;
      prefix += routePrefix;
    }

    // Add basePath after routePrefix
    if (this.options.basePath) {
      const basePath = this.options.basePath.startsWith('/')
        ? this.options.basePath
        : `/${this.options.basePath}`;
      prefix += basePath;
    }

    return prefix;
  }

  /**
   * Start the application
   * This method now handles all the Effect.js calls internally
   */
  async start(): Promise<void> {
    if (this.multiServiceMode) {
      await this.orchestrator!.startAll();

      // ONE handler for the whole process. The children are built with
      // `gracefulShutdown: false`, so nothing below this line can call `process.exit`
      // while a sibling is still running its destroy hooks — the parent exits after
      // `stopAll()` has stopped every service.
      if (this.options.gracefulShutdown !== false) {
        this.enableGracefulShutdown();
      }

      return;
    }

    // Default exception filter respects httpEnvelope option
    const appDefaultExceptionFilter = createDefaultExceptionFilter({
      httpEnvelope: this.options.httpEnvelope,
      exposeErrorDetails: this.options.exposeErrorDetails,
    });
    // `applyExceptionFilters` is a function declaration at method-body scope, so it
    // cannot see `const app = this` — that one is block-scoped inside the try below.
    const appLogger = this.logger;

    try {
      // Initialize configuration if schema was provided
      let profileMark: ProfileMark | undefined;
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'config:init');
      }
      if (!(this.config instanceof NotInitializedConfig)) {
        await this.config.initialize();
        this.logger.info('Application configuration initialized');
      }
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // This application's own DI scope. Everything below writes into it rather than into a
      // process-wide registry, which is what keeps a second application's @Global() services
      // — and a second DrizzleModule.forRoot() — from being the first one's.
      this.globalScope = createGlobalScope();

      // Test provider overrides are seeded BEFORE the tree is built, so PHASE -1 of every
      // module picks them up. Patching the root module afterwards, as this used to, reached
      // root-module controllers only: services and imported modules silently kept the real
      // instance, so a mock could be ignored without a word.
      if (this.options._testProviders) {
        for (const { tag, value } of this.options._testProviders) {
          this.globalScope.overrides.set(tag as Context.Tag<unknown, unknown>, value);
        }
      }

      // Register QueueService proxy in the scope BEFORE creating the root module,
      // so all modules (including child modules) pick it up via PHASE 0 of initModule().
      // After initializeQueue(), setDelegate(real) is called when queue is enabled.
      this.queueServiceProxy = new QueueServiceProxy();
      this.globalScope.services.set(
        QueueServiceTag as unknown as Context.Tag<unknown, unknown>,
        this.queueServiceProxy as unknown as QueueService,
      );

      // Create the root module AFTER config is initialized and QueueService proxy is registered,
      // so services can safely use this.config.get() in their constructors
      // and inject QueueService in any module depth.
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'module:create');
      }
      // A registration selected with forFeature(token) but never configured with
      // forRoot({ as: token }) is caught here, before anything is constructed.
      assertRegistrationsConfigured();

      this.rootModule = OneBunModule.create(
        this.moduleClass!, this.loggerLayer, this.config,
        this.options.tracing?.traceAll
          ? { traceAll: true, traceFilter: this.options.tracing.traceFilter }
          : undefined,
        this.globalScope,
      );
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Start metrics collection if enabled
      if (this.metricsService && this.metricsService.startSystemMetricsCollection) {
        this.metricsService.startSystemMetricsCollection();
        this.logger.info('System metrics collection started');
      }

      // Setup the module and create controller instances
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'module:setup');
      }
      await Effect.runPromise(this.ensureModule().setup() as Effect.Effect<unknown, never, never>);
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Get all controllers from the root module
      const controllers = this.ensureModule().getControllers();
      this.logger.debug(`Loaded ${controllers.length} controllers`);

      // Initialize WebSocket handler and detect gateways
      // The tracer is passed so a `@Traced` method reached from a socket callback is recorded
      // by THIS application's provider. `getTracer` is impl-only on the trace service, hence
      // the optional call.
      this.wsHandler = new WsHandler(this.logger, this.options.websocket, this.traceService?.getTracer?.());

      // Register WebSocket gateways (they are in controllers array but decorated with @WebSocketGateway)
      for (const controllerClass of controllers) {
        if (isWebSocketGateway(controllerClass)) {
          const instance = this.ensureModule().getControllerInstance?.(controllerClass);
          if (instance) {
            const ownerModule = this.ensureModule().getOwnerModuleForController?.(controllerClass) ?? this.ensureModule();
            this.wsHandler.registerGateway(
              controllerClass,
              instance as import('../websocket/ws-base-gateway').BaseWebSocketGateway,
              ownerModule.resolveInterceptors?.bind(ownerModule),
            );
            this.logger.info(`Registered WebSocket gateway: ${controllerClass.name}`);
          }
        }
      }

      // Initialize Queue system if configured or handlers exist
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'queue:init');
      }
      await this.initializeQueue(controllers);
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Initialize Docs (OpenAPI/Swagger) if enabled and available
      if (PROFILING_ENABLED) {
        profileMark = getProfiler()!.start('bootstrap', 'docs:init');
      }
      await this.initializeDocs(controllers);
      if (profileMark) {
        getProfiler()!.end(profileMark);
      }

      // Create server context binding (used by route handlers and executeHandler)
      const app = this;

      // Client-address policy: one answer to "who called", shared by the default
      // rate-limit key and the `remoteAddr` span field. Proxy headers are attacker-
      // controlled on a direct connection, so they only count when the application
      // opts in; otherwise the transport peer wins.
      const trustProxy = this.options.trustProxy ?? false;
      // The Bun server handle only exists once `Bun.serve` has returned, but every
      // request entry point is handed it as an argument — so the binding is built from
      // the first request and reused, keeping the per-request cost to one WeakMap write.
      let clientAddressBinding: ClientAddressBinding | null = null;
      const bindRequestClientAddress = (
        req: Request,
        server: PeerAddressSource,
      ): void => {
        clientAddressBinding ??= createClientAddressBinding(server, trustProxy);
        bindClientAddress(req, clientAddressBinding);
      };

      // Path constants for framework endpoints
      const metricsPath = this.options.metrics?.path || '/metrics';
      const docsPath = this.options.docs?.path || '/docs';
      const openApiPath = this.options.docs?.jsonPath || '/openapi.json';

      // Build application-level path prefix from options
      const appPrefix = this.buildPathPrefix();

      // Build Bun routes object: { "/path": { GET: handler, POST: handler } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bunRoutes: Record<string, any> = {};

      // Controller routes land here first, keyed by path, and are materialised into
      // `bunRoutes` in one pass once every controller has been walked. Writing straight
      // into a shared `bunRoutes[path]` object made precedence a function of walk order;
      // it is now a rule (see materialisation below).
      const routeRegistry = new Map<string, PathRegistration>();

      /**
       * Record one path/verb pair. `@All()` is stored apart from the concrete verbs
       * rather than as a `bunRoutes[path].ALL` key: Bun's method map has no
       * "every other verb" slot, and an `ALL` key makes `Bun.serve` throw.
       */
      function registerRoute(
        controllerClass: Function,
        route: RouteMetadata,
        pathKey: string,
        handler: BunRouteHandler,
      ): void {
        let registration = routeRegistry.get(pathKey);
        if (!registration) {
          registration = { methods: new Map() };
          routeRegistry.set(pathKey, registration);
        }

        if (route.method === HttpMethod.ALL) {
          registration.catchAll = handler;

          return;
        }

        const verb = String(route.method);
        if (!BUN_ROUTE_METHOD_KEYS.has(verb)) {
          // Without this, Bun.serve throws a TypeError that names neither the
          // controller nor the handler, so nobody can find the offending route.
          const decorator = ROUTE_DECORATOR_NAMES[verb] ?? `@${verb}`;
          throw new OneBunBootstrapError(
            `Cannot register route ${verb} ${pathKey} declared by ` +
              `${controllerClass.name}.${String(route.handler)}() via ${decorator}(): ` +
              `Bun's routes option accepts only ${[...BUN_ROUTE_METHOD_KEYS].join(', ')} ` +
              'as method keys. Use @All() for a catch-all route.',
          );
        }

        registration.methods.set(verb, handler);
      }

      /**
       * Create a route handler with the full OneBun request lifecycle:
       * tracing setup → per-request timeout → middleware chain → executeHandler → metrics → tracing end
       */
      function createRouteHandler(
        routeMeta: RouteMetadata,
        boundHandler: Function,
        controller: Controller,
        fullPath: string,
        method: string,
        resolvedInterceptors?: ResolvedInterceptor[],
      ): (req: OneBunRequest, server: ReturnType<typeof Bun.serve>) => Promise<Response> {
        // Determine the effective timeout for this route:
        // SSE endpoints check @Sse({ timeout }) first, then route-level, then DEFAULT_SSE_TIMEOUT
        // Normal endpoints use route-level timeout only (undefined = use global idleTimeout)
        // Pre-compute route metadata at registration time (not per-request)
        const controllerProto = Object.getPrototypeOf(controller);
        const controllerName = controller.constructor.name;
        const sseDecoratorOptions: SseDecoratorOptions | undefined = routeMeta.handler
          ? getSseMetadata(controllerProto, routeMeta.handler)
          : undefined;
        const isSse = sseDecoratorOptions !== undefined;
        const effectiveTimeout: number | undefined = isSse
          ? (sseDecoratorOptions?.timeout ?? routeMeta.timeout ?? DEFAULT_SSE_TIMEOUT)
          : routeMeta.timeout;
        // MEASURED optimisation, not incidental duplication: routing zero-param,
        // no-schema routes through executeHandler regresses the hot path. Do NOT collapse
        // the two arms — they also differ observably, the fast arm calling
        // boundHandler(req) where executeHandler calls boundHandler(...args).
        const isFastPath = (!routeMeta.params || routeMeta.params.length === 0) && !routeMeta.responseSchemas?.length;
        const needsQueryParams = routeMeta.params?.some((p) => p.type === ParamType.QUERY) ?? false;
        // An @All route answers every verb, so 'ALL' is not a method any client sent —
        // emitting it as a metric label or span attribute would be a lie, and it would
        // collapse every verb into one Prometheus series. Concrete routes keep the
        // registered verb, which Bun guarantees equals req.method for a method-map route.
        const isCatchAllRoute = method === HttpMethod.ALL;
        // Whether this application will create an OpenTelemetry span for the request itself, and
        // therefore whether entering a context scope per request buys anything. Resolved once at
        // registration rather than per request — none of these can change while serving.
        const tracesHttpSpans = Boolean(
          app.traceService
          && app.options.tracing?.exportOptions?.endpoint
          && app.options.tracing?.traceHttpRequests !== false,
        );

        // The tracer whose provider this application's spans belong to, and whether stating it
        // buys anything. OpenTelemetry keeps one provider per process and refuses a duplicate,
        // so an application that did NOT win that slot must name itself or its `@Traced` spans
        // are recorded by the winner's provider, under the winner's `service.name`.
        //
        // Gated on not owning the slot rather than applied unconditionally: a trace service is
        // created for every application by default, so an unconditional scope would add an
        // AsyncLocalStorage frame to every request of every OneBun application in existence to
        // fix a multi-application problem. The single-application hot path is unchanged.
        //
        // Resolved once at registration: a first application owns the slot for as long as it
        // runs, and a later sibling knows at its own registration time that it does not.
        const ownerTracer = app.traceService?.getTracer?.() as Tracer | undefined;
        const needsOwnerScope = ownerTracer !== undefined
          && app.traceService?.ownsInstalledProvider?.() === false;
        const entersTraceScope = tracesHttpSpans || needsOwnerScope;

        return async (req, server) => {
          // Outermost point of a routed request: bind before the middleware chain, the
          // guards or the handler can run, so every one of them resolves the same
          // client address without needing the server handle in scope.
          bindRequestClientAddress(req, server);

          return await requestContextStore.run({ traceContext: null }, async () => {
          // Capture outermost timestamp before any closure/ALS overhead
            const profiler = PROFILING_ENABLED ? getProfiler() : null;
            const outerStartNs = profiler ? Bun.nanoseconds() : 0;
            const observedMethod = isCatchAllRoute ? req.method : method;

            const requestHandler = async (): Promise<Response> => {
            // Only measure time when metrics or tracing need it
              const startTime = (app.metricsService || app.traceService) ? Date.now() : 0;

              // Apply per-request idle timeout if configured
              if (effectiveTimeout !== undefined) {
                server.timeout(req, effectiveTimeout);
              }

              // Setup tracing context if available and enabled
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let traceSpan: any = null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let traceContext: any = null;

              let pMark: ProfileMark | undefined;
              if (profiler && app.traceService) {
                pMark = profiler.start('framework', 'trace:setup');
              }
              if (app.traceService && app.options.tracing?.traceHttpRequests !== false) {
                try {
                // Extract only the trace propagation headers we need
                  const traceparent = req.headers.get('traceparent') ?? undefined;
                  const xTraceId = req.headers.get('x-trace-id') ?? undefined;
                  const xSpanId = req.headers.get('x-span-id') ?? undefined;

                  // Sync hot path: no Effect.runPromise overhead
                  // Kept apart from the generated fallback: only an ACTUALLY inbound context can
                  // parent this request's span, and `||` had already erased the difference by the
                  // time the span was created.
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const inboundContext: any = app.traceService.extractFromHeadersSync({
                    traceparent,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'x-trace-id': xTraceId,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'x-span-id': xSpanId,
                  });

                  traceContext = inboundContext || app.traceService.generateTraceContextSync();

                  const contentLengthHeader = req.headers.get('content-length');
                  traceSpan = app.traceService.startHttpTraceSync({
                    method: observedMethod,
                    url: req.url,
                    route: fullPath,
                    userAgent: req.headers.get('user-agent') ?? undefined,
                    // Same resolution as the rate-limit key: the transport peer unless
                    // `trustProxy` is on. Reading the headers here directly would let a
                    // caller decide what the span says about them.
                    remoteAddr: getClientAddress(req),
                    requestSize: contentLengthHeader
                      ? parseInt(contentLengthHeader, 10)
                      : undefined,
                    // Continues the caller's trace instead of starting a new one. Without it the
                    // inbound `traceparent` reached the logs and nothing else: the exported spans
                    // of two services sat in two unrelated traces, and following a trace id out of
                    // the logs showed half a picture that looked whole.
                    parentContext: inboundContext ?? undefined,
                  });

                  // Make the HTTP span the parent of everything the request goes on to do.
                  // Without this the span is exported but adopts nobody: each `@Traced` method
                  // arrives as its own root with its own trace id, and one request reads as N
                  // unrelated traces. The scope it is promoted into was opened around
                  // `requestHandler` below, before the span existed.
                  app.traceService.activateSpanSync?.(traceSpan);

                  // Store trace context in AsyncLocalStorage for per-request isolation
                  const store = requestContextStore.getStore();
                  if (store) {
                    store.traceContext = traceContext;
                  }
                } catch (error) {
                  app.logger.error(
                    'Failed to setup tracing:',
                    error instanceof Error ? error : new Error(String(error)),
                  );
                }
              }

              try {
                // Inside the try, deliberately. The trace span is created above; everything
                // between its creation and a `catch` that ends it is a window where a throw
                // loses the span outright — and `profiler` is a user-supplied object whose
                // `end()` can throw. It used to sit outside every try that reaches
                // `endHttpTraceSync`.
                if (pMark) {
                  profiler!.end(pMark);
                }

                // Extract query parameters only when route uses @Query (avoids overhead for simple routes)
                if (profiler && needsQueryParams) {
                  pMark = profiler.start('framework', 'url:parse');
                }
                const queryParams = needsQueryParams ? extractQueryParams(req.url) : EMPTY_QUERY_PARAMS;
                if (pMark) {
                  profiler!.end(pMark);
                }

                let response: Response;

                // Fast path: no params, no response schemas — inline handler call, skip executeHandler entirely
                // Full path: delegate to executeHandler for param extraction, validation, response wrapping
                const callHandler = isFastPath
                  ? async (): Promise<Response> => {
                    // Filtered here rather than in the outer catch, which sits above the
                    // middleware chain — see applyExceptionFilters.
                    try {
                      let hMark: ProfileMark | undefined;
                      if (profiler) {
                        hMark = profiler.start('handler', `${controllerName}.${routeMeta.handler ?? 'unknown'}`);
                      }
                      const result = await boundHandler(req);
                      if (hMark) {
                        profiler!.end(hMark);
                      }
                      if (sseDecoratorOptions) {
                        return createSseResponseFromResult(result, sseDecoratorOptions);
                      }

                      if (result instanceof Response) {
                        return result;
                      }

                      const successResponse = createSuccessResponse(result);

                      return new Response(JSON.stringify(successResponse), {
                        status: HttpStatusCode.OK,
                        headers: {
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                          'Content-Type': 'application/json',
                        },
                      });
                    } catch (error) {
                      return await applyExceptionFilters(error, req, routeMeta, controllerName);
                    }
                  }
                  : (): Promise<Response> => executeHandler(
                    boundHandler, routeMeta, controller, controllerName,
                    sseDecoratorOptions, req, queryParams, profiler,
                  );

                // Wrap callHandler with interceptors if any (zero-cost when absent)
                const interceptedHandler = (resolvedInterceptors && resolvedInterceptors.length > 0)
                  ? async (): Promise<Response> => {
                    const interceptorCtx = new HttpExecutionContextImpl(
                      req,
                      routeMeta.handler ?? '',
                      controllerName,
                    );

                    // callHandler already returns a filtered Response, so this only ever
                    // sees a throw from the interceptors themselves.
                    try {
                      return await (composeInterceptors(
                        resolvedInterceptors, interceptorCtx, callHandler,
                      )() as Promise<Response>);
                    } catch (error) {
                      return await applyExceptionFilters(error, req, routeMeta, controllerName);
                    }
                  }
                  : callHandler;

                // Execute middleware chain if any, then guards + handler
                if (routeMeta.middleware && routeMeta.middleware.length > 0) {
                  const guardedHandler = async (): Promise<Response> => {
                    if (routeMeta.guards && routeMeta.guards.length > 0) {
                      let guardMark: ProfileMark | undefined;
                      if (profiler) {
                        guardMark = profiler.start('guard', fullPath);
                      }
                      const guardCtx = new HttpExecutionContextImpl(
                        req,
                        routeMeta.handler ?? '',
                        controllerName,
                      );
                      let allowed: boolean;
                      try {
                        allowed = await executeHttpGuards(routeMeta.guards, guardCtx);
                      } catch (error) {
                        if (guardMark) {
                          profiler!.end(guardMark);
                        }

                        return await applyExceptionFilters(error, req, routeMeta, controllerName);
                      }
                      if (guardMark) {
                        profiler!.end(guardMark);
                      }

                      if (!allowed) {
                        return new Response(
                          JSON.stringify(
                            createErrorResponse(
                              'Forbidden',
                              HttpStatusCode.FORBIDDEN,
                            ),
                          ),
                          {
                            status: app.options.httpEnvelope ? HttpStatusCode.OK : HttpStatusCode.FORBIDDEN,
                            headers: {
                              // eslint-disable-next-line @typescript-eslint/naming-convention
                              'Content-Type': 'application/json',
                            },
                          },
                        );
                      }
                    }

                    return await interceptedHandler();
                  };

                  const next = async (index: number): Promise<Response> => {
                    if (index >= routeMeta.middleware!.length) {
                      return await guardedHandler();
                    }

                    const middleware = routeMeta.middleware![index];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const mwName = (middleware as any)._middlewareName
                  || middleware.name
                  || `middleware[${index}]`;

                    if (profiler) {
                      const mwMark = profiler.start('middleware', mwName);
                      const result = await middleware(req, () => next(index + 1));
                      profiler.end(mwMark);

                      return result;
                    }

                    return await middleware(req, () => next(index + 1));
                  };

                  response = await next(0);
                } else {
                // No middleware — run guards inline (no extra closure)
                  if (routeMeta.guards && routeMeta.guards.length > 0) {
                    let guardMark: ProfileMark | undefined;
                    if (profiler) {
                      guardMark = profiler.start('guard', fullPath);
                    }
                    const guardCtx = new HttpExecutionContextImpl(
                      req,
                      routeMeta.handler ?? '',
                      controllerName,
                    );
                    let allowed = false;
                    let guardError: { error: unknown } | null = null;
                    try {
                      allowed = await executeHttpGuards(routeMeta.guards, guardCtx);
                    } catch (error) {
                      guardError = { error };
                    }
                    if (guardMark) {
                      profiler!.end(guardMark);
                    }

                    if (guardError) {
                      response = await applyExceptionFilters(guardError.error, req, routeMeta, controllerName);
                    } else if (!allowed) {
                      response = new Response(
                        JSON.stringify(
                          createErrorResponse(
                            'Forbidden',
                            HttpStatusCode.FORBIDDEN,
                          ),
                        ),
                        {
                          status: app.options.httpEnvelope ? HttpStatusCode.OK : HttpStatusCode.FORBIDDEN,
                          headers: {
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            'Content-Type': 'application/json',
                          },
                        },
                      );
                    } else {
                      response = await interceptedHandler();
                    }
                  } else {
                    response = await interceptedHandler();
                  }
                }

                // Skip Date.now() when neither metrics nor tracing need duration
                const duration = (app.metricsService || traceSpan)
                  ? Date.now() - startTime
                  : 0;

                // Record metrics and end trace
                if (profiler) {
                  pMark = profiler.start('framework', 'metrics+trace');
                }
                if (app.metricsService && app.metricsService.recordHttpRequest) {
                  const durationSeconds = duration / 1000;
                  app.metricsService.recordHttpRequest({
                    method: observedMethod,
                    route: fullPath,
                    statusCode: response?.status || HttpStatusCode.OK,
                    duration: durationSeconds,
                    controller: controller.constructor.name,
                    action: 'unknown',
                  });
                }

                // End trace (sync — no Effect.runPromise overhead)
                if (traceSpan && app.traceService) {
                  try {
                    app.traceService.endHttpTraceSync(traceSpan, {
                      statusCode: response?.status || HttpStatusCode.OK,
                      responseSize: response?.headers?.get('content-length')
                        ? parseInt(response.headers.get('content-length')!, 10)
                        : undefined,
                      duration,
                    });
                  } catch (traceError) {
                    app.logger.error(
                      'Failed to end trace:',
                      traceError instanceof Error ? traceError : new Error(String(traceError)),
                    );
                  }
                }

                // Trace context is automatically scoped by requestContextStore.run()
                if (pMark) {
                  profiler!.end(pMark);
                }

                return response;
              } catch (error) {
                app.logger.error(
                  'Request handling error:',
                  error instanceof Error ? error : new Error(String(error)),
                );
                // Reachable only when framework code itself failed: a throwing
                // middleware, a metrics/profiler throw, or the default filter throwing.
                // Everything a route can throw is filtered below the middleware chain.
                const response = new Response(
                  JSON.stringify(
                    createErrorResponse('Internal Server Error', HttpStatusCode.INTERNAL_SERVER_ERROR),
                  ),
                  {
                    status: app.options.httpEnvelope
                      ? HttpStatusCode.OK
                      : HttpStatusCode.INTERNAL_SERVER_ERROR,
                    headers: {
                      // eslint-disable-next-line @typescript-eslint/naming-convention
                      'Content-Type': 'application/json',
                    },
                  },
                );
                const duration = Date.now() - startTime;

                // Record error metrics
                if (app.metricsService && app.metricsService.recordHttpRequest) {
                  const durationSeconds = duration / 1000;
                  app.metricsService.recordHttpRequest({
                    method: observedMethod,
                    route: fullPath,
                    statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                    duration: durationSeconds,
                    controller: controller.constructor.name,
                    action: 'unknown',
                  });
                }

                // End trace with error (sync)
                if (traceSpan && app.traceService) {
                  try {
                    traceSpan.events.push({
                      name: 'error',
                      timestamp: Date.now(),
                      attributes: {
                        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                        errorMessage: error instanceof Error ? error.message : String(error),
                      },
                    });
                    app.traceService.endHttpTraceSync(traceSpan, {
                      statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                      duration,
                    });
                  } catch (traceError) {
                    app.logger.error(
                      'Failed to end trace with error:',
                      traceError instanceof Error ? traceError : new Error(String(traceError)),
                    );
                  }
                }

                // Trace context is automatically scoped by requestContextStore.run()

                return response;
              }
            };

            // Each request begins its own trace. `ROOT_CONTEXT` and not `context.active()`:
            // Bun reuses the connection's async context across keep-alive requests, and
            // inheriting it would file the second request as a child of the first.
            //
            // This is also the scope `activateSpanSync` promotes the HTTP span into — entering it
            // here rather than around the span keeps the entire request body out of another
            // closure on a hot path that has been measured.
            //
            // Skipped entirely when no exporter is configured: `startHttpTraceSync` then takes
            // the lightweight path and creates no OpenTelemetry span, so there would be nothing
            // to promote and the extra AsyncLocalStorage frame would buy nothing. `@Traced`
            // methods still nest among themselves — `startActiveSpan` opens its own scope.
            const scopedRequestHandler = entersTraceScope
              ? (): Promise<Response> => inRootTraceScope(requestHandler, ownerTracer)
              : requestHandler;

            // Wrap in profiling scope for per-request mark isolation
            let response: Response;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let innerReport: any = null;
            if (profiler) {
              response = await runProfileScope(async () => {
                const res = await scopedRequestHandler();
                // Flush inside ALS scope to capture request-scoped marks
                innerReport = profiler.flush({ route: fullPath, method });

                return res;
              });
              // Inject outer total mark that spans everything (ALS overhead + requestHandler)
              const outerEndNs = Bun.nanoseconds();
              const totalDurationNs = outerEndNs - outerStartNs;
              if (innerReport) {
                innerReport.marks.unshift({
                  category: 'request',
                  label: 'total',
                  startNs: outerStartNs,
                  endNs: outerEndNs,
                  durationNs: totalDurationNs,
                });
                innerReport.totalNs = totalDurationNs;
                app.handleProfileReport(innerReport);
              }
            } else {
              response = await scopedRequestHandler();
            }

            return response;
          }); // end requestContextStore.run()
        };
      }

      // Build auto-configured security middleware from shorthand options.
      // These are prepended/appended in a fixed order: CORS → RateLimit → [user] → Security.
      const autoPrefix: Function[] = [];
      const autoSuffix: Function[] = [];

      if (this.options.cors) {
        const corsOpts = this.options.cors === true ? {} : this.options.cors;
        autoPrefix.push(CorsMiddleware.configure(corsOpts));
      }

      if (this.options.rateLimit) {
        const rlOpts = this.options.rateLimit === true ? {} : this.options.rateLimit;
        autoPrefix.push(RateLimitMiddleware.configure(rlOpts));
      }

      if (this.options.security) {
        const secOpts = this.options.security === true ? {} : this.options.security;
        autoSuffix.push(SecurityHeadersMiddleware.configure(secOpts));
      }

      // Application-wide middleware — resolve class constructors via root module DI
      const userMiddlewareClasses = (this.options.middleware as Function[] | undefined) ?? [];
      const allGlobalClasses = [...autoPrefix, ...userMiddlewareClasses, ...autoSuffix];
      const globalMiddleware: Function[] = allGlobalClasses.length > 0
        ? (this.ensureModule().resolveMiddleware?.(allGlobalClasses) ?? [])
        : [];

      // The resolved CORS middleware, if one is in the chain — used to answer a browser
      // preflight BEFORE routing. Global middleware is concatenated into registered route
      // handlers only, so an OPTIONS to a path whose controller declares just GET reached the
      // 404 fallback with no Access-Control-* headers, and the browser blocked every
      // cross-origin request carrying Authorization or a JSON content type.
      //
      // `resolveMiddleware` preserves input order 1:1, so the class index is the instance index.
      // Subclass detection is required because `CorsMiddleware.configure()` returns an anonymous
      // subclass, which is also how a user writing `middleware: [CorsMiddleware.configure(...)]`
      // by hand keeps working.
      const corsIndex = allGlobalClasses.findIndex((cls) =>
        cls === CorsMiddleware
        || (cls as { prototype?: unknown }).prototype instanceof CorsMiddleware);
      const corsPreflight = corsIndex === -1
        ? undefined
        : (globalMiddleware[corsIndex] as ResolvedMiddleware | undefined);
      // `preflightContinue: true` means the caller wants a downstream handler to produce the
      // preflight response, so the short-circuit must not fire. Read off the resolved instance
      // rather than `this.options.cors`, because a manually supplied
      // `middleware: [CorsMiddleware.configure({ preflightContinue: true })]` never goes
      // through `options.cors` at all.
      const corsContinues = (corsPreflight as { _middlewareInstance?: CorsMiddleware } | undefined)
        ?._middlewareInstance?.continuesPreflight === true;

      // Add routes from controllers
      for (const controllerClass of controllers) {
        const controllerMetadata = getControllerMetadata(controllerClass);
        if (!controllerMetadata) {
          // WebSocket gateways are in the controllers array but have no @Controller metadata — skip them.
          // Non-gateway classes without metadata indicate a missing @Controller decorator.
          if (isWebSocketGateway(controllerClass)) {
            continue;
          }
          throw new OneBunBootstrapError(
            `No metadata found for controller: ${controllerClass.name}. Ensure the @Controller decorator is applied.`,
          );
        }

        // Get controller instance from module
        if (!this.ensureModule().getControllerInstance) {
          throw new OneBunBootstrapError(
            `Module does not support getControllerInstance for ${controllerClass.name}.`,
          );
        }

        const controller = this.ensureModule().getControllerInstance!(controllerClass) as Controller;
        if (!controller) {
          throw new OneBunBootstrapError(
            `Controller instance not found for ${controllerClass.name}. ` +
              'Ensure it is listed in the module providers or controllers.',
          );
        }

        const controllerPath = controllerMetadata.path;

        // Module-level middleware (already resolved bound functions)
        const moduleMiddleware = this.ensureModule().getModuleMiddleware?.(controllerClass) ?? [];

        // Resolve controller-level and route-level middleware with the owner module's DI
        const ownerModule =
          this.ensureModule().getOwnerModuleForController?.(controllerClass) ?? this.ensureModule();

        // Controller-level middleware — resolve via owner module DI
        const ctrlMiddlewareClasses = getControllerMiddleware(controllerClass);
        const ctrlMiddleware: Function[] = ctrlMiddlewareClasses.length > 0
          ? (ownerModule.resolveMiddleware?.(ctrlMiddlewareClasses) ?? [])
          : [];

        for (const route of controllerMetadata.routes) {
          // Combine: appPrefix + controllerPath + routePath
          // Normalize to ensure consistent matching (e.g., '/api/users/' -> '/api/users')
          const fullPath = joinRoutePath(appPrefix, controllerPath, route.path);
          const method = this.mapHttpMethod(route.method);
          const handler = (controller as unknown as Record<string, Function>)[route.handler].bind(
            controller,
          );

          // Route-level middleware — resolve via owner module DI
          const routeMiddlewareClasses = route.middleware ?? [];
          const routeMiddleware: Function[] = routeMiddlewareClasses.length > 0
            ? (ownerModule.resolveMiddleware?.(routeMiddlewareClasses) ?? [])
            : [];

          // Merge middleware: global → module → controller → route
          const mergedMiddleware = [
            ...globalMiddleware,
            ...moduleMiddleware,
            ...ctrlMiddleware,
            ...routeMiddleware,
          ];

          // Merge guards: controller-level first, then route-level.
          // Resolved through the owning module ONCE here, like interceptors — guards used to
          // be constructed with `new guard()` on every request, so a guard extending
          // BaseService saw `this.config` and `this.logger` as undefined at request time.
          const ctrlGuards = getControllerGuards(controllerClass);
          const routeGuards = route.guards ?? [];
          const mergedGuardClasses = [...ctrlGuards, ...routeGuards];
          const mergedGuards = mergedGuardClasses.length > 0
            ? (ownerModule.resolveGuards?.(mergedGuardClasses) ?? mergedGuardClasses)
            : [];

          // Merge exception filters: global → controller → route (route has highest priority)
          const globalFilters = (this.options.filters as ExceptionFilter[] | undefined) ?? [];
          const ctrlFilters = getControllerFilters(controllerClass);
          const routeFilters = route.filters ?? [];
          const mergedFilters = [...globalFilters, ...ctrlFilters, ...routeFilters];

          // Merge interceptors: global → controller → route (global wraps outermost)
          const globalInterceptorClasses = this.options.interceptors ?? [];
          const ctrlInterceptors = getControllerInterceptors(controllerClass);
          const routeInterceptors = route.interceptors ?? [];
          const mergedInterceptorClasses = [...globalInterceptorClasses, ...ctrlInterceptors, ...routeInterceptors];
          const resolvedInterceptors = mergedInterceptorClasses.length > 0
            ? (ownerModule.resolveInterceptors?.(mergedInterceptorClasses) ?? [])
            : [];

          const routeWithMergedMiddleware: RouteMetadata = {
            ...route,
            middleware: mergedMiddleware.length > 0 ? mergedMiddleware : undefined,
            guards: mergedGuards.length > 0 ? mergedGuards : undefined,
            filters: mergedFilters.length > 0 ? mergedFilters : undefined,
          };

          // Create wrapped handler with full OneBun lifecycle (tracing, metrics, middleware)
          const wrappedHandler = createRouteHandler(
            routeWithMergedMiddleware, handler, controller, fullPath, method,
            resolvedInterceptors.length > 0 ? resolvedInterceptors : undefined,
          );

          // Collect into the registry; bunRoutes is filled in once, below.
          registerRoute(controllerClass, route, fullPath, wrappedHandler);

          // Register trailing slash variant for consistent matching
          // (e.g., /api/users and /api/users/ both map to the same handler)
          if (fullPath.length > 1 && !fullPath.endsWith('/')) {
            registerRoute(controllerClass, route, fullPath + '/', wrappedHandler);
          }
        }
      }

      // Materialise the registry into the two shapes Bun's `routes` option understands.
      //
      // PRECEDENCE RULE — an explicitly declared verb always beats `@All()` on the same
      // path. `@Get('/x')` next to `@All('/x')` sends GET to the @Get handler and every
      // other verb to the @All handler, whichever order the decorators were written in.
      //
      // A path with no `@All()` keeps the method-map form, so Bun itself rejects verbs
      // nobody declared (405/404 via the fetch fallback). A path that carries an `@All()`
      // becomes a bare function instead, because the method map has no "every other verb"
      // slot: Bun then routes EVERY method to it — GET…DELETE, OPTIONS, HEAD, and
      // non-standard verbs such as PROPFIND, PURGE, LOCK and QUERY — with `req.params`
      // intact. That is what makes @All a true catch-all, matching NestJS `router.all()`.
      // The dispatcher must always return a Response: a bare route function that returns
      // undefined does NOT fall through to `fetch`, Bun logs
      // "Expected a Response object" and serves its own welcome page.
      for (const [pathKey, registration] of routeRegistry) {
        const { methods, catchAll } = registration;

        if (!catchAll) {
          bunRoutes[pathKey] = Object.fromEntries(methods);

          continue;
        }

        // `methods` stays a Map so that a request whose method spells an
        // Object.prototype key cannot resolve to an inherited function.
        bunRoutes[pathKey] = (
          req: OneBunRequest,
          server: ReturnType<typeof Bun.serve>,
        ): Promise<Response> => (methods.get(req.method) ?? catchAll)(req, server);
      }

      // Add framework endpoints to routes (docs, metrics)
      if (app.options.docs?.enabled !== false && app.openApiSpec) {
        if (app.swaggerHtml) {
          bunRoutes[docsPath] = {

            GET: () => new Response(app.swaggerHtml!, {
              headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': 'text/html; charset=utf-8',
              },
            }),
          };
        }
        bunRoutes[openApiPath] = {

          GET: () => new Response(JSON.stringify(app.openApiSpec, null, 2), {
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
          }),
        };
      }

      if (app.metricsService) {
        bunRoutes[metricsPath] = {

          async GET() {
            try {
              const metrics = await app.metricsService.getMetrics();

              return new Response(metrics, {
                headers: {
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'Content-Type': app.metricsService.getContentType(),
                },
              });
            } catch (error) {
              app.logger.error(
                'Failed to get metrics:',
                error instanceof Error ? error : new Error(String(error)),
              );

              return new Response('Internal Server Error', {
                status: HttpStatusCode.INTERNAL_SERVER_ERROR,
              });
            }
          },
        };
      }

      // Log all routes
      for (const controllerClass of controllers) {
        const metadata = getControllerMetadata(controllerClass);
        if (!metadata) {
          continue;
        }

        for (const route of metadata.routes) {
          const fullPath = joinRoutePath(appPrefix, metadata.path, route.path);
          const method = this.mapHttpMethod(route.method);
          this.logger.info(`Mapped {${method}} route: ${fullPath}`);
        }
      }

      // Call onApplicationInit lifecycle hook for all services and controllers
      if (this.ensureModule().callOnApplicationInit) {
        await this.ensureModule().callOnApplicationInit!();
        this.logger.debug('Application initialization hooks completed');
      }

      const hasWebSocketGateways = this.wsHandler?.hasGateways() ?? false;

      // Prepare WebSocket handlers if gateways exist
      // When no gateways, use no-op handlers (required by Bun.serve)
      const wsHandlers = hasWebSocketGateways ? this.wsHandler!.createWebSocketHandlers() : {

        open() { /* no-op */ },

        message() { /* no-op */ },

        close() { /* no-op */ },

        drain() { /* no-op */ },
      };

      // Static file serving: resolve root and setup existence cache (CacheService or in-memory Map)
      const staticOpts = this.options.static;
      let staticRootResolved: string | null = null;
      let staticPathPrefix: string | undefined;
      let staticFallbackFile: string | undefined;
      let staticCacheTtlMs = 0;
      // Cache interface: get(key) => value | undefined, set(key, value, ttlMs)
      type StaticExistsCache = {
        get(key: string): Promise<boolean | undefined>;
        set(key: string, value: boolean, ttlMs: number): Promise<void>;
      };
      let staticExistsCache: StaticExistsCache | null = null;

      if (staticOpts?.root) {
        staticRootResolved = path.resolve(staticOpts.root);
        staticPathPrefix = staticOpts.pathPrefix;
        staticFallbackFile = staticOpts.fallbackFile;
        staticCacheTtlMs = staticOpts.fileExistenceCacheTtlMs ?? DEFAULT_STATIC_FILE_EXISTENCE_CACHE_TTL_MS;

        if (staticCacheTtlMs > 0) {
          if (cacheServiceClass) {
            try {
              const cacheService = this.ensureModule().getServiceByClass?.(cacheServiceClass);
              if (cacheService && typeof cacheService.get === 'function' && typeof cacheService.set === 'function') {
                staticExistsCache = {
                  get: (key: string) => cacheService.get(STATIC_EXISTS_CACHE_PREFIX + key),
                  set: (key: string, value: boolean, ttlMs: number) =>
                    cacheService.set(STATIC_EXISTS_CACHE_PREFIX + key, value, { ttl: ttlMs }),
                };
                this.logger.debug('Static file existence cache using CacheService');
              }
            } catch {
              // CacheService not in module, use fallback
            }
          }
          if (!staticExistsCache) {
            const map = new Map<string, { exists: boolean; expiresAt: number }>();
            staticExistsCache = {
              async get(key: string): Promise<boolean | undefined> {
                const entry = map.get(key);
                if (!entry) {
                  return undefined;
                }
                if (staticCacheTtlMs > 0 && Date.now() > entry.expiresAt) {
                  map.delete(key);

                  return undefined;
                }

                return entry.exists;
              },
              async set(key: string, value: boolean, ttlMs: number): Promise<void> {
                map.set(key, {
                  exists: value,
                  expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER,
                });
              },
            };
            this.logger.debug('Static file existence cache using in-memory Map');
          }
        }
      }

      // Flush bootstrap profiling report
      if (PROFILING_ENABLED) {
        const profiler = getProfiler()!;
        const bootstrapReport = profiler.flush({ route: 'bootstrap' });
        this.handleProfileReport(bootstrapReport);
      }

      // Register profiling diagnostic endpoint
      if (PROFILING_ENABLED && this.options.profiling?.endpoint) {
        const profilePath = this.options.profiling.endpoint;
        bunRoutes[profilePath] = {

          GET: () => new Response(JSON.stringify(this.profilingReports), {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'Content-Type': 'application/json' },
          }),
        };
      }

      this.server = Bun.serve<WsClientData>({
        port: this.options.port,
        hostname: this.options.host,
        // Idle timeout (seconds) — default 120s to support SSE and long-running requests
        idleTimeout: this.options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
        // WebSocket handlers
        websocket: wsHandlers,
        // Bun routes API: all endpoints are handled here
        routes: bunRoutes,
        // Fallback: only WebSocket upgrade and 404
        async fetch(req, server) {
          // The unrouted entry — WebSocket upgrades, static files, 404s. Bun's `routes`
          // map bypasses `fetch` entirely for a matched route, so this is a second
          // outermost entry, not a wrapper around the first. Binding here as well keeps
          // the unmatched path from falling back to one shared identity the moment
          // anything downstream starts asking who called.
          bindRequestClientAddress(req, server);

          // Answer a browser preflight before anything else looks at the request.
          //
          // Bun's `routes` table has already run, so an explicitly declared `@Options` route
          // never reaches here and cannot be shadowed — precedence is free. Reaching this point
          // means no route matched the method and path, which for a preflight is the normal
          // case: a controller declaring only `@Get` has no OPTIONS route, and the browser's
          // preflight was answered with a bare 404 carrying no `Access-Control-*` headers, so
          // every cross-origin request with `Authorization` or a JSON content type was blocked.
          //
          // BEFORE the WebSocket block on purpose. `isSocketIoPath` below is method-agnostic, so
          // with Socket.IO enabled a cross-origin `OPTIONS /socket.io/...` would enter
          // `handleUpgrade()`, fail to upgrade, and return 400 with no CORS headers. Placing the
          // short-circuit after that block would leave the bug alive for every Socket.IO app.
          //
          // Gated on `Access-Control-Request-Method`, which the Fetch spec requires on every real
          // preflight: a bare `curl -X OPTIONS` is API probing, not CORS, and keeps its honest
          // 404. Only the CORS middleware runs — rate limiting and auth must never see a
          // credential-less preflight, and they already never do on the routed path, because
          // CORS sits first in the chain and returns without calling `next()`.
          if (
            corsPreflight !== undefined
            && !corsContinues
            && req.method === 'OPTIONS'
            && req.headers.has('access-control-request-method')
          ) {
            // `OneBunRequest` is Bun's `BunRequest`, which carries `params` and `cookies`; the
            // fallback `req` is a plain `Request`. A subclass overriding `use()` and reading
            // either would throw on `undefined`, so both are supplied rather than cast away.
            const preflightRequest = Object.assign(req, {
              params: {},
              cookies: new Map<string, string>(),
            }) as unknown as OneBunRequest;

            return await corsPreflight(
              preflightRequest,
              async () => new Response('Not Found', { status: HttpStatusCode.NOT_FOUND }),
            );
          }

          // Handle WebSocket upgrade if gateways exist
          if (hasWebSocketGateways && app.wsHandler) {
            const upgradeHeader = req.headers.get('upgrade')?.toLowerCase();
            const socketioEnabled = app.options.websocket?.socketio?.enabled ?? false;
            const socketioPath = app.options.websocket?.socketio?.path ?? '/socket.io';

            const url = new URL(req.url);
            const requestPath = normalizePath(url.pathname);
            const isSocketIoPath = socketioEnabled && requestPath.startsWith(socketioPath);
            if (upgradeHeader === 'websocket' || isSocketIoPath) {
              const response = await app.wsHandler.handleUpgrade(req, server);
              if (response === undefined) {
                return undefined; // Successfully upgraded
              }

              return response;
            }
          }

          // Static file serving (GET/HEAD only)
          if (staticRootResolved && (req.method === 'GET' || req.method === 'HEAD')) {
            const requestPath = normalizePath(new URL(req.url).pathname);
            const prefix = staticPathPrefix ?? '/';
            const hasPrefix = prefix !== '' && prefix !== '/';
            if (hasPrefix && !requestPath.startsWith(prefix)) {
              return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
            }
            const relativePath = hasPrefix ? requestPath.slice(prefix.length) || '/' : requestPath;
            const resolvedPath = resolvePathUnderRoot(staticRootResolved, relativePath);
            if (resolvedPath === null) {
              return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
            }

            const cache = staticCacheTtlMs > 0 ? staticExistsCache : null;
            const cacheKey = resolvedPath;
            if (cache) {
              const cached = await cache.get(cacheKey);
              if (cached === true) {
                return new Response(Bun.file(resolvedPath));
              }
              if (cached === false) {
                if (staticFallbackFile) {
                  const fallbackResolved = resolvePathUnderRoot(staticRootResolved, staticFallbackFile);
                  if (fallbackResolved !== null) {
                    return new Response(Bun.file(fallbackResolved));
                  }
                }

                return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
              }
            }

            const file = Bun.file(resolvedPath);
            const exists = await file.exists();
            if (cache && staticCacheTtlMs > 0) {
              await cache.set(cacheKey, exists, staticCacheTtlMs);
            }
            if (exists) {
              return new Response(file);
            }
            if (staticFallbackFile) {
              const fallbackResolved = resolvePathUnderRoot(staticRootResolved, staticFallbackFile);
              if (fallbackResolved !== null) {
                const fallbackFile = Bun.file(fallbackResolved);
                if (await fallbackFile.exists()) {
                  return new Response(fallbackFile);
                }
              }
            }

            return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
          }

          // 404 for everything not matched by routes
          return new Response('Not Found', { status: HttpStatusCode.NOT_FOUND });
        },
      });

      // Initialize WebSocket gateways with server
      if (hasWebSocketGateways && this.wsHandler && this.server) {
        this.wsHandler.initializeGateways(this.server);
        this.logger.info(
          `WebSocket server (native) enabled at ws://${this.options.host}:${this.options.port}`,
        );
        const socketioEnabled = this.options.websocket?.socketio?.enabled ?? false;
        if (socketioEnabled) {
          const sioPath = this.options.websocket?.socketio?.path ?? '/socket.io';
          this.logger.info(
            `WebSocket server (Socket.IO) enabled at ws://${this.options.host}:${this.options.port}${sioPath}`,
          );
        }
      }

      this.logger.info(`Server started on http://${this.options.host}:${this.options.port}`);
      if (staticRootResolved) {
        this.logger.info(`Static files served from ${staticRootResolved}`);
      }
      if (this.metricsService) {
        this.logger.info(
          `Metrics available at http://${this.options.host}:${this.options.port}${metricsPath}`,
        );
      } else if (this.options.metrics?.enabled !== false) {
        this.logger.warn(
          'Metrics enabled but @onebun/metrics module not available. Install with: bun add @onebun/metrics',
        );
      }

      // Enable graceful shutdown by default (can be disabled with gracefulShutdown: false)
      if (this.options.gracefulShutdown !== false) {
        this.enableGracefulShutdown();
      }
    } catch (error) {
      this.logger.error(
        'Failed to start application:',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }

    /**
     * Extract an OneBunFile from a JSON value.
     * Supports two formats:
     * - String: raw base64 data
     * - Object: { data: string, filename?: string, mimeType?: string }
     */
    function extractFileFromJsonValue(value: unknown): OneBunFile | undefined {
      if (typeof value === 'string' && value.length > 0) {
        return OneBunFile.fromBase64(value);
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        if (typeof obj.data === 'string' && obj.data.length > 0) {
          return OneBunFile.fromBase64(
            obj.data,
            typeof obj.filename === 'string' ? obj.filename : undefined,
            typeof obj.mimeType === 'string' ? obj.mimeType : undefined,
          );
        }
      }

      return undefined;
    }

    /**
     * Extract a file from a JSON body by field name
     */
    function extractFileFromJson(
      jsonBody: Record<string, unknown>,
      fieldName: string,
    ): OneBunFile | undefined {
      const fieldValue = jsonBody[fieldName];

      return extractFileFromJsonValue(fieldValue);
    }

    /**
     * Execute route handler with parameter injection and validation.
     * Path parameters come from BunRequest.params (populated by Bun routes API).
     * Query parameters are extracted separately from the URL.
     */
    /**
     * Apply the route's exception filters to a thrown error.
     *
     * SINGLE SOURCE OF FILTER APPLICATION. Every execution path that can throw while
     * producing a route response must sit inside a `try` that delegates here. A path
     * added outside one is silently unfiltered — that was the original defect, where a
     * handler with no decorated parameters took the fast path and its `HttpException`
     * left the framework as a bare 500 `text/plain`. Call sites, `grep` for the name and
     * expect five:
     *   1. `executeHandler`'s catch                        — full-path handler
     *   2. the `isFastPath` arm of the `callHandler` ternary — fast-path handler
     *   3. the `interceptedHandler` arm                     — throwing interceptors
     *   4. the guard call inside `guardedHandler`           — throwing guards, with middleware
     *   5. the inline guard call                            — throwing guards, without
     *
     * DELIBERATELY NOT applied to the middleware chain. Middleware post-processes the
     * Response that `next()` returns — `CorsMiddleware`, `SecurityHeadersMiddleware` and
     * `RateLimitMiddleware` all set headers AFTER `await next()`. Filtering above the
     * chain would unwind past those blocks and strip the headers from every error
     * response. All five sites sit BELOW the chain, so a filtered response still flows
     * back out through it. A throwing middleware is therefore not filtered by design and
     * falls to the last-resort outer catch.
     *
     * Only the last filter runs — route-level filters are appended last and win. A filter
     * that throws, or returns something other than a Response, degrades to the default
     * filter instead of escaping: applying filters on more paths widens the blast radius
     * of a buggy user filter, so the fallback is part of the fix rather than a bonus.
     */
    async function applyExceptionFilters(
      error: unknown,
      req: OneBunRequest,
      routeMeta: RouteMetadata,
      controllerName: string,
    ): Promise<Response> {
      // Log the unexpected bucket only: HttpException and OneBunBaseError carry a
      // deliberate status and are ordinary control flow, not incidents.
      if (!(error instanceof HttpException) && !(error instanceof OneBunBaseError)) {
        appLogger.error(
          `Unhandled error in ${controllerName}.${routeMeta.handler ?? 'unknown'}:`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      const ctx = new HttpExecutionContextImpl(req, routeMeta.handler ?? '', controllerName);
      const filters = routeMeta.filters;

      if (filters && filters.length > 0) {
        try {
          const filtered = await filters[filters.length - 1].catch(error, ctx);
          if (filtered instanceof Response) {
            return filtered;
          }

          appLogger.error(
            'Exception filter returned a non-Response; falling back to the default filter',
            new Error(`${controllerName}.${routeMeta.handler ?? 'unknown'}`),
          );
        } catch (filterError) {
          appLogger.error(
            'Exception filter threw; falling back to the default filter',
            filterError instanceof Error ? filterError : new Error(String(filterError)),
          );
        }
      }

      return await appDefaultExceptionFilter.catch(error, ctx);
    }

    /**
     * Execute route handler with parameter injection, validation, and response wrapping.
     * Called only for routes with params or response schemas (full path).
     * Simple routes use the inline fast path in createRouteHandler.
     */
    async function executeHandler(
      boundHandler: Function,
      routeMeta: RouteMetadata,
      controller: Controller,
      controllerName: string,
      sseOptions: SseDecoratorOptions | undefined,
      req: OneBunRequest,
      queryParams: Record<string, string | string[]>,
      profiler: import('../profiler').Profiler | null,
    ): Promise<Response> {
      try {
      // Prepare arguments array based on parameter metadata
        const args: unknown[] = [];

        // Sort params by index to ensure correct order
        const sortedParams = [...(routeMeta.params || [])].sort((a, b) => a.index - b.index);

        // Pre-parse body for file upload params (FormData or JSON, cached for all params)
        const needsFileData = sortedParams.some(
          (p) =>
            p.type === ParamType.FILE ||
          p.type === ParamType.FILES ||
          p.type === ParamType.FORM_FIELD,
        );

        // Validate that @Body and file decorators are not used on the same method
        if (needsFileData) {
          const hasBody = sortedParams.some((p) => p.type === ParamType.BODY);
          if (hasBody) {
            throw new HttpException(
              HttpStatusCode.BAD_REQUEST,
              'Cannot use @Body() together with @UploadedFile/@UploadedFiles/@FormField on the same method. ' +
            'Both consume the request body. Use file decorators for multipart/base64 uploads.',
            );
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let formData: any = null;
        let jsonBody: Record<string, unknown> | null = null;
        let isMultipart = false;

        if (needsFileData) {
          const contentType = req.headers.get('content-type') || '';

          if (contentType.includes('multipart/form-data')) {
            isMultipart = true;
            try {
              formData = await req.formData();
            } catch {
              formData = null;
            }
          } else if (contentType.includes('application/json')) {
            try {
              const parsed = await req.json();
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                jsonBody = parsed as Record<string, unknown>;
              }
            } catch {
              jsonBody = null;
            }
          }
        }

        let paramsMark: ProfileMark | undefined;
        if (profiler) {
          paramsMark = profiler.start('handler', 'params:extract');
        }
        for (const param of sortedParams) {
          switch (param.type) {
            case ParamType.PATH:
            // Use req.params from BunRequest (natively populated by Bun routes API)
              args[param.index] = param.name
                ? (req.params as Record<string, string>)[param.name]
                : undefined;
              break;

            case ParamType.QUERY:
              args[param.index] = param.name ? queryParams[param.name] : undefined;
              break;

            case ParamType.BODY:
              try {
                args[param.index] = await req.json();
              } catch {
                args[param.index] = undefined;
              }
              break;

            case ParamType.HEADER:
              args[param.index] = param.name ? req.headers.get(param.name) : undefined;
              break;

            case ParamType.COOKIE:
              args[param.index] = param.name ? req.cookies.get(param.name) ?? undefined : undefined;
              break;

            case ParamType.REQUEST:
              args[param.index] = req;
              break;

            case ParamType.RESPONSE:
            // For now, we don't support direct response manipulation
              args[param.index] = undefined;
              break;

            case ParamType.FILE: {
              let file: OneBunFile | undefined;

              if (isMultipart && formData && param.name) {
                const entry = formData.get(param.name);
                if (entry instanceof File) {
                  file = new OneBunFile(entry);
                }
              } else if (jsonBody && param.name) {
                file = extractFileFromJson(jsonBody, param.name);
              }

              if (file && param.fileOptions) {
                validateFile(file, param.fileOptions, param.name);
              }

              args[param.index] = file;
              break;
            }

            case ParamType.FILES: {
              let files: OneBunFile[] = [];

              if (isMultipart && formData) {
                if (param.name) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const entries: any[] = formData.getAll(param.name);
                  files = entries
                    .filter((entry: unknown): entry is File => entry instanceof File)
                    .map((f: File) => new OneBunFile(f));
                } else {
                // Get all files from all fields
                  for (const [, value] of formData.entries()) {
                    if (value instanceof File) {
                      files.push(new OneBunFile(value));
                    }
                  }
                }
              } else if (jsonBody) {
                if (param.name) {
                  const fieldValue = jsonBody[param.name];
                  if (Array.isArray(fieldValue)) {
                    files = fieldValue
                      .map((item) => extractFileFromJsonValue(item))
                      .filter((f): f is OneBunFile => f !== undefined);
                  }
                } else {
                // Extract all file-like values from JSON
                  for (const [, value] of Object.entries(jsonBody)) {
                    const file = extractFileFromJsonValue(value);
                    if (file) {
                      files.push(file);
                    }
                  }
                }
              }

              // Validate maxCount
              if (param.fileOptions?.maxCount !== undefined && files.length > param.fileOptions.maxCount) {
                throw new HttpException(
                  HttpStatusCode.BAD_REQUEST,
                  `Too many files for "${param.name || 'upload'}". Got ${files.length}, max is ${param.fileOptions.maxCount}`,
                );
              }

              // Validate each file
              if (param.fileOptions) {
                for (const file of files) {
                  validateFile(file, param.fileOptions, param.name);
                }
              }

              args[param.index] = files;
              break;
            }

            case ParamType.FORM_FIELD: {
              let value: string | undefined;

              if (isMultipart && formData && param.name) {
                const entry = formData.get(param.name);
                if (typeof entry === 'string') {
                  value = entry;
                }
              } else if (jsonBody && param.name) {
                const jsonValue = jsonBody[param.name];
                if (jsonValue !== undefined && jsonValue !== null) {
                  value = String(jsonValue);
                }
              }

              args[param.index] = value;
              break;
            }

            default:
              args[param.index] = undefined;
          }

          // Validate parameter if required
          if (param.isRequired && (args[param.index] === undefined || args[param.index] === null)) {
            throw new HttpException(HttpStatusCode.BAD_REQUEST, `Required parameter ${param.name || param.index} is missing`);
          }

          // For FILES type, also check for empty array when required
          if (
            param.isRequired &&
          param.type === ParamType.FILES &&
          Array.isArray(args[param.index]) &&
          (args[param.index] as unknown[]).length === 0
          ) {
            throw new HttpException(HttpStatusCode.BAD_REQUEST, `Required parameter ${param.name || param.index} is missing`);
          }

          // Apply arktype schema validation if provided
          if (param.schema && args[param.index] !== undefined) {
            try {
              args[param.index] = validateOrThrow(param.schema, args[param.index]);
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              throw new HttpException(
                HttpStatusCode.BAD_REQUEST,
                `Parameter ${param.name || param.index} validation failed: ${errorMessage}`,
              );
            }
          }
        }
        if (paramsMark) {
          profiler!.end(paramsMark);
        }
        // Call handler with injected parameters
        let handlerMark: ProfileMark | undefined;
        if (profiler) {
          handlerMark = profiler.start('handler', `${controllerName}.${routeMeta.handler ?? 'unknown'}`);
        }
        const result = await boundHandler(...args);
        if (handlerMark) {
          profiler!.end(handlerMark);
        }

        // Handle SSE response - wrap async generator in SSE Response
        if (sseOptions !== undefined) {
          return createSseResponseFromResult(result, sseOptions);
        }

        // Initialize variables for response validation
        let validatedResult = result;
        let responseStatusCode = HttpStatusCode.OK;

        // If the result is already a Response object, extract body and validate it
        if (result instanceof Response) {
          responseStatusCode = result.status;

          // Extract and parse response body for validation
          const contentType = result.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              // Clone response to avoid consuming the body
              const clonedResponse = result.clone();
              const bodyText = await clonedResponse.text();
              const bodyData = bodyText ? JSON.parse(bodyText) : null;

              // Validate response body if schema is provided
              if (routeMeta.responseSchemas && routeMeta.responseSchemas.length > 0) {
                const responseSchema = routeMeta.responseSchemas.find(
                  (rs) => rs.statusCode === responseStatusCode,
                ) || routeMeta.responseSchemas.find(
                  (rs) => rs.statusCode === HttpStatusCode.OK,
                ) || routeMeta.responseSchemas[0];

                if (responseSchema?.schema) {
                  try {
                    validatedResult = validateOrThrow(responseSchema.schema, stripUndefined(bodyData));
                  } catch (error) {
                    const errorMessage =
                      error instanceof Error ? error.message : String(error);
                    throw new Error(`Response validation failed: ${errorMessage}`);
                  }
                } else {
                  validatedResult = bodyData;
                }
              } else {
                validatedResult = bodyData;
              }

              // Preserve all original headers (including multiple Set-Cookie)
              // using new Headers() constructor instead of Object.fromEntries()
              // which would lose duplicate header keys
              const newHeaders = new Headers(result.headers);
              newHeaders.set('Content-Type', 'application/json');

              // Create new Response with validated data
              return new Response(JSON.stringify(validatedResult), {
                status: responseStatusCode,
                headers: newHeaders,
              });
            } catch {
              // If parsing fails, return original response
              return result;
            }
          } else {
            // For non-JSON responses, return as-is (can't validate)
            return result;
          }
        }

        // Validate response against schema if provided
        if (routeMeta.responseSchemas && routeMeta.responseSchemas.length > 0) {
          // Find matching response schema (default to 200 if not found)
          const responseSchema = routeMeta.responseSchemas.find(
            (rs) => rs.statusCode === HttpStatusCode.OK,
          ) || routeMeta.responseSchemas[0];

          if (responseSchema?.schema) {
            try {
              validatedResult = validateOrThrow(responseSchema.schema, stripUndefined(validatedResult));
              responseStatusCode = responseSchema.statusCode;
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              throw new Error(`Response validation failed: ${errorMessage}`);
            }
          }
        }

        // If the result is already in standardized format, return it as JSON
        if (
          typeof validatedResult === 'object' &&
          validatedResult !== null &&
          'success' in validatedResult
        ) {
          let serMark: ProfileMark | undefined;
          if (profiler) {
            serMark = profiler.start('framework', 'response:serialize');
          }
          const resp = new Response(JSON.stringify(validatedResult), {
            status: responseStatusCode,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
          });
          if (serMark) {
            profiler!.end(serMark);
          }

          return resp;
        }

        // Otherwise, wrap in standardized success response
        let serializeMark: ProfileMark | undefined;
        if (profiler) {
          serializeMark = profiler.start('framework', 'response:serialize');
        }
        const successResponse = createSuccessResponse(validatedResult);

        const resp = new Response(JSON.stringify(successResponse), {
          status: responseStatusCode,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
        if (serializeMark) {
          profiler!.end(serializeMark);
        }

        return resp;
      } catch (error) {
        return await applyExceptionFilters(error, req, routeMeta, controllerName);
      }
    }

    /**
     * Create SSE Response from handler result
     * Handles both async generators and already-created Responses
     */
    function createSseResponseFromResult(
      result: unknown,
      options: SseDecoratorOptions,
    ): Response {
      // If result is already a Response (e.g., from controller.sse()), return it
      if (result instanceof Response) {
        return result;
      }

      // Check if result is an async iterable (generator)
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // Apply default heartbeat if none specified to keep the connection alive
        const effectiveOptions = {
          ...options,
          heartbeat: options.heartbeat ?? DEFAULT_SSE_HEARTBEAT_MS,
        };
        const stream = createSseStream(
          result as AsyncIterable<unknown>,
          effectiveOptions,
        );

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

      // Fallback: return error if result is not valid for SSE
      throw new Error(
        'SSE endpoint must return an async generator or a Response object. ' +
        'Use "async *methodName()" or return this.sse(generator).',
      );
    }
  }

  /**
   * Stop the application with graceful shutdown.
   *
   * Idempotent and concurrency-safe: every call after the first awaits the same shutdown
   * and performs no second pass over the destroy hooks. Bounded by `shutdownTimeout` —
   * it always resolves, even if a request or a hook never does.
   *
   * @param options - Shutdown options
   */
  async stop(options?: { closeSharedRedis?: boolean; signal?: string }): Promise<void> {
    await this.runShutdown(options);
  }

  /**
   * The shutdown latch. The first caller runs the sequence; everyone after — a second
   * `stop()`, a second signal, the orchestrator stopping an already-stopped child —
   * awaits that same promise and its outcome.
   */
  private async runShutdown(
    options?: { closeSharedRedis?: boolean; signal?: string },
  ): Promise<ShutdownOutcome> {
    this.shutdownPromise ??= this.executeShutdown(options);

    return await this.shutdownPromise;
  }

  /**
   * Run the shutdown sequence against a hard deadline.
   *
   * The sequence is raced, not cancelled: a hook that never returns cannot be interrupted
   * from the outside, so the deadline stops *waiting* for it, names it, and lets the
   * caller decide (the signal path exits with code 1).
   */
  private async executeShutdown(
    options?: { closeSharedRedis?: boolean; signal?: string },
  ): Promise<ShutdownOutcome> {
    const budgetMs = this.resolveShutdownTimeout();
    const outcome: ShutdownOutcome = {
      timedOut: false, phase: null, forceClosed: 0, failures: [], 
    };
    const deadline = createDeadline(budgetMs);

    // A backstop, not the error path. Every step inside `performShutdown` is individually
    // guarded, so a rejection reaching here means the guard itself is broken — which is worth
    // saying differently from a step that failed and was handled.
    const sequence = this.performShutdown(options, outcome).then(
      () => 'done' as const,
      (error: unknown) => {
        this.logger.error(
          'Shutdown sequence failed outside any guarded step — this is a framework bug:',
          error instanceof Error ? error : new Error(String(error)),
        );

        return 'done' as const;
      },
    );

    const result = await Promise.race([sequence, deadline.expired]);
    deadline.cancel();

    if (result === 'timeout') {
      outcome.timedOut = true;
      this.logger.error(
        `Shutdown timed out after ${budgetMs}ms while ${outcome.phase ?? 'stopping'}; `
        + 'abandoning the rest of the teardown',
      );
    }

    if (outcome.failures.length > 0) {
      // One summary line naming every phase that failed. The per-step lines carry the errors;
      // this one exists so an operator scanning the tail of the log sees the whole picture
      // rather than whichever failure happened to be last.
      this.logger.error(
        `Shutdown completed with ${outcome.failures.length} failed step(s): `
        + outcome.failures.join(', '),
      );
    }

    return outcome;
  }

  /** Resolve the shutdown budget, ignoring non-positive and non-finite overrides. */
  private resolveShutdownTimeout(): number {
    const configured = this.options.shutdownTimeout;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return configured;
    }

    return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  /**
   * Run one shutdown step, and keep going if it rejects.
   *
   * The sequence used to be a chain of bare awaits, so the FIRST step that rejected abandoned
   * every later one — and the only trace was a single line the process was about to stop being
   * able to emit. In practice the likely rejecter is the trace flush, which pushes the last span
   * batch to a collector that is usually going down with the pod. When it rejected, user
   * `onModuleDestroy` hooks never ran, the shared Redis lease was never released, and the logger
   * never flushed: precisely the work graceful shutdown exists to do.
   *
   * `outcome.phase` is set before the step so a timeout can still name what was running, and the
   * failure is recorded by phase so an operator is told WHICH part failed rather than that
   * something did.
   */
  private async runShutdownStep(
    outcome: ShutdownOutcome,
    phase: string,
    step: () => Promise<void>,
  ): Promise<void> {
    outcome.phase = phase;

    try {
      await step();
    } catch (error) {
      outcome.failures.push(phase);
      this.logger.error(
        `Shutdown step "${phase}" failed; continuing with the rest of the teardown:`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * The shutdown sequence itself. `outcome.phase` is updated as it advances so a timeout
   * can name what was still running.
   */
  private async performShutdown(
    options: { closeSharedRedis?: boolean; signal?: string } | undefined,
    outcome: ShutdownOutcome,
  ): Promise<void> {
    if (this.multiServiceMode) {
      if (this.orchestrator) {
        await this.runShutdownStep(outcome, 'stopping services', async () => {
          await this.orchestrator!.stopAll();
        });
      }

      return;
    }

    const closeRedis = options?.closeSharedRedis ?? true;
    const signal = options?.signal;

    this.logger.info('Stopping OneBun application...');

    // Drain and close the HTTP server FIRST. Destroy hooks used to run while the socket
    // was still accepting new work — a hook that deregisters from discovery or flushes a
    // buffer ran under live traffic, and the request that was mid-response was severed by
    // the process.exit that followed.
    const drainBudgetMs = Math.floor(this.resolveShutdownTimeout() * DRAIN_BUDGET_RATIO);
    await this.runShutdownStep(outcome, 'draining in-flight HTTP requests', async () => {
      outcome.forceClosed = await this.drainHttpServer(drainBudgetMs);
    });

    // Call beforeApplicationDestroy lifecycle hook
    if (this.rootModule?.callBeforeApplicationDestroy) {
      await this.runShutdownStep(outcome, 'running beforeApplicationDestroy hooks', async () => {
        this.logger.debug('Calling beforeApplicationDestroy hooks');
        await this.rootModule!.callBeforeApplicationDestroy!(signal);
      });
    }

    // Cleanup WebSocket resources
    if (this.wsHandler) {
      await this.runShutdownStep(outcome, 'closing WebSocket connections', async () => {
        this.logger.debug('Cleaning up WebSocket handler');
        await this.wsHandler!.cleanup();
      });
      // Dropped whether or not cleanup succeeded: the handle is dead either way, and keeping
      // it would let a later teardown path re-run a cleanup that has already failed once.
      this.wsHandler = null;
    }

    // Stop queue service
    if (this.queueService) {
      await this.runShutdownStep(outcome, 'stopping the queue service', async () => {
        this.logger.debug('Stopping queue service');
        await this.queueService!.stop();
      });
      this.queueService = null;
    }
    this.queueServiceProxy?.setDelegate(null);

    // Disconnect queue adapter
    if (this.queueAdapter) {
      await this.runShutdownStep(outcome, 'disconnecting the queue adapter', async () => {
        this.logger.debug('Disconnecting queue adapter');
        await this.queueAdapter!.disconnect();
      });
      this.queueAdapter = null;
    }

    // Stop the system-metric sampler. `startSystemMetricsCollection()` is called at startup and
    // nothing ever called its counterpart, so the interval outlived the application: in a test
    // suite or a multi-service process, every stopped application left a timer sampling memory
    // and CPU into a registry nobody reads.
    if (this.metricsService?.stopSystemMetricsCollection) {
      await this.runShutdownStep(outcome, 'stopping system metrics collection', async () => {
        this.logger.debug('Stopping system metrics collection');
        this.metricsService!.stopSystemMetricsCollection!();
      });
    }

    // Shutdown trace service — flush pending spans before module destroy
    if (this.traceService?.shutdown) {
      await this.runShutdownStep(outcome, 'flushing traces', async () => {
        this.logger.debug('Shutting down trace service');
        await this.traceService!.shutdown!();
      });
    }

    // Call onModuleDestroy lifecycle hook
    if (this.rootModule?.callOnModuleDestroy) {
      await this.runShutdownStep(outcome, 'running onModuleDestroy hooks', async () => {
        this.logger.debug('Calling onModuleDestroy hooks');
        await this.rootModule!.callOnModuleDestroy!();
      });
    }

    // Release this application's hold on the shared Redis client. It is disconnected only
    // when the last consumer lets go — previously every application called disconnect()
    // outright, so in multi-service mode the FIRST one to stop tore the client out from
    // under its still-running siblings.
    if (closeRedis && SharedRedisProvider.isConnected()) {
      await this.runShutdownStep(outcome, 'releasing the shared Redis client', async () => {
        this.logger.debug('Releasing shared Redis');
        await SharedRedisProvider.release();
      });
    }

    // Call onApplicationDestroy lifecycle hook
    if (this.rootModule?.callOnApplicationDestroy) {
      await this.runShutdownStep(outcome, 'running onApplicationDestroy hooks', async () => {
        this.logger.debug('Calling onApplicationDestroy hooks');
        await this.rootModule!.callOnApplicationDestroy!(signal);
      });
    }

    // Dispose this application's DI scope AFTER every destroy hook has run — the hooks read
    // service instances, and a later application must not inherit any of them.
    if (this.globalScope) {
      this.globalScope.services.clear();
      this.globalScope.processedModules.clear();
      this.globalScope.overrides.clear();
      this.globalScope.moduleOptions.clear();
      this.globalScope = null;
    }

    this.logger.info(
      outcome.forceClosed > 0
        ? `OneBun application stopped (${outcome.forceClosed} request(s) force-closed)`
        : 'OneBun application stopped',
    );

    // Shutdown logger transport LAST — flush OTLP log batches after final log message.
    // Guarded like the rest, with one caveat: if this is what failed, the line reporting it is
    // written through the transport that is going down, so it may not land. Continuing is still
    // right — the alternative is an unhandled rejection at the very end of the process.
    await this.runShutdownStep(outcome, 'flushing logs', async () => {
      await shutdownLogger();
    });
  }

  /**
   * Refuse new requests, wait for the in-flight ones, then close the listener.
   *
   * The listener deliberately stays open while draining and answers 503: that is what
   * tells a load balancer to stop routing here, and it keeps the deadline enforceable —
   * Bun ignores `stop(true)` once a graceful `stop()` is pending, so closing the listener
   * first would leave nothing able to force-close a wedged connection.
   *
   * WebSocket sockets and in-flight scheduled jobs belong in the same wait: add another
   * {@link InFlightSource} to `sources` rather than a second waiting loop.
   *
   * @param budgetMs - Deadline for the drain, in milliseconds
   * @returns Number of connections force-closed because the deadline expired
   */
  private async drainHttpServer(budgetMs: number): Promise<number> {
    const server = this.server;
    if (!server) {
      return 0;
    }

    // Swapping the route table beats a per-request `isDraining` check: the hot path keeps
    // exactly the code it had, and every route — controller, docs, metrics, static — is
    // refused by the one handler.
    if (typeof server.reload === 'function') {
      server.reload({
        routes: {},
        fetch(): Response {
          return new Response(SHUTDOWN_RESPONSE_BODY, {
            status: HttpStatusCode.SERVICE_UNAVAILABLE,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Connection': 'close',
            },
          });
        },
      });
    }

    const sources: InFlightSource[] = [{
      name: 'HTTP request(s)',
      // A mocked server has no counter; nothing to wait for then.
      pending: () => (typeof server.pendingRequests === 'number' ? server.pendingRequests : 0),
    }];

    const report: DrainReport = await drainInFlight(sources, budgetMs);
    const forceClosed = report.remaining.reduce((total, entry) => total + entry.pending, 0);

    if (report.drained) {
      this.logger.debug(`In-flight requests drained in ${report.waitedMs}ms`);
    } else {
      this.logger.warn(
        `Drain deadline of ${budgetMs}ms expired with ${describeRemaining(report.remaining)} `
        + 'still in flight; force-closing',
      );
    }

    // Open WebSockets are cut here, not drained — they have no bounded wait of their own
    // yet, and a graceful `stop()` never resolves while one is connected (measured).
    const openSockets = typeof server.pendingWebSockets === 'number' ? server.pendingWebSockets : 0;
    if (openSockets > 0) {
      this.logger.warn(
        `Closing ${openSockets} active WebSocket connection(s) without waiting for in-flight messages`,
      );
    }

    // Always the forcing form. The bounded wait above is what makes the shutdown graceful;
    // `stop(false)` would hand the deadline back to whatever is still connected — a single
    // idle WebSocket keeps it pending forever.
    await server.stop(true);
    this.server = null;
    this.logger.debug('HTTP server stopped');

    return forceClosed;
  }

  /**
   * Initialize the queue system based on configuration and detected handlers
   */
  private async initializeQueue(controllers: Function[]): Promise<void> {
    const queueOptions = this.options.queue;

    // Check if any controller has queue-related decorators
    const hasQueueHandlers = controllers.some(controller => {
      const instance = this.ensureModule().getControllerInstance?.(controller);
      if (!instance) {
        return false;
      }

      return hasQueueDecorators(controller) || hasQueueDecorators(instance.constructor);
    });

    // Determine if queue should be enabled: a queue decorator on a controller, OR
    // queue.enabled === true, OR an explicit queue.adapter/options/redis backend config.
    // An explicit queue.enabled === false overrides all three, and warns once when it
    // contradicts a configured backend.
    const enablement = resolveQueueEnablement(queueOptions, hasQueueHandlers);
    if (!enablement.enabled) {
      if (enablement.contradiction) {
        this.logger.warn(QUEUE_DISABLED_WITH_ADAPTER_WARNING);
      } else {
        this.logger.debug(
          'Queue system not enabled (no handlers detected, no backend configured, or explicitly disabled)',
        );
      }

      return;
    }

    // Create the appropriate adapter. `queue.redis` selects the Redis adapter when no explicit
    // `adapter` is given — it used to only ENABLE the queue, so a redis-only config quietly ran
    // in memory with every Redis setting discarded.
    const adapterOpt = resolveQueueAdapterType(queueOptions);

    if (typeof adapterOpt === 'function') {
      // Custom adapter constructor (e.g. NATS JetStream)
      const adapterCtor = adapterOpt;
      this.queueAdapter = new adapterCtor(queueOptions?.options);
      await this.queueAdapter.connect();
      this.logger.info(`Queue system initialized with custom adapter: ${this.queueAdapter.name}`);
    } else {
      const adapterType = adapterOpt;
      if (adapterType === 'memory') {
        this.queueAdapter = new InMemoryQueueAdapter();
        this.logger.info('Queue system initialized with in-memory adapter');
      } else if (adapterType === 'redis') {
        const redisOptions = queueOptions?.redis ?? {};
        if (redisOptions.useSharedProvider !== false) {
          // Use shared Redis provider
          this.queueAdapter = new RedisQueueAdapter({
            useSharedClient: true,
            keyPrefix: redisOptions.prefix ?? 'onebun:queue:',
          });
          this.logger.info('Queue system initialized with Redis adapter (shared provider)');
        } else if (redisOptions.url) {
          // Create dedicated Redis connection
          this.queueAdapter = new RedisQueueAdapter({
            useSharedClient: false,
            url: redisOptions.url,
            keyPrefix: redisOptions.prefix ?? 'onebun:queue:',
          });
          this.logger.info('Queue system initialized with Redis adapter (dedicated connection)');
        } else {
          throw new Error('Redis queue adapter requires either useSharedProvider: true or a url');
        }
      } else {
        throw new Error(`Unknown queue adapter type: ${adapterType}`);
      }

      // Connect the adapter
      await this.queueAdapter.connect();
    }

    // Create queue service with config
    const queueServiceConfig: QueueConfig = {
      adapter:
        typeof adapterOpt === 'function' ? this.queueAdapter.type : adapterOpt,
      options:
        typeof adapterOpt === 'function'
          ? (queueOptions?.options as Record<string, unknown> | undefined)
          : queueOptions?.redis,
    };
    this.queueService = new QueueService(queueServiceConfig);
    // Before any handler is registered: every delivery and every scheduled job this service
    // invokes then runs under THIS application's tracer, whichever adapter delivered it.
    this.queueService.setOwnerTracer(this.traceService?.getTracer?.());

    // Initialize with the adapter
    await this.queueService.initialize(this.queueAdapter);

    // Wire scheduler error handler so failed jobs are logged
    this.queueService.getScheduler().setErrorHandler((jobName, error) => {
      this.logger.warn(`Scheduled job "${jobName}" failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    // An adapter-level failure — an unreachable broker, a rejected command — reaches the
    // application only through `onError`, and until this was wired the only listeners were the
    // application's own `@OnQueueError` handlers. An application without one saw nothing at all:
    // no consumer running, no log line, no clue. Additive — user handlers still fire.
    this.queueAdapter.on('onError', (error: unknown) => {
      this.logger.error(
        `Queue adapter "${this.queueAdapter?.name}" reported an error: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    });

    // Register handlers from controllers using registerService
    for (const controllerClass of controllers) {
      const instance = this.ensureModule().getControllerInstance?.(controllerClass);
      if (!instance) {
        this.logger.debug(`Queue: skipping controller ${controllerClass.name} (no instance found)`);
        continue;
      }

      // Check both controllerClass and instance.constructor for queue decorators
      // These should be identical, but if @Controller wrapping produces a different reference,
      // we check both to be safe
      const hasDecorators =
        hasQueueDecorators(controllerClass) || hasQueueDecorators(instance.constructor);

      if (hasDecorators) {
        // Use whichever reference has the metadata for registration
        const registrationClass = hasQueueDecorators(controllerClass)
          ? controllerClass
          : instance.constructor;
        const queueOwnerModule = this.ensureModule().getOwnerModuleForController?.(controllerClass) ?? this.ensureModule();
        await this.queueService.registerService(
          instance,
          registrationClass as new (...args: unknown[]) => unknown,
          queueOwnerModule.resolveInterceptors?.bind(queueOwnerModule),
        );
        this.logger.debug(`Registered queue handlers for controller: ${controllerClass.name}`);
      } else {
        this.logger.debug(`Queue: controller ${controllerClass.name} has no queue decorators`);
      }
    }

    // Start the queue service
    await this.queueService.start();
    this.logger.info('Queue service started');

    // Wire the real QueueService into the DI proxy so injected consumers use it
    this.queueServiceProxy?.setDelegate(this.queueService);
  }

  /**
   * Get the queue service instance
   * @returns The queue service or null if not enabled
   */
  getQueueService(): QueueService | null {
    this.ensureSingleServiceMode('getQueueService');

    return this.queueService;
  }

  /**
   * Initialize the documentation system (OpenAPI/Swagger)
   */
  private async initializeDocs(controllers: Function[]): Promise<void> {
    const docsOptions = this.options.docs;

    // Skip if docs are explicitly disabled or @onebun/docs is not available
    if (docsOptions?.enabled === false) {
      this.logger.debug('Documentation explicitly disabled');

      return;
    }

    if (!generateOpenApiSpec || !generateSwaggerUiHtml) {
      if (docsOptions?.enabled === true) {
        this.logger.warn(
          'Documentation enabled but @onebun/docs module not available. Install with: bun add @onebun/docs',
        );
      } else {
        this.logger.debug('@onebun/docs module not available, documentation disabled');
      }

      return;
    }

    try {
      // Generate OpenAPI spec from controllers
      this.openApiSpec = generateOpenApiSpec(controllers, {
        title: docsOptions?.title || this.options.name || 'OneBun API',
        version: docsOptions?.version || '1.0.0',
        description: docsOptions?.description,
      });

      // Add additional OpenAPI info if provided
      if (this.openApiSpec && docsOptions?.contact) {
        (this.openApiSpec.info as Record<string, unknown>).contact = docsOptions.contact;
      }
      if (this.openApiSpec && docsOptions?.license) {
        (this.openApiSpec.info as Record<string, unknown>).license = docsOptions.license;
      }
      if (this.openApiSpec && docsOptions?.externalDocs) {
        this.openApiSpec.externalDocs = docsOptions.externalDocs;
      }
      if (this.openApiSpec && docsOptions?.servers && docsOptions.servers.length > 0) {
        this.openApiSpec.servers = docsOptions.servers;
      }

      // Generate Swagger UI HTML
      const openApiPath = docsOptions?.jsonPath || '/openapi.json';
      this.swaggerHtml = generateSwaggerUiHtml(openApiPath);

      const docsPath = docsOptions?.path || '/docs';
      this.logger.info(
        `Documentation available at http://${this.options.host}:${this.options.port}${docsPath}`,
      );
      this.logger.info(
        `OpenAPI spec available at http://${this.options.host}:${this.options.port}${openApiPath}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to initialize documentation:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get the OpenAPI specification
   * @returns The OpenAPI spec or null if not generated
   */
  getOpenApiSpec(): Record<string, unknown> | null {
    this.ensureSingleServiceMode('getOpenApiSpec');

    return this.openApiSpec;
  }

  /**
   * Register signal handlers for graceful shutdown.
   *
   * `start()` already calls this unless `gracefulShutdown: false` was passed, so calling
   * it again is a no-op rather than a second pair of listeners. A signal that arrives
   * while a shutdown is already running is logged and ignored — it does not restart the
   * drain or re-run the destroy hooks.
   *
   * The process exits `0` when the shutdown completed, and `1` when it hit
   * `shutdownTimeout` with work still running.
   *
   * @example
   * ```typescript
   * // Only needed when the automatic registration was turned off
   * const app = new OneBunApplication(AppModule, { gracefulShutdown: false });
   * await app.start();
   * app.enableGracefulShutdown();
   * ```
   */
  enableGracefulShutdown(): void {
    if (this.signalHandlersRegistered) {
      this.logger.debug('Graceful shutdown handlers already registered, ignoring');

      return;
    }
    this.signalHandlersRegistered = true;

    // Exactly one exit is ever scheduled, but every signal leads to one: a signal that
    // arrives after a programmatic `stop()` must still end the process, and a second
    // signal during a shutdown must not exit twice or restart the teardown.
    let exitScheduled = false;
    const scheduleExit = (shutdown: Promise<ShutdownOutcome>): void => {
      if (exitScheduled) {
        return;
      }
      exitScheduled = true;

      void shutdown
        .then((outcome) => {
          process.exit(outcome.timedOut ? 1 : 0);
        })
        .catch((error: unknown) => {
          this.logger.error(
            'Graceful shutdown failed:',
            error instanceof Error ? error : new Error(String(error)),
          );
          process.exit(1);
        });
    };

    const shutdown = (signal: string): void => {
      // The latch, not a local flag: `stop()` called by application code before the
      // signal arrived must silence the handler just as a first signal does.
      if (this.shutdownPromise) {
        this.logger.warn(`Already shutting down, ignoring ${signal}`);
        scheduleExit(this.shutdownPromise);

        return;
      }

      this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
      scheduleExit(this.runShutdown({ signal }));
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    this.logger.debug('Graceful shutdown handlers registered');
  }

  /**
   * Get the application logger
   * @returns The logger instance
   */
  getLogger(context?: Record<string, unknown>): SyncLogger {
    if (context) {
      return this.logger.child(context);
    }

    return this.logger;
  }

  /**
   * Get the actual port the server is listening on.
   * When `port: 0` is passed, the OS assigns a free port — use this method
   * to obtain the real port after `start()`.
   * @returns Actual listening port, or the configured port if not yet started
   */
  getPort(): number {
    this.ensureSingleServiceMode('getPort');

    return this.server?.port ?? this.options.port ?? 3000;
  }

  /**
   * Store a profile report and deliver it via configured channels.
   * @internal
   */
  private handleProfileReport(report: import('../profiler').ProfileReport): void {
    const maxReports = this.options.profiling?.maxReports ?? 100;
    this.profilingReports.push(report);
    if (this.profilingReports.length > maxReports) {
      this.profilingReports.shift();
    }
    if (this.options.profiling?.onProfile) {
      this.options.profiling.onProfile(report);
    }
    if (this.options.profiling?.logReport) {
      this.logger.debug('Profile report', report as unknown as Record<string, unknown>);
    }
  }

  /**
   * Get the underlying Bun server instance.
   * Use this to dispatch requests directly (bypassing the global `fetch`) e.g. in tests.
   * @internal
   */
  getServer(): ReturnType<typeof Bun.serve> | null {
    this.ensureSingleServiceMode('getServer');

    return this.server;
  }

  /**
   * Get the HTTP URL where the application is listening
   * @returns The HTTP URL
   */
  getHttpUrl(): string {
    this.ensureSingleServiceMode('getHttpUrl');

    return `http://${this.options.host ?? '0.0.0.0'}:${this.getPort()}`;
  }

  /**
   * Ensure the application is in multi-service mode.
   * @throws Error if called in single-service mode
   */
  private ensureMultiServiceMode(methodName: string): void {
    if (!this.multiServiceMode) {
      throw new Error(
        `${methodName}() is only available in multi-service mode. ` +
        'Pass { services: ... } to the OneBunApplication constructor.',
      );
    }
  }

  /**
   * Ensure the application is in single-service mode.
   * @throws Error if called in multi-service mode
   */
  private ensureSingleServiceMode(methodName: string): void {
    if (this.multiServiceMode) {
      throw new Error(
        `${methodName}() is only available in single-service mode. ` +
        `Use getApplication(name).${methodName}() instead.`,
      );
    }
  }

  /**
   * Get a child OneBunApplication instance by service name.
   * Only available in multi-service mode.
   *
   * @param name - Service name
   * @returns OneBunApplication instance or undefined if not running
   * @throws Error if called in single-service mode
   */
  getApplication(name: string & keyof TServices): OneBunApplication | undefined {
    this.ensureMultiServiceMode('getApplication');

    return this.orchestrator!.getApplication(name);
  }

  /**
   * Get URL for a service.
   * Returns local URL if service is running in this process,
   * otherwise looks in externalServiceUrls option.
   * Only available in multi-service mode.
   *
   * @param name - Service name
   * @returns Service URL
   * @throws Error if called in single-service mode or service not available
   */
  getServiceUrl(name: string & keyof TServices): string {
    this.ensureMultiServiceMode('getServiceUrl');

    return this.orchestrator!.getServiceUrl(name);
  }

  /**
   * Get all running service names.
   * Only available in multi-service mode.
   *
   * @returns Array of running service names
   * @throws Error if called in single-service mode
   */
  getRunningServices(): string[] {
    this.ensureMultiServiceMode('getRunningServices');

    return this.orchestrator!.getRunningServices();
  }

  /**
   * Check if a specific service is running.
   * Only available in multi-service mode.
   *
   * @param name - Service name
   * @returns true if service is running
   * @throws Error if called in single-service mode
   */
  isServiceRunning(name: string & keyof TServices): boolean {
    this.ensureMultiServiceMode('isServiceRunning');

    return this.orchestrator!.isServiceRunning(name);
  }

  /**
   * Get a service instance by class from the module container.
   * Useful for accessing services outside of the request context.
   * Only available in single-service mode.
   *
   * @param serviceClass - The service class to get
   * @returns The service instance
   * @throws Error if service is not found or called in multi-service mode
   *
   * @example
   * ```typescript
   * const app = new OneBunApplication(AppModule, options);
   * await app.start();
   *
   * const userService = app.getService(UserService);
   * await userService.performBackgroundTask();
   * ```
   */
  /**
   * Refuse to answer for a service the tree holds two instances of.
   *
   * An Effect tag is keyed by the class NAME, so two named registrations — or two service
   * classes that happen to share a name — have more instances than there are keys. Returning
   * one of them makes the answer a function of module import order. Injection is unaffected:
   * it resolves by tag identity at the module boundary, where each module has exactly one.
   */
  private assertServiceUnambiguous(className: string): void {
    const ambiguous = this.ensureModule().findAmbiguousServiceKeys?.();
    const holders = ambiguous?.get(className);
    if (!holders) {
      return;
    }

    const error = new Error(
      `This application holds ${holders.length} instances of ${className} (${holders.join(', ')}), ` +
      'so getService() has no correct answer — the one it would return depends on the order ' +
      'the modules were imported in. Name the registration you mean: ' +
      `getService(${className}, <token>).`,
    );
    error.name = 'OneBunAmbiguousServiceError';
    throw error;
  }

  /**
   * Refuse to hand out a layer that silently drops one of two instances.
   *
   * An Effect `Context` has exactly one slot per key, so an application with two instances of
   * one service class does not fit in one. A layer built without saying which instance takes the
   * slot would carry whichever was merged last — a function of module import order.
   *
   * `resolved` are the classes a `getLayer(selections)` call named. Those are no longer
   * ambiguous: the caller stated the answer. Everything else still refuses, and the message
   * names only what is actually still unresolved, so a partial selection does not report the
   * classes it already fixed.
   */
  private assertLayerUnambiguous(resolved: string[] = []): void {
    const ambiguous = this.ensureModule().findAmbiguousServiceKeys?.();
    if (!ambiguous || ambiguous.size === 0) {
      return;
    }

    const unresolved = [...ambiguous.entries()].filter(([key]) => !resolved.includes(key));
    if (unresolved.length === 0) {
      return;
    }

    const details = unresolved
      .map(([key, holders]) => `${key} (${holders.join(', ')})`)
      .join('; ');
    const error = new Error(
      'getLayer() cannot represent this application: an Effect Context has one slot per ' +
      `service class and this one holds two instances of ${details}. The layer would carry ` +
      'whichever was merged last. Name the instance you mean — ' +
      'getLayer([[Class, token]]) — or reach it directly with getService(Class, token) ' +
      'or @Inject(token).',
    );
    error.name = 'OneBunAmbiguousServiceError';
    throw error;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getService<T>(serviceClass: new (...args: any[]) => T, token?: symbol | string): T {
    this.ensureSingleServiceMode('getService');
    if (token === undefined) {
      // Only the UNTOKENED form is ambiguous. `getService(Class, TOKEN)` names one
      // registration and is unambiguous by construction.
      this.assertServiceUnambiguous(serviceClass.name);
    }

    if (!this.ensureModule().getServiceByClass) {
      throw new Error('Module does not support getServiceByClass');
    }

    const service = this.ensureModule().getServiceByClass!(serviceClass, token);
    if (!service) {
      const named = token !== undefined
        ? ` for registration ${typeof token === 'symbol' ? token.toString() : `'${token}'`}`
        : '';
      throw new Error(
        `Service ${serviceClass.name} not found${named}. ` +
        'Make sure it\'s registered in the module\'s providers.',
      );
    }

    return service;
  }
}

import {
  type Context,
  Effect,
  Layer,
} from 'effect';

import type { Guard } from '../http-guards/http-guards';
import type { ModuleInstance } from '../types';
import type { Interceptor, ResolvedInterceptor } from '../types';

import {
  createSyncLogger,
  type Logger,
  LoggerService,
  makeLogger,
  type SyncLogger,
} from '@onebun/logger';
import type { TraceFilterOptions } from '@onebun/trace';

import {
  getConstructorParamTypes,
  getModuleMetadata,
  getRegisteredModules,
  isGlobalModule,
  isOptionalParam,
  getInjectToken,
  registerControllerDependencies,
} from '../decorators/decorators';
import { buildDecoratorMetadataDiagnosticMessage, diagnoseDecoratorMetadata } from '../decorators/metadata';
import { CircularDependencyError, DependencyResolutionError } from '../errors/dependency-errors';
import { attachGuardBinding } from '../http-guards/guard-binding';
import { BaseInterceptor } from '../interceptors/interceptors';
import {
  type ProfileMark,
  PROFILING_ENABLED,
  getProfiler,
} from '../profiler';
import { QueueService, QueueServiceTag } from '../queue';
import { getCurrentTraceContext } from '../request-context';
import { BaseWebSocketGateway } from '../websocket/ws-base-gateway';
import { isWebSocketGateway } from '../websocket/ws-decorators';

import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from './config.interface';
import { Controller } from './controller';
import {
  hasOnModuleInit,
  hasOnApplicationInit,
  hasOnModuleDestroy,
  hasBeforeApplicationDestroy,
  hasOnApplicationDestroy,
  hasConfigureMiddleware,
} from './lifecycle';
import { BaseMiddleware } from './middleware';
import { describeRegistrationToken, findRegistrationModule } from './registration';
import {
  BaseService,
  getServiceMetadata,
  getServiceTag,
} from './service';


/**
 * The DI state that a single application owns for the whole of its module tree.
 *
 * Everything here used to live on `globalThis` behind `Symbol.for()`, which meant one
 * process held exactly one copy no matter how many applications ran in it: a second
 * `DrizzleModule.forRoot()` silently reused the first application's connection, and a test
 * suite could talk to — and drop — the wrong database. The scope is threaded BY REFERENCE
 * through module construction instead, so two applications never see each other's services.
 *
 * In multi-service mode each sub-application gets its own scope: one global service instance
 * per sub-application, not one per process.
 *
 * @see docs:api/core.md
 */
export interface GlobalScope {
  /** Instances contributed by `@Global()` modules, visible to every module in this tree. */
  services: Map<Context.Tag<unknown, unknown>, unknown>;
  /** `@Global()` modules already constructed in this tree, so they are constructed once. */
  processedModules: Set<Function>;
  /** Test overrides, seeded into EVERY module before any provider is constructed. */
  overrides: Map<Context.Tag<unknown, unknown>, unknown>;
  /** Dynamic-module options captured at import-processing time, keyed by module class. */
  moduleOptions: Map<Function, unknown>;
  /**
   * Modules already constructed in this application, keyed by module class.
   *
   * A module class is built ONCE per application and `imports` decides VISIBILITY only.
   * Before this, deduplication existed for `@Global()` modules alone, so the documented
   * remedy for a non-global module — every submodule importing it via `forFeature()` — gave
   * each submodule its OWN instance: three CacheService instances for a root plus two
   * leaves, three initializations, and state written in one invisible in another.
   */
  sharedModules: Map<Function, OneBunModule>;
}

/**
 * Create an empty {@link GlobalScope} for one application.
 *
 * @see docs:api/core.md
 */
export function createGlobalScope(): GlobalScope {
  return {
    services: new Map(),
    processedModules: new Set(),
    overrides: new Map(),
    moduleOptions: new Map(),
    sharedModules: new Map(),
  };
}

/**
 * The scope used when a module is constructed without one — a direct `new OneBunModule(...)`
 * in a unit test, or the deprecated registry helpers below.
 *
 * Still on `globalThis` via `Symbol.for()` so it survives package duplication in
 * `node_modules`. Applications never use it; they each create their own.
 */
const processDefaultScope: GlobalScope = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  services: ((globalThis as any)[Symbol.for('onebun:global_services_registry')] ??= new Map()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processedModules: ((globalThis as any)[Symbol.for('onebun:processed_global_modules')] ??= new Set()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides: ((globalThis as any)[Symbol.for('onebun:global_overrides')] ??= new Map()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  moduleOptions: ((globalThis as any)[Symbol.for('onebun:global_module_options')] ??= new Map()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sharedModules: ((globalThis as any)[Symbol.for('onebun:shared_modules')] ??= new Map()),
};

/**
 * Read a dynamic module's options as they were when this application imported it.
 *
 * `DrizzleModule.forRoot()` and friends store their options on the module CLASS, which is
 * shared by every application in the process, so a second `forRoot()` overwrites the first.
 * The snapshot is taken while the importing module is being initialized and read back from
 * the application's own scope.
 *
 * @see docs:api/core.md
 */
export function resolveScopedModuleOptions<T>(
  scope: GlobalScope | undefined,
  moduleClass: Function,
): T | undefined {
  return scope?.moduleOptions.get(moduleClass) as T | undefined;
}

/**
 * Clear the process-default global services registry (useful for testing).
 *
 * @deprecated Applications own a {@link GlobalScope} each; this reaches only the
 * process-default scope used by a direct `new OneBunModule(...)`, never an application's own.
 * Assert on resolved instances instead.
 * @internal
 */
export function clearGlobalServicesRegistry(): void {
  processDefaultScope.services.clear();
  processDefaultScope.processedModules.clear();
  processDefaultScope.overrides.clear();
  processDefaultScope.moduleOptions.clear();
  processDefaultScope.sharedModules.clear();
  OneBunModule.resetDecoratorMetadataDiagnosis();
}

/**
 * Get all services in the process-default scope (useful for debugging).
 *
 * Returns a COPY: mutating it changes nothing, and an "after stop() it no longer contains X"
 * assertion against it passes vacuously.
 *
 * @deprecated Applications own a {@link GlobalScope} each; this reaches only the
 * process-default scope used by a direct `new OneBunModule(...)`, never an application's own.
 * @internal
 */
export function getGlobalServicesRegistry(): Map<Context.Tag<unknown, unknown>, unknown> {
  return new Map(processDefaultScope.services);
}

/**
 * OneBun Module implementation
 */
export class OneBunModule implements ModuleInstance {
  private rootLayer: Layer.Layer<never, never, unknown>;
  private controllers: Function[] = [];
  private controllerInstances: Map<Function, Controller> = new Map();
  private serviceInstances: Map<Context.Tag<unknown, unknown>, unknown> = new Map();
  private pendingServiceInits: Array<{ name: string; instance: unknown }> = [];
  private logger: SyncLogger;
  private config: IConfig<OneBunAppConfig>;

  /**
   * Middleware class constructors defined by this module via OnModuleConfigure.configureMiddleware()
   */
  private ownMiddlewareClasses: Function[] = [];

  /**
   * Accumulated middleware class constructors from ancestor modules (parent → child).
   * Does NOT include this module's own middleware.
   */
  private ancestorMiddlewareClasses: Function[] = [];

  /**
   * Resolved middleware functions (bound use() methods) for this module's own middleware.
   * Populated during setup() after services are created.
   */
  private resolvedOwnMiddleware: Function[] = [];

  /**
   * Resolved middleware functions from ancestor modules.
   * Populated during setup() after services are created.
   */
  private resolvedAncestorMiddleware: Function[] = [];

  /**
   * Tracing options for auto-trace (traceAll + filters)
   */
  private readonly tracingOptions?: { traceAll?: boolean; traceFilter?: TraceFilterOptions };

  /**
   * The owning application's DI scope, shared BY REFERENCE with every child module.
   * Defaults to the process-default scope for a direct `new OneBunModule(...)`.
   */
  private readonly scope: GlobalScope;

  /**
   * Whether this module is the root of its own tree. Only the root runs the global-module
   * pre-pass; children inherit its results through the shared scope.
   */
  private readonly isTreeRoot: boolean;

  constructor(
    private moduleClass: Function,
    private loggerLayer?: Layer.Layer<never, never, unknown>,
    config?: IConfig<OneBunAppConfig>,
    ancestorMiddleware?: Function[],
    tracingOptions?: { traceAll?: boolean; traceFilter?: TraceFilterOptions },
    scope?: GlobalScope,
    parent?: OneBunModule,
  ) {
    this.scope = scope ?? processDefaultScope;
    this.isTreeRoot = parent === undefined;
    // Initialize logger with module class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (logger: Logger) =>
          logger.child({ className: `OneBunModule:${moduleClass.name}` }),
        ),
        this.loggerLayer || makeLogger(),
      ) as Effect.Effect<Logger, never, never>,
    ) as Logger;
    this.logger = createSyncLogger(effectLogger, getCurrentTraceContext);
    this.config = config ?? new NotInitializedConfig();
    this.tracingOptions = tracingOptions;
    this.ancestorMiddlewareClasses = ancestorMiddleware ?? [];

    // Read module-level middleware from OnModuleConfigure interface
    if (hasConfigureMiddleware(moduleClass)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const moduleInstance = new (moduleClass as new () => any)();
        this.ownMiddlewareClasses = moduleInstance.configureMiddleware();
        this.logger.debug(
          `Module ${moduleClass.name} configured ${this.ownMiddlewareClasses.length} middleware class(es)`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to call configureMiddleware() on module ${moduleClass.name}: ${error}`,
        );
      }
    }

    this.logger.debug(`Initializing OneBunModule for ${moduleClass.name}`);
    const { layer, controllers } = this.initModule();
    this.rootLayer = layer;
    this.controllers = controllers;

    this.logger.debug(
      `OneBunModule initialized for ${moduleClass.name}, controllers: ${controllers.length}`,
    );
  }

  /**
   * Child modules instances (for accessing their exported services)
   */
  private childModules: OneBunModule[] = [];

  /**
   * Global modules this module constructed in the pre-pass, so the import loop can merge
   * their layers when it reaches the corresponding `imports` entry.
   */
  private preRegisteredModules: Map<Function, OneBunModule> = new Map();

  /**
   * Which imported modules contributed each service tag, used to detect two registrations
   * of one class competing for the single slot the tag has.
   */
  private tagContributors: Map<Context.Tag<unknown, unknown>, Function[]> = new Map();

  /**
   * Per-registration instances this module selected, keyed by tag and then by the imported
   * registration module. What `@Inject(TOKEN)` reads: `serviceInstances` has one slot per tag
   * and cannot hold two registrations, but a module that imported both still has to hand each
   * one to the parameter that named it.
   */
  private tagByRegistration: Map<Context.Tag<unknown, unknown>, Map<Function, unknown>> = new Map();

  /** Cached result of findAmbiguousServiceKeys; the tree is immutable after setup(). */
  private ambiguousKeys: Map<string, string[]> | undefined;

  /**
   * Initialize module from metadata and create layer
   */
  private initModule(): {
    layer: Layer.Layer<never, never, unknown>;
    controllers: Function[];
  } {
    this.logger.debug(`Initializing module metadata for ${this.moduleClass.name}`);
    const metadata = getModuleMetadata(this.moduleClass);
    if (!metadata) {
      this.logger.error(`Module ${this.moduleClass.name} does not have @Module decorator`);
      throw new Error(`Module ${this.moduleClass.name} does not have @Module decorator`);
    }
    this.logger.debug(`Found module metadata for ${this.moduleClass.name}`);

    // Use provided logger layer or create a default one
    let layer: Layer.Layer<never, never, unknown> = this.loggerLayer || makeLogger();
    const controllers: Function[] = [];

    // Add controllers
    if (metadata.controllers) {
      for (const controller of metadata.controllers) {
        controllers.push(controller);
      }
    }

    // PHASE -1: Seed test overrides into EVERY module before anything is constructed.
    // They are applied here rather than patched into the root module afterwards, which is
    // why overrideProvider() now reaches services and imported modules instead of only
    // root-module controllers. Later phases must not overwrite them.
    for (const [tag, instance] of this.scope.overrides) {
      this.serviceInstances.set(tag, instance);
      this.logger.debug(
        `Applied test override ${(instance as object)?.constructor?.name || 'unknown'} to ${this.moduleClass.name}`,
      );
    }

    // PHASE 0: Add global services from the application's scope first
    // Global services are available in all modules without explicit import
    this.seedGlobalServices();

    // PHASE 0.5: construct every @Global() module anywhere in the graph, BEFORE the import
    // loop. Re-seeding the scope (FB-6) only helps a module that is still being built when
    // the registration happens; a consumer nested inside a subtree built EARLIER in the same
    // `imports` array has already finished by then. `imports: [Feature, CacheModule]` failed
    // where `[CacheModule, Feature]` booted, at any depth. Building the globals up front
    // removes the ordering question instead of racing it.
    this.preRegisterGlobalModules(metadata);

    // PHASE 1: Import child modules FIRST and collect their exported services
    if (metadata.imports) {
      for (const importModule of metadata.imports) {
        // Check if this is a global module that was already processed
        const isGlobal = isGlobalModule(importModule);

        // Capture a dynamic module's options BEFORE any of its providers is constructed.
        // The whole tree is built in one synchronous span, so this cannot interleave with a
        // concurrently starting sub-application overwriting the module class's static slot.
        this.captureModuleOptions(importModule);

        if (isGlobal && this.scope.processedModules.has(importModule)) {
          // Global module already processed — take its services from the scope rather than
          // constructing it again. Seeding HERE rather than relying on PHASE 0 is the point:
          // PHASE 0 ran before this loop, so a module registered by an earlier import in the
          // same loop would otherwise contribute nothing to the module that declared it.
          //
          // When THIS module pre-registered it, merge its layer here — the pre-pass builds
          // the module but only the import that declares it knows where its layer belongs.
          const preRegistered = this.preRegisteredModules.get(importModule);
          if (preRegistered) {
            layer = Layer.merge(layer, preRegistered.getLayer());
          }

          const reseeded = this.seedGlobalServices();
          this.logger.debug(
            `Global module ${importModule.name} already initialized; ` +
            `re-seeded ${reseeded} service(s) into ${this.moduleClass.name} from the application scope`,
          );
          continue;
        }

        // Already built in this application: take its exports rather than constructing a
        // second copy. `imports` decides VISIBILITY; the instance count is one per
        // application, for global and non-global modules alike.
        const shared = this.scope.sharedModules.get(importModule);
        if (shared) {
          layer = Layer.merge(layer, shared.getLayer());
          for (const [tag, instance] of shared.getExportedServices()) {
            this.noteContributor(tag, importModule, instance);
            if (!this.scope.overrides.has(tag)) {
              this.serviceInstances.set(tag, instance);
            }
          }
          this.logger.debug(
            `Reusing already-constructed module ${importModule.name} in ${this.moduleClass.name}`,
          );
          continue;
        }

        // Pass the logger layer, config, accumulated middleware class refs and — by
        // reference — this application's scope to child modules
        const accumulatedMiddleware = [...this.ancestorMiddlewareClasses, ...this.ownMiddlewareClasses];
        const childModule = new OneBunModule(
          importModule, this.loggerLayer, this.config,
          accumulatedMiddleware, this.tracingOptions, this.scope, this,
        );
        this.childModules.push(childModule);

        // Merge layers
        layer = Layer.merge(layer, childModule.getLayer());

        // Get exported services from child module and register them for DI
        const exportedServices = childModule.getExportedServices();
        for (const [tag, instance] of exportedServices) {
          this.noteContributor(tag, importModule, instance);

          // An override wins over the real provider, whichever module declared it.
          if (!this.scope.overrides.has(tag)) {
            this.serviceInstances.set(tag, instance);
            this.logger.debug(
              `Imported service ${(instance as object).constructor?.name || 'unknown'} from ${importModule.name}`,
            );
          }

          // If this is a global module, also register services in the scope
          if (isGlobal) {
            this.scope.services.set(tag, instance);
            this.logger.debug(
              `Registered global service ${(instance as object).constructor?.name || 'unknown'} from ${importModule.name}`,
            );
          }
        }

        // Mark global module as processed
        if (isGlobal) {
          this.scope.processedModules.add(importModule);
        }
      }
    }

    // PHASE 0 (again): a sibling import may have registered a @Global() module's services
    // DURING the loop above, i.e. after this module's first pass over the scope and after
    // the `continue` that skips an already-processed module. Without this second pass the
    // importer declares the import and receives nothing, and `imports: [Feature, Core]`
    // fails where `imports: [Core, Feature]` boots — import order becomes silently
    // load-bearing, and the failure surfaces at a controller far from the module that
    // caused it. Re-reading here costs one Map walk and makes order irrelevant.
    this.seedGlobalServices();

    // PHASE 2: Create services of THIS module with DI (can now access imported services)
    this.createServicesWithDI(metadata);

    // Create Effect layers for all registered services
    for (const [tag, instance] of this.serviceInstances) {
      const serviceLayer = Layer.succeed(tag, instance);
      layer = Layer.merge(layer, serviceLayer);
    }

    // Publish SELF, at the end of this module's own initialization. Publishing from the
    // importer instead — after its whole import loop finished — lets a sibling or a
    // descendant reach the same module first and build a second copy: measured 5 instances
    // where there should have been 2.
    this.rootLayer = layer;
    this.scope.sharedModules.set(this.moduleClass, this);

    return { layer, controllers };
  }

  /**
   * Construct every `@Global()` module reachable from this module's import graph, before any
   * ordinary import is processed.
   *
   * Only the tree root does this; children share the scope and find the globals already in
   * `processedModules`, so their own import loops take the re-seed branch.
   *
   * Walks metadata ONLY to decide what is global — no provider is constructed by the walk
   * itself. Cycles and repeats are handled by the visited set, and a module already in
   * `scope.processedModules` is skipped, so nothing is built twice.
   */
  private preRegisterGlobalModules(metadata: NonNullable<ReturnType<typeof getModuleMetadata>>): void {
    if (!this.isTreeRoot) {
      return;
    }

    const globals: Function[] = [];
    const visited = new Set<Function>();

    const walk = (moduleClass: Function): void => {
      if (visited.has(moduleClass)) {
        return;
      }
      visited.add(moduleClass);

      if (isGlobalModule(moduleClass) && !this.scope.processedModules.has(moduleClass)) {
        globals.push(moduleClass);
      }

      const childMetadata = getModuleMetadata(moduleClass);
      for (const imported of childMetadata?.imports ?? []) {
        walk(imported);
      }
    };

    for (const imported of metadata.imports ?? []) {
      walk(imported);
    }

    if (globals.length === 0) {
      return;
    }

    for (const globalModule of globals) {
      // A global module imported by an earlier one in this list is already processed.
      if (this.scope.processedModules.has(globalModule)) {
        continue;
      }

      const childModule = new OneBunModule(
        globalModule, this.loggerLayer, this.config,
        [...this.ancestorMiddlewareClasses, ...this.ownMiddlewareClasses],
        this.tracingOptions, this.scope, this,
      );
      this.childModules.push(childModule);
      this.preRegisteredModules.set(globalModule, childModule);

      for (const [tag, instance] of childModule.getExportedServices()) {
        this.scope.services.set(tag, instance);
      }
      this.scope.processedModules.add(globalModule);

      this.logger.debug(
        `Pre-registered global module ${globalModule.name} before processing imports of ${this.moduleClass.name}`,
      );
    }

    // Make them visible to THIS module too, since PHASE 0 already ran.
    this.seedGlobalServices();
  }

  /**
   * Record which imported module contributed a service, so two registrations of the same
   * class can be told apart.
   *
   * Two named registrations export the SAME service class and therefore the same tag; the
   * per-module map has one slot for it, so without this the second import silently replaces
   * the first and the module talks to whichever database was listed last.
   */
  private noteContributor(
    tag: Context.Tag<unknown, unknown>,
    importModule: Function,
    instance?: unknown,
  ): void {
    if (instance !== undefined) {
      const byRegistration = this.tagByRegistration.get(tag) ?? new Map<Function, unknown>();
      byRegistration.set(importModule, instance);
      this.tagByRegistration.set(tag, byRegistration);
    }

    const existing = this.tagContributors.get(tag);
    if (!existing) {
      this.tagContributors.set(tag, [importModule]);

      return;
    }

    if (!existing.includes(importModule)) {
      existing.push(importModule);
    }
  }

  /**
   * Refuse to answer for a service that two selected registrations both provide.
   *
   * The slot is VACATED rather than left holding the last writer: an ambiguous ask must not
   * be answered, and leaving a value there would answer it. The error names both
   * registrations, because "could not resolve" for a service that is present twice reads as
   * a missing import and sends the reader looking in the wrong place.
   */
  private assertUnambiguous(tag: Context.Tag<unknown, unknown>, requestedBy: string): void {
    const contributors = this.tagContributors.get(tag);
    if (!contributors || contributors.length < 2) {
      return;
    }

    const names = contributors.map((module) => module.name).join(', ');
    const error = new Error(
      `Module ${this.moduleClass.name} selects ${contributors.length} registrations that ` +
      `each provide this service (${names}), so the dependency of ${requestedBy} is ` +
      'ambiguous. Import one registration per module, so each module\'s providers resolve ' +
      'to the one it selected.',
    );
    error.name = 'OneBunAmbiguousRegistrationError';
    throw error;
  }

  /**
   * Copy the application scope's `@Global()` services into this module.
   *
   * Never overwrites: an override seeded in PHASE -1, or a service this module already
   * imported, wins over the scope. Runs twice — once before the import loop and once after
   * it — because an import can register a global module mid-loop.
   *
   * @returns The number of services this call added.
   */
  private seedGlobalServices(): number {
    let added = 0;

    for (const [tag, instance] of this.scope.services) {
      if (!this.serviceInstances.has(tag)) {
        this.serviceInstances.set(tag, instance);
        added++;
        this.logger.debug(
          `Added global service ${(instance as object).constructor?.name || 'unknown'} to ${this.moduleClass.name}`,
        );
      }
    }

    return added;
  }

  /**
   * Snapshot a dynamic module's options into this application's scope.
   *
   * `forRoot()` stores its options on the module CLASS, which every application in the
   * process shares — so a second `forRoot()` overwrites the first for everyone. Reading them
   * here, while the importing module is being initialized, pins the value this application
   * imported. Consumers read it back through `resolveScopedModuleOptions`.
   */
  private captureModuleOptions(importModule: Function): void {
    const getOptions = (importModule as { getOptions?: unknown }).getOptions;
    if (typeof getOptions !== 'function') {
      return;
    }

    try {
      const options = (getOptions as () => unknown).call(importModule);
      if (options !== undefined) {
        this.scope.moduleOptions.set(importModule, options);
      }
    } catch (error) {
      this.logger.debug(`Could not capture options for module ${importModule.name}: ${error}`);
    }
  }

  /**
   * Reject NestJS-style object providers, which were silently discarded.
   *
   * `@Module({ providers: [{ provide: X, useValue: v }] })` typechecks against the metadata
   * shape but every later filter drops anything that is not a function, so the provider
   * simply never existed and the failure surfaced as an unrelated unresolved dependency.
   *
   * @see docs:migration-nestjs.md
   */
  private validateProviderShapes(providers: readonly unknown[]): void {
    for (const provider of providers) {
      if (typeof provider === 'function' || provider === null || provider === undefined) {
        continue;
      }

      if (typeof provider === 'object' && 'provide' in (provider as object)) {
        const error = new Error(
          `Module ${this.moduleClass.name} declares an object provider ` +
          `{ provide: ${String((provider as { provide?: unknown }).provide)}, ... }. ` +
          'OneBun supports class-based providers only: list the @Service()-decorated class ' +
          'itself, and substitute implementations with TestingModule.overrideProvider().',
        );
        error.name = 'OneBunInvalidProviderError';
        throw error;
      }
    }
  }

  /**
   * Create services with automatic dependency injection
   * Services can depend on other services (including imported ones)
   */
  /**
   * Whether the decorator metadata diagnostic has already run (once per process).
   * Prevents repeated checks across multiple module initializations.
   */
  private static decoratorMetadataDiagnosed = false;

  /**
   * Reset the diagnostic flag (for testing).
   * @internal
   */
  static resetDecoratorMetadataDiagnosis(): void {
    OneBunModule.decoratorMetadataDiagnosed = false;
  }

  private createServicesWithDI(metadata: ReturnType<typeof getModuleMetadata>): void {
    if (!metadata?.providers) {
      return;
    }

    // Run before both `typeof p === 'function'` filters below, which is where an object
    // provider used to disappear without a trace.
    this.validateProviderShapes(metadata.providers as readonly unknown[]);

    // The set of service classes this module can resolve, keyed by the class OBJECT.
    // Keyed by `provider.name` this decided "defer" vs "throw" for two DIFFERENT classes that
    // share a name: creating the first marked the other one's name as created, the deferral
    // was skipped, and boot died with a DependencyResolutionError advising you to decorate a
    // class that is decorated. Same module graph, and the order of the `providers` array
    // decided whether the application started.
    const availableServiceClasses = new Set<Function>();
    for (const provider of metadata.providers) {
      if (typeof provider === 'function') {
        availableServiceClasses.add(provider);
      }
    }

    // Add imported services to available classes
    for (const [, instance] of this.serviceInstances) {
      if (instance && typeof instance === 'object') {
        availableServiceClasses.add(instance.constructor);
      }
    }

    // Run decorator metadata diagnostic once: check that Bun emits design:paramtypes.
    // If emitDecoratorMetadata is missing from the root tsconfig.json, Bun silently
    // skips metadata emission and ALL constructor-based DI breaks.
    // Only mark as diagnosed when we actually found classes with constructor params
    // (modules with only zero-arg services can't tell us anything).
    if (!OneBunModule.decoratorMetadataDiagnosed) {
      const providerClasses = metadata.providers.filter(
        (p): p is Function => typeof p === 'function',
      );
      const diagnosis = diagnoseDecoratorMetadata(providerClasses);
      if (diagnosis.classesWithParams > 0) {
        OneBunModule.decoratorMetadataDiagnosed = true;
        if (!diagnosis.ok) {
          throw new Error(
            buildDecoratorMetadataDiagnosticMessage(diagnosis.classesWithParams),
          );
        }
      }
    }

    // Create services in dependency order
    const pendingProviders = [...metadata.providers.filter((p) => typeof p === 'function')];
    const createdServices = new Set<Function>();
    // Names, not classes: this one only ever feeds message text and buildDependencyChain.
    const unresolvedDeps = new Map<string, string[]>(); // Track unresolved dependencies for error reporting
    let iterations = 0;
    const maxIterations = pendingProviders.length * 2; // Prevent infinite loops

    while (pendingProviders.length > 0 && iterations < maxIterations) {
      iterations++;
      const provider = pendingProviders.shift();
      if (!provider || typeof provider !== 'function') {
        continue;
      }

      const serviceMetadata = getServiceMetadata(provider);
      if (!serviceMetadata) {
        this.logger.debug(`Provider ${provider.name} does not have @Service decorator, skipping`);
        continue;
      }

      // An override replaces the provider outright: constructing the real one would run its
      // constructor (and its dependencies') for an instance nothing would ever receive.
      if (this.scope.overrides.has(serviceMetadata.tag as Context.Tag<unknown, unknown>)) {
        createdServices.add(provider);
        this.logger.debug(`Provider ${provider.name} replaced by a test override, not constructed`);
        continue;
      }

      // Use getConstructorParamTypes for @Inject and TypeScript design:paramtypes metadata
      const detectedDeps = getConstructorParamTypes(provider);
      const dependencies: unknown[] = [];
      let allDependenciesResolved = true;

      if (detectedDeps && detectedDeps.length > 0) {
        for (let i = 0; i < detectedDeps.length; i++) {
          const depType = detectedDeps[i];
          const dependency = this.resolveDependencyByType(depType, provider, i);
          if (dependency) {
            dependencies.push(dependency);
          } else {
            // Check if it's a service that hasn't been created yet
            const isServiceInModule = availableServiceClasses.has(depType);
            if (isServiceInModule && !createdServices.has(depType)) {
              // Track unresolved dependency for error reporting
              const deps = unresolvedDeps.get(provider.name) || [];
              if (!deps.includes(depType.name)) {
                deps.push(depType.name);
                unresolvedDeps.set(provider.name, deps);
              }
              // This dependency will be created later, defer this service
              allDependenciesResolved = false;
              pendingProviders.push(provider);
              break;
            } else if (isOptionalParam(provider, i)) {
              dependencies.push(undefined);
            } else {
              const suggestions = this.buildResolutionSuggestions(depType);
              throw new DependencyResolutionError(provider.name, depType.name, 'service', suggestions);
            }
          }
        }
      }

      if (!allDependenciesResolved) {
        continue;
      }

      // Create service instance with resolved dependencies.
      // Set ambient init context so BaseService constructor can pick up logger/config,
      // making them available immediately after super() in subclass constructors.
      let diMark: ProfileMark | undefined;
      if (PROFILING_ENABLED) {
        diMark = getProfiler()!.start('di', `service:${provider.name}`, {
          dependencyCount: dependencies.length,
        });
      }
      try {
        const serviceConstructor = provider as new (...args: unknown[]) => unknown;

        BaseService.setInitContext(this.logger, this.config, this.scope, this.moduleClass);
        let serviceInstance: unknown;
        try {
          serviceInstance = new serviceConstructor(...dependencies);
        } finally {
          BaseService.clearInitContext();
        }

        // Fallback: call initializeService for services that have it but were not
        // initialized via the constructor (e.g., services not extending BaseService
        // but implementing initializeService manually, or for backwards compatibility).
        if (
          serviceInstance &&
          typeof serviceInstance === 'object' &&
          'initializeService' in serviceInstance &&
          typeof (serviceInstance as { initializeService: unknown }).initializeService === 'function'
        ) {
          (serviceInstance as {
            initializeService: (logger: SyncLogger, config: unknown, scope?: GlobalScope) => void;
          })
            .initializeService(this.logger, this.config, this.scope);
        }

        // Track services that need lifecycle hooks (onModuleInit)
        if (hasOnModuleInit(serviceInstance)) {
          this.pendingServiceInits.push({
            name: provider.name,
            instance: serviceInstance,
          });
        }

        // Apply auto-tracing if enabled (lazy require to avoid loading OTEL when tracing is off)
        if (this.tracingOptions) {
          const { shouldAutoTrace, applyAutoTrace } = require('@onebun/trace');
          if (shouldAutoTrace(provider, provider.name, !!this.tracingOptions.traceAll, this.tracingOptions.traceFilter)) {
            applyAutoTrace(serviceInstance, provider.name, this.tracingOptions.traceFilter);
          }
        }

        this.serviceInstances.set(serviceMetadata.tag, serviceInstance);
        createdServices.add(provider);
        if (diMark) {
          getProfiler()!.end(diMark);
        }
        this.logger.debug(
          `Created service ${provider.name} with ${dependencies.length} injected dependencies`,
        );
      } catch (error) {
        if (diMark) {
          getProfiler()!.end(diMark);
        }
        // Re-throw bootstrap errors (DI resolution, circular deps) so they propagate
        if (error instanceof Error && error.name.startsWith('OneBun')) {
          throw error;
        }
        this.logger.error(`Failed to create service ${provider.name}: ${error}`);
      }
    }

    // Only report circular dependency if there are still unresolved services
    const unresolvedServices = pendingProviders
      .filter((p) => typeof p === 'function')
      .map((p) => p.name);

    if (iterations >= maxIterations && unresolvedServices.length > 0) {
      const details = unresolvedServices
        .map((serviceName) => {
          const deps = unresolvedDeps.get(serviceName) || [];

          return `  - ${serviceName} -> needs: [${deps.join(', ')}]`;
        })
        .join('\n');

      const dependencyChain = this.buildDependencyChain(unresolvedDeps, unresolvedServices);

      const errorMessage =
        `Circular dependency detected in module ${this.moduleClass.name}!\n` +
        `Unresolved services:\n${details}\n` +
        `Dependency chain: ${dependencyChain}`;

      this.logger.error(errorMessage);
      throw new CircularDependencyError(this.moduleClass.name, dependencyChain, unresolvedServices);
    }
  }

  /**
   * Get exported services from this module
   * Returns services that are listed in the module's exports array.
   *
   * A MODULE listed there throws: `exports` accepts services only.
   *
   * @see docs:api/decorators.md
   */
  getExportedServices(): Map<Context.Tag<unknown, unknown>, unknown> {
    const metadata = getModuleMetadata(this.moduleClass);
    const exported = new Map<Context.Tag<unknown, unknown>, unknown>();

    if (!metadata?.exports) {
      return exported;
    }

    for (const exportedProvider of metadata.exports) {
      if (typeof exportedProvider !== 'function') {
        continue;
      }

      // A module class in `exports` is the NestJS re-export idiom, and it contributed
      // NOTHING here: getServiceTag() throws for it and the throw was swallowed. An
      // importer that also imported the re-exported module got a SECOND copy of every
      // provider — two DrizzleServices, two connection pools — and an importer that relied
      // on the re-export alone failed at a controller with no mention of the export.
      if (getModuleMetadata(exportedProvider)) {
        const error = new Error(
          `Module ${this.moduleClass.name} exports the module ${exportedProvider.name}. ` +
          'OneBun exports services, not modules: re-exporting a module has never made its ' +
          `services reachable. Remove ${exportedProvider.name} from exports and import it ` +
          'directly wherever its services are needed.',
        );
        error.name = 'OneBunInvalidExportError';
        throw error;
      }

      try {
        const tag = getServiceTag(exportedProvider as new (...args: unknown[]) => unknown);
        const instance = this.serviceInstances.get(tag);
        if (instance) {
          exported.set(tag, instance);
        }
      } catch {
        // Not a service with @Service decorator
      }
    }

    return exported;
  }

  /**
   * Instantiate middleware classes with DI from this module's service scope.
   * Resolves constructor dependencies, calls initializeMiddleware(), and
   * returns bound use() functions ready for the execution pipeline.
   */
  resolveMiddleware(classes: Function[]): Function[] {
    return classes.map((cls) => {
      // Resolve constructor dependencies (same logic as for controllers)
      const paramTypes = getConstructorParamTypes(cls);
      const deps: unknown[] = [];

      if (paramTypes && paramTypes.length > 0) {
        for (let i = 0; i < paramTypes.length; i++) {
          const paramType = paramTypes[i];
          const dep = this.resolveDependencyByType(paramType, cls, i);
          if (dep) {
            deps.push(dep);
          } else if (isOptionalParam(cls, i)) {
            deps.push(undefined);
          } else {
            const suggestions = this.buildResolutionSuggestions(paramType);
            throw new DependencyResolutionError(cls.name, paramType.name, 'middleware', suggestions);
          }
        }
      }

      const middlewareConstructor = cls as new (...args: unknown[]) => BaseMiddleware;

      // Set ambient init context so BaseMiddleware constructor can pick up logger/config,
      // making them available immediately after super() in subclass constructors.
      BaseMiddleware.setInitContext(this.logger, this.config);
      let instance: BaseMiddleware;
      try {
        instance = new middlewareConstructor(...deps);
      } finally {
        BaseMiddleware.clearInitContext();
      }

      // Fallback: call initializeMiddleware for middleware not initialized via
      // the constructor (e.g., not extending BaseMiddleware, or for backwards compatibility).
      instance.initializeMiddleware(this.logger, this.config);

      const bound = instance.use.bind(instance);
      // Preserve class name for profiling and debugging
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bound as any)._middlewareName = cls.name;
      // And the instance itself, so a caller that needs to ask the middleware a question —
      // rather than run it — does not have to instantiate a second one with different DI.
      // The application's CORS preflight short-circuit reads `continuesPreflight` this way.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bound as any)._middlewareInstance = instance;

      return bound;
    });
  }

  /**
   * Instantiate interceptor classes with DI from this module's service scope.
   * Resolves constructor dependencies, calls initializeInterceptor(), and
   * returns bound intercept() functions ready for the execution pipeline.
   *
   * Accepts both class constructors (resolved via DI) and instances (used as-is).
   */
  resolveInterceptors(classes: (Function | Interceptor)[]): ResolvedInterceptor[] {
    return classes.map((cls) => {
      // If already an instance (not a constructor), bind intercept() directly
      if (typeof cls !== 'function') {
        const instance = cls;
        if ('initializeInterceptor' in instance) {
          (instance as BaseInterceptor).initializeInterceptor(this.logger, this.config);
        }

        return instance.intercept.bind(instance);
      }

      // Resolve constructor dependencies (same logic as for middleware)
      const paramTypes = getConstructorParamTypes(cls);
      const deps: unknown[] = [];

      if (paramTypes && paramTypes.length > 0) {
        for (let i = 0; i < paramTypes.length; i++) {
          const paramType = paramTypes[i];
          const dep = this.resolveDependencyByType(paramType, cls, i);
          if (dep) {
            deps.push(dep);
          } else if (isOptionalParam(cls, i)) {
            deps.push(undefined);
          } else {
            const suggestions = this.buildResolutionSuggestions(paramType);
            throw new DependencyResolutionError(cls.name, paramType.name, 'interceptor', suggestions);
          }
        }
      }

      const interceptorConstructor = cls as new (...args: unknown[]) => Interceptor;

      // Set ambient init context so BaseInterceptor constructor can pick up logger/config
      BaseInterceptor.setInitContext(this.logger, this.config);
      let instance: Interceptor;
      try {
        instance = new interceptorConstructor(...deps);
      } finally {
        BaseInterceptor.clearInitContext();
      }

      // Fallback initialization for interceptors extending BaseInterceptor
      if ('initializeInterceptor' in instance) {
        (instance as BaseInterceptor).initializeInterceptor(this.logger, this.config);
      }

      const bound = instance.intercept.bind(instance);

      return bound;
    });
  }

  /**
   * Resolve guard classes into instances with dependency injection, once.
   *
   * Guards were the only element of the documented request pipeline with no DI at all:
   * `executeHttpGuards` did `new guard()` with zero arguments, on EVERY request. A guard
   * extending `BaseService` therefore saw `this.config` and `this.logger` as `undefined`,
   * because the ambient init context is only set around module construction — so the
   * documented `this.config.get('auth.apiKey')` threw at request time.
   *
   * Mirrors `resolveInterceptors`. An entry that is already an instance is passed through,
   * so `@UseGuards(new RolesGuard(['admin']))` keeps working.
   *
   * Transport-agnostic: WebSocket gateways and queue consumers run their guards through this
   * same method, via the binding `createControllersWithDI` attaches to each instance, so
   * `@UseGuards` behaves identically on all three transports instead of only having DI on HTTP.
   *
   * @see docs:api/guards.md
   */
  resolveGuards(guards: (Function | Guard)[]): Guard[] {
    return guards.map((guard) => {
      if (typeof guard !== 'function') {
        // Already an instance — the caller owns its lifetime, as before. Initialize it if
        // it can be, then use it as-is.
        if (guard instanceof BaseService) {
          guard.initializeService(this.logger, this.config, this.scope);
        }

        return guard;
      }

      // Dependencies are resolved ONCE, here. The instance is NOT: a guard class has always
      // been constructed per request, so guards are the one pipeline element where stashing
      // request state on `this` across an await is safe. Sharing one instance turns that
      // pattern into a cross-request race that authorizes requests it must deny — measured:
      // a slow "mallory" request and a fast "admin" one overlapping made mallory pass. So
      // the lifetime stays per-request and only the wiring is hoisted.
      const paramTypes = getConstructorParamTypes(guard);
      const deps: unknown[] = [];

      if (paramTypes && paramTypes.length > 0) {
        for (let i = 0; i < paramTypes.length; i++) {
          const paramType = paramTypes[i];
          const dep = this.resolveDependencyByType(paramType, guard, i);
          if (dep) {
            deps.push(dep);
          } else if (isOptionalParam(guard, i)) {
            deps.push(undefined);
          } else {
            const suggestions = this.buildResolutionSuggestions(paramType);
            throw new DependencyResolutionError(guard.name, paramType.name, 'guard', suggestions);
          }
        }
      }

      const guardConstructor = guard as new (...args: unknown[]) => Guard;
      const logger = this.logger;
      const config = this.config;
      const scope = this.scope;

      // A per-invocation façade, so the resolved dependencies are reused without the instance
      // being shared. Returned as a Guard so the three executors need no changes.
      return {
        // The class name would otherwise be lost behind this object literal, and it is what
        // every guard diagnostic on WS and queue names.
        guardName: guardConstructor.name,
        canActivate(context): boolean | Promise<boolean> {
          // Ambient init context, so a guard extending BaseService has this.config and
          // this.logger available immediately after super().
          BaseService.setInitContext(logger, config, scope);
          let instance: Guard;
          try {
            instance = new guardConstructor(...deps);
          } finally {
            BaseService.clearInitContext();
          }

          if (instance instanceof BaseService) {
            instance.initializeService(logger, config, scope);
          }

          return instance.canActivate(context);
        },
      };
    });
  }

  /**
   * Resolve own and ancestor middleware classes into bound functions.
   * Recursively resolves middleware for all child modules too.
   * Must be called after services are created (DI scope is complete).
   * @internal
   */
  private resolveModuleMiddleware(): void {
    if (this.ancestorMiddlewareClasses.length > 0) {
      this.resolvedAncestorMiddleware = this.resolveMiddleware(this.ancestorMiddlewareClasses);
    }
    if (this.ownMiddlewareClasses.length > 0) {
      this.resolvedOwnMiddleware = this.resolveMiddleware(this.ownMiddlewareClasses);
    }
    // Recursively resolve for all descendant modules
    for (const childModule of this.childModules) {
      childModule.resolveModuleMiddleware();
    }
  }

  /**
   * Create controller instances and inject services
   */
  createControllerInstances(): Effect.Effect<unknown, never, void> {
    return Effect.sync(() => {
      // Automatically analyze and register dependencies for all controllers of this module
      for (const controllerClass of this.controllers) {
        registerControllerDependencies(controllerClass);
      }

      // Create controller instances with automatic dependency injection
      this.createControllersWithDI();
    }).pipe(Effect.provide(this.rootLayer));
  }

  /**
   * Create controllers with automatic dependency injection
   */
  private createControllersWithDI(): void {
    for (const controllerClass of this.controllers) {
      // Get constructor parameter types automatically from DI system
      const paramTypes = getConstructorParamTypes(controllerClass);
      const dependencies: unknown[] = [];

      if (paramTypes && paramTypes.length > 0) {
        // Resolve dependencies based on registered parameter types
        for (let i = 0; i < paramTypes.length; i++) {
          const paramType = paramTypes[i];
          const dependency = this.resolveDependencyByType(paramType, controllerClass, i);
          if (dependency) {
            dependencies.push(dependency);
          } else if (isOptionalParam(controllerClass, i)) {
            dependencies.push(undefined);
          } else {
            const suggestions = this.buildResolutionSuggestions(paramType);
            throw new DependencyResolutionError(
              controllerClass.name, paramType.name, 'controller', suggestions,
            );
          }
        }
      }

      // Create controller with resolved dependencies.
      // Set ambient init context so the base class constructor can pick up logger/config,
      // making them available immediately after super() in subclass constructors.
      const controllerConstructor = controllerClass as new (...args: unknown[]) => Controller;
      const isGateway = isWebSocketGateway(controllerClass);
      let controller: Controller;

      if (isGateway) {
        BaseWebSocketGateway.setInitContext(this.logger, this.config);
      } else {
        Controller.setInitContext(this.logger, this.config);
      }

      try {
        controller = new controllerConstructor(...dependencies);
      } finally {
        if (isGateway) {
          BaseWebSocketGateway.clearInitContext();
        } else {
          Controller.clearInitContext();
        }
      }

      // Fallback: call initializeController / _initializeBase for controllers/gateways
      // that were not initialized via the constructor (e.g., not extending the base class,
      // or for backwards compatibility).
      if (isGateway) {
        const gateway = controller as unknown as BaseWebSocketGateway;
        if (typeof gateway._initializeBase === 'function') {
          gateway._initializeBase(this.logger, this.config);
        }
      } else if (typeof controller.initializeController === 'function') {
        controller.initializeController(this.logger, this.config);
      }

      // Apply auto-tracing if enabled (lazy require to avoid loading OTEL when tracing is off)
      if (this.tracingOptions) {
        const { shouldAutoTrace, applyAutoTrace } = require('@onebun/trace');
        if (shouldAutoTrace(
          controllerClass, controllerClass.name,
          !!this.tracingOptions.traceAll, this.tracingOptions.traceFilter,
        )) {
          applyAutoTrace(controller, controllerClass.name, this.tracingOptions.traceFilter);
        }
      }

      // Lend this module's guard DI to whoever registers the instance later. HTTP resolves
      // guards in application.ts, where the owner module is in hand; WebSocket gateways and
      // queue consumers are registered by WsHandler/QueueService, which know nothing about
      // modules — which is why both used to construct guards with a bare `new guard()` and any
      // guard with a dependency threw on every message. Attached to the INSTANCE, not to a
      // class-keyed registry: in multi-service mode two applications can mount the same class
      // and must not share a DI scope.
      attachGuardBinding(controller, {
        resolve: (guards) => this.resolveGuards(guards),
        logger: this.logger,
      });

      this.controllerInstances.set(controllerClass, controller);

      if (paramTypes && paramTypes.length > 0) {
        this.logger.debug(
          `Controller ${controllerClass.name} created with ${paramTypes.length} injected dependencies`,
        );
      }
    }
  }

  /**
   * Resolve dependency by name (string) - DEPRECATED
   */
  private resolveDependencyByName(_typeName: string): unknown {
    // This method is deprecated with the new automatic system
    return null;
  }

  /**
   * Resolve a dependency the caller named with `@Inject(TOKEN)`.
   *
   * Reads the per-registration map rather than `serviceInstances`, whose single slot per tag
   * is exactly what a module holding two registrations cannot use. An unselected token is an
   * error naming what the module DID select: silently falling back to the tag slot would hand
   * back the other database, which is the failure this whole mechanism exists to prevent.
   */
  private resolveByRegistrationToken(type: Function, token: symbol | string, requestedBy: string): unknown {
    const registrationModule = findRegistrationModule(token, type);
    let tag: Context.Tag<unknown, unknown> | undefined;
    try {
      tag = getServiceTag(type as new (...args: unknown[]) => unknown) as Context.Tag<unknown, unknown>;
    } catch {
      tag = undefined;
    }

    const selected = tag ? this.tagByRegistration.get(tag) : undefined;
    if (registrationModule && selected?.has(registrationModule)) {
      return selected.get(registrationModule);
    }

    const available = selected && selected.size > 0
      ? [...selected.keys()].map((module) => module.name).join(', ')
      : '(none)';
    const error = new Error(
      `Module ${this.moduleClass.name} did not select the registration ` +
      `${describeRegistrationToken(token)} that ${requestedBy} asks for. It selected: ` +
      `${available}. Add forFeature(${describeRegistrationToken(token)}) to this module's imports.`,
    );
    error.name = 'OneBunUnselectedRegistrationError';
    throw error;
  }

  /**
   * Resolve dependency by type (constructor function)
   */
  private resolveDependencyByType(type: Function, owner?: Function, paramIndex?: number): unknown {
    // An explicit registration token decides WHICH registration this parameter gets, which is
    // the only way to resolve at all in a module that selected two of them.
    if (owner !== undefined && paramIndex !== undefined) {
      const token = getInjectToken(owner, paramIndex);
      if (token !== undefined) {
        return this.resolveByRegistrationToken(type, token, owner.name);
      }
    }

    // QueueService is registered by tag (QueueServiceTag) before setup(); resolve by tag
    if (type === QueueService) {
      const byTag = this.serviceInstances.get(
        QueueServiceTag as Context.Tag<unknown, unknown>,
      );
      if (byTag !== undefined) {
        return byTag;
      }
    }

    // Try to find by Effect Context.Tag first.
    // This is the primary mechanism and also makes test overrides work:
    // TestingModule.overrideProvider(MyService).useValue(mock) registers the mock
    // under MyService's tag, so it is found here even if mock is not instanceof MyService.
    let tag: Context.Tag<unknown, unknown> | undefined;
    try {
      tag = getServiceTag(type as new (...args: unknown[]) => unknown) as Context.Tag<unknown, unknown>;
    } catch {
      // Not a @Service()-decorated class — fall through to the instanceof check below.
      tag = undefined;
    }

    if (tag) {
      // Outside the try on purpose: an ambiguity error must propagate, not be swallowed by
      // the catch that exists only to detect a non-@Service class.
      this.assertUnambiguous(tag, type.name);

      const byTag = this.serviceInstances.get(tag);
      if (byTag !== undefined) {
        return byTag;
      }
    }

    // Fallback: find service instance that matches the type by reference equality or inheritance
    const serviceInstance = Array.from(this.serviceInstances.values()).find((instance) => {
      if (!instance) {
        return false;
      }

      // Check if instance is of the exact type or inherits from it
      return instance.constructor === type || instance instanceof type;
    });

    return serviceInstance;
  }

  /**
   * Build a human-readable dependency chain for circular dependency error reporting
   * Traverses the dependency graph to find and display the cycle
   */
  private buildDependencyChain(
    unresolvedDeps: Map<string, string[]>,
    unresolvedServices: string[],
  ): string {
    // Find cycle by traversing dependencies
    const visited = new Set<string>();
    const chain: string[] = [];

    const findCycle = (service: string): boolean => {
      if (visited.has(service)) {
        chain.push(service);

        return true;
      }
      visited.add(service);
      chain.push(service);

      const deps = unresolvedDeps.get(service) || [];
      for (const dep of deps) {
        if (unresolvedServices.includes(dep)) {
          if (findCycle(dep)) {
            return true;
          }
        }
      }
      chain.pop();

      return false;
    };

    for (const service of unresolvedServices) {
      visited.clear();
      chain.length = 0;
      if (findCycle(service)) {
        return chain.join(' -> ');
      }
    }

    // If no cycle found, just show all unresolved services
    return unresolvedServices.join(' <-> ');
  }

  /**
   * Build actionable suggestions when a dependency cannot be resolved.
   * Searches child modules and all registered modules to find where the
   * missing type is provided and whether it is exported/imported correctly.
   */
  private buildResolutionSuggestions(missingType: Function): string[] {
    const suggestions: string[] = [];
    const metadata = getModuleMetadata(this.moduleClass);
    const currentImports = new Set((metadata?.imports ?? []).map((m) => m.name));

    // 1. Search imported child modules
    for (const child of this.childModules) {
      const childMeta = getModuleMetadata(child.moduleClass);
      const childProviders = (childMeta?.providers ?? []) as Function[];
      const childExports = (childMeta?.exports ?? []) as Function[];

      const isProvided = childProviders.some((p) => typeof p === 'function' && p.name === missingType.name);
      const isExported = childExports.some((e) => typeof e === 'function' && e.name === missingType.name);

      if (isProvided && isExported) {
        suggestions.push(
          `${missingType.name} is exported from ${child.moduleClass.name} (already imported) — ` +
            'check if the service was created successfully.',
        );
      } else if (isProvided && !isExported) {
        suggestions.push(
          `${missingType.name} exists in ${child.moduleClass.name} but is not exported. ` +
            'Add it to the exports array.',
        );
      }
    }

    // 2. Search all registered modules that are NOT imported
    for (const [moduleClass, moduleMeta] of getRegisteredModules()) {
      if (moduleClass === this.moduleClass) {
        continue;
      }
      if (currentImports.has(moduleClass.name)) {
        continue;
      }

      const providers = (moduleMeta.providers ?? []) as Function[];
      const exports = (moduleMeta.exports ?? []) as Function[];
      const hasProvider = providers.some((p) => typeof p === 'function' && p.name === missingType.name);
      const hasExport = exports.some((e) => typeof e === 'function' && e.name === missingType.name);

      if (hasProvider && hasExport) {
        if (isGlobalModule(moduleClass)) {
          suggestions.push(
            `${missingType.name} is available in global module ${moduleClass.name} — ` +
              'it should be auto-resolved. Check module initialization order.',
          );
        } else {
          suggestions.push(
            `${missingType.name} is exported from ${moduleClass.name}. ` +
              `Add ${moduleClass.name} to imports of ${this.moduleClass.name}.`,
          );
        }
      } else if (hasProvider && !hasExport) {
        suggestions.push(
          `${missingType.name} exists in ${moduleClass.name} but is not exported. ` +
            `Add it to exports and import ${moduleClass.name}.`,
        );
      }
    }

    // 3. Fallback
    if (suggestions.length === 0) {
      suggestions.push(`Ensure ${missingType.name} is decorated with @Service() and listed in a module's providers.`);
      suggestions.push('If the dependency is optional, use @Optional() on the constructor parameter.');
    }

    return suggestions;
  }

  /**
   * Collect all descendant modules in depth-first order (leaves first).
   * This ensures that deeply nested modules are initialized before their parents.
   */
  private collectDescendantModules(): OneBunModule[] {
    const result: OneBunModule[] = [];
    for (const child of this.childModules) {
      result.push(...child.collectDescendantModules());
      result.push(child);
    }

    return result;
  }

  setup(): Effect.Effect<unknown, never, void> {
    const allDescendants = this.collectDescendantModules();

    return this.callServicesOnModuleInit().pipe(
      // Run onModuleInit for all descendant modules' services (depth-first)
      Effect.flatMap(() =>
        Effect.forEach(allDescendants, (mod) => mod.callServicesOnModuleInit(), {
          discard: true,
        }),
      ),
      // Resolve module-level middleware with DI (services are now available)
      // resolveModuleMiddleware is recursive and handles all descendants
      Effect.flatMap(() =>
        Effect.sync(() => {
          this.resolveModuleMiddleware();
        }),
      ),
      // Create controller instances in all descendant modules first, then this module
      Effect.flatMap(() =>
        Effect.forEach(allDescendants, (mod) => mod.createControllerInstances(), {
          discard: true,
        }),
      ),
      Effect.flatMap(() => this.createControllerInstances()),
      // Then call onModuleInit for controllers
      Effect.flatMap(() => this.callControllersOnModuleInit()),
      // Run onModuleInit for all descendant modules' controllers
      Effect.flatMap(() =>
        Effect.forEach(allDescendants, (mod) => mod.callControllersOnModuleInit(), {
          discard: true,
        }),
      ),
    );
  }

  /**
   * Call onModuleInit lifecycle hook for all services that implement it.
   * Hooks are called sequentially in dependency order (dependencies first),
   * so each service's onModuleInit completes before its dependents' onModuleInit starts.
   * This is called for ALL services in providers, even if they are not injected anywhere.
   */
  callServicesOnModuleInit(): Effect.Effect<unknown, never, void> {
    if (this.pendingServiceInits.length === 0) {
      return Effect.void;
    }

    this.logger.debug(`Calling onModuleInit for ${this.pendingServiceInits.length} service(s)`);

    return Effect.promise(async () => {
      // Run onModuleInit hooks sequentially in dependency order
      // (pendingServiceInits is already ordered: dependencies first)
      for (const { name, instance } of this.pendingServiceInits) {
        try {
          if (hasOnModuleInit(instance)) {
            await instance.onModuleInit();
          }
          this.logger.debug(`Service ${name} onModuleInit completed`);
        } catch (error) {
          this.logger.error(`Service ${name} onModuleInit failed: ${error}`);
          throw error;
        }
      }
      // Clear the list after initialization
      this.pendingServiceInits = [];
    });
  }

  /**
   * Call onModuleInit lifecycle hook for all controllers that implement it
   */
  callControllersOnModuleInit(): Effect.Effect<unknown, never, void> {
    const controllers = Array.from(this.controllerInstances.values());
    const controllersWithInit = controllers.filter((c): c is Controller & { onModuleInit(): Promise<void> | void } =>
      hasOnModuleInit(c),
    );

    if (controllersWithInit.length === 0) {
      return Effect.void;
    }

    this.logger.debug(`Calling onModuleInit for ${controllersWithInit.length} controller(s)`);

    const initPromises = controllersWithInit.map(async (controller) => {
      try {
        await controller.onModuleInit();
        this.logger.debug(`Controller ${controller.constructor.name} onModuleInit completed`);
      } catch (error) {
        this.logger.error(`Controller ${controller.constructor.name} onModuleInit failed: ${error}`);
        throw error;
      }
    });

    return Effect.promise(() => Promise.all(initPromises));
  }

  /**
   * Call onApplicationInit lifecycle hook for all services and controllers
   *
   * @param invoked - Identity set of instances already visited, threaded through the
   *   recursion. A `@Global()` service is present in the `serviceInstances` map of every
   *   module that can see it, so without this its hook fired once per module — five times in
   *   a five-module tree. Test overrides seeded into every module amplify the same effect.
   */
  async callOnApplicationInit(invoked: Set<unknown> = new Set()): Promise<void> {
    // Call for services
    for (const [, instance] of this.serviceInstances) {
      if (!this.markInvoked(invoked, instance)) {
        continue;
      }
      if (hasOnApplicationInit(instance)) {
        try {
          await instance.onApplicationInit();
          this.logger.debug(`Service ${(instance as object).constructor.name} onApplicationInit completed`);
        } catch (error) {
          this.logger.error(`Service ${(instance as object).constructor.name} onApplicationInit failed: ${error}`);
          throw error;
        }
      }
    }

    // Call for controllers
    for (const [, controller] of this.controllerInstances) {
      if (hasOnApplicationInit(controller)) {
        try {
          await controller.onApplicationInit();
          this.logger.debug(`Controller ${controller.constructor.name} onApplicationInit completed`);
        } catch (error) {
          this.logger.error(`Controller ${controller.constructor.name} onApplicationInit failed: ${error}`);
          throw error;
        }
      }
    }

    // Call for child modules
    for (const childModule of this.childModules) {
      await childModule.callOnApplicationInit(invoked);
    }
  }

  /**
   * Mark an instance as visited for a lifecycle pass.
   *
   * @returns `true` when this pass has not seen the instance before.
   */
  private markInvoked(invoked: Set<unknown>, instance: unknown): boolean {
    if (invoked.has(instance)) {
      return false;
    }
    invoked.add(instance);

    return true;
  }

  /**
   * Call beforeApplicationDestroy lifecycle hook for all services and controllers
   *
   * @param signal - Termination signal, when the shutdown was signal-driven.
   * @param invoked - Identity set of instances already visited; see `callOnApplicationInit`.
   */
  async callBeforeApplicationDestroy(signal?: string, invoked: Set<unknown> = new Set()): Promise<void> {
    // Call for services
    for (const [, instance] of this.serviceInstances) {
      if (!this.markInvoked(invoked, instance)) {
        continue;
      }
      if (hasBeforeApplicationDestroy(instance)) {
        try {
          await instance.beforeApplicationDestroy(signal);
          this.logger.debug(`Service ${(instance as object).constructor.name} beforeApplicationDestroy completed`);
        } catch (error) {
          this.logger.error(`Service ${(instance as object).constructor.name} beforeApplicationDestroy failed: ${error}`);
        }
      }
    }

    // Call for controllers
    for (const [, controller] of this.controllerInstances) {
      if (hasBeforeApplicationDestroy(controller)) {
        try {
          await controller.beforeApplicationDestroy(signal);
          this.logger.debug(`Controller ${controller.constructor.name} beforeApplicationDestroy completed`);
        } catch (error) {
          this.logger.error(`Controller ${controller.constructor.name} beforeApplicationDestroy failed: ${error}`);
        }
      }
    }

    // Call for child modules
    for (const childModule of this.childModules) {
      await childModule.callBeforeApplicationDestroy(signal, invoked);
    }
  }

  /**
   * Call onModuleDestroy lifecycle hook for controllers first, then services
   *
   * @param invoked - Identity set of instances already visited; see `callOnApplicationInit`.
   *   Without it a `@Global()` service's `close()` runs once per module that can see it.
   */
  async callOnModuleDestroy(invoked: Set<unknown> = new Set()): Promise<void> {
    // Call for controllers first (reverse order of creation)
    const controllers = Array.from(this.controllerInstances.values()).reverse();
    for (const controller of controllers) {
      if (hasOnModuleDestroy(controller)) {
        try {
          await controller.onModuleDestroy();
          this.logger.debug(`Controller ${controller.constructor.name} onModuleDestroy completed`);
        } catch (error) {
          this.logger.error(`Controller ${controller.constructor.name} onModuleDestroy failed: ${error}`);
        }
      }
    }

    // Call for services (reverse order of creation)
    const services = Array.from(this.serviceInstances.values()).reverse();
    for (const instance of services) {
      if (!this.markInvoked(invoked, instance)) {
        continue;
      }
      if (hasOnModuleDestroy(instance)) {
        try {
          await instance.onModuleDestroy();
          this.logger.debug(`Service ${(instance as object).constructor.name} onModuleDestroy completed`);
        } catch (error) {
          this.logger.error(`Service ${(instance as object).constructor.name} onModuleDestroy failed: ${error}`);
        }
      }
    }

    // Call for child modules
    for (const childModule of this.childModules) {
      await childModule.callOnModuleDestroy(invoked);
    }
  }

  /**
   * Call onApplicationDestroy lifecycle hook for all services and controllers
   *
   * @param signal - Termination signal, when the shutdown was signal-driven.
   * @param invoked - Identity set of instances already visited; see `callOnApplicationInit`.
   */
  async callOnApplicationDestroy(signal?: string, invoked: Set<unknown> = new Set()): Promise<void> {
    // Call for services
    for (const [, instance] of this.serviceInstances) {
      if (!this.markInvoked(invoked, instance)) {
        continue;
      }
      if (hasOnApplicationDestroy(instance)) {
        try {
          await instance.onApplicationDestroy(signal);
          this.logger.debug(`Service ${(instance as object).constructor.name} onApplicationDestroy completed`);
        } catch (error) {
          this.logger.error(`Service ${(instance as object).constructor.name} onApplicationDestroy failed: ${error}`);
        }
      }
    }

    // Call for controllers
    for (const [, controller] of this.controllerInstances) {
      if (hasOnApplicationDestroy(controller)) {
        try {
          await controller.onApplicationDestroy(signal);
          this.logger.debug(`Controller ${controller.constructor.name} onApplicationDestroy completed`);
        } catch (error) {
          this.logger.error(`Controller ${controller.constructor.name} onApplicationDestroy failed: ${error}`);
        }
      }
    }

    // Call for child modules
    for (const childModule of this.childModules) {
      await childModule.callOnApplicationDestroy(signal, invoked);
    }
  }

  /**
   * Get all controllers from this module and child modules (recursive).
   * Used by the application layer for routing and lifecycle.
   */
  getControllers(): Function[] {
    const fromChildren = this.childModules.flatMap((child) => child.getControllers());

    return [...this.controllers, ...fromChildren];
  }

  /**
   * Find controller instance (searches this module then child modules recursively, no logging).
   */
  private findControllerInstance(controllerClass: Function): Controller | undefined {
    const instance = this.controllerInstances.get(controllerClass);
    if (instance) {
      return instance;
    }
    for (const childModule of this.childModules) {
      const childInstance = childModule.findControllerInstance(controllerClass);
      if (childInstance) {
        return childInstance;
      }
    }

    return undefined;
  }

  /**
   * Get controller instance (searches this module then child modules recursively).
   */
  getControllerInstance(controllerClass: Function): Controller | undefined {
    const instance = this.findControllerInstance(controllerClass);
    if (!instance) {
      this.logger.warn(`No instance found for controller ${controllerClass.name}`);
    }

    return instance;
  }

  /**
   * Get accumulated module-level middleware (resolved bound functions)
   * for a controller class. Returns [...ancestorResolved, ...ownResolved]
   * for controllers that belong to this module, or delegates to child modules.
   */
  getModuleMiddleware(controllerClass: Function): Function[] {
    // Check if this module directly owns the controller
    if (this.controllers.includes(controllerClass)) {
      return [...this.resolvedAncestorMiddleware, ...this.resolvedOwnMiddleware];
    }

    // Delegate to child modules
    for (const childModule of this.childModules) {
      const middleware = childModule.getModuleMiddleware(controllerClass);
      if (middleware.length > 0) {
        return middleware;
      }
    }

    // Controller not found in this module tree (return empty — no module middleware)
    return [];
  }

  /**
   * Get the module instance that owns the given controller.
   * Used to resolve controller-level and route-level middleware with the owner module's DI.
   */
  getOwnerModuleForController(controllerClass: Function): ModuleInstance | undefined {
    if (this.controllers.includes(controllerClass)) {
      return this;
    }
    for (const childModule of this.childModules) {
      const owner = childModule.getOwnerModuleForController(controllerClass);
      if (owner) {
        return owner;
      }
    }

    return undefined;
  }

  /**
   * Get all controller instances from this module and child modules (recursive).
   */
  getControllerInstances(): Map<Function, Controller> {
    const merged = new Map<Function, Controller>(this.controllerInstances);
    for (const childModule of this.childModules) {
      for (const [cls, instance] of childModule.getControllerInstances()) {
        merged.set(cls, instance);
      }
    }

    return merged;
  }

  /**
   * Get service instance by tag
   */
  getServiceInstance<T>(tag: Context.Tag<T, T>): T | undefined {
    return this.serviceInstances.get(tag as Context.Tag<unknown, unknown>) as T | undefined;
  }

  /**
   * Get service instance by class, optionally from a NAMED registration.
   *
   * Without a token this answers from the tag-keyed slot, exactly as before. With one it
   * walks the tree for the module that selected that registration — the tag slot holds one
   * instance per module and cannot answer for a second registration, so an application with
   * two of them has no other way to reach the one it means.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getServiceByClass<T>(serviceClass: new (...args: any[]) => T, token?: symbol | string): T | undefined {
    try {
      const tag = getServiceTag(serviceClass);

      if (token !== undefined) {
        const registrationModule = findRegistrationModule(token, serviceClass);

        return registrationModule
          ? this.findByRegistration(tag as Context.Tag<unknown, unknown>, registrationModule) as T | undefined
          : undefined;
      }

      return this.getServiceInstance(tag);
    } catch {
      // Service doesn't have @Service decorator or not found
      return undefined;
    }
  }

  /**
   * The instance a given registration module contributed, searched depth-first.
   *
   * The registration may have been selected by a feature module rather than the root, so
   * asking only this module answers `undefined` for a perfectly reachable service.
   */
  private findByRegistration(tag: Context.Tag<unknown, unknown>, registrationModule: Function): unknown {
    const own = this.tagByRegistration.get(tag)?.get(registrationModule);
    if (own !== undefined) {
      return own;
    }

    for (const child of this.childModules) {
      const found = child.findByRegistration(tag, registrationModule);
      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  /**
   * Service classes the module tree holds MORE THAN ONE instance of, keyed by tag key.
   *
   * Two named registrations, or two service classes that share a name, mint one Effect tag
   * key and hold two instances. `assertUnambiguous` catches only the case where a SINGLE
   * module imported both; in the ordinary layout — the root selects one, a feature module the
   * other — nothing in the tree is ambiguous and every injection is correct. What is
   * ambiguous is asking the APPLICATION for "the" instance, and that is what this answers.
   *
   * Computed on demand and cached: the tree is immutable once `setup()` has run.
   * @internal
   */
  findAmbiguousServiceKeys(): Map<string, string[]> {
    if (this.ambiguousKeys) {
      return this.ambiguousKeys;
    }

    const byKey = new Map<string, Set<unknown>>();
    this.collectInstancesByKey(byKey);

    const ambiguous = new Map<string, string[]>();
    for (const [key, instances] of byKey) {
      if (instances.size > 1) {
        ambiguous.set(key, [...instances].map((instance) => this.describeInstance(instance)));
      }
    }
    this.ambiguousKeys = ambiguous;

    return ambiguous;
  }

  /**
   * Group every instance in this subtree by its tag KEY — the class name Effect keys by.
   */
  private collectInstancesByKey(byKey: Map<string, Set<unknown>>): void {
    for (const [tag, instance] of this.serviceInstances) {
      const key = (tag as unknown as { key: string }).key;
      const existing = byKey.get(key) ?? new Set<unknown>();
      existing.add(instance);
      byKey.set(key, existing);
    }

    for (const child of this.childModules) {
      child.collectInstancesByKey(byKey);
    }
  }

  /**
   * Name an instance for the ambiguity error: the registration that owns it when there is
   * one, so the message points at the `forRoot({ as })` call rather than at a class name that
   * is the same for both.
   */
  private describeInstance(instance: unknown): string {
    const owner = (instance as { _owner?: Function })?._owner;
    const className = (instance as object)?.constructor?.name ?? 'unknown';

    return owner && owner !== this.moduleClass ? `${className} from ${owner.name}` : className;
  }

  /**
   * Get all service instances
   */
  getAllServiceInstances(): Map<Context.Tag<unknown, unknown>, unknown> {
    return new Map(this.serviceInstances);
  }

  /**
   * Get the Layer for this module
   */
  getLayer(): Layer.Layer<never, never, unknown> {
    return this.rootLayer;
  }

  /**
   * Register a service instance by tag (e.g. before setup() for application-provided services like QueueService proxy).
   */
  registerService<T>(tag: Context.Tag<unknown, T>, instance: T): void {
    this.serviceInstances.set(tag as Context.Tag<unknown, unknown>, instance);
  }

  /**
   * Create a module from class
   * @param moduleClass - The module class
   * @param loggerLayer - Optional logger layer to use
   * @param config - Optional configuration to inject
   * @param tracingOptions - Optional auto-trace configuration
   * @param scope - The owning application's DI scope, shared by reference with the whole
   *   tree. Omit only outside an application; the process-default scope is used then.
   */
  static create(
    moduleClass: Function,
    loggerLayer?: Layer.Layer<never, never, unknown>,
    config?: IConfig<OneBunAppConfig>,
    tracingOptions?: { traceAll?: boolean; traceFilter?: TraceFilterOptions },
    scope?: GlobalScope,
  ): ModuleInstance {
    // Using console.log here because we don't have access to the logger instance yet
    // The instance will create its own logger in the constructor
    return new OneBunModule(moduleClass, loggerLayer, config, undefined, tracingOptions, scope);
  }
}

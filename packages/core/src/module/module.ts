import {
  type Context,
  Effect,
  Layer,
} from 'effect';

import type { Controller } from './controller';
import type { ModuleInstance } from '../types';

import {
  createSyncLogger,
  type Logger,
  LoggerService,
  makeLogger,
  type SyncLogger,
} from '@onebun/logger';

import {
  autoDetectDependencies,
  getConstructorParamTypes,
  getModuleMetadata,
  isGlobalModule,
  registerControllerDependencies,
} from '../decorators/decorators';
import { isWebSocketGateway } from '../websocket/ws-decorators';

import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from './config.interface';
import {
  hasOnModuleInit,
  hasOnApplicationInit,
  hasOnModuleDestroy,
  hasBeforeApplicationDestroy,
  hasOnApplicationDestroy,
} from './lifecycle';
import { getServiceMetadata, getServiceTag } from './service';

/**
 * Global services registry
 * Stores services from modules marked with @Global() decorator
 * These services are automatically available in all modules without explicit import
 */
const globalServicesRegistry = new Map<Context.Tag<unknown, unknown>, unknown>();

/**
 * Registry of processed global modules to avoid duplicate initialization
 */
const processedGlobalModules = new Set<Function>();

/**
 * Clear global services registry (useful for testing)
 * @internal
 */
export function clearGlobalServicesRegistry(): void {
  globalServicesRegistry.clear();
  processedGlobalModules.clear();
}

/**
 * Get all global services (useful for debugging)
 * @internal
 */
export function getGlobalServicesRegistry(): Map<Context.Tag<unknown, unknown>, unknown> {
  return new Map(globalServicesRegistry);
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

  constructor(
    private moduleClass: Function,
    private loggerLayer?: Layer.Layer<never, never, unknown>,
    config?: IConfig<OneBunAppConfig>,
  ) {
    // Initialize logger with module class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (logger: Logger) =>
          logger.child({ className: `OneBunModule:${moduleClass.name}` }),
        ),
        this.loggerLayer || makeLogger(),
      ) as Effect.Effect<Logger, never, never>,
    ) as Logger;
    this.logger = createSyncLogger(effectLogger);
    this.config = config ?? new NotInitializedConfig();

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

    // PHASE 0: Add global services from registry first
    // Global services are available in all modules without explicit import
    for (const [tag, instance] of globalServicesRegistry) {
      if (!this.serviceInstances.has(tag)) {
        this.serviceInstances.set(tag, instance);
        this.logger.debug(
          `Added global service ${(instance as object).constructor?.name || 'unknown'} to ${this.moduleClass.name}`,
        );
      }
    }

    // PHASE 1: Import child modules FIRST and collect their exported services
    if (metadata.imports) {
      for (const importModule of metadata.imports) {
        // Check if this is a global module that was already processed
        const isGlobal = isGlobalModule(importModule);
        
        if (isGlobal && processedGlobalModules.has(importModule)) {
          // Global module already processed, just use services from global registry
          this.logger.debug(
            `Global module ${importModule.name} already initialized, using services from global registry`,
          );
          continue;
        }

        // Pass the logger layer and config to child modules
        const childModule = new OneBunModule(importModule, this.loggerLayer, this.config);
        this.childModules.push(childModule);

        // Merge layers
        layer = Layer.merge(layer, childModule.getLayer());

        // Get exported services from child module and register them for DI
        const exportedServices = childModule.getExportedServices();
        for (const [tag, instance] of exportedServices) {
          this.serviceInstances.set(tag, instance);
          this.logger.debug(
            `Imported service ${(instance as object).constructor?.name || 'unknown'} from ${importModule.name}`,
          );

          // If this is a global module, also register services in global registry
          if (isGlobal) {
            globalServicesRegistry.set(tag, instance);
            this.logger.debug(
              `Registered global service ${(instance as object).constructor?.name || 'unknown'} from ${importModule.name}`,
            );
          }
        }

        // Mark global module as processed
        if (isGlobal) {
          processedGlobalModules.add(importModule);
        }
      }
    }

    // PHASE 2: Create services of THIS module with DI (can now access imported services)
    this.createServicesWithDI(metadata);

    // Create Effect layers for all registered services
    for (const [tag, instance] of this.serviceInstances) {
      const serviceLayer = Layer.succeed(tag, instance);
      layer = Layer.merge(layer, serviceLayer);
    }

    return { layer, controllers };
  }

  /**
   * Create services with automatic dependency injection
   * Services can depend on other services (including imported ones)
   */
  private createServicesWithDI(metadata: ReturnType<typeof getModuleMetadata>): void {
    if (!metadata?.providers) {
      return;
    }

    // Build a map of available service classes for dependency resolution
    // Include both current module providers and imported services
    const availableServiceClasses = new Map<string, Function>();
    for (const provider of metadata.providers) {
      if (typeof provider === 'function') {
        availableServiceClasses.set(provider.name, provider);
      }
    }

    // Add imported services to available classes
    for (const [, instance] of this.serviceInstances) {
      if (instance && typeof instance === 'object') {
        availableServiceClasses.set(instance.constructor.name, instance.constructor);
      }
    }

    // Create services in dependency order
    const pendingProviders = [...metadata.providers.filter((p) => typeof p === 'function')];
    const createdServices = new Set<string>();
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

      // Use getConstructorParamTypes first (for @Inject and TypeScript metadata),
      // then fallback to autoDetectDependencies (for constructor source analysis)
      const detectedDeps =
        getConstructorParamTypes(provider) ||
        autoDetectDependencies(provider, availableServiceClasses);
      const dependencies: unknown[] = [];
      let allDependenciesResolved = true;

      if (detectedDeps && detectedDeps.length > 0) {
        for (const depType of detectedDeps) {
          const dependency = this.resolveDependencyByType(depType);
          if (dependency) {
            dependencies.push(dependency);
          } else {
            // Check if it's a service that hasn't been created yet
            const isServiceInModule = availableServiceClasses.has(depType.name);
            if (isServiceInModule && !createdServices.has(depType.name)) {
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
            } else {
              this.logger.warn(
                `Could not resolve dependency ${depType.name} for service ${provider.name}`,
              );
            }
          }
        }
      }

      if (!allDependenciesResolved) {
        continue;
      }

      // Create service instance with resolved dependencies (without logger/config in constructor)
      try {
        const serviceConstructor = provider as new (...args: unknown[]) => unknown;
        const serviceInstance = new serviceConstructor(...dependencies);

        // Initialize service with logger and config if it has initializeService method
        // This is the pattern used by BaseService
        if (
          serviceInstance &&
          typeof serviceInstance === 'object' &&
          'initializeService' in serviceInstance &&
          typeof (serviceInstance as { initializeService: unknown }).initializeService === 'function'
        ) {
          (serviceInstance as { initializeService: (logger: SyncLogger, config: unknown) => void })
            .initializeService(this.logger, this.config);
        }

        // Track services that need lifecycle hooks (onModuleInit)
        if (hasOnModuleInit(serviceInstance)) {
          this.pendingServiceInits.push({
            name: provider.name,
            instance: serviceInstance,
          });
        }

        this.serviceInstances.set(serviceMetadata.tag, serviceInstance);
        createdServices.add(provider.name);
        this.logger.debug(
          `Created service ${provider.name} with ${dependencies.length} injected dependencies`,
        );
      } catch (error) {
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

      this.logger.error(
        `Circular dependency detected in module ${this.moduleClass.name}!\n` +
          `Unresolved services:\n${details}\n` +
          `Dependency chain: ${dependencyChain}`,
      );
    }
  }

  /**
   * Get exported services from this module
   * Returns services that are listed in the module's exports array
   */
  getExportedServices(): Map<Context.Tag<unknown, unknown>, unknown> {
    const metadata = getModuleMetadata(this.moduleClass);
    const exported = new Map<Context.Tag<unknown, unknown>, unknown>();

    if (!metadata?.exports) {
      return exported;
    }

    for (const exportedProvider of metadata.exports) {
      if (typeof exportedProvider === 'function') {
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
    }

    return exported;
  }

  /**
   * Create controller instances and inject services
   */
  createControllerInstances(): Effect.Effect<unknown, never, void> {
    return Effect.sync(() => {
      // Build map of available services from this module's DI scope (own providers + imported exports + global)
      const availableServices = new Map<string, Function>();
      for (const [, instance] of this.serviceInstances) {
        if (instance && typeof instance === 'object') {
          availableServices.set(instance.constructor.name, instance.constructor);
        }
      }

      // Automatically analyze and register dependencies for all controllers of this module
      for (const controllerClass of this.controllers) {
        registerControllerDependencies(controllerClass, availableServices);
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
        for (const paramType of paramTypes) {
          const dependency = this.resolveDependencyByType(paramType);
          if (dependency) {
            dependencies.push(dependency);
          } else {
            this.logger.warn(
              `Could not resolve dependency ${paramType.name} for ${controllerClass.name}`,
            );
          }
        }
      }

      // Logger and config are now injected separately via initializeController
      // No need to add them to constructor dependencies

      // Create controller with resolved dependencies
      const controllerConstructor = controllerClass as new (...args: unknown[]) => Controller;
      const controller = new controllerConstructor(...dependencies);

      // Initialize controller with logger and config (skip for WebSocket gateways)
      if (!isWebSocketGateway(controllerClass) && typeof controller.initializeController === 'function') {
        controller.initializeController(this.logger, this.config);
      }

      this.controllerInstances.set(controllerClass, controller);

      // Inject all services into controller (for legacy compatibility)
      // Skip for WebSocket gateways which don't have setService
      if (!isWebSocketGateway(controllerClass) && typeof controller.setService === 'function') {
        for (const [tag, serviceInstance] of this.serviceInstances.entries()) {
          controller.setService(tag, serviceInstance);
        }
      }

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
   * Resolve dependency by type (constructor function)
   */
  private resolveDependencyByType(type: Function): unknown {
    // Find service instance that matches the type
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
   * Setup the module and its dependencies
   */
  setup(): Effect.Effect<unknown, never, void> {
    return this.callServicesOnModuleInit().pipe(
      // Also run onModuleInit for child modules' services
      Effect.flatMap(() =>
        Effect.forEach(this.childModules, (childModule) => childModule.callServicesOnModuleInit(), {
          discard: true,
        }),
      ),
      // Create controller instances in child modules first, then this module (each uses its own DI scope)
      Effect.flatMap(() =>
        Effect.forEach(this.childModules, (childModule) => childModule.createControllerInstances(), {
          discard: true,
        }),
      ),
      Effect.flatMap(() => this.createControllerInstances()),
      // Then call onModuleInit for controllers
      Effect.flatMap(() => this.callControllersOnModuleInit()),
      // Also run onModuleInit for child modules' controllers
      Effect.flatMap(() =>
        Effect.forEach(this.childModules, (childModule) => childModule.callControllersOnModuleInit(), {
          discard: true,
        }),
      ),
    );
  }

  /**
   * Call onModuleInit lifecycle hook for all services that implement it
   */
  callServicesOnModuleInit(): Effect.Effect<unknown, never, void> {
    if (this.pendingServiceInits.length === 0) {
      return Effect.void;
    }

    this.logger.debug(`Calling onModuleInit for ${this.pendingServiceInits.length} service(s)`);

    // Run all service onModuleInit hooks sequentially
    const initPromises = this.pendingServiceInits.map(async ({ name, instance }) => {
      try {
        if (hasOnModuleInit(instance)) {
          await instance.onModuleInit();
        }
        this.logger.debug(`Service ${name} onModuleInit completed`);
      } catch (error) {
        this.logger.error(`Service ${name} onModuleInit failed: ${error}`);
        throw error;
      }
    });

    return Effect.promise(() => Promise.all(initPromises)).pipe(
      Effect.map(() => {
        // Clear the list after initialization
        this.pendingServiceInits = [];
      }),
    );
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
   */
  async callOnApplicationInit(): Promise<void> {
    // Call for services
    for (const [, instance] of this.serviceInstances) {
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
      await childModule.callOnApplicationInit();
    }
  }

  /**
   * Call beforeApplicationDestroy lifecycle hook for all services and controllers
   */
  async callBeforeApplicationDestroy(signal?: string): Promise<void> {
    // Call for services
    for (const [, instance] of this.serviceInstances) {
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
      await childModule.callBeforeApplicationDestroy(signal);
    }
  }

  /**
   * Call onModuleDestroy lifecycle hook for controllers first, then services
   */
  async callOnModuleDestroy(): Promise<void> {
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
      await childModule.callOnModuleDestroy();
    }
  }

  /**
   * Call onApplicationDestroy lifecycle hook for all services and controllers
   */
  async callOnApplicationDestroy(signal?: string): Promise<void> {
    // Call for services
    for (const [, instance] of this.serviceInstances) {
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
      await childModule.callOnApplicationDestroy(signal);
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
   * Get controller instance (searches this module then child modules recursively).
   */
  getControllerInstance(controllerClass: Function): Controller | undefined {
    const instance = this.controllerInstances.get(controllerClass);
    if (instance) {
      return instance;
    }
    for (const childModule of this.childModules) {
      const childInstance = childModule.getControllerInstance(controllerClass);
      if (childInstance) {
        return childInstance;
      }
    }
    this.logger.warn(`No instance found for controller ${controllerClass.name}`);

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
   * Get service instance by class
   */
  getServiceByClass<T>(serviceClass: new (...args: unknown[]) => T): T | undefined {
    try {
      const tag = getServiceTag(serviceClass);

      return this.getServiceInstance(tag);
    } catch {
      // Service doesn't have @Service decorator or not found
      return undefined;
    }
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
   * Create a module from class
   * @param moduleClass - The module class
   * @param loggerLayer - Optional logger layer to use
   * @param config - Optional configuration to inject
   */
  static create(
    moduleClass: Function,
    loggerLayer?: Layer.Layer<never, never, unknown>,
    config?: IConfig<OneBunAppConfig>,
  ): ModuleInstance {
    // Using console.log here because we don't have access to the logger instance yet
    // The instance will create its own logger in the constructor
    return new OneBunModule(moduleClass, loggerLayer, config);
  }
}

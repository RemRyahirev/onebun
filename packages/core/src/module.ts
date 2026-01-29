import {
  type Context,
  Effect,
  Layer,
} from 'effect';

import type { Controller } from './controller';
import type { Module } from './types';

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
  registerControllerDependencies,
} from './decorators';
import { getServiceMetadata, getServiceTag } from './service';

/**
 * OneBun Module implementation
 */
export class OneBunModule implements Module {
  private rootLayer: Layer.Layer<never, never, unknown>;
  private controllers: Function[] = [];
  private controllerInstances: Map<Function, Controller> = new Map();
  private serviceInstances: Map<Context.Tag<unknown, unknown>, unknown> = new Map();
  private logger: SyncLogger;
  private config: unknown;

  constructor(
    private moduleClass: Function,
    private loggerLayer?: Layer.Layer<never, never, unknown>,
    config?: unknown,
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
    this.config = config;

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

    // PHASE 1: Import child modules FIRST and collect their exported services
    if (metadata.imports) {
      for (const importModule of metadata.imports) {
        // Pass the logger layer and config to child modules
        const childModule = new OneBunModule(importModule, this.loggerLayer, this.config);
        this.childModules.push(childModule);

        // Merge layers
        layer = Layer.merge(layer, childModule.getLayer());

        // Add controllers from child module
        controllers.push(...childModule.getControllers());

        // Get exported services from child module and register them for DI
        const exportedServices = childModule.getExportedServices();
        for (const [tag, instance] of exportedServices) {
          this.serviceInstances.set(tag, instance);
          this.logger.debug(
            `Imported service ${(instance as object).constructor?.name || 'unknown'} from ${importModule.name}`,
          );
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

      // Use autoDetectDependencies to find dependencies from constructor
      const detectedDeps = autoDetectDependencies(provider, availableServiceClasses);
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

      // Add logger and config at the end
      dependencies.push(this.logger, this.config);

      // Create service instance with resolved dependencies
      try {
        const serviceConstructor = provider as new (...args: unknown[]) => unknown;
        const serviceInstance = new serviceConstructor(...dependencies);
        this.serviceInstances.set(serviceMetadata.tag, serviceInstance);
        createdServices.add(provider.name);
        this.logger.debug(
          `Created service ${provider.name} with ${dependencies.length - 2} injected dependencies`,
        );
      } catch (error) {
        this.logger.error(`Failed to create service ${provider.name}: ${error}`);
      }
    }

    if (iterations >= maxIterations) {
      this.logger.error('Possible circular dependency detected in services');
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
    const self = this;

    return Effect.gen(function* (_) {
      // Services are already created in initModule via createServicesWithDI
      // Just need to set up controllers with DI

      // Get module metadata to access providers for controller dependency registration
      const moduleMetadata = getModuleMetadata(self.moduleClass);
      if (moduleMetadata && moduleMetadata.providers) {
        // Create map of available services for dependency resolution
        const availableServices = new Map<string, Function>();

        // For each provider that is a class constructor, add to available services map
        for (const provider of moduleMetadata.providers) {
          if (typeof provider === 'function') {
            availableServices.set(provider.name, provider);
          }
        }

        // Also add services from imported modules
        for (const childModule of self.childModules) {
          const childMetadata = getModuleMetadata(childModule.moduleClass);
          if (childMetadata?.exports) {
            for (const exported of childMetadata.exports) {
              if (typeof exported === 'function') {
                availableServices.set(exported.name, exported);
              }
            }
          }
        }

        // Automatically analyze and register dependencies for all controllers
        for (const controllerClass of self.controllers) {
          registerControllerDependencies(controllerClass, availableServices);
        }
      }

      // Now create controller instances with automatic dependency injection
      self.createControllersWithDI();
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

      // Initialize controller with logger and config
      controller.initializeController(this.logger, this.config);

      this.controllerInstances.set(controllerClass, controller);

      // Inject all services into controller (for legacy compatibility)
      for (const [tag, serviceInstance] of this.serviceInstances.entries()) {
        controller.setService(tag, serviceInstance);
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
   * Setup the module and its dependencies
   */
  setup(): Effect.Effect<unknown, never, void> {
    return this.createControllerInstances();
  }

  /**
   * Get all controllers from this module
   */
  getControllers(): Function[] {
    return this.controllers;
  }

  /**
   * Get controller instance
   */
  getControllerInstance(controllerClass: Function): Controller | undefined {
    const instance = this.controllerInstances.get(controllerClass);

    if (!instance) {
      this.logger.warn(`No instance found for controller ${controllerClass.name}`);
    }

    return instance;
  }

  /**
   * Get all controller instances
   */
  getControllerInstances(): Map<Function, Controller> {
    return this.controllerInstances;
  }

  /**
   * Get service instance
   */
  getServiceInstance<T>(tag: Context.Tag<T, T>): T | undefined {
    return this.serviceInstances.get(tag as Context.Tag<unknown, unknown>) as T | undefined;
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
    config?: unknown,
  ): Module {
    // Using console.log here because we don't have access to the logger instance yet
    // The instance will create its own logger in the constructor
    return new OneBunModule(moduleClass, loggerLayer, config);
  }
}

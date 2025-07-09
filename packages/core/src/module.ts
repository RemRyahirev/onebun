import {
  Context,
  Effect,
  Layer,
} from 'effect';
import {
  Logger,
  SyncLogger,
  LoggerService,
  makeLogger,
  createSyncLogger,
} from '@onebun/logger';

import { Controller } from './controller';
import {
  getModuleMetadata,
  getControllerMetadata,
  getConstructorParamTypes,
  registerControllerDependencies,
} from './decorators';
import { getServiceMetadata, createServiceLayer } from './service';
import { Module, ModuleProviders } from './types';

/**
 * OneBun Module implementation
 */
export class OneBunModule implements Module {
  private rootLayer: Layer.Layer<never, never, unknown>;
  private controllers: Function[] = [];
  private controllerInstances: Map<Function, Controller> = new Map();
  private serviceInstances: Map<Context.Tag<any, any>, any> = new Map();
  private logger: SyncLogger;
  private config: any;

  constructor(private moduleClass: Function, private loggerLayer?: Layer.Layer<never, never, unknown>, config?: any) {
    // Initialize logger with module class name as context
    const effectLogger = Effect.runSync(
      Effect.provide(
        Effect.map(
          LoggerService,
          (logger: Logger) => logger.child({ className: `OneBunModule:${moduleClass.name}` }),
        ),
        this.loggerLayer || makeLogger(),
      ) as any,
    ) as Logger;
    this.logger = createSyncLogger(effectLogger);
    this.config = config;

    this.logger.debug(`Initializing OneBunModule for ${moduleClass.name}`);
    const { layer, controllers } = this.initModule();
    this.rootLayer = layer;
    this.controllers = controllers;

    this.logger.debug(`OneBunModule initialized for ${moduleClass.name}, controllers: ${controllers.length}`);
  }

  /**
   * Initialize module from metadata and create layer
   */
  private initModule(): { layer: Layer.Layer<never, never, unknown>; controllers: Function[] } {
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
    const serviceLayers: Layer.Layer<never, never, unknown>[] = [];

    // Add controllers
    if (metadata.controllers) {
      for (const controller of metadata.controllers) {
        controllers.push(controller);
      }
    }

    // Initialize provider layers
    if (metadata.providers) {
      // For each provider, create a layer
      for (const provider of metadata.providers) {
        // Check if provider has @Service decorator
        if (typeof provider === 'function') {
          this.logger.debug(`Checking if provider ${provider.name} has @Service decorator`);
          const serviceMetadata = getServiceMetadata(provider);
          if (serviceMetadata) {
            // This is a service with @Service decorator
            this.logger.debug(`Provider ${provider.name} has @Service decorator, creating service layer`);
            const serviceLayer = createServiceLayer(provider as new (...args: any[]) => unknown, this.logger, this.config);
            serviceLayers.push(serviceLayer);
            layer = Layer.merge(layer, serviceLayer);
            this.logger.debug(`Added service layer for ${provider.name}`);
            continue;
          } else {
            this.logger.warn(`Provider ${provider.name} does not have @Service decorator`);
          }
        }

        // Legacy provider handling
        if (typeof provider === 'object' && provider !== null && 'prototype' in provider && 'tag' in provider) {
          // This is a Context Tag, we need to get implementation
          // Find matching implementation in providers array
          const tagProvider = provider as { isTag?: boolean; Service?: Function };
          const impl = metadata.providers.find((p: unknown) =>
            tagProvider.isTag && typeof p === 'function' && typeof tagProvider.Service === 'function' &&
            'prototype' in p && p.prototype instanceof tagProvider.Service,
          );

          if (impl && typeof impl === 'function') {
            // Create layer for this service
            const implConstructor = impl as new () => any;
            const serviceLayer = Layer.succeed(provider as any, new implConstructor());
            serviceLayers.push(serviceLayer);
            layer = Layer.merge(layer, serviceLayer);
          }
        } else if (typeof provider === 'function') {
          // This is a class, try to create instance and find if it implements a Tag
          try {
            const providerConstructor = provider as new () => any;
            const instance = new providerConstructor();
            // Find matching tag in providers
            const tag = metadata.providers.find((p: unknown) =>
              typeof p === 'object' && p !== null && 'isTag' in p && 'Service' in p && instance instanceof (p as { Service: Function }).Service,
            );

            if (tag) {
              const serviceLayer = Layer.succeed(tag as any, instance);
              serviceLayers.push(serviceLayer);
              layer = Layer.merge(layer, serviceLayer);
            }
          } catch (error) {
            this.logger.warn(`Failed to auto-create instance of ${provider.name}`);
          }
        }
      }
    }

    // Import child modules and merge their layers
    if (metadata.imports) {
      for (const importModule of metadata.imports) {
        // Pass the logger layer and config to child modules
        const childModule = new OneBunModule(importModule, this.loggerLayer, this.config);
        // Merge layers
        layer = Layer.merge(layer, childModule.getLayer());
        // Add controllers
        controllers.push(...childModule.getControllers());
      }
    }

    return { layer, controllers };
  }

  /**
   * Create controller instances and inject services
   */
  createControllerInstances(): Effect.Effect<unknown, never, void> {
    const self = this;

    return Effect.gen(function* (_) {
      // Get all services from the layer
      const services = yield* _(Effect.context());

      // First, process all services from context and register them
      for (const [key, value] of Object.entries(services)) {
        if (key && value && typeof key === 'object' && 'Identifier' in key) {
          const tag = key as Context.Tag<unknown, unknown>;
          self.serviceInstances.set(tag, value);
        }
      }

      // Get module metadata to access providers and register any missing services
      const moduleMetadata = getModuleMetadata(self.moduleClass);
      if (moduleMetadata && moduleMetadata.providers) {
        // Import getServiceTag function to avoid circular dependency
        const { getServiceTag } = require('./service');

        // Create map of available services for dependency resolution
        const availableServices = new Map<string, Function>();

        // For each provider that is a class constructor, register it with its tag
        for (const provider of moduleMetadata.providers) {
          if (typeof provider === 'function') {
            // Add to available services map
            availableServices.set(provider.name, provider);

            try {
              // Get the service tag for this provider
              const tag = getServiceTag(provider);

              // Find the service instance in the services context
              let found = false;
              for (const [key, value] of Object.entries(services)) {
                if (key && value && typeof key === 'object' && 'Identifier' in key) {
                  if (key === tag || (key as any).Identifier === (tag as any).Identifier) {
                    // Register the service with its tag
                    self.serviceInstances.set(tag, value);
                    found = true;
                    break;
                  }
                }
              }

              if (!found) {
                // Create an instance of the service and register it
                const ServiceConstructor = provider as new (logger?: SyncLogger, config?: any) => any;
                const serviceInstance = new ServiceConstructor(self.logger, self.config);
                self.serviceInstances.set(tag, serviceInstance);
              }
            } catch (error) {
              // If getServiceTag fails, the provider might not have @Service decorator
              self.logger.warn(`Failed to get service tag for provider ${provider.name}: ${error}`);
            }
          }
        }

        // Automatically analyze and register dependencies for all controllers
        for (const ControllerClass of self.controllers) {
          registerControllerDependencies(ControllerClass, availableServices);
        }
      }

      // Now create controller instances with automatic dependency injection
      self.createControllersWithDI();
    }).pipe(
      Effect.provide(this.rootLayer),
    );
  }

  /**
   * Create controllers with automatic dependency injection
   */
  private createControllersWithDI(): void {
    for (const ControllerClass of this.controllers) {
      // Get constructor parameter types automatically from DI system
      const paramTypes = getConstructorParamTypes(ControllerClass);
      const dependencies: any[] = [];
      
      if (paramTypes && paramTypes.length > 0) {
        // Resolve dependencies based on registered parameter types
        for (const paramType of paramTypes) {
          const dependency = this.resolveDependencyByType(paramType);
          if (dependency) {
            dependencies.push(dependency);
          } else {
            this.logger.warn(`Could not resolve dependency ${paramType.name} for ${ControllerClass.name}`);
          }
        }
      }
      
      // Add logger and config at the end (always needed)
      dependencies.push(this.logger);
      dependencies.push(this.config);
      
      // Create controller with resolved dependencies
      const ControllerConstructor = ControllerClass as any;
      const controller = new ControllerConstructor(...dependencies);
      
      this.controllerInstances.set(ControllerClass, controller);

      // Inject all services into controller (for legacy compatibility)
      for (const [tag, serviceInstance] of this.serviceInstances.entries()) {
        controller.setService(tag, serviceInstance);
      }
      
      if (paramTypes && paramTypes.length > 0) {
        this.logger.debug(`Controller ${ControllerClass.name} created with ${paramTypes.length} injected dependencies`);
      }
    }
  }

  /**
   * Resolve dependency by name (string) - DEPRECATED
   */
  private resolveDependencyByName(typeName: string): any {
    // This method is deprecated with the new automatic system
    return null;
  }

  /**
   * Resolve dependency by type (constructor function)
   */
  private resolveDependencyByType(type: Function): any {
    // Find service instance that matches the type
    const serviceInstance = Array.from(this.serviceInstances.values()).find(instance => {
      if (!instance) {
        return false;
      }
      
      // Check if instance is of the exact type or inherits from it
      return (instance.constructor === type || instance instanceof type);
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
    return this.serviceInstances.get(tag) as T | undefined;
  }

  /**
   * Get the Layer for this module
   */
  getLayer(): Layer.Layer<never, never, unknown> {
    return this.rootLayer;
  }

  /**
   * Create a module from class
   * @param moduleClass The module class
   * @param loggerLayer Optional logger layer to use
   * @param config Optional configuration to inject
   */
  static create(moduleClass: Function, loggerLayer?: Layer.Layer<never, never, unknown>, config?: any): Module {
    // Using console.log here because we don't have access to the logger instance yet
    // The instance will create its own logger in the constructor
    return new OneBunModule(moduleClass, loggerLayer, config);
  }
}

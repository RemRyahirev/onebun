import { Context, Effect, Layer } from 'effect';
import { getModuleMetadata, getControllerMetadata } from './decorators';
import { Module, ModuleProviders } from './types';
import { getServiceMetadata, createServiceLayer } from './service';
import { Controller } from './controller';
import { makeLogger } from '@onebun/logger';

/**
 * OneBun Module implementation
 */
export class OneBunModule implements Module {
  private rootLayer: Layer.Layer<never, never, unknown>;
  private controllers: Function[] = [];
  private controllerInstances: Map<Function, Controller> = new Map();
  private serviceInstances: Map<Context.Tag<any, any>, any> = new Map();

  constructor(private moduleClass: Function) {
    console.log(`Initializing OneBunModule for ${moduleClass.name}`);
    const { layer, controllers } = this.initModule();
    this.rootLayer = layer;
    this.controllers = controllers;
    console.log(`OneBunModule initialized for ${moduleClass.name}, controllers: ${controllers.length}`);
    for (const controller of controllers) {
      console.log(`Module ${moduleClass.name} includes controller: ${controller.name}`);
    }
  }

  /**
   * Initialize module from metadata and create layer
   */
  private initModule(): { layer: Layer.Layer<never, never, unknown>, controllers: Function[] } {
    console.log(`Initializing module metadata for ${this.moduleClass.name}`);
    const metadata = getModuleMetadata(this.moduleClass);
    if (!metadata) {
      console.error(`Module ${this.moduleClass.name} does not have @Module decorator`);
      throw new Error(`Module ${this.moduleClass.name} does not have @Module decorator`);
    }
    console.log(`Found module metadata for ${this.moduleClass.name}`);

    // Start with logger layer based on NODE_ENV
    let layer: Layer.Layer<never, never, unknown> = makeLogger();
    const controllers: Function[] = [];
    const serviceLayers: Layer.Layer<never, never, unknown>[] = [];

    // Add controllers
    if (metadata.controllers) {
      console.log(`Adding ${metadata.controllers.length} controllers from module ${this.moduleClass.name}`);
      for (const controller of metadata.controllers) {
        console.log(`Adding controller ${controller.name} from module ${this.moduleClass.name}`);

        // Log controller details for debugging
        console.log(`Controller constructor: ${controller.constructor?.name || 'undefined'}`);
        console.log(`Controller prototype: ${Object.getPrototypeOf(controller)?.name || 'undefined'}`);

        // Check if controller has metadata
        const controllerMetadata = getControllerMetadata(controller);
        if (controllerMetadata) {
          console.log(`Found metadata for controller ${controller.name} in module, routes: ${controllerMetadata.routes.length}`);
        } else {
          console.warn(`No metadata found for controller ${controller.name} in module`);
        }

        controllers.push(controller);
      }
    } else {
      console.log(`No controllers found in module ${this.moduleClass.name}`);
    }

    // Initialize provider layers
    if (metadata.providers) {
      // For each provider, create a layer
      for (const provider of metadata.providers) {
        // Check if provider has @Service decorator
        if (typeof provider === 'function') {
          console.log(`Checking if provider ${provider.name} has @Service decorator`);
          const serviceMetadata = getServiceMetadata(provider);
          if (serviceMetadata) {
            // This is a service with @Service decorator
            console.log(`Provider ${provider.name} has @Service decorator, creating service layer`);
            const serviceLayer = createServiceLayer(provider as new () => unknown);
            serviceLayers.push(serviceLayer);
            layer = Layer.merge(layer, serviceLayer);
            console.log(`Added service layer for ${provider.name}`);
            continue;
          } else {
            console.warn(`Provider ${provider.name} does not have @Service decorator`);
          }
        }

        // Legacy provider handling
        if (typeof provider === 'object' && provider !== null && 'prototype' in provider && 'tag' in provider) {
          // This is a Context Tag, we need to get implementation
          // Find matching implementation in providers array
          const tagProvider = provider as { isTag?: boolean, Service?: Function };
          const impl = metadata.providers.find((p: unknown) =>
            tagProvider.isTag && typeof p === 'function' && typeof tagProvider.Service === 'function' &&
            'prototype' in p && p.prototype instanceof tagProvider.Service
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
              typeof p === 'object' && p !== null && 'isTag' in p && 'Service' in p && instance instanceof (p as { Service: Function }).Service
            );

            if (tag) {
              const serviceLayer = Layer.succeed(tag as any, instance);
              serviceLayers.push(serviceLayer);
              layer = Layer.merge(layer, serviceLayer);
            }
          } catch (error) {
            console.warn(`Failed to auto-create instance of ${provider.name}`);
          }
        }
      }
    }

    // Import child modules and merge their layers
    if (metadata.imports) {
      for (const importModule of metadata.imports) {
        const childModule = new OneBunModule(importModule);
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
      console.log(`Got services context with ${Object.keys(services).length} entries`);

      // Log all services for debugging
      for (const [key, value] of Object.entries(services)) {
        if (key && typeof key === 'object' && 'Identifier' in key) {
          console.log(`Service in context: ${(key as any).Identifier}`);
        }
      }

      // Create controller instances
      for (const ControllerClass of self.controllers) {
        console.log(`Creating instance of controller ${ControllerClass.name}`);

        // Log controller details for debugging
        console.log(`Controller constructor: ${ControllerClass.constructor?.name || 'undefined'}`);
        console.log(`Controller prototype: ${Object.getPrototypeOf(ControllerClass)?.name || 'undefined'}`);

        // Check if controller has metadata before instantiation
        const controllerMetadata = getControllerMetadata(ControllerClass);
        if (controllerMetadata) {
          console.log(`Found metadata for controller ${ControllerClass.name} before instantiation, routes: ${controllerMetadata.routes.length}`);
        } else {
          console.warn(`No metadata found for controller ${ControllerClass.name} before instantiation`);
        }

        const ControllerConstructor = ControllerClass as new () => Controller;
        const controller = new ControllerConstructor();
        self.controllerInstances.set(ControllerClass, controller);

        // Check if controller has metadata after instantiation
        const controllerMetadataAfter = getControllerMetadata(ControllerClass);
        if (controllerMetadataAfter) {
          console.log(`Found metadata for controller ${ControllerClass.name} after instantiation, routes: ${controllerMetadataAfter.routes.length}`);
        } else {
          console.warn(`No metadata found for controller ${ControllerClass.name} after instantiation`);
        }

        // Inject services into controller
        // Use Object.entries to iterate over the services context
        for (const [key, value] of Object.entries(services)) {
          if (key && value && typeof key === 'object' && 'Identifier' in key) {
            const tag = key as Context.Tag<unknown, unknown>;
            controller.setService(tag, value);
            self.serviceInstances.set(tag, value);
          }
        }

        // Get module metadata to access providers
        const moduleMetadata = getModuleMetadata(self.moduleClass);
        if (moduleMetadata && moduleMetadata.providers) {
          // Import getServiceTag function to avoid circular dependency
          const { getServiceTag } = require('./service');

          // For each provider that is a class constructor, register it with its tag
          for (const provider of moduleMetadata.providers) {
            if (typeof provider === 'function') {
              try {
                // Get the service tag for this provider
                const tag = getServiceTag(provider);
                console.log(`Got service tag for provider ${provider.name}: ${tag.Identifier}`);

                // Find the service instance in the services context
                let found = false;
                for (const [key, value] of Object.entries(services)) {
                  if (key && value && typeof key === 'object' && 'Identifier' in key) {
                    console.log(`Checking service in context: ${(key as any).Identifier} against tag: ${tag.Identifier}`);
                    if (key === tag || (key as any).Identifier === (tag as any).Identifier) {
                      // Register the service with its tag in the controller
                      controller.setService(tag, value);
                      self.serviceInstances.set(tag, value);
                      console.log(`Registered service ${provider.name} in controller ${ControllerClass.name}`);
                      found = true;
                      break;
                    }
                  }
                }

                if (!found) {
                  console.warn(`Service ${provider.name} not found in context with tag ${tag.Identifier}`);

                  // Create an instance of the service and register it
                  console.log(`Creating instance of service ${provider.name}`);
                  const serviceInstance = new (provider as new () => any)();
                  controller.setService(tag, serviceInstance);
                  self.serviceInstances.set(tag, serviceInstance);
                  console.log(`Registered manually created service ${provider.name} in controller ${ControllerClass.name}`);
                }
              } catch (error) {
                // If getServiceTag fails, the provider might not have @Service decorator
                console.warn(`Failed to get service tag for provider ${provider.name}: ${error}`);
              }
            }
          }
        }
      }
    }).pipe(
      Effect.provide(this.rootLayer)
    );
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
    console.log(`Getting controller instance for ${controllerClass.name}`);

    // Log controller details for debugging
    console.log(`Controller constructor: ${controllerClass.constructor?.name || 'undefined'}`);
    console.log(`Controller prototype: ${Object.getPrototypeOf(controllerClass)?.name || 'undefined'}`);

    // Check if controller has metadata
    const controllerMetadata = getControllerMetadata(controllerClass);
    if (controllerMetadata) {
      console.log(`Found metadata for controller ${controllerClass.name} in getControllerInstance, routes: ${controllerMetadata.routes.length}`);
    } else {
      console.warn(`No metadata found for controller ${controllerClass.name} in getControllerInstance`);
    }

    // Log all keys in controllerInstances for debugging
    console.log(`controllerInstances keys: ${Array.from(this.controllerInstances.keys()).map(k => k.name).join(', ')}`);

    const instance = this.controllerInstances.get(controllerClass);
    if (instance) {
      console.log(`Found instance for controller ${controllerClass.name}`);
    } else {
      console.warn(`No instance found for controller ${controllerClass.name}`);
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
   */
  static create(moduleClass: Function): Module {
    console.log(`Creating OneBunModule for ${moduleClass.name}`);
    return new OneBunModule(moduleClass);
  }
}

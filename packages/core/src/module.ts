import { Context, Effect, Layer } from 'effect';
import { getModuleMetadata, getControllerMetadata } from './decorators';
import { Module, ModuleProviders } from './types';

/**
 * OneBun Module implementation
 */
export class OneBunModule implements Module {
  private rootLayer: Layer.Layer<any>;
  private controllers: any[] = [];
  
  constructor(private moduleClass: any) {
    const { layer, controllers } = this.initModule();
    this.rootLayer = layer;
    this.controllers = controllers;
  }

  /**
   * Initialize module from metadata and create layer
   */
  private initModule(): { layer: Layer.Layer<any>, controllers: any[] } {
    const metadata = getModuleMetadata(this.moduleClass);
    if (!metadata) {
      throw new Error(`Module ${this.moduleClass.name} does not have @Module decorator`);
    }

    let layer = Layer.empty;
    const controllers: any[] = [];
    
    // Add controllers
    if (metadata.controllers) {
      controllers.push(...metadata.controllers);
    }
    
    // Initialize provider layers
    if (metadata.providers) {
      // For each provider, create a layer
      for (const provider of metadata.providers) {
        // Check if provider is a Tag
        if (provider.prototype && 'tag' in provider) {
          // This is a Context Tag, we need to get implementation
          // Find matching implementation in providers array
          const impl = metadata.providers.find((p: any) => 
            provider.isTag && p.prototype instanceof provider.Service
          );

          if (impl) {
            // Create layer for this service
            const serviceLayer = Layer.succeed(provider, new impl());
            layer = Layer.merge(layer, serviceLayer);
          }
        } else if (typeof provider === 'function') {
          // This is a class, try to create instance and find if it implements a Tag
          try {
            const instance = new provider();
            // Find matching tag in providers
            const tag = metadata.providers.find((p: any) => 
              p.isTag && instance instanceof p.Service
            );
            
            if (tag) {
              const serviceLayer = Layer.succeed(tag, instance);
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
   * Setup the module and its dependencies
   */
  setup(): Effect.Effect<void> {
    return Effect.succeed(undefined);
  }

  /**
   * Get all controllers from this module
   */
  getControllers(): any[] {
    return this.controllers;
  }

  /**
   * Get the Layer for this module
   */
  getLayer(): Layer.Layer<any> {
    return this.rootLayer;
  }

  /**
   * Create a module from class
   */
  static create(moduleClass: any): Module {
    return new OneBunModule(moduleClass);
  }
} 
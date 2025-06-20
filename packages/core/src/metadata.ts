/**
 * Custom implementation of metadata functionality to replace reflect-metadata
 */

// Store metadata in WeakMaps to allow garbage collection
const metadataStorage = new WeakMap<object, Map<string, Map<string | symbol, any>>>();

/**
 * Define metadata on a target object
 * @param metadataKey The key for the metadata
 * @param metadataValue The value for the metadata
 * @param target The target object
 * @param propertyKey Optional property key
 */
export function defineMetadata(
  metadataKey: string,
  metadataValue: any,
  target: object,
  propertyKey?: string | symbol
): void {
  // Get or create metadata map for target
  let targetMetadata = metadataStorage.get(target);
  if (!targetMetadata) {
    targetMetadata = new Map<string, Map<string | symbol, any>>();
    metadataStorage.set(target, targetMetadata);
  }

  // Get or create metadata map for key
  let keyMetadata = targetMetadata.get(metadataKey);
  if (!keyMetadata) {
    keyMetadata = new Map<string | symbol, any>();
    targetMetadata.set(metadataKey, keyMetadata);
  }

  // Set metadata value
  keyMetadata.set(propertyKey || '', metadataValue);
}

/**
 * Get metadata from a target object
 * @param metadataKey The key for the metadata
 * @param target The target object
 * @param propertyKey Optional property key
 * @returns The metadata value or undefined if not found
 */
export function getMetadata(
  metadataKey: string,
  target: object,
  propertyKey?: string | symbol
): any {
  // Get metadata map for target
  const targetMetadata = metadataStorage.get(target);
  if (!targetMetadata) {
    return undefined;
  }

  // Get metadata map for key
  const keyMetadata = targetMetadata.get(metadataKey);
  if (!keyMetadata) {
    return undefined;
  }

  // Get metadata value
  return keyMetadata.get(propertyKey || '');
}

/**
 * Get constructor parameter types using TypeScript's emitDecoratorMetadata
 * This works with our custom metadata system and doesn't require reflect-metadata
 * 
 * @deprecated Use getConstructorParamTypes instead
 */
function getLegacyConstructorParamTypes(target: Function): Function[] | undefined {
  // Try to get design:paramtypes metadata that TypeScript emits
  // This should work because we have emitDecoratorMetadata: true in tsconfig
  const types = getMetadata('design:paramtypes', target);
  
  if (!types || !Array.isArray(types)) {
    return undefined;
  }
  
  console.log(`Raw design:paramtypes for ${target.name}:`, types.map(t => t?.name || 'undefined'));
  
  // Filter out basic types and focus on service types
  const serviceTypes = types.filter((type: any, index: number) => {
    // Skip undefined, Object, and basic types
    if (!type || type === Object || type === String || type === Number || type === Boolean) {
      console.log(`Skipping basic type at index ${index}:`, type?.name || 'undefined');
      return false;
    }
    
    // Skip logger and config types (they have specific patterns)
    const typeName = type.name;
    if (typeName && (typeName.toLowerCase().includes('logger') || typeName.toLowerCase().includes('config'))) {
      console.log(`Skipping system type at index ${index}:`, typeName);
      return false;
    }
    
    console.log(`Keeping service type at index ${index}:`, typeName);
    return true;
  });
  
  return serviceTypes.length > 0 ? serviceTypes : undefined;
}

/**
 * Set constructor parameter types (used by TypeScript when emitDecoratorMetadata is enabled)
 */
export function setConstructorParamTypes(target: Function, types: Function[]): void {
  defineMetadata('design:paramtypes', types, target);
}

/**
 * Hook into TypeScript's decorator metadata emission
 * This function gets called by TypeScript when emitDecoratorMetadata is enabled
 */
if (typeof (globalThis as any).__decorate === 'undefined') {
  (globalThis as any).__decorate = function(decorators: any[], target: any, propertyKey?: any, descriptor?: any) {
    console.log('__decorate', decorators, target, propertyKey, descriptor);
    // This is where TypeScript would normally call Reflect.decorate
    // We can intercept and store metadata here
    if (arguments.length === 2 && typeof target === 'function') {
      // This is a class decorator, capture constructor parameter types
      const paramTypes = (globalThis as any).__param || [];
      if (paramTypes.length > 0) {
        defineMetadata('design:paramtypes', paramTypes, target);
      }
    }
    
    // Apply decorators normally
    let result = target;
    for (let i = decorators.length - 1; i >= 0; i--) {
      const decorator = decorators[i];
      if (decorator) {
        if (typeof decorator === 'function') {
          if (arguments.length === 2) {
            result = decorator(result) || result;
          } else {
            result = decorator(target, propertyKey, descriptor) || descriptor;
          }
        }
      }
    }
    return result;
  };
}

/**
 * Minimal Reflect polyfill for design:paramtypes support in Bun
 * Only adds what's needed for TypeScript's emitDecoratorMetadata
 */
if (!(globalThis as any).Reflect || !(globalThis as any).Reflect.metadata) {
  // Simple storage for metadata
  const globalMetadataStorage = new WeakMap<any, Map<string, any>>();
  
  const reflectPolyfill = {
    metadata: (key: string, value: any) => {
      return function(target: any) {
        if (!globalMetadataStorage.has(target)) {
          globalMetadataStorage.set(target, new Map());
        }
        globalMetadataStorage.get(target)!.set(key, value);
      };
    },
    
    getMetadata: (key: string, target: any) => {
      const metadata = globalMetadataStorage.get(target);
      return metadata ? metadata.get(key) : undefined;
    },
    
    defineMetadata: (key: string, value: any, target: any) => {
      if (!globalMetadataStorage.has(target)) {
        globalMetadataStorage.set(target, new Map());
      }
      globalMetadataStorage.get(target)!.set(key, value);
    }
  };
  
  if (!(globalThis as any).Reflect) {
    (globalThis as any).Reflect = reflectPolyfill;
  } else {
    Object.assign((globalThis as any).Reflect, reflectPolyfill);
  }
}

/**
 * Enhanced getConstructorParamTypes with Reflect polyfill support
 */
export function getConstructorParamTypes(target: Function): Function[] | undefined {
  // First try the global Reflect (now with our polyfill)
  let types: Function[] | undefined;
  
  try {
    types = (globalThis as any).Reflect?.getMetadata?.('design:paramtypes', target);
    if (types && Array.isArray(types) && types.length > 0) {
      // Filter out basic types and focus on service types
      const serviceTypes = types.filter((type: any) => {
        if (!type || type === Object || type === String || type === Number || type === Boolean) {
          return false;
        }
        const typeName = type.name;
        if (typeName && (typeName.toLowerCase().includes('logger') || typeName.toLowerCase().includes('config'))) {
          return false;
        }
        return true;
      });
      
      return serviceTypes.length > 0 ? serviceTypes : undefined;
    }
  } catch (e) {
    // Silent fallback to custom metadata
  }
  
  // Fallback to our custom metadata
  types = getMetadata('design:paramtypes', target);
  if (types && Array.isArray(types)) {
    const serviceTypes = types.filter((type: any) => {
      if (!type || type === Object || type === String || type === Number || type === Boolean) {
        return false;
      }
      const typeName = type.name;
      if (typeName && (typeName.toLowerCase().includes('logger') || typeName.toLowerCase().includes('config'))) {
        return false;
      }
      return true;
    });
    
    return serviceTypes.length > 0 ? serviceTypes : undefined;
  }
  
  return undefined;
}

/**
 * Namespace for metadata functions to mimic Reflect API
 */
export const Reflect = {
  defineMetadata,
  getMetadata,
  getConstructorParamTypes,
  setConstructorParamTypes
};

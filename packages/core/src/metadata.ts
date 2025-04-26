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
 * Namespace for metadata functions to mimic Reflect API
 */
export const Reflect = {
  defineMetadata,
  getMetadata
};

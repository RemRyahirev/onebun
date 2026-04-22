/* eslint-disable
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/explicit-module-boundary-types */
// Metadata system must work with any types as it stores arbitrary metadata values
// This is similar to reflect-metadata which also uses `any` for metadata values
// Return types are intentionally flexible to match reflect-metadata API

/**
 * Custom implementation of metadata functionality to replace reflect-metadata
 */

// Store metadata in WeakMaps to allow garbage collection
const metadataStorage = new WeakMap<object, Map<string, Map<string | symbol, any>>>();

/**
 * Define metadata on a target object
 * @param metadataKey - The key for the metadata
 * @param metadataValue - The value for the metadata
 * @param target - The target object
 * @param propertyKey - Optional property key
 */
export function defineMetadata(
  metadataKey: string,
  metadataValue: any,
  target: object,
  propertyKey?: string | symbol,
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
 * Copy all metadata from one target to another.
 * Used by @Controller to preserve method-decorator metadata (e.g. queue decorators)
 * when wrapping the original class.
 */
export function copyAllMetadata(source: object, destination: object): void {
  const sourceMetadata = metadataStorage.get(source);
  if (!sourceMetadata) {
    return;
  }

  let destMetadata = metadataStorage.get(destination);
  if (!destMetadata) {
    destMetadata = new Map<string, Map<string | symbol, any>>();
    metadataStorage.set(destination, destMetadata);
  }

  for (const [metadataKey, keyMap] of sourceMetadata) {
    // Only copy if destination doesn't already have this key
    if (!destMetadata.has(metadataKey)) {
      destMetadata.set(metadataKey, new Map(keyMap));
    }
  }
}

/**
 * Get metadata from a target object
 * @param metadataKey - The key for the metadata
 * @param target - The target object
 * @param propertyKey - Optional property key
 * @returns The metadata value or undefined if not found
 */
export function getMetadata(
  metadataKey: string,
  target: object,
  propertyKey?: string | symbol,
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _getLegacyConstructorParamTypes(target: Function): Function[] | undefined {
  // Try to get design:paramtypes metadata that TypeScript emits
  // This should work because we have emitDecoratorMetadata: true in tsconfig
  const types = getMetadata('design:paramtypes', target);

  if (!types || !Array.isArray(types)) {
    return undefined;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Raw design:paramtypes for ${target.name}:`,
    types.map((t) => t?.name || 'undefined'),
  );

  // Filter out basic types and focus on service types
  const serviceTypes = types.filter((type: any, _index: number) => {
    // Skip undefined, Object, and basic types
    if (!type || type === Object || type === String || type === Number || type === Boolean) {
      // Debug: Skipping basic type
      // console.log(`Skipping basic type at index ${index}:`, type?.name || 'undefined');

      return false;
    }

    // Skip logger and config types (they have specific patterns)
    const typeName = type.name;
    if (
      typeName &&
      (typeName.toLowerCase().includes('logger') || typeName.toLowerCase().includes('config'))
    ) {
      // Debug: Skipping system type
      // console.log(`Skipping system type at index ${index}:`, typeName);

      return false;
    }

    // Debug: Keeping service type
    // console.log(`Keeping service type at index ${index}:`, typeName);

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
 * Minimal Reflect polyfill for design:paramtypes support in Bun
 * Only adds what's needed for TypeScript's emitDecoratorMetadata
 */
if (!(globalThis as any).Reflect || !(globalThis as any).Reflect.metadata) {
  // Simple storage for metadata
  const globalMetadataStorage = new WeakMap<any, Map<string, any>>();

  const reflectPolyfill = {
    metadata(key: string, value: any) {
      return (target: any) => {
        if (!globalMetadataStorage.has(target)) {
          globalMetadataStorage.set(target, new Map());
        }
        globalMetadataStorage.get(target)!.set(key, value);
      };
    },

    getMetadata(key: string, target: any) {
      const metadata = globalMetadataStorage.get(target);

      return metadata ? metadata.get(key) : undefined;
    },

    defineMetadata(key: string, value: any, target: any) {
      if (!globalMetadataStorage.has(target)) {
        globalMetadataStorage.set(target, new Map());
      }
      globalMetadataStorage.get(target)!.set(key, value);
    },
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
      // Filter out basic types and framework-specific types
      // Only filter exact framework type names, not user services containing these words
      const frameworkTypes = new Set(['SyncLogger', 'Logger', 'Object', 'String', 'Number', 'Boolean']);
      const serviceTypes = types.filter((type: any) => {
        if (!type || type === Object || type === String || type === Number || type === Boolean) {
          return false;
        }
        const typeName = type.name;
        if (typeName && frameworkTypes.has(typeName)) {
          return false;
        }

        return true;
      });

      return serviceTypes.length > 0 ? serviceTypes : undefined;
    }
  } catch {
    // Silent fallback to custom metadata
  }

  // Fallback to our custom metadata
  types = getMetadata('design:paramtypes', target);
  if (types && Array.isArray(types)) {
    const frameworkTypes = new Set(['SyncLogger', 'Logger', 'Object', 'String', 'Number', 'Boolean']);
    const serviceTypes = types.filter((type: any) => {
      if (!type || type === Object || type === String || type === Number || type === Boolean) {
        return false;
      }
      const typeName = type.name;
      if (typeName && frameworkTypes.has(typeName)) {
        return false;
      }

      return true;
    });

    return serviceTypes.length > 0 ? serviceTypes : undefined;
  }

  return undefined;
}

/**
 * Diagnostic: check whether Bun is emitting decorator metadata (design:paramtypes).
 *
 * Scans an array of decorated classes. If at least one class has constructor
 * parameters (target.length > 0) but NONE of them have design:paramtypes,
 * then emitDecoratorMetadata is not working — typically because the setting
 * is missing from the root tsconfig.json that Bun actually reads.
 *
 * @param decoratedClasses - Classes registered via @Service / @Controller / @Middleware
 * @returns Object with diagnostic result and details
 */
export function diagnoseDecoratorMetadata(decoratedClasses: Function[]): {
  ok: boolean;
  classesWithParams: number;
  classesWithMetadata: number;
} {
  let classesWithParams = 0;
  let classesWithMetadata = 0;

  for (const cls of decoratedClasses) {
    if (cls.length > 0) {
      classesWithParams++;
      const types = (globalThis as any).Reflect?.getMetadata?.('design:paramtypes', cls);
      if (types && Array.isArray(types) && types.length > 0) {
        classesWithMetadata++;
      }
    }
  }

  return {
    ok: classesWithParams === 0 || classesWithMetadata > 0,
    classesWithParams,
    classesWithMetadata,
  };
}

/**
 * Build a detailed diagnostic message by inspecting the project's tsconfig files.
 *
 * Walks up from `process.cwd()` looking for tsconfig.json files, reads them,
 * and tells the user exactly which file to edit and what to add.
 */
export function buildDecoratorMetadataDiagnosticMessage(
  classesWithParams: number,
): string {
  const fs = require('node:fs');
  const pathModule = require('node:path');

  const header =
    `[OneBun] Dependency injection is broken: none of the ${classesWithParams} ` +
    'service(s) with constructor parameters have design:paramtypes metadata.\n' +
    'Bun is NOT emitting decorator metadata.\n';

  type TsconfigInfo = { path: string; content: any; hasEmit: boolean; hasExperimental: boolean };

  const readTsconfig = (tsconfigPath: string): TsconfigInfo | null => {
    try {
      if (!fs.existsSync(tsconfigPath)) {
        return null;
      }
      const raw = fs.readFileSync(tsconfigPath, 'utf-8');
      // Strip comments (single-line // and multi-line /* */) for JSON.parse
      const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const parsed = JSON.parse(stripped);
      const compilerOptions = parsed.compilerOptions || {};

      return {
        path: tsconfigPath,
        content: parsed,
        hasEmit: compilerOptions.emitDecoratorMetadata === true,
        hasExperimental: compilerOptions.experimentalDecorators === true,
      };
    } catch {
      return null;
    }
  };

  // 1. Find tsconfig.json files walking UP from cwd to filesystem root
  const tsconfigFiles: TsconfigInfo[] = [];
  let dir = process.cwd();
  const root = pathModule.parse(dir).root;

  while (dir !== root) {
    const info = readTsconfig(pathModule.join(dir, 'tsconfig.json'));
    if (info) {
      tsconfigFiles.push(info);
    }
    dir = pathModule.dirname(dir);
  }

  // 2. Also scan immediate subdirectories of cwd for child tsconfig.json files
  //    (e.g. packages/backend/tsconfig.json in a monorepo)
  const childTsconfigFiles: TsconfigInfo[] = [];
  try {
    const scanDirs = [process.cwd()];
    // Scan up to 2 levels deep to find packages/*/tsconfig.json and similar
    for (const scanDir of scanDirs) {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subdir = pathModule.join(scanDir, entry.name);
          const info = readTsconfig(pathModule.join(subdir, 'tsconfig.json'));
          if (info) {
            childTsconfigFiles.push(info);
          }
          // One level deeper (e.g. packages/backend/)
          try {
            const subEntries = fs.readdirSync(subdir, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.isDirectory() && !subEntry.name.startsWith('.') && subEntry.name !== 'node_modules') {
                const info2 = readTsconfig(pathModule.join(subdir, subEntry.name, 'tsconfig.json'));
                if (info2) {
                  childTsconfigFiles.push(info2);
                }
              }
            }
          } catch {
            // Skip unreadable directories
          }
        }
      }
    }
  } catch {
    // Skip if directory scanning fails
  }

  if (tsconfigFiles.length === 0) {
    return (
      header +
      '\nNo tsconfig.json found. Create one in your project root with:\n\n' +
      '  {\n' +
      '    "compilerOptions": {\n' +
      '      "experimentalDecorators": true,\n' +
      '      "emitDecoratorMetadata": true\n' +
      '    }\n' +
      '  }\n'
    );
  }

  // The first (deepest / closest to cwd) tsconfig is what the user likely expects to work.
  // The last (shallowest / closest to root) is what Bun actually reads.
  const rootTsconfig = tsconfigFiles[tsconfigFiles.length - 1];

  // Check if any child tsconfig has the settings but root does not
  // Look in both parent chain and scanned subdirectories
  const allConfigs = [...tsconfigFiles, ...childTsconfigFiles];
  const childWithSettings = allConfigs.find(
    (t) => t.path !== rootTsconfig.path && (t.hasEmit || t.hasExperimental),
  );

  const lines: string[] = [header];

  if (rootTsconfig.hasEmit && rootTsconfig.hasExperimental) {
    // Root has both settings — unusual, might be a different issue
    lines.push(`\nRoot tsconfig (${rootTsconfig.path}) already has both settings.`);
    lines.push('If DI is still broken, check that Bun is reading this file for your entry point.');

    return lines.join('\n');
  }

  // Report what's missing from the root tsconfig
  const missing: string[] = [];
  if (!rootTsconfig.hasExperimental) {
    missing.push('"experimentalDecorators": true');
  }
  if (!rootTsconfig.hasEmit) {
    missing.push('"emitDecoratorMetadata": true');
  }

  lines.push(`\nRoot tsconfig: ${rootTsconfig.path}`);
  lines.push(`Missing in "compilerOptions": ${missing.join(', ')}`);

  if (childWithSettings) {
    const childHas: string[] = [];
    if (childWithSettings.hasExperimental) {
      childHas.push('"experimentalDecorators": true');
    }
    if (childWithSettings.hasEmit) {
      childHas.push('"emitDecoratorMetadata": true');
    }
    lines.push(
      `\nNote: ${childWithSettings.path} has ${childHas.join(' and ')},` +
      ' but Bun ignores these when they are only in a child tsconfig.',
    );
  }

  lines.push(`\nFix: add the missing option(s) to ${rootTsconfig.path}:\n`);
  lines.push('  "compilerOptions": {');
  if (!rootTsconfig.hasExperimental) {
    lines.push('    "experimentalDecorators": true,');
  }
  if (!rootTsconfig.hasEmit) {
    lines.push('    "emitDecoratorMetadata": true');
  }
  lines.push('  }');

  return lines.join('\n');
}

/**
 * Namespace for metadata functions to mimic Reflect API
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Reflect = {
  defineMetadata,
  getMetadata,
  getConstructorParamTypes,
  setConstructorParamTypes,
};

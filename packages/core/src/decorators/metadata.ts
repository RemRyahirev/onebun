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
 * Set constructor parameter types (used by TypeScript when emitDecoratorMetadata is enabled)
 *
 * Accepts holes: a parameter whose type could not be named is `undefined` in its own slot,
 * never absent. The array is read by INDEX — `@Optional()` and `@Inject()` are keyed by the
 * declared parameter position — so shortening it silently rebinds every later decorator.
 */
export function setConstructorParamTypes(target: Function, types: (Function | undefined)[]): void {
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
 * The constructor types that name nothing the container could ever hand over.
 *
 * `Object` is the interesting one and it covers far more than `{}`: Bun's `emitDecoratorMetadata`
 * emits every type reference as `typeof X === "undefined" ? Object : X`, so an interface, a type
 * alias, `any`, `unknown` and a reference broken by a circular import ALL arrive here as `Object`.
 * They are indistinguishable from the array alone, which is why nothing built on this list may
 * claim to know WHY a parameter could not be resolved.
 *
 * The list is deliberately not wider. `Array`, `Function`, `Symbol`, `BigInt`, `Date`, `Map` and
 * `Set` are absent on purpose: each of them reaches the resolver, fails its `instanceof` check
 * and raises a LOUD `DependencyResolutionError` at startup. Adding them here would convert those
 * failures into silent `undefined` injections — the exact direction of the defect this file was
 * changed to fix.
 */
const NON_INJECTABLE_PARAM_TYPES: readonly unknown[] = [Object, String, Number, Boolean];

/**
 * Whether a `design:paramtypes` entry names something the container can resolve.
 *
 * The container's own rule, exported so an application auditing its constructors asks the
 * framework instead of guessing. The guess is not a hypothetical: an `undefined`-only audit
 * finds nothing, because an interface arrives as `Object` rather than as a hole — and the
 * obvious hand-written list (`Object`, `Function`, `String`, `Number`, `Boolean`, `Array`) is
 * wrong in both directions, since `Function` and `Array` DO reach the resolver and fail loudly
 * there, which this predicate must not hide.
 *
 * ```typescript
 * const types = getConstructorParamTypes(MyService) ?? [];
 * const holes = types.flatMap((type, index) => (isInjectableParamType(type) ? [] : [index]));
 * ```
 *
 * What it does NOT tell you is WHY — see {@link NON_INJECTABLE_PARAM_TYPES}: an interface, a
 * type alias, `any`, `unknown` and a circular-import-broken reference are all `Object` here and
 * cannot be told apart.
 *
 * @see docs:api/decorators.md
 */
export function isInjectableParamType(type: Function | undefined): type is Function {
  return type !== undefined && !NON_INJECTABLE_PARAM_TYPES.includes(type);
}

/**
 * `design:paramtypes` for a constructor, POSITIONALLY INTACT, or `undefined` when none was
 * emitted.
 *
 * Entry `i` describes parameter `i`, and an entry that names nothing usable is `undefined` in
 * its own slot. That is the whole contract, and it used to be violated: this function `.filter()`ed
 * the array, which COLLAPSES it. An interface-typed parameter — `Object` at runtime — was not
 * reported as unresolvable, it was DELETED, and every later parameter slid one slot left. The
 * service then constructed successfully holding the wrong object in several fields, with nothing
 * logged and nothing thrown (reported as onebun-FB-18; the line, as onebun-FB-19).
 *
 * The damage went past the arguments. `@Optional()` and `@Inject()` are keyed by the DECLARED
 * parameter index, so against a shortened array both landed on the wrong parameter. A
 * `@Inject(TOKEN)` sitting after a dropped entry silently fell through to plain tag resolution.
 *
 * Nothing is filtered here now. Deciding that `Object` cannot be resolved is the resolver's job —
 * see {@link isInjectableParamType} — and it can only be done per index, which is precisely what
 * a filter destroys.
 */
export function getConstructorParamTypes(target: Function): (Function | undefined)[] | undefined {
  let types: unknown;

  // The global Reflect first (our polyfill, or a real reflect-metadata if the host has one),
  // then our own store. Either may hold the array depending on how the class was decorated.
  try {
    types = (globalThis as any).Reflect?.getMetadata?.('design:paramtypes', target);
  } catch {
    // Silent fallback to custom metadata
  }

  if (!Array.isArray(types) || types.length === 0) {
    types = getMetadata('design:paramtypes', target);
  }

  if (!Array.isArray(types) || types.length === 0) {
    return undefined;
  }

  // Normalised, not filtered: a hole keeps its position. Anything that is not a constructor —
  // `null`, `undefined`, or junk from a hand-written `setConstructorParamTypes` — becomes one
  // `undefined` rather than being dropped or reaching `instanceof` and throwing a raw TypeError.
  return types.map((type) => (typeof type === 'function' ? type as Function : undefined));
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

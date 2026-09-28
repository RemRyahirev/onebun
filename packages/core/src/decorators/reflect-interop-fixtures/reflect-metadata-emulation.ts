/**
 * An in-repo stand-in for the two generations of `reflect-metadata`, for the interop fixtures.
 *
 * The real package is deliberately not a dependency of any workspace package and no test imports
 * it (onebun-FB-33). What @onebun/core has to survive is not its code but two installation
 * behaviours, and those are reproduced here from the published sources (0.1.14, 0.2.1, 0.2.2):
 *
 * - **0.2.x** looks for a provider registry under `Symbol.for('@reflect-metadata:registry')` on
 *   the global `Reflect`. When there is none but a `Reflect.defineMetadata` exists, it adopts the
 *   existing global implementation as a legacy FALLBACK provider — capturing its functions
 *   unbound, and asking its `getOwnMetadataKeys` whether it owns a target — and publishes a fresh
 *   registry. Either way it registers its own store and then OVERWRITES every global function.
 * - **0.1.x** has no registry and fills ONLY the global functions that are missing.
 *
 * Every call is an independent physical copy with a store of its own, so calling a loader twice is
 * "two copies of reflect-metadata in node_modules". The one 0.2.1 difference that matters is kept
 * behind `fallbackQuirk021`: its fallback provider stops asking the legacy implementation about a
 * target as soon as it has recorded ANY property key of it, which loses the others. 0.2.x's
 * registry also returns the first provider where it means the second on an uncached lookup; that
 * branch is unreachable here (a provider always caches the pair it claims) and is not reproduced.
 */

/** Anything the Metadata API accepts as a key. */
type Key = unknown;
type Property = string | symbol | undefined;
type Decorator = (target: object, propertyKey?: Property, descriptor?: PropertyDescriptor) => unknown;

/* eslint-disable @typescript-eslint/naming-convention -- reflect-metadata's provider protocol names */
interface Provider {
  isProviderFor(target: object, propertyKey: Property): boolean;
  OrdinaryDefineOwnMetadata(key: Key, value: unknown, target: object, propertyKey: Property): void;
  OrdinaryHasOwnMetadata(key: Key, target: object, propertyKey: Property): boolean;
  OrdinaryGetOwnMetadata(key: Key, target: object, propertyKey: Property): unknown;
  OrdinaryOwnMetadataKeys(target: object, propertyKey: Property): Key[];
  OrdinaryDeleteMetadata(key: Key, target: object, propertyKey: Property): boolean;
}
/* eslint-enable @typescript-eslint/naming-convention */

interface Registry {
  registerProvider(provider: Provider): void;
  getProvider(target: object, propertyKey: Property): Provider | undefined;
  setProvider(target: object, propertyKey: Property, provider: Provider): boolean;
}

type GlobalReflect = Record<PropertyKey, unknown>;
type LegacyFunction = (...args: unknown[]) => unknown;

const REGISTRY_KEY = Symbol.for('@reflect-metadata:registry');

function root(): GlobalReflect {
  return globalThis.Reflect as unknown as GlobalReflect;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' ? value !== null : typeof value === 'function';
}

function checkTarget(target: unknown): object {
  if (!isObject(target)) {
    throw new TypeError();
  }

  return target;
}

function toProperty(propertyKey: unknown): Property {
  return propertyKey === undefined || typeof propertyKey === 'symbol' ? propertyKey : String(propertyKey);
}

/** `Reflect.decorate`, which both generations also export (0.1.x only when it is missing). */
function decorate(decorators: Decorator[], target: object, propertyKey?: Property, attributes?: PropertyDescriptor | null) {
  if (propertyKey === undefined) {
    let decorated: object = target;
    for (let i = decorators.length - 1; i >= 0; i--) {
      const result = decorators[i](decorated);
      if (result !== undefined && result !== null) {
        decorated = result as object;
      }
    }

    return decorated;
  }

  let descriptor = attributes === null ? undefined : attributes;
  for (let i = decorators.length - 1; i >= 0; i--) {
    const result = decorators[i](target, propertyKey, descriptor);
    if (result !== undefined && result !== null) {
      descriptor = result as PropertyDescriptor;
    }
  }

  return descriptor;
}

/**
 * The ten exported functions over "does this target own metadata here" primitives, with the
 * proposal's prototype walk. Shared by both generations; only the primitives differ.
 */
function buildApi(primitives: {
  hasOwn(key: Key, target: object, propertyKey: Property): boolean;
  getOwn(key: Key, target: object, propertyKey: Property): unknown;
  ownKeys(target: object, propertyKey: Property): Key[];
  define(key: Key, value: unknown, target: object, propertyKey: Property): void;
  remove(key: Key, target: object, propertyKey: Property): boolean;
}): Record<string, unknown> {
  const {
    hasOwn, getOwn, ownKeys, define, remove,
  } = primitives;
  const parentOf = (target: object): object | null => Object.getPrototypeOf(target) as object | null;

  return {
    decorate,
    metadata: (key: Key, value: unknown) => (target: unknown, propertyKey?: unknown) => {
      if (propertyKey !== undefined && typeof propertyKey !== 'string' && typeof propertyKey !== 'symbol') {
        throw new TypeError();
      }
      define(key, value, checkTarget(target), propertyKey);
    },
    defineMetadata(key: Key, value: unknown, target: unknown, propertyKey?: unknown) {
      define(key, value, checkTarget(target), toProperty(propertyKey));
    },
    hasOwnMetadata: (key: Key, target: unknown, property?: unknown) => hasOwn(key, checkTarget(target), toProperty(property)),
    getOwnMetadata: (key: Key, target: unknown, property?: unknown) => getOwn(key, checkTarget(target), toProperty(property)),
    getOwnMetadataKeys: (target: unknown, property?: unknown) => ownKeys(checkTarget(target), toProperty(property)),
    deleteMetadata: (key: Key, target: unknown, property?: unknown) => remove(key, checkTarget(target), toProperty(property)),
    hasMetadata(key: Key, target: unknown, propertyKey?: unknown): boolean {
      const property = toProperty(propertyKey);
      for (let current: object | null = checkTarget(target); current !== null; current = parentOf(current)) {
        if (hasOwn(key, current, property)) {
          return true;
        }
      }

      return false;
    },
    getMetadata(key: Key, target: unknown, propertyKey?: unknown): unknown {
      const property = toProperty(propertyKey);
      for (let current: object | null = checkTarget(target); current !== null; current = parentOf(current)) {
        if (hasOwn(key, current, property)) {
          return getOwn(key, current, property);
        }
      }

      return undefined;
    },
    getMetadataKeys(target: unknown, propertyKey?: unknown): Key[] {
      const property = toProperty(propertyKey);
      const keys = new Set<Key>();
      for (let current: object | null = checkTarget(target); current !== null; current = parentOf(current)) {
        for (const key of ownKeys(current, property)) {
          keys.add(key);
        }
      }

      return [...keys];
    },
  };
}

/** A per-copy store: `target -> propertyKey -> key -> value`. */
function createStore() {
  const store = new WeakMap<object, Map<Property, Map<Key, unknown>>>();

  return {
    table(target: object, propertyKey: Property): Map<Key, unknown> | undefined {
      return store.get(target)?.get(propertyKey);
    },
    create(target: object, propertyKey: Property): { table: Map<Key, unknown>; undo(): void } {
      let byProperty = store.get(target);
      const createdTarget = byProperty === undefined;
      if (byProperty === undefined) {
        byProperty = new Map();
        store.set(target, byProperty);
      }
      const table = new Map<Key, unknown>();
      byProperty.set(propertyKey, table);

      return {
        table,
        undo() {
          byProperty.delete(propertyKey);
          if (createdTarget) {
            store.delete(target);
          }
        },
      };
    },
    has(target: object, propertyKey: Property): boolean {
      return store.get(target)?.has(propertyKey) ?? false;
    },
  };
}

function createRegistry(fallback: Provider | undefined): Registry {
  const providers: Provider[] = [];
  const owners = new WeakMap<object, Map<Property, Provider>>();

  const getProvider = (target: object, propertyKey: Property): Provider | undefined => {
    const known = owners.get(target)?.get(propertyKey);
    if (known !== undefined) {
      return known;
    }
    const found = providers.find((provider) => provider.isProviderFor(target, propertyKey))
      ?? (fallback?.isProviderFor(target, propertyKey) ? fallback : undefined);
    if (found !== undefined) {
      const byProperty = owners.get(target) ?? new Map<Property, Provider>();
      owners.set(target, byProperty);
      byProperty.set(propertyKey, found);
    }

    return found;
  };

  return {
    registerProvider(provider) {
      if (provider !== fallback && !providers.includes(provider)) {
        providers.push(provider);
      }
    },
    getProvider,
    setProvider(target, propertyKey, provider) {
      if (!providers.includes(provider)) {
        throw new Error('Metadata provider not registered.');
      }
      const existing = getProvider(target, propertyKey);
      if (existing !== undefined) {
        return existing === provider;
      }
      const byProperty = owners.get(target) ?? new Map<Property, Provider>();
      owners.set(target, byProperty);
      byProperty.set(propertyKey, provider);

      return true;
    },
  };
}

/**
 * 0.2.x's `CreateFallbackProvider`: the pre-existing global implementation, called through the
 * functions captured NOW (unbound). A missing `getOwnMetadataKeys` throws on the first lookup —
 * the crash onebun-FB-33 reported against @onebun/core 0.8.1.
 */
function createFallbackProvider(reflect: GlobalReflect, fallbackQuirk021: boolean): Provider {
  const defineMetadata = reflect.defineMetadata as LegacyFunction;
  const hasOwnMetadata = reflect.hasOwnMetadata as LegacyFunction;
  const getOwnMetadata = reflect.getOwnMetadata as LegacyFunction;
  const getOwnMetadataKeys = reflect.getOwnMetadataKeys as LegacyFunction;
  const deleteMetadata = reflect.deleteMetadata as LegacyFunction;
  const seen = new WeakMap<object, Set<Property>>();

  /* eslint-disable @typescript-eslint/naming-convention -- reflect-metadata's provider protocol names */
  return {
    isProviderFor(target, propertyKey) {
      const properties = seen.get(target);
      if (properties !== undefined && (fallbackQuirk021 || properties.has(propertyKey))) {
        return properties.has(propertyKey);
      }
      if ((getOwnMetadataKeys(target, propertyKey) as Key[]).length > 0) {
        const recorded = properties ?? new Set<Property>();
        seen.set(target, recorded);
        recorded.add(propertyKey);

        return true;
      }

      return false;
    },
    OrdinaryDefineOwnMetadata(key, value, target, propertyKey) {
      defineMetadata(key, value, target, propertyKey);
    },
    OrdinaryHasOwnMetadata: (key, target, propertyKey) => hasOwnMetadata(key, target, propertyKey) === true,
    OrdinaryGetOwnMetadata: (key, target, propertyKey) => getOwnMetadata(key, target, propertyKey),
    OrdinaryOwnMetadataKeys: (target, propertyKey) => getOwnMetadataKeys(target, propertyKey) as Key[],
    OrdinaryDeleteMetadata: (key, target, propertyKey) => deleteMetadata(key, target, propertyKey) === true,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

export interface ReflectMetadata02Options {
  /** Reproduce 0.2.1's fallback provider instead of 0.2.2's. */
  fallbackQuirk021?: boolean;
}

/**
 * Load one more copy of reflect-metadata 0.2.x: join (or create) the registry, register a fresh
 * store, overwrite every global function.
 */
export function loadReflectMetadata02(options: ReflectMetadata02Options = {}): void {
  const reflect = root();

  let registry = Object.isExtensible(reflect) ? reflect[REGISTRY_KEY] as Registry | undefined : undefined;
  if (registry === undefined) {
    const adoptLegacy = !(REGISTRY_KEY in reflect) && typeof reflect.defineMetadata === 'function';
    registry = createRegistry(adoptLegacy ? createFallbackProvider(reflect, options.fallbackQuirk021 === true) : undefined);
  }
  if (Object.isExtensible(reflect)) {
    Object.defineProperty(reflect, REGISTRY_KEY, {
      enumerable: false, configurable: false, writable: false, value: registry,
    });
  }

  const store = createStore();
  const activeRegistry = registry;
  /* eslint-disable @typescript-eslint/naming-convention -- reflect-metadata's provider protocol names */
  const provider: Provider = {
    isProviderFor: (target, propertyKey) => store.has(target, propertyKey),
    OrdinaryDefineOwnMetadata(key, value, target, propertyKey) {
      let table = store.table(target, propertyKey);
      if (table === undefined) {
        const created = store.create(target, propertyKey);
        if (!activeRegistry.setProvider(target, propertyKey, provider)) {
          created.undo();
          throw new Error('Wrong provider for target.');
        }
        table = created.table;
      }
      table.set(key, value);
    },
    OrdinaryHasOwnMetadata: (key, target, propertyKey) => store.table(target, propertyKey)?.has(key) ?? false,
    OrdinaryGetOwnMetadata: (key, target, propertyKey) => store.table(target, propertyKey)?.get(key),
    OrdinaryOwnMetadataKeys: (target, propertyKey) => [...(store.table(target, propertyKey)?.keys() ?? [])],
    OrdinaryDeleteMetadata: (key, target, propertyKey) => store.table(target, propertyKey)?.delete(key) ?? false,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
  activeRegistry.registerProvider(provider);

  const providerFor = (target: object, propertyKey: Property, create: boolean): Provider | undefined => {
    const registered = activeRegistry.getProvider(target, propertyKey);
    if (registered !== undefined || !create) {
      return registered;
    }
    if (activeRegistry.setProvider(target, propertyKey, provider)) {
      return provider;
    }
    throw new Error('Illegal state.');
  };

  const owner = (target: object, property: Property): Provider | undefined => providerFor(target, property, false);
  const api = buildApi({
    hasOwn: (key, target, property) => owner(target, property)?.OrdinaryHasOwnMetadata(key, target, property) === true,
    getOwn: (key, target, property) => owner(target, property)?.OrdinaryGetOwnMetadata(key, target, property),
    ownKeys: (target, property) => owner(target, property)?.OrdinaryOwnMetadataKeys(target, property) ?? [],
    define(key, value, target, property) {
      providerFor(target, property, true)!.OrdinaryDefineOwnMetadata(key, value, target, property);
    },
    remove: (key, target, property) => owner(target, property)?.OrdinaryDeleteMetadata(key, target, property) ?? false,
  });

  // 0.2.x's exporter: no "is it already there" check.
  for (const [name, fn] of Object.entries(api)) {
    Object.defineProperty(reflect, name, { configurable: true, writable: true, value: fn });
  }
}

/**
 * Load one copy of reflect-metadata 0.1.x: its own store, and only the global functions that are
 * not already functions.
 */
export function loadReflectMetadata01(): void {
  const reflect = root();
  const store = createStore();

  const api = buildApi({
    hasOwn: (key, target, propertyKey) => store.table(target, propertyKey)?.has(key) ?? false,
    getOwn: (key, target, propertyKey) => store.table(target, propertyKey)?.get(key),
    ownKeys: (target, propertyKey) => [...(store.table(target, propertyKey)?.keys() ?? [])],
    define(key, value, target, propertyKey) {
      (store.table(target, propertyKey) ?? store.create(target, propertyKey).table).set(key, value);
    },
    remove: (key, target, propertyKey) => store.table(target, propertyKey)?.delete(key) ?? false,
  });

  // 0.1.x's exporter: `if (typeof target[key] !== "function")`.
  for (const [name, fn] of Object.entries(api)) {
    if (typeof reflect[name] !== 'function') {
      Object.defineProperty(reflect, name, { configurable: true, writable: true, value: fn });
    }
  }
}

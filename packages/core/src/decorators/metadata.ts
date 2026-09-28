/* eslint-disable
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/explicit-module-boundary-types */
// Metadata system must work with any types as it stores arbitrary metadata values
// This is similar to reflect-metadata which also uses `any` for metadata values
// Return types are intentionally flexible to match reflect-metadata API

/**
 * OneBun's metadata, in two layers, with no dependency on reflect-metadata:
 *
 * - a module-private store (`defineMetadata` / `getMetadata` below, and the `Reflect` namespace
 *   export at the end) for the framework's own keys — routes, params, guards, queue handlers;
 * - the GLOBAL Reflect Metadata API, installed further down, which is where Bun's
 *   `emitDecoratorMetadata` output lands and which other libraries in the process share.
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

/* -------------------------------------------------------------------------------------------------
 * The global Reflect Metadata API
 *
 * Bun's `emitDecoratorMetadata` output records `design:paramtypes`, `design:type` and
 * `design:returntype` through the GLOBAL `Reflect.metadata`, and only when that function exists.
 * So something must install it, and whatever is installed is shared with every other library in the
 * process that speaks the same API: tsyringe, class-transformer, inversify, and any
 * `reflect-metadata` a dependency imports on its own (`@simplewebauthn/server` does, via tsyringe).
 *
 * A partial API breaks both generations of reflect-metadata loaded after it. Take the three
 * functions an older copy of this module installs — `metadata`, `getMetadata`, `defineMetadata` —
 * which ignore the property key and the prototype chain:
 *
 * - 0.2.x sees an existing `Reflect.defineMetadata`, wraps the global as a legacy "fallback
 *   provider" and calls its `getOwnMetadataKeys` on the first lookup. There is none, so every
 *   later decorator throws, and classes decorated earlier lose their `design:paramtypes`.
 * - 0.1.x only fills the functions that are missing, so it adds `getOwnMetadata` next to the
 *   existing `defineMetadata`: one target's metadata splits across two stores, and a tsyringe
 *   `@inject` token written through one half is never read back through the other.
 *
 * What is installed is the complete API — all nine functions, with per-property storage and
 * the proposal's prototype walk — plus the provider registry reflect-metadata 0.2.x shares between
 * its copies (`Symbol.for('@reflect-metadata:registry')`). A 0.2.x loaded later finds the registry,
 * registers its own store beside ours and routes every target to whichever store holds it, so
 * metadata written before it arrived is still read back afterwards. A 0.1.x loaded later finds
 * nothing missing and changes nothing.
 *
 * An implementation that is already there (reflect-metadata imported first, core-js, another copy
 * of this module) is never replaced: its store holds whatever was decorated before this module
 * ran, and replacing its functions would orphan that.
 * ---------------------------------------------------------------------------------------------- */

/** A metadata key: any value, compared the way a `Map` compares its keys. */
type MetadataKey = unknown;

/** A normalised property key. `undefined` addresses the target itself (a class, not a member). */
type MetadataPropertyKey = string | symbol | undefined;

/* eslint-disable @typescript-eslint/naming-convention -- the `Ordinary*` names are reflect-metadata's protocol */
/**
 * One metadata store, in the shape reflect-metadata 0.2.x hands to the shared registry. Every
 * implementation that joins the registry — this module's and each reflect-metadata copy — is one
 * provider, and every `(target, propertyKey)` pair belongs to exactly one of them.
 */
interface MetadataProvider {
  isProviderFor(target: object, propertyKey: MetadataPropertyKey): boolean;
  OrdinaryDefineOwnMetadata(key: MetadataKey, value: unknown, target: object, propertyKey: MetadataPropertyKey): void;
  OrdinaryHasOwnMetadata(key: MetadataKey, target: object, propertyKey: MetadataPropertyKey): boolean;
  OrdinaryGetOwnMetadata(key: MetadataKey, target: object, propertyKey: MetadataPropertyKey): unknown;
  OrdinaryOwnMetadataKeys(target: object, propertyKey: MetadataPropertyKey): MetadataKey[];
  OrdinaryDeleteMetadata(key: MetadataKey, target: object, propertyKey: MetadataPropertyKey): boolean;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * The registry reflect-metadata 0.2.x looks for on the global `Reflect` before it creates its own.
 * The three methods are the whole protocol; a copy of reflect-metadata calls them on this object.
 */
interface MetadataRegistry {
  registerProvider(provider: MetadataProvider): void;
  getProvider(target: object, propertyKey: MetadataPropertyKey): MetadataProvider | undefined;
  setProvider(target: object, propertyKey: MetadataPropertyKey, provider: MetadataProvider): boolean;
}

/** The nine functions of the Reflect Metadata API, as they sit on the global `Reflect`. */
interface ReflectMetadataApi {
  metadata(key: MetadataKey, value: unknown): (target: object, propertyKey?: string | symbol) => void;
  defineMetadata(key: MetadataKey, value: unknown, target: object, propertyKey?: PropertyKey): void;
  hasMetadata(key: MetadataKey, target: object, propertyKey?: PropertyKey): boolean;
  hasOwnMetadata(key: MetadataKey, target: object, propertyKey?: PropertyKey): boolean;
  getMetadata(key: MetadataKey, target: object, propertyKey?: PropertyKey): unknown;
  getOwnMetadata(key: MetadataKey, target: object, propertyKey?: PropertyKey): unknown;
  getMetadataKeys(target: object, propertyKey?: PropertyKey): MetadataKey[];
  getOwnMetadataKeys(target: object, propertyKey?: PropertyKey): MetadataKey[];
  deleteMetadata(key: MetadataKey, target: object, propertyKey?: PropertyKey): boolean;
}

const REFLECT_METADATA_FUNCTIONS: readonly (keyof ReflectMetadataApi)[] = [
  'metadata',
  'defineMetadata',
  'hasMetadata',
  'hasOwnMetadata',
  'getMetadata',
  'getOwnMetadata',
  'getMetadataKeys',
  'getOwnMetadataKeys',
  'deleteMetadata',
];

/** The key reflect-metadata 0.2.x stores its shared provider registry under. */
const METADATA_REGISTRY_KEY = Symbol.for('@reflect-metadata:registry');

/** The global `Reflect`, typed as what it may hold. */
type GlobalReflect = Partial<ReflectMetadataApi> & Record<PropertyKey, unknown>;

interface GlobalReflectHolder {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the global's own name
  Reflect?: GlobalReflect;
}

/**
 * The global `Reflect`, read through `globalThis` on every call and never cached: this module
 * shadows the name with its own `Reflect` namespace export, and another library may replace the
 * functions at any time — reading them late is what makes that safe.
 */
function globalReflect(): GlobalReflect | undefined {
  return (globalThis as unknown as GlobalReflectHolder).Reflect;
}

function isMetadataRegistry(value: unknown): value is MetadataRegistry {
  const candidate = value as Partial<MetadataRegistry> | undefined;

  return isObjectLike(candidate)
    && typeof candidate.registerProvider === 'function'
    && typeof candidate.getProvider === 'function'
    && typeof candidate.setProvider === 'function';
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' ? value !== null : typeof value === 'function';
}

function requireMetadataTarget(target: unknown): object {
  if (!isObjectLike(target)) {
    throw new TypeError('Reflect metadata target must be an object or a function');
  }

  return target;
}

/**
 * The proposal's `ToPropertyKey`: a symbol stays a symbol, anything else becomes the string a
 * property access would use (`1` and `'1'` address the same member). A computed key performs
 * exactly that conversion, including an object's `Symbol.toPrimitive`.
 */
function toMetadataPropertyKey(propertyKey: unknown): MetadataPropertyKey {
  if (propertyKey === undefined || typeof propertyKey === 'string' || typeof propertyKey === 'symbol') {
    return propertyKey;
  }
  const probe = { [propertyKey as PropertyKey]: true };

  return Object.getOwnPropertySymbols(probe)[0] ?? Object.keys(probe)[0];
}

const FUNCTION_PROTOTYPE: unknown = Object.getPrototypeOf(Function);

/**
 * The proposal's `OrdinaryGetPrototypeOf`: the next object of the metadata walk.
 *
 * Plain `Object.getPrototypeOf`, except for a down-levelled (ES5) subclass constructor whose own
 * `[[Prototype]]` is still `Function.prototype`: its superclass is recovered through
 * `prototype.__proto__.constructor`, as reflect-metadata does, so a walk answers the same whichever
 * implementation performs it.
 */
function metadataParentOf(target: object): object | null {
  const proto = Object.getPrototypeOf(target) as object | null;

  if (typeof target !== 'function' || target === FUNCTION_PROTOTYPE || proto !== FUNCTION_PROTOTYPE) {
    return proto;
  }

  const prototype: unknown = (target as { prototype?: unknown }).prototype;
  const prototypeProto = isObjectLike(prototype) ? Object.getPrototypeOf(prototype) as object | null : null;
  if (prototypeProto === null || prototypeProto === Object.prototype) {
    return proto;
  }

  const constructorOfParent: unknown = (prototypeProto as { constructor?: unknown }).constructor;
  if (typeof constructorOfParent !== 'function' || constructorOfParent === target) {
    return proto;
  }

  return constructorOfParent;
}

/**
 * A provider registry with reflect-metadata 0.2.x's protocol. Providers are consulted in
 * registration order and the answer is remembered per `(target, propertyKey)`, so a pair keeps the
 * store it was first written to whichever implementation's functions are on the global later.
 */
function createMetadataRegistry(): MetadataRegistry {
  const providers: MetadataProvider[] = [];
  const owners = new WeakMap<object, Map<MetadataPropertyKey, MetadataProvider>>();

  const remember = (target: object, propertyKey: MetadataPropertyKey, provider: MetadataProvider): void => {
    let byProperty = owners.get(target);
    if (byProperty === undefined) {
      byProperty = new Map();
      owners.set(target, byProperty);
    }
    byProperty.set(propertyKey, provider);
  };

  const getProvider = (target: object, propertyKey: MetadataPropertyKey): MetadataProvider | undefined => {
    const known = owners.get(target)?.get(propertyKey);
    if (known !== undefined) {
      return known;
    }

    const found = providers.find((provider) => provider.isProviderFor(target, propertyKey));
    if (found !== undefined) {
      remember(target, propertyKey, found);
    }

    return found;
  };

  return {
    registerProvider(provider) {
      if (!providers.includes(provider)) {
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
      remember(target, propertyKey, provider);

      return true;
    },
  };
}

/**
 * This module's own store, as a registry provider: `target -> propertyKey -> key -> value`.
 * Nothing here uses `this` — reflect-metadata calls provider methods detached from the object.
 */
function createMetadataProvider(registry: MetadataRegistry): MetadataProvider {
  const store = new WeakMap<object, Map<MetadataPropertyKey, Map<MetadataKey, unknown>>>();

  // Assigned below: `ownMetadata` claims a new pair for this provider through the registry.
  let provider: MetadataProvider;

  const ownMetadata = (
    target: object,
    propertyKey: MetadataPropertyKey,
    create: boolean,
  ): Map<MetadataKey, unknown> | undefined => {
    let byProperty = store.get(target);
    let createdTarget = false;
    if (byProperty === undefined) {
      if (!create) {
        return undefined;
      }
      byProperty = new Map();
      store.set(target, byProperty);
      createdTarget = true;
    }

    let byKey = byProperty.get(propertyKey);
    if (byKey === undefined) {
      if (!create) {
        return undefined;
      }
      byKey = new Map();
      byProperty.set(propertyKey, byKey);
      if (!registry.setProvider(target, propertyKey, provider)) {
        byProperty.delete(propertyKey);
        if (createdTarget) {
          store.delete(target);
        }
        throw new Error('Wrong provider for target.');
      }
    }

    return byKey;
  };

  /* eslint-disable @typescript-eslint/naming-convention -- reflect-metadata's protocol names */
  provider = {
    isProviderFor: (target, propertyKey) => store.get(target)?.has(propertyKey) ?? false,
    OrdinaryDefineOwnMetadata(key, value, target, propertyKey) {
      ownMetadata(target, propertyKey, true)!.set(key, value);
    },
    OrdinaryHasOwnMetadata: (key, target, propertyKey) => ownMetadata(target, propertyKey, false)?.has(key) ?? false,
    OrdinaryGetOwnMetadata: (key, target, propertyKey) => ownMetadata(target, propertyKey, false)?.get(key),
    OrdinaryOwnMetadataKeys: (target, propertyKey) => [...(ownMetadata(target, propertyKey, false)?.keys() ?? [])],
    OrdinaryDeleteMetadata(key, target, propertyKey) {
      const byKey = ownMetadata(target, propertyKey, false);
      if (byKey === undefined || !byKey.delete(key)) {
        return false;
      }
      if (byKey.size === 0) {
        const byProperty = store.get(target);
        byProperty?.delete(propertyKey);
        if (byProperty?.size === 0) {
          store.delete(target);
        }
      }

      return true;
    },
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  return provider;
}

/**
 * The nine API functions over a registry. A pair owned by another provider is read and written in
 * that provider's store; a new pair is claimed for `ownProvider`. The functions behave the same as
 * reflect-metadata's own, so it does not matter whose are on the global at any moment.
 */
function createReflectMetadataApi(registry: MetadataRegistry, ownProvider: MetadataProvider): ReflectMetadataApi {
  function providerFor(target: object, propertyKey: MetadataPropertyKey, create: boolean): MetadataProvider | undefined {
    const registered = registry.getProvider(target, propertyKey);
    if (registered !== undefined || !create) {
      return registered;
    }
    if (registry.setProvider(target, propertyKey, ownProvider)) {
      return ownProvider;
    }
    throw new Error('Illegal state: no metadata provider accepted the target.');
  }

  function hasOwn(key: MetadataKey, target: object, propertyKey: MetadataPropertyKey): boolean {
    return providerFor(target, propertyKey, false)?.OrdinaryHasOwnMetadata(key, target, propertyKey) === true;
  }

  function getOwn(key: MetadataKey, target: object, propertyKey: MetadataPropertyKey): unknown {
    return providerFor(target, propertyKey, false)?.OrdinaryGetOwnMetadata(key, target, propertyKey);
  }

  function ownKeys(target: object, propertyKey: MetadataPropertyKey): MetadataKey[] {
    return providerFor(target, propertyKey, false)?.OrdinaryOwnMetadataKeys(target, propertyKey) ?? [];
  }

  function defineOwn(key: MetadataKey, value: unknown, target: object, propertyKey: MetadataPropertyKey): void {
    providerFor(target, propertyKey, true)!.OrdinaryDefineOwnMetadata(key, value, target, propertyKey);
  }

  return {
    metadata(key, value) {
      return (target: object, propertyKey?: string | symbol): void => {
        requireMetadataTarget(target);
        if (propertyKey !== undefined && typeof propertyKey !== 'string' && typeof propertyKey !== 'symbol') {
          throw new TypeError('Reflect.metadata decorator property key must be a string or a symbol');
        }
        defineOwn(key, value, target, propertyKey);
      };
    },
    defineMetadata(key, value, target, propertyKey) {
      defineOwn(key, value, requireMetadataTarget(target), toMetadataPropertyKey(propertyKey));
    },
    hasOwnMetadata(key, target, propertyKey) {
      return hasOwn(key, requireMetadataTarget(target), toMetadataPropertyKey(propertyKey));
    },
    getOwnMetadata(key, target, propertyKey) {
      return getOwn(key, requireMetadataTarget(target), toMetadataPropertyKey(propertyKey));
    },
    getOwnMetadataKeys(target, propertyKey) {
      return ownKeys(requireMetadataTarget(target), toMetadataPropertyKey(propertyKey));
    },
    hasMetadata(key, target, propertyKey) {
      const property = toMetadataPropertyKey(propertyKey);
      for (let current: object | null = requireMetadataTarget(target); current !== null; current = metadataParentOf(current)) {
        if (hasOwn(key, current, property)) {
          return true;
        }
      }

      return false;
    },
    getMetadata(key, target, propertyKey) {
      const property = toMetadataPropertyKey(propertyKey);
      for (let current: object | null = requireMetadataTarget(target); current !== null; current = metadataParentOf(current)) {
        if (hasOwn(key, current, property)) {
          return getOwn(key, current, property);
        }
      }

      return undefined;
    },
    getMetadataKeys(target, propertyKey) {
      const property = toMetadataPropertyKey(propertyKey);
      // Own keys first, then each ancestor's keys not seen yet — the proposal's order.
      const keys = new Set<MetadataKey>();
      for (let current: object | null = requireMetadataTarget(target); current !== null; current = metadataParentOf(current)) {
        for (const key of ownKeys(current, property)) {
          keys.add(key);
        }
      }

      return [...keys];
    },
    deleteMetadata(key, target, propertyKey) {
      const object = requireMetadataTarget(target);
      const property = toMetadataPropertyKey(propertyKey);

      return providerFor(object, property, false)?.OrdinaryDeleteMetadata(key, object, property) ?? false;
    },
  };
}

/**
 * Install the API on the global `Reflect` unless an implementation is already there.
 *
 * "Already there" means ANY of the nine functions: a complete implementation owns the metadata
 * decorated so far, and a partial one (an older copy of this module, which installed three) is
 * left exactly as it was rather than mixed with a second store.
 */
function installGlobalReflectMetadata(): void {
  const reflect = globalReflect();
  if (
    !isObjectLike(reflect)
    || !Object.isExtensible(reflect)
    || REFLECT_METADATA_FUNCTIONS.some((name) => typeof reflect[name] === 'function')
  ) {
    return;
  }

  // Join a registry that is already published (its functions were removed, not its providers);
  // otherwise publish ours, with the descriptor reflect-metadata uses so that its own
  // `defineProperty` of the key succeeds. A foreign value under the key leaves the registry private.
  const published = reflect[METADATA_REGISTRY_KEY];
  const registry = isMetadataRegistry(published) ? published : createMetadataRegistry();
  if (published === undefined) {
    Object.defineProperty(reflect, METADATA_REGISTRY_KEY, {
      enumerable: false, configurable: false, writable: false, value: registry,
    });
  }

  const provider = createMetadataProvider(registry);
  registry.registerProvider(provider);

  const api = createReflectMetadataApi(registry, provider);
  for (const name of REFLECT_METADATA_FUNCTIONS) {
    Object.defineProperty(reflect, name, { configurable: true, writable: true, value: api[name] });
  }
}

installGlobalReflectMetadata();

/**
 * `key` as the target's OWN metadata on the global `Reflect`, or `undefined`. Never walks the
 * prototype chain: a class that declares no constructor of its own has no `design:paramtypes` of
 * its own, and handing it its parent's would inject by position into a constructor that may take
 * different parameters.
 *
 * A global with no `getOwnMetadata` is a partial one installed before this module (an older copy
 * of it); its `getMetadata` never walked, so it is the own read there. A throwing implementation
 * reads as "no metadata".
 */
export function getOwnGlobalMetadata(key: string, target: object): unknown {
  const reflect = globalReflect();

  try {
    if (typeof reflect?.getOwnMetadata === 'function') {
      return reflect.getOwnMetadata(key, target);
    }
    if (typeof reflect?.getMetadata === 'function') {
      return reflect.getMetadata(key, target);
    }
  } catch {
    // Fall through: the caller has its own fallback.
  }

  return undefined;
}

/**
 * Write `key` as the target's own metadata on the global `Reflect`, if it has a `defineMetadata`.
 */
export function defineGlobalMetadata(key: string, value: unknown, target: object): void {
  const reflect = globalReflect();
  if (typeof reflect?.defineMetadata === 'function') {
    reflect.defineMetadata(key, value, target);
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
 * its own slot. That is the whole contract. Filtering the array would COLLAPSE it: an
 * interface-typed parameter — `Object` at runtime — would not be reported as unresolvable but
 * DELETED, and every later parameter would slide one slot left. The service would then construct
 * successfully holding the wrong object in several fields, with nothing logged and nothing thrown.
 *
 * The damage would go past the arguments. `@Optional()` and `@Inject()` are keyed by the DECLARED
 * parameter index, so against a shortened array both would land on the wrong parameter, and a
 * `@Inject(TOKEN)` sitting after a dropped entry would silently fall through to plain tag
 * resolution.
 *
 * Nothing is filtered here. Deciding that `Object` cannot be resolved is the resolver's job —
 * see {@link isInjectableParamType} — and it can only be done per index, which is precisely what
 * a filter destroys.
 */
export function getConstructorParamTypes(target: Function): (Function | undefined)[] | undefined {
  // The global Reflect first (our API, or a reflect-metadata the host loaded), then our own store.
  // Either may hold the array depending on how the class was decorated. OWN metadata only, in
  // both: see getOwnGlobalMetadata for why a subclass must not borrow its parent's array.
  let types = getOwnGlobalMetadata('design:paramtypes', target);

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
      const types = getOwnGlobalMetadata('design:paramtypes', cls);
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

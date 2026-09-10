/**
 * Named module registrations.
 *
 * A dynamic module — `DrizzleModule`, `CacheModule` — is configured through a static
 * `forRoot()`. Historically that stored the options on the module CLASS, which the whole
 * process shares, so a second `forRoot()` overwrote the first for everyone: two
 * `DrizzleService` instances both connected to whichever database was configured last,
 * silently. A registration replaces that single slot with one identity per configuration.
 *
 * The identity is a MODULE class minted per token, not a per-registration service tag.
 * `@Service()` mints exactly one `Context.Tag` per class and every DI map is keyed by it, so
 * two registrations exporting the same service class cannot both live in one tag-keyed map.
 * Keeping the identity at the module level sidesteps that entirely: selection happens at the
 * module boundary, where each importing module already has its own `serviceInstances`.
 *
 * The rule that makes it safe: **a named registration is never `@Global()`**. Ambient
 * visibility is what would put two instances of one class into the shared scope, and there
 * is exactly one slot there. A named registration reaches a module only by being imported.
 *
 * @see docs:api/decorators.md
 */

import { getModuleMetadata, Module } from '../decorators/decorators';

/**
 * What identifies a registration at the call site.
 *
 * Both forms are accepted. A `symbol` cannot collide across packages; a `string` is easier
 * to read in an error message and easier to share across files without an import.
 */
export type RegistrationToken = symbol | string;

interface Registration {
  /** The module class minted for this registration. */
  moduleClass: Function;
  /** The options `forRoot()` was called with, once it has been. */
  options: unknown;
  /** The base module the registration was minted from. */
  baseModule: Function;
  /** Whether `forRoot()` has supplied options. A selected-but-unconfigured one is an error. */
  configured: boolean;
  /** The service classes this registration provides, for resolving `@Inject(TOKEN)`. */
  providers: Function[];
}

/**
 * One unnamed `forRoot()` call, kept so a later call that disagrees can be reported against it.
 *
 * `defaultRegistrations` holds only the winner; this holds the history, which is the only way
 * to say WHICH two calls disagreed and where they were written.
 */
interface UnnamedCall {
  /** Effective ambient visibility, `isGlobal !== false`. `undefined` when the caller did not say. */
  ambient: boolean | undefined;
  /**
   * What the call configured, compared as a string.
   *
   * Taken at call time on purpose: an options object mutated after `forRoot()` would otherwise
   * make two calls agree — or disagree — retroactively.
   */
  fingerprint: string;
  /** Where the call was written, as far as the stack could say. */
  callSite: string;
}

/** Every registration in the process, keyed by base module and then by token. */
const registrations = new Map<Function, Map<RegistrationToken, Registration>>();

/** The unnamed registration per base module, if `forRoot()` was called without `as`. */
const defaultRegistrations = new Map<Function, Registration>();

/** Every unnamed `forRoot()` per base module, in call order. Checked at boot, not here. */
const unnamedCalls = new Map<Function, UnnamedCall[]>();

/** Which registration a minted module class belongs to, for reading options back. */
const byModuleClass = new Map<Function, Registration>();

function describeToken(token: RegistrationToken): string {
  return typeof token === 'symbol' ? token.toString() : `'${token}'`;
}

function listTokens(baseModule: Function): string {
  const tokens = [...(registrations.get(baseModule)?.entries() ?? [])]
    .filter(([, registration]) => registration.configured)
    .map(([token]) => describeToken(token));

  return tokens.length > 0 ? tokens.join(', ') : '(none)';
}

/**
 * The options with the two keys that name the registration rather than describe its target.
 *
 * `isGlobal` is compared on its own — it is a different kind of disagreement, with a different
 * message — and an unnamed call has no `as` by definition.
 */
function comparableOptions(options: unknown): unknown {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return options;
  }

  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
    if (key !== 'isGlobal' && key !== 'as') {
      copy[key] = value;
    }
  }

  return copy;
}

/**
 * A stable, readable description of a configuration, for comparing two calls and for printing
 * the difference back to whoever wrote them.
 *
 * Keys are sorted, so property order cannot make one configuration look like two. Non-plain
 * objects collapse to their class name: a driver handle or a custom store is not meaningfully
 * comparable and walking one risks a cycle. Two calls differing ONLY inside such a value are
 * therefore not distinguished — the check reports what it can see, and says nothing it cannot.
 */
function fingerprint(value: unknown, seen: Set<object> = new Set()): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'function') {
    return `[function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) as string;
  }
  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => fingerprint(item, seen)).join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return `[${(value as object).constructor?.name ?? 'object'}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, item]) => `${key}:${fingerprint(item, seen)}`);

  return `{${entries.join(',')}}`;
}

/**
 * Where the `forRoot()` that reached us was written.
 *
 * Frames from this file are ours, and a frame named `forRoot` is the module's own static method
 * — `registerModule` exists to be called from one. What is left is the user's call, the only
 * address they can act on. A runtime that inlines the `forRoot` frame away lands on the same
 * answer, which is why this skips by NAME rather than by counting.
 *
 * Stacks are best-effort. When the shape is not what we expect, say so rather than print a frame
 * that means something else.
 */
function captureCallSite(): string {
  const stack = new Error().stack;
  if (stack === undefined) {
    return 'unknown location';
  }

  const caller = stack.split('\n')
    .slice(1)
    .find((frame) => !frame.includes('registration.ts') && !/^\s*at\s+(?:\S+\.)?forRoot\b/.test(frame));
  const location = caller?.match(/\(?([^()\s]+:\d+:\d+)\)?\s*$/)?.[1];

  return location ?? 'unknown location';
}

/**
 * Register a configuration of a dynamic module.
 *
 * Called from the module's own `forRoot()`. Returns the class to put in `imports`.
 *
 * @param baseModule - The module class being configured, e.g. `DrizzleModule`.
 * @param options - Whatever `forRoot()` was given; stored verbatim.
 * @param token - Names this registration, so `forFeature(token)` can select it.
 * @param providers - The providers the minted module declares and exports.
 * @param ambient - Whether this call leaves the module ambiently visible, i.e. `isGlobal !== false`.
 *   Only the calling module knows its own options shape. Omitting it means the unnamed calls are
 *   compared on configuration alone.
 */
export function registerModule(
  baseModule: Function,
  options: unknown,
  token: RegistrationToken | undefined,
  providers: Function[],
  ambient?: boolean,
): Function {
  if (token === undefined) {
    const calls = unnamedCalls.get(baseModule) ?? [];
    calls.push({ ambient, fingerprint: fingerprint(comparableOptions(options)), callSite: captureCallSite() });
    unnamedCalls.set(baseModule, calls);

    // The unnamed registration keeps the base module itself as its identity, so an
    // application with one configuration is byte-for-byte what it was before registrations
    // existed: same class in `imports`, same globality, same ambient resolution.
    const registration: Registration = {
      moduleClass: baseModule, options, baseModule, configured: true, providers,
    };
    defaultRegistrations.set(baseModule, registration);
    byModuleClass.set(baseModule, registration);

    return baseModule;
  }

  const registration = getOrCreate(baseModule, token, providers);
  if (registration.configured) {
    const error = new Error(
      `Module ${baseModule.name} is already registered under ${describeToken(token)}. ` +
      'A registration token names one configuration; registering it twice would silently ' +
      'replace the first, which is the defect registrations exist to prevent. Use a ' +
      'different token, or call forRoot() once.',
    );
    error.name = 'OneBunDuplicateRegistrationError';
    throw error;
  }

  registration.options = options;
  registration.configured = true;

  return registration.moduleClass;
}

/**
 * The registration for a (module, token) pair, created on first mention.
 *
 * Either side may come first. A feature module calling `forFeature(TOKEN)` is evaluated
 * BEFORE the root module that calls `forRoot({ as: TOKEN })` — decorators run in file order
 * and the feature file is imported first — so resolving eagerly against a registry the root
 * has not filled yet is impossible. Deriving the identity from the pair lets whichever runs
 * first create it; `forRoot()` then attaches the options, and a registration that never gets
 * them is reported at boot rather than guessed at.
 */
function getOrCreate(
  baseModule: Function,
  token: RegistrationToken,
  providers: Function[],
): Registration {
  const forBase = registrations.get(baseModule) ?? new Map<RegistrationToken, Registration>();
  const existing = forBase.get(token);
  if (existing) {
    if (existing.providers.length === 0 && providers.length > 0) {
      existing.providers = providers;
    }

    return existing;
  }

  const label = typeof token === 'symbol'
    ? (token.description ?? 'anonymous')
    : token;
  const moduleClass = class {};
  Object.defineProperty(moduleClass, 'name', {
    value: `${baseModule.name}_${label.replace(/[^\w$]/g, '_')}`,
    configurable: true,
  });

  // Deliberately NOT @Global(): ambient visibility is what would put two instances of one
  // service class into the single shared scope slot.
  Module({ providers, exports: providers })(moduleClass as never);

  const registration: Registration = {
    moduleClass, options: undefined, baseModule, configured: false, providers,
  };
  forBase.set(token, registration);
  registrations.set(baseModule, forBase);
  byModuleClass.set(moduleClass, registration);

  return registration;
}

/**
 * Select a registration for import into a feature module.
 *
 * With no token: the unnamed registration when there is one, otherwise the sole named one.
 * Ambiguity is an error rather than a guess — picking one silently is how a feature ends up
 * talking to the wrong database.
 */
export function selectRegistration(
  baseModule: Function,
  token?: RegistrationToken,
  providers?: Function[],
): Function {
  if (token !== undefined) {
    // Created on first mention, from either side — see getOrCreate. Whether it was ever
    // CONFIGURED is checked at boot, in assertRegistrationsConfigured, because at this point
    // the root module that calls forRoot() may not have been evaluated yet.
    return getOrCreate(baseModule, token, providers ?? []).moduleClass;
  }

  const fallback = defaultRegistrations.get(baseModule);
  if (fallback) {
    return fallback.moduleClass;
  }

  const named = [...(registrations.get(baseModule)?.entries() ?? [])]
    .filter(([, registration]) => registration.configured);
  if (named.length === 1) {
    return named[0][1].moduleClass;
  }

  if (named.length > 1) {
    const error = new Error(
      `${baseModule.name}.forFeature() is ambiguous: ${named.length} registrations exist ` +
      `(${listTokens(baseModule)}) and none of them is the default. ` +
      'Name the one this module needs — forFeature(<token>).',
    );
    error.name = 'OneBunAmbiguousRegistrationError';
    throw error;
  }

  // No registration at all: fall back to the base module, which is what an application that
  // never called forRoot() has always imported.
  return baseModule;
}

/**
 * The options a registration was configured with, for the module class that carries it.
 *
 * This is what lets a service read ITS OWN configuration instead of the class-static slot
 * every registration in the process shares.
 */
export function getRegistrationOptions<T>(moduleClass: Function): T | undefined {
  return byModuleClass.get(moduleClass)?.options as T | undefined;
}

/**
 * Whether a module class is a minted registration rather than a base module.
 */
export function isRegistrationModule(moduleClass: Function): boolean {
  const registration = byModuleClass.get(moduleClass);

  return registration !== undefined && registration.moduleClass !== registration.baseModule;
}

/**
 * The base module a registration was minted from, or the class itself.
 */
export function getRegistrationBase(moduleClass: Function): Function {
  return byModuleClass.get(moduleClass)?.baseModule ?? moduleClass;
}

/**
 * Forget every registration.
 *
 * `forRoot()` runs at module-evaluation time, so the registry cannot be per application and
 * a test suite needs a way back to a clean process.
 * @internal
 */
export function resetRegistrations(): void {
  registrations.clear();
  defaultRegistrations.clear();
  byModuleClass.clear();
  unnamedCalls.clear();
}

/**
 * Every module reachable from a root's import graph, the root included.
 *
 * The unnamed registration keeps the base module itself as its identity, so a base module in
 * this set is one this application actually imports — which is what makes the conflict check
 * below able to stay silent about a module the application never mentioned.
 */
function collectReachableModules(rootModule: Function): Set<Function> {
  const visited = new Set<Function>();

  const walk = (moduleClass: Function): void => {
    if (visited.has(moduleClass)) {
      return;
    }
    visited.add(moduleClass);

    for (const imported of getModuleMetadata(moduleClass)?.imports ?? []) {
      walk(imported);
    }
  };

  walk(rootModule);

  return visited;
}

/** Trim a fingerprint for an error message: enough to see the difference, not a wall of JSON. */
function abbreviate(text: string): string {
  const limit = 200;

  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function conflictingUnnamedCallsError(
  baseModule: Function,
  rootModule: Function,
  first: UnnamedCall,
  later: UnnamedCall,
  ambientDiffers: boolean,
): Error {
  const detail = ambientDiffers
    ? [
      `  first   isGlobal: ${String(first.ambient)}   at ${first.callSite}`,
      `  second  isGlobal: ${String(later.ambient)}   at ${later.callSite}`,
    ]
    : [
      `  first   at ${first.callSite}`,
      `          ${abbreviate(first.fingerprint)}`,
      `  second  at ${later.callSite}`,
      `          ${abbreviate(later.fingerprint)}`,
    ];

  const cause = ambientDiffers
    ? 'Ambient visibility is process-wide state keyed by the module class, so the call evaluated ' +
      'last decides for every application: one of them boots with a service it never asked for, ' +
      'or fails to resolve one it did.'
    : 'An unnamed registration is identified by the module class itself, so the call evaluated ' +
      'last replaced the first for every application: two services configured differently end up ' +
      'talking to the same target.';

  const error = new Error(
    `${baseModule.name}.forRoot() was called more than once in this process, with ` +
    `${ambientDiffers ? 'different ambient visibility' : 'a different configuration'}, and ` +
    `${rootModule.name} imports ${baseModule.name}.\n` +
    `${cause}\n` +
    `${detail.join('\n')}\n` +
    'Name the configurations so each keeps its own identity: ' +
    `${baseModule.name}.forRoot({ ..., as: TOKEN }) where it is configured, and ` +
    `${baseModule.name}.forFeature(TOKEN) in the modules that need it. A registration token is ` +
    'the supported way to configure one module twice in a single process.',
  );
  error.name = 'OneBunConflictingRegistrationError';

  return error;
}

/**
 * Fail when two unnamed `forRoot()` calls disagree about a module this application imports.
 *
 * Deliberately at BOOT rather than at the second `forRoot()`: the defect is "an application was
 * wired on an answer it did not declare", and that is what boot-with-reachability describes. A
 * throw at registration time is broader than the defect — it fails a process that merely imports
 * two module graphs and boots neither, which is the ordinary shape of a test suite.
 *
 * Reachability is why an options comparison is affordable here at all. Comparing configurations
 * at registration time would fire on every process that configures the same module twice; here it
 * only fires when an application actually boots with the contested module in its graph.
 */
function assertUnnamedRegistrationsAgree(rootModule: Function): void {
  if (unnamedCalls.size === 0) {
    return;
  }

  const reachable = collectReachableModules(rootModule);
  for (const [baseModule, calls] of unnamedCalls) {
    if (calls.length < 2 || !reachable.has(baseModule)) {
      continue;
    }

    const [first] = calls;
    for (const later of calls.slice(1)) {
      // `undefined` on either side means that caller did not report globality, which is not the
      // same as reporting agreement — comparing it would invent a disagreement out of silence.
      const ambientDiffers = first.ambient !== undefined
        && later.ambient !== undefined
        && first.ambient !== later.ambient;

      if (ambientDiffers || first.fingerprint !== later.fingerprint) {
        throw conflictingUnnamedCallsError(baseModule, rootModule, first, later, ambientDiffers);
      }
    }
  }
}

/**
 * Fail on any registration that was selected but never configured.
 *
 * `forFeature(TOKEN)` creates the registration if it is the first mention, so a typo in the
 * token, or a missing `forRoot()`, produces an empty registration rather than an immediate
 * error. This is where that is caught — at boot, before anything is constructed, with the
 * call that is missing named.
 *
 * @param rootModule - The module this application is booting. Given one, two unnamed `forRoot()`
 *   calls that disagree about a module in its graph are refused here too. Without one there is
 *   nothing for a module to be reachable FROM, so that check is skipped rather than widened to
 *   the whole process.
 */
export function assertRegistrationsConfigured(rootModule?: Function): void {
  for (const [baseModule, forBase] of registrations) {
    for (const [token, registration] of forBase) {
      if (registration.configured) {
        continue;
      }

      const error = new Error(
        `${baseModule.name} was selected as ${describeToken(token)} but never configured. ` +
        `Call ${baseModule.name}.forRoot({ ..., as: ${describeToken(token)} }) in the module ` +
        `that owns the configuration. Configured: ${listTokens(baseModule)}.`,
      );
      error.name = 'OneBunUnconfiguredRegistrationError';
      throw error;
    }
  }

  if (rootModule !== undefined) {
    assertUnnamedRegistrationsAgree(rootModule);
  }
}

/**
 * The module class registered under a token, for `@Inject(TOKEN)`.
 *
 * `provider` disambiguates when two different base modules use the same token string — the
 * one that actually provides the requested service wins, and only a genuinely undecidable
 * token returns undefined.
 */
export function findRegistrationModule(
  token: RegistrationToken,
  provider?: Function,
): Function | undefined {
  const matches: Registration[] = [];
  for (const forBase of registrations.values()) {
    const registration = forBase.get(token);
    if (registration) {
      matches.push(registration);
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length === 1) {
    return matches[0].moduleClass;
  }

  const byProvider = provider
    ? matches.filter((registration) => registration.providers.includes(provider))
    : [];

  return byProvider.length === 1 ? byProvider[0].moduleClass : undefined;
}

/**
 * Every token configured for a base module, for error messages.
 * @internal
 */
export function describeRegistrationToken(token: RegistrationToken): string {
  return describeToken(token);
}

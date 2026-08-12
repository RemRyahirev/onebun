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

import { Module } from '../decorators/decorators';

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
}

/** Every registration in the process, keyed by base module and then by token. */
const registrations = new Map<Function, Map<RegistrationToken, Registration>>();

/** The unnamed registration per base module, if `forRoot()` was called without `as`. */
const defaultRegistrations = new Map<Function, Registration>();

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
 * Register a configuration of a dynamic module.
 *
 * Called from the module's own `forRoot()`. Returns the class to put in `imports`.
 *
 * @param baseModule - The module class being configured, e.g. `DrizzleModule`.
 * @param options - Whatever `forRoot()` was given; stored verbatim.
 * @param token - Names this registration, so `forFeature(token)` can select it.
 * @param providers - The providers the minted module declares and exports.
 */
export function registerModule(
  baseModule: Function,
  options: unknown,
  token: RegistrationToken | undefined,
  providers: Function[],
): Function {
  if (token === undefined) {
    // The unnamed registration keeps the base module itself as its identity, so an
    // application with one configuration is byte-for-byte what it was before registrations
    // existed: same class in `imports`, same globality, same ambient resolution.
    const registration: Registration = {
      moduleClass: baseModule, options, baseModule, configured: true,
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
    moduleClass, options: undefined, baseModule, configured: false,
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
}

/**
 * Fail on any registration that was selected but never configured.
 *
 * `forFeature(TOKEN)` creates the registration if it is the first mention, so a typo in the
 * token, or a missing `forRoot()`, produces an empty registration rather than an immediate
 * error. This is where that is caught — at boot, before anything is constructed, with the
 * call that is missing named.
 */
export function assertRegistrationsConfigured(): void {
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
}

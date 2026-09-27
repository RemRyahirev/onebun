/**
 * Base error for framework bootstrap failures.
 * Thrown when the application cannot start due to configuration or wiring issues.
 *
 * @see docs:api/services.md
 */
export class OneBunBootstrapError extends Error {
  override name = 'OneBunBootstrapError';
}

/**
 * Thrown when a required dependency cannot be resolved during DI.
 * Includes diagnostic suggestions: which module has the provider,
 * whether it's exported, and whether the module is imported.
 *
 * Also thrown when a provider waits for a provider of its own module that was never
 * constructed because no `@Service()` is visible on it to this copy of the framework. That is
 * not a cycle, so it is not reported as a `CircularDependencyError`. A provider whose
 * constructor throws is never reported here: that ends the boot with a
 * {@link ServiceConstructionError} at the throw.
 *
 * @see docs:api/services.md
 */
export class DependencyResolutionError extends OneBunBootstrapError {
  override name = 'DependencyResolutionError';

  constructor(
    public readonly targetName: string,
    public readonly dependencyName: string,
    public readonly targetType: 'service' | 'controller' | 'middleware' | 'interceptor' | 'guard' | 'filter',
    public readonly suggestions: string[],
  ) {
    const msg = `Could not resolve dependency ${dependencyName} for ${targetType} ${targetName}.`;
    const hints = suggestions.length > 0
      ? '\n' + suggestions.map((s) => `  - ${s}`).join('\n')
      : '\n  - Ensure it is decorated with @Service() and provided in this module.';
    super(msg + hints);
  }
}

/**
 * Thrown when a circular dependency is detected during module initialization.
 * The framework does not support circular dependencies — bootstrap will fail
 * with a clear error message showing the dependency chain. `chain` names only the
 * cycle itself; a provider that merely waits on it is listed in `unresolvedServices`.
 * An acyclic graph never produces this error, whatever the order of its `providers`.
 *
 * `notes` explains a link of the chain the classes do not show: a decorated class in the chain
 * that declares no constructor is injected with the parameters of the constructor it inherits, so
 * its dependency is named by its parent. Each note is listed after the services, one per line.
 *
 * @see docs:api/services.md
 * @see docs:api/decorators.md
 */
export class CircularDependencyError extends OneBunBootstrapError {
  override name = 'CircularDependencyError';

  constructor(
    public readonly moduleName: string,
    public readonly chain: string,
    public readonly unresolvedServices: string[],
    public readonly notes: string[] = [],
  ) {
    super(
      `Circular dependency detected in module ${moduleName}!\n` +
        `Dependency chain: ${chain}\n` +
        `Unresolved services: ${unresolvedServices.join(', ')}` +
        notes.map((note) => `\n  - ${note}`).join(''),
    );
  }
}

/**
 * `Name: message` for a thrown `Error`, the way `String(error)` renders one, and a plain string
 * for anything else that was thrown — including a value whose own `toString` throws.
 */
function describeThrown(value: unknown): string {
  if (value instanceof Error) {
    return value.message === '' ? value.name : `${value.name}: ${value.message}`;
  }
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * The `at ...` frames of a thrown error's stack, without its header — whose message can span
 * several lines, so it is not simply the first one. Empty for a thrown non-`Error`, or a stack
 * in a format with no such frames.
 */
function stackFrames(value: unknown): string[] {
  if (!(value instanceof Error) || typeof value.stack !== 'string') {
    return [];
  }

  return value.stack.split('\n').filter((line) => /^\s+at /.test(line));
}

/**
 * Thrown when the constructor of a `@Service()` provider throws while its module is initialized.
 * A throw from the step the framework runs on the new instance right after its constructor — the
 * `initializeService()` it calls on a provider that defines one, or applying auto-tracing — is
 * reported the same way; 0.8.x swallowed those as well.
 *
 * The boot ends at the throw, whether or not anything injects the provider — an `@Optional()`
 * consumer included. The message names the service and its module, then gives the original
 * error's type and message. `cause` is the thrown value itself, unchanged, and `stack` carries
 * its frames, so the first frame points at the line of the constructor that threw rather than
 * at the framework.
 *
 * Before 0.9.0 the error was logged and the service dropped: a consumer then failed with a
 * `DependencyResolutionError` naming a dependency that is registered correctly, an `@Optional()`
 * consumer got `undefined`, and with no consumer the application booted without the service.
 *
 * A framework bootstrap error thrown from a constructor — a `OneBunBootstrapError`, or an error
 * whose `name` starts with `OneBun` — is not wrapped: it already names what is wrong.
 *
 * @see docs:api/services.md
 */
export class ServiceConstructionError extends OneBunBootstrapError {
  override name = 'ServiceConstructionError';

  constructor(
    public readonly serviceName: string,
    public readonly moduleName: string,
    cause: unknown,
  ) {
    super(`Failed to create service ${serviceName} in module ${moduleName}: ${describeThrown(cause)}`, { cause });
    const frames = stackFrames(cause);
    if (frames.length > 0) {
      this.stack = `${this.name}: ${this.message}\n${frames.join('\n')}`;
    }
  }
}

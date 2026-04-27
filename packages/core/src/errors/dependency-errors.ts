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
 * @see docs:api/services.md
 */
export class DependencyResolutionError extends OneBunBootstrapError {
  override name = 'DependencyResolutionError';

  constructor(
    public readonly targetName: string,
    public readonly dependencyName: string,
    public readonly targetType: 'service' | 'controller' | 'middleware' | 'interceptor',
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
 * with a clear error message showing the dependency chain.
 *
 * @see docs:api/services.md
 */
export class CircularDependencyError extends OneBunBootstrapError {
  override name = 'CircularDependencyError';

  constructor(
    public readonly moduleName: string,
    public readonly chain: string,
    public readonly unresolvedServices: string[],
  ) {
    super(
      `Circular dependency detected in module ${moduleName}!\n` +
        `Dependency chain: ${chain}\n` +
        `Unresolved services: ${unresolvedServices.join(', ')}`,
    );
  }
}

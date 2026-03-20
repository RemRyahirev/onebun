import type { EnvLoadOptions, EnvSchema } from './types';

import { EnvLoader } from './loader';
import { ConfigProxy } from './typed-env';

// Cache: schema reference -> ConfigProxy instance
// WeakMap so schemas can be garbage collected
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configCache = new WeakMap<object, ConfigProxy<any>>();

/**
 * Synchronously load and parse environment configuration from schema.
 * Returns a fully initialized ConfigProxy with .get(), .values, .getSafeConfig().
 *
 * Uses readFileSync for .env file loading, so it works before application bootstrap.
 * Results are cached per schema reference — calling getConfig() twice with the same
 * schema object returns the same ConfigProxy instance.
 *
 * @example
 * ```typescript
 * import { getConfig } from '@onebun/core';
 * import { envSchema, type AppConfig } from './config';
 *
 * const config = getConfig<AppConfig>(envSchema);
 * const port = config.get('server.port'); // typed!
 *
 * const app = new OneBunApplication(AppModule, {
 *   envSchema,
 *   cors: { origin: config.get('server.corsOrigin') },
 * });
 * ```
 */
export function getConfig<T>(
  schema: EnvSchema<T>,
  options: EnvLoadOptions = {},
): ConfigProxy<T> {
  const cached = configCache.get(schema);
  if (cached) {
    return cached as ConfigProxy<T>;
  }

  const rawVariables = EnvLoader.loadSync(options);
  const proxy = new ConfigProxy<T>(schema, options);
  proxy.initializeSync(rawVariables);

  configCache.set(schema, proxy);

  return proxy;
}

/**
 * Clear getConfig cache (for testing)
 */
export function clearGetConfigCache(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configCache = new WeakMap<object, ConfigProxy<any>>();
}

import { Effect, pipe } from 'effect';

import type {
  AuthConfig,
  OneBunAuthConfig,
  RequestConfig,
} from './types.js';

/**
 * Apply authentication to request configuration
 */
export const applyAuth = (
  auth: AuthConfig,
  config: RequestConfig,
): Effect.Effect<RequestConfig, Error> => {
  switch (auth.type) {
    case 'bearer':
      return Effect.succeed({
        ...config,
        headers: {
          ...config.headers,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: `Bearer ${auth.token}`,
        },
      });

    case 'apikey':
      if (auth.location === 'query') {
        return Effect.succeed({
          ...config,
          query: {
            ...config.query,
            [auth.key]: auth.value,
          },
        });
      } else {
        return Effect.succeed({
          ...config,
          headers: {
            ...config.headers,
            [auth.key]: auth.value,
          },
        });
      }

    case 'basic': {
      const credentials = btoa(`${auth.username}:${auth.password}`);

      return Effect.succeed({
        ...config,
        headers: {
          ...config.headers,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: `Basic ${credentials}`,
        },
      });
    }

    case 'custom':
      return pipe(
        Effect.succeed({ ...config } as RequestConfig),
        Effect.map((updatedConfig: RequestConfig) => {
          // Apply custom headers
          if (auth.headers) {
            updatedConfig.headers = {
              ...updatedConfig.headers,
              ...auth.headers,
            };
          }

          // Apply custom query parameters
          if (auth.query) {
            updatedConfig.query = {
              ...updatedConfig.query,
              ...auth.query,
            };
          }

          return updatedConfig;
        }),
        Effect.flatMap((updatedConfig: RequestConfig) => {
          // Apply custom interceptor
          if (auth.interceptor) {
            return Effect.tryPromise({
              try: () => Promise.resolve(auth.interceptor!(updatedConfig)),
              catch: (error) => new Error(`Auth interceptor failed: ${error}`),
            });
          }

          return Effect.succeed(updatedConfig);
        }),
      );

    case 'onebun':
      // Deliberately a no-op here. `onebun` is the one scheme that signs the request, and a
      // signature has to cover what is FINAL — the URL with its query built, the Content-Type
      // that will be sent, the exact body bytes. None of that exists yet at this point in the
      // pipeline, which is precisely how the old implementation came to sign a path with no
      // query and no body. Signing happens in `client.ts`, per attempt, over the assembled
      // request. See `signOneBunRequest`.
      return Effect.succeed(config);

    default:
      return Effect.succeed(config);
  }
};

/**
 * Whether this scheme SIGNS the request rather than shaping it.
 *
 * The distinction drives the pipeline order: shaping schemes (`bearer`, `apikey`, `basic`,
 * `custom`) run before the URL is built, signing runs after, over what is final. Getting that
 * backwards is what made `apikey` in query mode a silent no-op — the key was added to
 * `config.query` one line after the URL had already been assembled from it — and what left the
 * HMAC signature covering neither the query string nor the body.
 *
 * A type predicate, so a caller that branches on it gets the narrowed config rather than
 * re-checking `type` and hoping the two checks stay in step.
 *
 * @see docs:api/requests.md
 */
export function isSigningAuth(auth: AuthConfig): auth is OneBunAuthConfig {
  return auth.type === 'onebun';
}

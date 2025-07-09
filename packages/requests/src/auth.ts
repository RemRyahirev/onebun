import { Effect, pipe } from 'effect';

import type {
  AuthConfig,
  RequestConfig,
  OneBunAuthConfig,
} from './types.js';

/**
 * Apply authentication to request configuration
 */
export const applyAuth = (auth: AuthConfig, config: RequestConfig): Effect.Effect<RequestConfig, Error> => {
  switch (auth.type) {
    case 'bearer':
      return Effect.succeed({
        ...config,
        headers: {
          ...config.headers,
          'Authorization': `Bearer ${auth.token}`,
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

    case 'basic':
      const credentials = btoa(`${auth.username}:${auth.password}`);

      return Effect.succeed({
        ...config,
        headers: {
          ...config.headers,
          'Authorization': `Basic ${credentials}`,
        },
      });

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
      return applyOneBunAuth(auth, config);

    default:
      return Effect.succeed(config);
  }
};

/**
 * Apply OneBun framework internal authentication
 */
const applyOneBunAuth = (auth: OneBunAuthConfig, config: RequestConfig): Effect.Effect<RequestConfig, Error> => {
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const algorithm = auth.algorithm || 'hmac-sha256';

  // Create signature payload
  const payload = [
    config.method,
    config.url,
    timestamp,
    nonce,
    auth.serviceId,
  ].join('\n');

  return pipe(
    generateSignature(payload, auth.secretKey, algorithm),
    Effect.map((signature) => ({
      ...config,
      headers: {
        ...config.headers,
        'X-OneBun-Service-Id': auth.serviceId,
        'X-OneBun-Timestamp': timestamp,
        'X-OneBun-Nonce': nonce,
        'X-OneBun-Algorithm': algorithm,
        'X-OneBun-Signature': signature,
      },
    })),
  );
};

/**
 * Generate cryptographic signature for OneBun auth
 */
const generateSignature = (
  payload: string, 
  secretKey: string, 
  algorithm: 'hmac-sha256' | 'hmac-sha512',
): Effect.Effect<string, Error> => {
  return Effect.tryPromise({
    async try() {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secretKey);
      const payloadData = encoder.encode(payload);

      const algorithmName = algorithm === 'hmac-sha256' ? 'SHA-256' : 'SHA-512';

      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: algorithmName },
        false,
        ['sign'],
      );

      const signature = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);

      return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    },
    catch: (error) => new Error(`Failed to generate signature: ${error}`),
  });
};

/**
 * Generate random nonce for request uniqueness
 */
const generateNonce = (): string => {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);

  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Validate OneBun authentication headers from incoming request
 */
export const validateOneBunAuth = (
  headers: Record<string, string>,
  secretKey: string,
  maxAge: number = 300000, // 5 minutes
): Effect.Effect<{ serviceId: string; valid: boolean }, Error> => {
  const serviceId = headers['x-onebun-service-id'];
  const timestamp = headers['x-onebun-timestamp'];
  const nonce = headers['x-onebun-nonce'];
  const algorithm = headers['x-onebun-algorithm'] as 'hmac-sha256' | 'hmac-sha512';
  const signature = headers['x-onebun-signature'];

  if (!serviceId || !timestamp || !nonce || !algorithm || !signature) {
    return Effect.succeed({ serviceId: serviceId || 'unknown', valid: false });
  }

  // Check timestamp age
  const requestTime = parseInt(timestamp, 10);
  const now = Date.now();
  if (now - requestTime > maxAge) {
    return Effect.succeed({ serviceId, valid: false });
  }

  // Reconstruct payload (method and URL should be provided separately)
  const method = headers['x-onebun-method'] || 'GET';
  const url = headers['x-onebun-url'] || '/';
  
  const payload = [method, url, timestamp, nonce, serviceId].join('\n');

  // Verify signature
  return pipe(
    generateSignature(payload, secretKey, algorithm),
    Effect.map((expectedSignature) => ({
      serviceId,
      valid: signature === expectedSignature,
    })),
  );
}; 
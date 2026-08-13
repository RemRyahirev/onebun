/**
 * Security Middleware
 *
 * Built-in middleware for common security concerns: CORS, rate limiting,
 * and HTTP security headers.
 */

export {
  bindClientAddress,
  createClientAddressBinding,
  getClientAddress,
  getPeerAddress,
  type ClientAddressBinding,
  type PeerAddressSource,
} from './client-address';
export { CorsMiddleware, type CorsOptions } from './cors-middleware';
export {
  RateLimitMiddleware,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitOptions,
  type RateLimitStore,
} from './rate-limit-middleware';
export {
  SecurityHeadersMiddleware,
  type SecurityHeadersOptions,
} from './security-headers-middleware';

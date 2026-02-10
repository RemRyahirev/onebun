/**
 * Module System
 *
 * Core module, controller, service, and middleware abstractions.
 */

export * from './module';
export * from './controller';
// Re-export Controller as BaseController for backward compatibility
export { Controller as BaseController } from './controller';
export * from './middleware';
export * from './service';
export * from './config.service';
export * from './config.interface';
export * from './lifecycle';

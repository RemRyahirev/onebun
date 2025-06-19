/**
 * @onebun/trace - OpenTelemetry-compatible tracing module for OneBun framework
 * 
 * This module provides:
 * - Automatic HTTP request tracing
 * - W3C trace context propagation
 * - Effect.js integration
 * - Decorators for method tracing
 * - Custom span creation and management
 */

// Types
export type {
  TraceContext,
  TraceSpan,
  TraceEvent,
  SpanStatus,
  TraceHeaders,
  TraceOptions,
  TraceExportOptions,
  HttpTraceData,
} from './types.js';

export { SpanStatusCode } from './types.js';

// Core service
export {
  TraceService,
  TraceServiceImpl,
  makeTraceService,
  TraceServiceLive,
  CurrentTraceContext,
  CurrentSpan,
} from './trace.service.js';

// Middleware and decorators
export {
  TraceMiddleware,
  createTraceMiddleware,
  Trace,
  Span,
} from './middleware.js';

// Re-export some OpenTelemetry types for convenience
export type { Context } from '@opentelemetry/api'; 
/**
 * \@onebun/trace - OpenTelemetry-compatible tracing module for OneBun framework
 *
 * This module provides:
 * - Automatic HTTP request tracing
 * - W3C trace context propagation
 * - Effect.js integration
 * - Decorators for method tracing
 * - Custom span creation and management
 */

// Re-export some OpenTelemetry types for convenience
export type { Context } from '@opentelemetry/api';
// Middleware and decorators
export {
  createTraceMiddleware,
  Span,
  span,
  // Backward compatibility aliases
  Trace,
  TraceMiddleware,
  trace,
} from './middleware.js';

// Core service
export {
  currentSpan,
  currentTraceContext,
  makeTraceService,
  // Backward compatibility aliases
  TraceService,
  TraceServiceImpl,
  TraceServiceLive,
  traceService,
  traceServiceLive,
} from './trace.service.js';
// Types
export type {
  HttpTraceData,
  SpanStatus,
  TraceContext,
  TraceEvent,
  TraceExportOptions,
  TraceHeaders,
  TraceOptions,
  TraceSpan,
} from './types.js';
export { SpanStatusCode } from './types.js';

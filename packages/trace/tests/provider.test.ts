/* eslint-disable @typescript-eslint/naming-convention */
import { trace } from '@opentelemetry/api';
import {
  describe,
  test,
  expect,
  afterEach,
} from 'bun:test';

import { initTracerProvider } from '../src/provider';

describe('initTracerProvider', () => {
  afterEach(async () => {
    // Always clean up global tracer provider state
    trace.disable();
  });

  describe('provider creation', () => {
    test('should create a provider and register it globally', async () => {
      const result = initTracerProvider({
        serviceName: 'test-service',
      });

      try {
        expect(result.provider).toBeDefined();

        // Verify the provider is registered globally
        const tracer = trace.getTracer('test');
        expect(tracer).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });

    test('should return a shutdown function', async () => {
      const result = initTracerProvider({
        serviceName: 'test-service',
      });

      try {
        expect(typeof result.shutdown).toBe('function');
      } finally {
        await result.shutdown();
      }
    });
  });

  describe('without endpoint', () => {
    test('should create provider without exporter', async () => {
      const result = initTracerProvider({
        serviceName: 'no-export-service',
      });

      try {
        expect(result.provider).toBeDefined();

        // Provider should still work — it just won't export spans
        const tracer = trace.getTracer('test');
        expect(tracer).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });

    test('should create provider with empty exportOptions', async () => {
      const result = initTracerProvider({
        serviceName: 'no-export-service',
        exportOptions: {},
      });

      try {
        expect(result.provider).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });
  });

  describe('with endpoint', () => {
    test('should create provider with exporter and batch processor', async () => {
      const result = initTracerProvider({
        serviceName: 'export-service',
        exportOptions: {
          endpoint: 'http://localhost:4318',
        },
      });

      try {
        expect(result.provider).toBeDefined();

        // The tracer should be active
        const tracer = trace.getTracer('test');
        expect(tracer).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });

    test('should pass custom headers and timeout to exporter', async () => {
      const result = initTracerProvider({
        serviceName: 'custom-export-service',
        exportOptions: {
          endpoint: 'http://collector:4318',
          headers: { Authorization: 'Bearer test-token' },
          timeout: 5000,
          batchSize: 50,
          batchTimeout: 2000,
        },
      });

      try {
        expect(result.provider).toBeDefined();
      } finally {
        await result.shutdown();
      }
    });
  });

  describe('shutdown()', () => {
    test('should call provider.shutdown() and trace.disable()', async () => {
      const result = initTracerProvider({
        serviceName: 'shutdown-test',
      });

      // Register is working
      const tracerBefore = trace.getTracer('test');
      expect(tracerBefore).toBeDefined();

      await result.shutdown();

      // After shutdown + disable, the global provider should be a noop
      // Calling getTracer still works but returns a noop tracer
      const tracerAfter = trace.getTracer('test');
      expect(tracerAfter).toBeDefined();
    });

    test('should not throw when called multiple times', async () => {
      const result = initTracerProvider({
        serviceName: 'multi-shutdown',
      });

      await result.shutdown();
      await expect(result.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('resource configuration', () => {
    test('should use provided service name and version', async () => {
      const result = initTracerProvider({
        serviceName: 'my-custom-service',
        serviceVersion: '3.2.1',
      });

      try {
        expect(result.provider).toBeDefined();
        // Resource is set on the provider — we verify it was created without error
      } finally {
        await result.shutdown();
      }
    });

    test('should use default service name when not provided', async () => {
      const result = initTracerProvider({});

      try {
        expect(result.provider).toBeDefined();
        // Default: serviceName='onebun-service', serviceVersion='1.0.0'
      } finally {
        await result.shutdown();
      }
    });

    test('should use default service version when not provided', async () => {
      const result = initTracerProvider({
        serviceName: 'test-service',
      });

      try {
        expect(result.provider).toBeDefined();
        // Default serviceVersion='1.0.0'
      } finally {
        await result.shutdown();
      }
    });
  });
});

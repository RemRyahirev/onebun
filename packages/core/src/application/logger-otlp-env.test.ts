/**
 * OTLP log export configured by environment variable alone.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` exist so that one image
 * can be promoted from dev to staging to prod with observability switched on by injection. The
 * fallback that reads them lives inside `makeLoggerFromOptions`, and the application called that
 * only when `loggerOptions` was present — so setting either variable and nothing else did
 * nothing whatsoever, silently.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';

import { shutdownLogger } from '@onebun/logger';

import { Module } from '../decorators';

import { OneBunApplication } from './application';

@Module({})
class EmptyModule {}

const HTTP_OK = 200;

describe('OTLP logging enabled by the environment', () => {
  const originalFetch = globalThis.fetch;
  const originalLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const originalServiceName = process.env.OTEL_SERVICE_NAME;

  let posted: Array<{ url: string; body: string }>;

  beforeEach(() => {
    posted = [];
    // Installed before the application is constructed: `OtlpLogTransport` captures
    // `globalThis.fetch` in its constructor, so a later swap would never be seen.
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      posted.push({ url: String(url), body: init.body as string });

      return new Response('{}', { status: HTTP_OK });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
  });

  afterEach(async () => {
    await shutdownLogger();
    globalThis.fetch = originalFetch;

    for (const [name, value] of [
      ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', originalLogsEndpoint],
      ['OTEL_EXPORTER_OTLP_ENDPOINT', originalEndpoint],
      ['OTEL_SERVICE_NAME', originalServiceName],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('ships records to the collector when only the variable is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';

    const app = new OneBunApplication(EmptyModule, { tracing: { enabled: false }, metrics: { enabled: false } });
    app.getLogger().info('reached the collector');

    await shutdownLogger();

    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe('http://collector:4318/v1/logs');
    expect(posted[0].body).toContain('reached the collector');
  });

  it('names the service on the env path, not only on the explicit-endpoint one', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';

    const app = new OneBunApplication(EmptyModule, {
      tracing: { enabled: false, serviceName: 'orders', serviceVersion: '2.4.0' },
      metrics: { enabled: false },
    });
    app.getLogger().info('attributable record');

    await shutdownLogger();

    // Records that arrive with an empty resource cannot be attributed to a service, and telling
    // the services apart is most of what a log backend is for.
    const payload = JSON.parse(posted[0].body);
    const attributes = payload.resourceLogs[0].resource.attributes as Array<{
      key: string;
      value: { stringValue: string };
    }>;

    expect(attributes.find((a) => a.key === 'service.name')?.value.stringValue).toBe('orders');
    expect(attributes.find((a) => a.key === 'service.version')?.value.stringValue).toBe('2.4.0');
  });

  it('falls back to OTEL_SERVICE_NAME when nothing names the service in code', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.OTEL_SERVICE_NAME = 'injected-name';

    const app = new OneBunApplication(EmptyModule, { tracing: { enabled: false }, metrics: { enabled: false } });
    app.getLogger().info('named by injection');

    await shutdownLogger();

    const payload = JSON.parse(posted[0].body);
    const attributes = payload.resourceLogs[0].resource.attributes as Array<{
      key: string;
      value: { stringValue: string };
    }>;

    expect(attributes.find((a) => a.key === 'service.name')?.value.stringValue).toBe('injected-name');
  });

  it('does not build an OTLP transport when no endpoint is configured anywhere', async () => {
    const app = new OneBunApplication(EmptyModule, { tracing: { enabled: false }, metrics: { enabled: false } });
    app.getLogger().info('console only');

    await shutdownLogger();

    expect(posted).toHaveLength(0);
  });
});

import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { schema } from './config';

const app = new OneBunApplication(AppModule, {
  name: 'example', // optional, used for metrics and tracing labels
  port: 3001, // default is from PORT env or 3000
  host: '0.0.0.0', // default is from HOST env or localhost
  development: true, // default is true if NODE_ENV is not production
  envs: {
    schema,
    file: '../../.env', // look for closest .env, with priority to .env.development/.env.production
    /*
    envs always overrides .env file
    config is always strict
    dot files are optional but always try to load them
    default array separator is changeable on the exact config path in schema settings only
     */
  },
  logger: {
    level: 'info', // default is from LOG_LEVEL env or info for production and debug for development
    /*
    key `class` used to instantiate custom logger instead of built-in
    key `instance` used to use exact instance of custom logger instead of built-in
     */
  },
  metrics: {
    enabled: true, // this is default
    path: '/metrics', // this is default
    collectHttpMetrics: true, // this is default
    collectSystemMetrics: true, // this is default
    collectGcMetrics: true, // this is default
    prefix: 'example_app_', // `onebun_` by default
    httpDurationBuckets: [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600], // this is default (duration in seconds)
    systemMetricsInterval: 5000, // this is default
    defaultLabels: {
      // optional custom static labels
      app: 'example', // this is default if `name` specified and it's `example`
    },
  },
  tracing: {
    enabled: true, // this is default
    serviceName: 'example', // default is `onebun-app` but it would be same as `name` option if it's specified
    serviceVersion: '0.1.0', // default is from package.json
    samplingRate: 1.0, // this is default
    traceHttpRequests: true, // this is default
    traceDatabaseQueries: true, // this is default
    defaultAttributes: {
      'service.name': 'example', // same as `serviceName` option by default
      'service.version': '0.1.0', // same as `serviceVersion` option by default
      'deployment.environment': 'development', // this is default if `development` option is true, `production` otherwise
    },
    exportOptions: {
      /*
      endpoint
      headers
      timeout
      batchSize
      batchTimeout

      and any other options from otl exporter to push traces into something like jaeger or signoz
       */
    },
  },
});

// TODO: swagger, validation, cors

const logger = app.getLogger({ className: 'AppBootstrap' });
app
  .start()
  .then(() => {
    logger.info('Application started successfully and listen to', app.getHttpUrl());
  })
  .catch((error: unknown) => {
    logger.error('Failed to start application:', error);
  });

import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

// Create application with integrated configuration
const app = new OneBunApplication(AppModule, {
  port: 3001,
  host: '0.0.0.0',
  development: true,
  envSchema,
  envOptions: {
    envFilePath: '../../.env',
  },
  metrics: {
    enabled: true,
    path: '/metrics',
    collectHttpMetrics: true,
    collectSystemMetrics: true,
    collectGcMetrics: true,
    prefix: 'example_app_',
  },
  tracing: {
    enabled: true,
    serviceName: 'onebun-example',
    serviceVersion: '0.1.0',
    samplingRate: 1.0,
    traceHttpRequests: true,
    traceDatabaseQueries: true,
    defaultAttributes: {
      'service.name': 'onebun-example',
      'service.version': '0.1.0',
      'deployment.environment': 'development',
    },
  },
});

// Start the application
app.start()
  .then(() => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.info('Application started successfully');

    // Demonstrate config access from application level
    try {
      const config = app.getConfig();

      // Safe config logging
      const safeConfig = config.getSafeConfig();
      logger.info('Application configuration loaded:', { config: safeConfig });
    } catch (error) {
      logger.warn('Configuration not available:', { error: error instanceof Error ? error.message : String(error) });
    }
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error('Failed to start application:', error instanceof Error ? error : new Error(String(error)));
  });

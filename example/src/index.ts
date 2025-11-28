import { OneBunApplication } from '@onebun/core';
// For multi-service setup, uncomment the following:
// import { MultiServiceApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

/**
 * Default development server port
 */
const DEFAULT_DEV_PORT = 3001;

// ============================================================================
// OPTION 1: Single Application (current setup)
// ============================================================================

// Create application with integrated configuration
const app = new OneBunApplication(AppModule, {
  port: DEFAULT_DEV_PORT,
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
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'service.name': 'onebun-example',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'service.version': '0.1.0',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'deployment.environment': 'development',
    },
  },
});

// Start the application
app
  .start()
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
      logger.warn('Configuration not available:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error(
      'Failed to start application:',
      error instanceof Error ? error : new Error(String(error)),
    );
  });

// ============================================================================
// OPTION 2: Multi-Service Application
// Uncomment and modify for running multiple services in one process
// ============================================================================
/*
import { MultiServiceApplication } from '@onebun/core';

const multiApp = new MultiServiceApplication({
  services: {
    main: {
      module: AppModule,
      port: 3001,
    },
    // Add more services here:
    // users: {
    //   module: UsersModule,
    //   port: 3002,
    //   envOverrides: {
    //     DB_NAME: { fromEnv: 'USERS_DB_NAME' },
    //   },
    // },
    // orders: {
    //   module: OrdersModule,
    //   port: 3003,
    //   envOverrides: {
    //     DB_NAME: { value: 'orders_db' },
    //   },
    // },
  },
  envSchema,
  envOptions: {
    envFilePath: '../../.env',
  },
  metrics: {
    enabled: true,
    prefix: 'example_app_',
  },
  tracing: {
    enabled: true,
  },
  // Filter which services to start (optional):
  // enabledServices: ['main', 'users'],
  // excludedServices: ['orders'],
  // 
  // External URLs for services not running in this process:
  // externalServiceUrls: {
  //   payments: 'http://payments-service:3004',
  // },
});

multiApp
  .start()
  .then(() => {
    const logger = multiApp.getLogger();
    logger.info('Multi-service application started');
    logger.info('Running services:', multiApp.getRunningServices());
  })
  .catch((error: unknown) => {
    console.error('Failed to start multi-service application:', error);
  });
*/

import { getConfig, MultiServiceApplication } from '@onebun/core';

import { type AppConfig, envSchema } from './config';
import { OrderModule } from './orders/orders.module';
import { UserModule } from './users/users.module';

const config = getConfig<AppConfig>(envSchema);

const app = new MultiServiceApplication({
  services: {
    users: {
      module: UserModule,
      port: config.get('users.port'),
      routePrefix: true,
      metrics: {
        prefix: 'users_',
      },
      tracing: {
        serviceName: 'users-service',
      },
    },
    orders: {
      module: OrderModule,
      port: config.get('orders.port'),
      routePrefix: true,
      envOverrides: {
        'database.url': { fromEnv: 'ORDERS_DATABASE_URL' },
      },
      metrics: {
        prefix: 'orders_',
      },
      tracing: {
        serviceName: 'orders-service',
      },
    },
  },
  envSchema,
  envOptions: {
    loadDotEnv: true,
  },
  // URLs for services when they run in separate processes
  // Used by app.getServiceUrl() for inter-service communication
  externalServiceUrls: {
    users: process.env.USERS_SERVICE_URL,
    orders: process.env.ORDERS_SERVICE_URL,
  },
  metrics: {
    enabled: true,
  },
  tracing: {
    enabled: true,
  },
});

app.start().then(() => {
  const logger = app.getLogger();
  logger.info('Multi-service application started');
  logger.info('Running services:', app.getRunningServices());
  logger.info(`Users service: ${app.getServiceUrl('users')}`);
  logger.info(`Orders service: ${app.getServiceUrl('orders')}`);
}).catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});

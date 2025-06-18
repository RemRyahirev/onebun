import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

// Create application
const app = new OneBunApplication(AppModule, {
  port: 3001,
  host: '0.0.0.0',
  development: true
});

// Start the application
app.start()
  .then(() => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.info('Application started successfully');
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error('Failed to start application:', error instanceof Error ? error : new Error(String(error)));
  });

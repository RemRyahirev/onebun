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
    console.log('Application started successfully');
  })
  .catch((error: unknown) => {
    console.error('Failed to start application:', error);
  });

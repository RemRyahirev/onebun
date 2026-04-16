import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true, serviceName: 'crud-api' },
});

app.start().then(() => {
  const logger = app.getLogger();
  logger.info(`CRUD API started on ${app.getHttpUrl()}`);
});

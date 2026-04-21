import { OneBunApplication, getConfig } from '@onebun/core';

import { BenchModule } from './app.module';
import { envSchema, type AppConfig } from './config';

const config = getConfig<AppConfig>(envSchema);

const app = new OneBunApplication(BenchModule, {
  envSchema,
  port: config.get('bench.port'),
  host: '0.0.0.0',
  docs: { enabled: true, title: 'Realistic Benchmark API', version: '1.0.0' },
  metrics: { enabled: false },
  tracing: { enabled: false },
});

app.start().catch((error: unknown) => {
  throw error instanceof Error ? error : new Error(String(error));
});

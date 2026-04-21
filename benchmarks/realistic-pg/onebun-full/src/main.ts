import { OneBunApplication, getConfig } from '@onebun/core';

import { BenchModule } from '../../onebun/src/app.module';
import { envSchema, type AppConfig } from '../../onebun/src/config';

const config = getConfig<AppConfig>(envSchema);

const app = new OneBunApplication(BenchModule, {
  envSchema,
  port: config.get('bench.port'),
  host: '0.0.0.0',
  docs: { enabled: true, title: 'Realistic PG Benchmark API', version: '1.0.0' },
  metrics: { enabled: true },
  tracing: { enabled: true },
});

app.start().catch((error: unknown) => {
  throw error instanceof Error ? error : new Error(String(error));
});

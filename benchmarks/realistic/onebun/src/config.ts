import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  bench: {
    port: Env.number({ default: 3300, env: 'BENCH_PORT' }),
    dbPath: Env.string({ default: './bench.db', env: 'BENCH_DB_PATH' }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}

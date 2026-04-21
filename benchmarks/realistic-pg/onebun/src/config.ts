import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  bench: {
    port: Env.number({ default: 3300, env: 'BENCH_PORT' }),
  },
  db: {
    host: Env.string({ default: 'localhost', env: 'DB_HOST' }),
    port: Env.number({ default: 5432, env: 'DB_PORT' }),
    user: Env.string({ default: 'bench', env: 'DB_USER' }),
    password: Env.string({ default: 'bench', env: 'DB_PASSWORD' }),
    database: Env.string({ default: 'bench', env: 'DB_NAME' }),
  },
  cache: {
    ttl: Env.number({ default: 30000, env: 'CACHE_TTL' }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}

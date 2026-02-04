import { Env, type InferConfigType } from '@onebun/core';

// Define environment schema using Env helpers
export const envSchema = {
  server: {
    port: Env.number({ env: 'PORT', default: 3000 }),
    host: Env.string({ env: 'HOST', default: '0.0.0.0' }),
    ssl: {
      enabled: Env.boolean({ env: 'SSL_ENABLED', default: false }),
      cert: Env.string({
        env: 'SSL_CERT',
        default: '/ssl/cert.pem',
        sensitive: true,
      }),
    },
  },
  database: {
    url: Env.string({ env: 'DATABASE_URL', required: true, sensitive: true }),
    password: Env.string({
      env: 'DB_PASSWORD',
      required: true,
      sensitive: true,
    }),
  },
  auth: {
    jwtSecret: Env.string({
      env: 'JWT_SECRET',
      required: true,
      sensitive: true,
    }),
    apiKeys: Env.array({ env: 'API_KEYS', default: [], sensitive: true }),
  },
};

// Infer config type from schema (automatic!)
export type AppConfig = InferConfigType<typeof envSchema>;

// Module augmentation for global type inference
declare module '@onebun/core' {
   
  interface OneBunAppConfig extends AppConfig {}
}

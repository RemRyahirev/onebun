import { Env, type EnvSchema } from '@onebun/core';

// Define configuration interface
interface AppConfig {
  server: {
    port: number;
    host: string;
    ssl: {
      enabled: boolean;
      cert: string;
    };
  };
  database: {
    url: string;
    password: string;
  };
  auth: {
    jwtSecret: string;
    apiKeys: string[];
  };
}

// Define environment schema
export const envSchema: EnvSchema<AppConfig> = {
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

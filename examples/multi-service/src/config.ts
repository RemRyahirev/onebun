import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  // Shared configuration
  app: {
    name: Env.string({ default: 'multi-service' }),
    environment: Env.string({ default: 'development' }),
  },

  // Users service
  users: {
    port: Env.number({ default: 3001, env: 'USERS_PORT' }),
    database: {
      url: Env.string({ env: 'USERS_DATABASE_URL', sensitive: true }),
    },
  },

  // Orders service
  orders: {
    port: Env.number({ default: 3002, env: 'ORDERS_PORT' }),
    database: {
      url: Env.string({ env: 'ORDERS_DATABASE_URL', sensitive: true }),
    },
  },

  // Inter-service communication
  usersServiceUrl: Env.string({ default: 'http://localhost:3001', env: 'USERS_SERVICE_URL' }),

  // Shared Redis
  redis: {
    host: Env.string({ default: 'localhost' }),
    port: Env.number({ default: 6379 }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

// This enables typed access to this.config.get() everywhere
declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}

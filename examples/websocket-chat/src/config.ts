import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}

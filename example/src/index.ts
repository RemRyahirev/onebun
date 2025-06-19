import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { Env, EnvSchema } from '@onebun/envs';

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
const envSchema: EnvSchema<AppConfig> = {
  server: {
    port: Env.number({ env: 'PORT', default: 3000 }),
    host: Env.string({ env: 'HOST', default: '0.0.0.0' }),
    ssl: {
      enabled: Env.boolean({ env: 'SSL_ENABLED', default: false }),
      cert: Env.string({ env: 'SSL_CERT', default: '/ssl/cert.pem', sensitive: true })
    }
  },
  database: {
    url: Env.string({ env: 'DATABASE_URL', required: true, sensitive: true }),
    password: Env.string({ env: 'DB_PASSWORD', required: true, sensitive: true })
  },
  auth: {
    jwtSecret: Env.string({ env: 'JWT_SECRET', required: true, sensitive: true }),
    apiKeys: Env.array({ env: 'API_KEYS', default: [], sensitive: true })
  }
};

// Create application with integrated configuration
const app = new OneBunApplication(AppModule, {
  port: 3001,
  host: '0.0.0.0',
  development: true,
  envSchema: envSchema,
  envOptions: {
    envFilePath: '.env',
    loadDotEnv: true,
    envOverridesDotEnv: true
  }
});

// Start the application
app.start()
  .then(() => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.info('Application started successfully');
    
    // Demonstrate config access from application level
    try {
      const config = app.getConfig();
      const port = config.get<number>('server.port');
      const host = config.get<string>('server.host');
      logger.info(`Server running on http://${host}:${port}`);
      
      // Safe config logging
      const safeConfig = config.getSafeConfig();
      logger.info('Application configuration loaded:', { config: safeConfig });
    } catch (error) {
      logger.warn('Configuration not available:', { error: error instanceof Error ? error.message : String(error) });
    }
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error('Failed to start application:', error instanceof Error ? error : new Error(String(error)));
  });

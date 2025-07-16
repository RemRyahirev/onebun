import { Context } from 'effect';

import type { SyncLogger } from '@onebun/logger';

import { BaseService, Service } from './service';

/**
 * Configuration service tag
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ConfigServiceTag = Context.GenericTag<ConfigServiceImpl>('ConfigService');

/**
 * Configuration service implementation
 */
@Service(ConfigServiceTag)
export class ConfigServiceImpl extends BaseService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private configInstance: any = null;

  constructor(
    logger?: SyncLogger,
    config?: unknown,
  ) {
    super(logger, config);
    this.configInstance = config;
  }

  /**
   * Initialize configuration
   */
  async initialize(): Promise<void> {
    if (this.configInstance) {
      await this.configInstance.initialize();
      this.logger.info('Configuration initialized successfully');
    }
  }

  /**
   * Get configuration value by path
   */
  get<T = unknown>(path: string): T {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.get(path);
  }

  /**
   * Get all configuration values
   */
  get values(): unknown {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.values;
  }

  /**
   * Get safe configuration for logging (sensitive data masked)
   */
  getSafeConfig(): unknown {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.getSafeConfig();
  }

  /**
   * Check if configuration is initialized
   */
  get isInitialized(): boolean {
    return this.configInstance ? this.configInstance.isInitialized : false;
  }

  /**
   * Get the underlying TypedEnv instance
   */
  get instance(): unknown {
    return this.configInstance;
  }
}

// Export both tag and implementation
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ConfigService = ConfigServiceTag; 

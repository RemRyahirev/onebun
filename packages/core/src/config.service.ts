import { Context } from 'effect';

import { BaseService, Service } from './service';

/**
 * Configuration service tag
 */
export const ConfigServiceTag = Context.GenericTag<ConfigServiceImpl>('ConfigService');

/**
 * Configuration service implementation
 */
@Service(ConfigServiceTag)
export class ConfigServiceImpl extends BaseService {
  private configInstance: any = null;

  constructor(logger?: any, config?: any) {
    super(logger);
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
  get<T = any>(path: string): T {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.get(path);
  }

  /**
   * Get all configuration values
   */
  get values(): any {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.values;
  }

  /**
   * Get safe configuration for logging (sensitive data masked)
   */
  getSafeConfig(): any {
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
  get instance(): any {
    return this.configInstance;
  }
}

// Export both tag and implementation
export const ConfigService = ConfigServiceTag; 
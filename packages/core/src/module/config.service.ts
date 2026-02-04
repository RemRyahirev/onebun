import { Context } from 'effect';

import type { IConfig, OneBunAppConfig } from './config.interface';

import type { DeepPaths, DeepValue } from '@onebun/envs';
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
  private configInstance: IConfig<OneBunAppConfig> | null = null;

  constructor(logger?: SyncLogger, config?: IConfig<OneBunAppConfig>) {
    super();
    // If logger is provided directly (for backwards compatibility in tests),
    // initialize the service immediately
    if (logger && config) {
      this.initializeService(logger, config);
    }
    this.configInstance = config ?? null;
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
   * Get configuration value by path with full type inference.
   * Uses module augmentation of OneBunAppConfig for type-safe access.
   * 
   * @example
   * // With module augmentation:
   * declare module '@onebun/core' {
   *   interface OneBunAppConfig {
   *     server: { port: number; host: string };
   *   }
   * }
   * 
   * const port = configService.get('server.port'); // number
   * const host = configService.get('server.host'); // string
   */
  get<P extends DeepPaths<OneBunAppConfig>>(path: P): DeepValue<OneBunAppConfig, P>;
  /** Fallback for dynamic paths */
  get<T = unknown>(path: string): T;
  get(path: string): unknown {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.get(path);
  }

  /**
   * Get all configuration values
   */
  get values(): OneBunAppConfig {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.values;
  }

  /**
   * Get safe configuration for logging (sensitive data masked)
   */
  getSafeConfig(): OneBunAppConfig {
    if (!this.configInstance) {
      throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
    }

    return this.configInstance.getSafeConfig();
  }

  /**
   * Check if configuration is initialized
   */
  override get isInitialized(): boolean {
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

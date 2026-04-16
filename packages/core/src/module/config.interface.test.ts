/**
 * NotInitializedConfig Tests
 */

import {
  describe,
  test,
  expect,
} from 'bun:test';

import { NotInitializedConfig } from './config.interface';

describe('NotInitializedConfig', () => {
  let config: NotInitializedConfig;

  // Use beforeEach inline via direct instantiation — each test creates its own
  test('get() throws with initialization message', () => {
    config = new NotInitializedConfig();
    expect(() => config.get('server.port')).toThrow(
      'Configuration not initialized. Provide envSchema in ApplicationOptions.',
    );
  });

  test('values getter throws with initialization message', () => {
    config = new NotInitializedConfig();
    expect(() => config.values).toThrow(
      'Configuration not initialized. Provide envSchema in ApplicationOptions.',
    );
  });

  test('getSafeConfig() throws with initialization message', () => {
    config = new NotInitializedConfig();
    expect(() => config.getSafeConfig()).toThrow(
      'Configuration not initialized. Provide envSchema in ApplicationOptions.',
    );
  });

  test('initialize() rejects with initialization message', async () => {
    config = new NotInitializedConfig();
    await expect(config.initialize()).rejects.toThrow(
      'Configuration not initialized. Provide envSchema in ApplicationOptions.',
    );
  });

  test('isInitialized returns false', () => {
    config = new NotInitializedConfig();
    expect(config.isInitialized).toBe(false);
  });
});

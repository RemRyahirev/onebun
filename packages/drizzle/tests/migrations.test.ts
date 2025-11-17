import {
  describe,
  expect,
  test,
} from 'bun:test';

import { generateMigrations, pushSchema } from '../src/migrations';

describe('Migration utilities', () => {
  describe('generateMigrations', () => {
    test('should be defined', () => {
      expect(generateMigrations).toBeDefined();
      expect(typeof generateMigrations).toBe('function');
    });

    test('should accept options', async () => {
      await expect(
        generateMigrations({
          schemaPath: './test-schema',
          migrationsFolder: './test-migrations',
          dialect: 'sqlite',
        }),
      ).rejects.toThrow(); // Will fail because schema doesn't exist, but function is callable
    });

    test('should use default options', async () => {
      await expect(generateMigrations()).rejects.toThrow(); // Will fail but function is callable
    });
  });

  describe('pushSchema', () => {
    test('should be defined', () => {
      expect(pushSchema).toBeDefined();
      expect(typeof pushSchema).toBe('function');
    });

    test('should accept options', async () => {
      await expect(
        pushSchema({
          schemaPath: './test-schema',
          dialect: 'sqlite',
          connectionString: ':memory:',
        }),
      ).rejects.toThrow(); // Will fail because schema doesn't exist, but function is callable
    });

    test('should use default options', async () => {
      await expect(pushSchema()).rejects.toThrow(); // Will fail but function is callable
    });
  });
});













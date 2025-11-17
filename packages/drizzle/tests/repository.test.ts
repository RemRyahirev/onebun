import {
  describe,
  expect,
  test,
  beforeEach,
} from 'bun:test';
import {
  sqliteTable,
  integer,
  text,
} from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';

import { makeMockLoggerLayer } from '@onebun/core';
import { LoggerService } from '@onebun/logger';

import { DrizzleService } from '../src/drizzle.service';
import { BaseRepository } from '../src/repository';
import { DatabaseType } from '../src/types';

// Test schema
const testEntities = sqliteTable('test_entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

type TestEntity = typeof testEntities.$inferSelect;

class TestRepository extends BaseRepository<typeof testEntities> {
  override async findById(_id: unknown): Promise<TestEntity | null> {
    // Mock implementation
    return null;
  }

  override async create(data: Partial<typeof testEntities.$inferInsert>): Promise<TestEntity> {
    // Mock implementation
    return { id: 1, name: data.name || 'test' } as TestEntity;
  }

  override async update(
    id: unknown,
    data: Partial<typeof testEntities.$inferInsert>,
  ): Promise<TestEntity | null> {
    // Mock implementation
    return { id: id as number, name: data.name || 'updated' } as TestEntity;
  }

  override async delete(_id: unknown): Promise<boolean> {
    // Mock implementation
    return true;
  }
}

describe('BaseRepository', () => {
  let drizzleService: DrizzleService<DatabaseType.SQLITE>;
  let repository: TestRepository;

  beforeEach(async () => {
    // Clear DB env vars to prevent auto-initialization
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;
    
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );
    drizzleService = new DrizzleService<DatabaseType.SQLITE>(logger, undefined);
    await drizzleService.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });
    
    // Create table directly from schema (for testing)
    const sqliteDb = drizzleService.getSQLiteDatabase();
    await sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS test_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);
    
    repository = new TestRepository(drizzleService, testEntities);
  });

  describe('Constructor', () => {
    test('should create repository instance', () => {
      expect(repository).toBeDefined();
      expect(repository).toBeInstanceOf(BaseRepository);
    });
  });

  describe('Abstract methods', () => {
    test('should have findById method', () => {
      expect(repository.findById).toBeDefined();
      expect(typeof repository.findById).toBe('function');
    });

    test('should have create method', () => {
      expect(repository.create).toBeDefined();
      expect(typeof repository.create).toBe('function');
    });

    test('should have update method', () => {
      expect(repository.update).toBeDefined();
      expect(typeof repository.update).toBe('function');
    });

    test('should have delete method', () => {
      expect(repository.delete).toBeDefined();
      expect(typeof repository.delete).toBe('function');
    });
  });

  describe('findAll', () => {
    test('should have findAll method', () => {
      expect(repository.findAll).toBeDefined();
      expect(typeof repository.findAll).toBe('function');
    });

    test('should return empty array if database is empty', async () => {
      const results = await repository.findAll();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('count', () => {
    test('should have count method', () => {
      expect(repository.count).toBeDefined();
      expect(typeof repository.count).toBe('function');
    });

    test('should return 0 if database is empty', async () => {
      const count = await repository.count();
      expect(count).toBe(0);
    });
  });
});

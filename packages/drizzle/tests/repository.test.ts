import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import { makeMockLoggerLayer, createMockConfig } from '@onebun/core';
import { LoggerService } from '@onebun/logger';

import { DrizzleService } from '../src/drizzle.service';
import { BaseRepository } from '../src/repository';
import {
  sqliteTable,
  integer,
  text,
} from '../src/sqlite';
import { DatabaseType } from '../src/types';

// Test schema
const testEntities = sqliteTable('test_entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

// Real repository that uses BaseRepository methods without overriding
class TestRepository extends BaseRepository<typeof testEntities> {
  // No overrides - uses real BaseRepository implementation
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
    drizzleService = new DrizzleService<DatabaseType.SQLITE>();
    drizzleService.initializeService(logger, createMockConfig());
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

  afterEach(async () => {
    // Clean up table data between tests
    const sqliteDb = drizzleService.getSQLiteDatabase();
    await sqliteDb.run('DELETE FROM test_entities');
  });

  describe('Constructor', () => {
    test('should create repository instance with access to table and db', () => {
      expect(repository).toBeDefined();
      expect(repository).toBeInstanceOf(BaseRepository);
    });
  });

  describe('create', () => {
    test('should create a new entity and return it with generated id', async () => {
      const entity = await repository.create({ name: 'Test Entity' });
      
      expect(entity).toBeDefined();
      expect(entity.id).toBeDefined();
      expect(typeof entity.id).toBe('number');
      expect(entity.name).toBe('Test Entity');
    });

    test('should create multiple entities with unique ids', async () => {
      const entity1 = await repository.create({ name: 'Entity 1' });
      const entity2 = await repository.create({ name: 'Entity 2' });
      
      expect(entity1.id).not.toBe(entity2.id);
      expect(entity1.name).toBe('Entity 1');
      expect(entity2.name).toBe('Entity 2');
    });
  });

  describe('findById', () => {
    test('should find existing entity by id', async () => {
      const created = await repository.create({ name: 'Find Me' });
      const found = await repository.findById(created.id);
      
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Find Me');
    });

    test('should return null for non-existent id', async () => {
      const found = await repository.findById(99999);
      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    test('should return empty array when no entities exist', async () => {
      const results = await repository.findAll();
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should return all entities', async () => {
      await repository.create({ name: 'Entity 1' });
      await repository.create({ name: 'Entity 2' });
      await repository.create({ name: 'Entity 3' });
      
      const results = await repository.findAll();
      
      expect(results.length).toBe(3);
      expect(results.map(e => e.name).sort()).toEqual(['Entity 1', 'Entity 2', 'Entity 3']);
    });
  });

  describe('update', () => {
    test('should update existing entity and return updated data', async () => {
      const created = await repository.create({ name: 'Original Name' });
      const updated = await repository.update(created.id, { name: 'Updated Name' });
      
      expect(updated).toBeDefined();
      expect(updated?.id).toBe(created.id);
      expect(updated?.name).toBe('Updated Name');
    });

    test('should return null when updating non-existent entity', async () => {
      const updated = await repository.update(99999, { name: 'Will Not Exist' });
      expect(updated).toBeNull();
    });

    test('should persist changes to database', async () => {
      const created = await repository.create({ name: 'Before Update' });
      await repository.update(created.id, { name: 'After Update' });
      
      const found = await repository.findById(created.id);
      expect(found?.name).toBe('After Update');
    });
  });

  describe('delete', () => {
    test('should delete existing entity and return true', async () => {
      const created = await repository.create({ name: 'To Delete' });
      const deleted = await repository.delete(created.id);
      
      expect(deleted).toBe(true);
    });

    test('should return false when deleting non-existent entity', async () => {
      const deleted = await repository.delete(99999);
      expect(deleted).toBe(false);
    });

    test('should remove entity from database', async () => {
      const created = await repository.create({ name: 'Will Be Gone' });
      await repository.delete(created.id);
      
      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });
  });

  describe('count', () => {
    test('should return 0 when no entities exist', async () => {
      const count = await repository.count();
      expect(count).toBe(0);
    });

    test('should return correct count after creating entities', async () => {
      await repository.create({ name: 'Entity 1' });
      await repository.create({ name: 'Entity 2' });
      
      const count = await repository.count();
      expect(count).toBe(2);
    });

    test('should update count after delete', async () => {
      const entity1 = await repository.create({ name: 'Entity 1' });
      await repository.create({ name: 'Entity 2' });
      
      expect(await repository.count()).toBe(2);
      
      await repository.delete(entity1.id);
      
      expect(await repository.count()).toBe(1);
    });
  });

  describe('getQueryBuilder', () => {
    test('should return query builder with all methods', () => {
      const qb = repository.getQueryBuilder();
      
      expect(qb).toBeDefined();
      expect(typeof qb.select).toBe('function');
      expect(typeof qb.insert).toBe('function');
      expect(typeof qb.update).toBe('function');
      expect(typeof qb.delete).toBe('function');
    });
  });

  describe('transaction', () => {
    test('should execute operations within transaction', async () => {
      await repository.transaction(async () => {
        await repository.create({ name: 'In Transaction' });
      });
      
      const count = await repository.count();
      expect(count).toBe(1);
    });
  });
});

/* eslint-disable @typescript-eslint/no-shadow, @typescript-eslint/no-explicit-any */
import {
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import type { CacheService } from '../src/cache.service';

import { cacheServiceTag, makeCacheService } from '../src/cache.service';
import { createInMemoryCache } from '../src/memory-cache';

describe('Cache Integration Tests', () => {
  describe('Real-world usage patterns', () => {
    it('should cache API responses', async () => {
      const cache = createInMemoryCache({ defaultTtl: 5000 }); // 5 second TTL
      const cacheLayer = makeCacheService(cache);

      // Simulate API service that uses cache
      const apiService = pipe(
        cacheServiceTag,
        Effect.andThen((cacheService) => {
          const fetchUser = (userId: string) =>
            pipe(
              cacheService.getEffect(`user:${userId}`),
              Effect.andThen((cached) => {
                if (cached) {
                  return Effect.succeed({
                    ...(cached as any),
                    source: 'cache' as const,
                  });
                }

                // Simulate API call
                const userData = {
                  id: userId,
                  name: `User ${userId}`,
                  email: `user${userId}@example.com`,
                  fetchedAt: Date.now(),
                };

                return pipe(
                  cacheService.setEffect(`user:${userId}`, userData, { ttl: 30000 }), // 30 seconds
                  Effect.andThen(() => Effect.succeed({ ...userData, source: 'api' as const })),
                );
              }),
            );

          return pipe(
            fetchUser('123'),
            Effect.andThen((user1First) =>
              pipe(
                fetchUser('123'), // Should be from cache
                Effect.andThen((user1Second) =>
                  pipe(
                    fetchUser('456'), // Should be from API
                    Effect.andThen((user2) =>
                      Effect.succeed({
                        user1First,
                        user1Second,
                        user2,
                      }),
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      );

      const program = Effect.provide(apiService, cacheLayer);
      const result = await Effect.runPromise(program);

      // First call should be from API
      expect(result.user1First.source).toBe('api');
      expect(result.user1First.id).toBe('123');

      // Second call should be from cache
      expect(result.user1Second.source).toBe('cache');
      expect(result.user1Second.id).toBe('123');
      expect(result.user1Second.fetchedAt).toBe(result.user1First.fetchedAt);

      // Different user should be from API
      expect(result.user2.source).toBe('api');
      expect(result.user2.id).toBe('456');

      await cache.close();
    });

    it('should handle cache invalidation patterns', async () => {
      const cache = createInMemoryCache();
      const cacheLayer = makeCacheService(cache);

      // Simulate a simple database
      const db = new Map();

      const getUser = (cacheService: CacheService, userId: string) =>
        pipe(
          cacheService.getEffect(`user:${userId}`),
          Effect.andThen((cached) => {
            if (cached) {
              return Effect.succeed({ ...cached, source: 'cache' });
            }

            // Simulate database fetch
            const dbData = db.get(userId) || {
              id: userId,
              name: `User ${userId}`,
              version: 1,
            };

            return pipe(
              cacheService.setEffect(`user:${userId}`, dbData, { ttl: 30000 }),
              Effect.andThen(() => Effect.succeed({ ...dbData, source: 'db' })),
            );
          }),
        );

      const updateUser = (cacheService: CacheService, userId: string, data: Record<string, unknown>) =>
        pipe(
          Effect.sync(() => {
            // Update database (simulated)
            const existingData = db.get(userId) || {
              id: userId,
              name: `User ${userId}`,
              version: 1,
            };
            const updatedData = { ...existingData, ...data, updatedAt: Date.now() };
            db.set(userId, updatedData);

            return updatedData;
          }),
          Effect.andThen((updatedData) =>
            pipe(
              cacheService.deleteEffect(`user:${userId}`),
              Effect.andThen(() => Effect.succeed(updatedData)),
            ),
          ),
        );

      const dataService = pipe(
        cacheServiceTag,
        Effect.andThen((cacheService) =>
          pipe(
            getUser(cacheService, '123'),
            Effect.andThen((initialUser) => {
              expect(initialUser.source).toBe('db');

              return getUser(cacheService, '123');
            }),
            Effect.andThen((cachedUser) => {
              expect(cachedUser.source).toBe('cache');

              return updateUser(cacheService, '123', { name: 'Updated User', version: 2 });
            }),
            Effect.andThen((updatedUser) => {
              expect(updatedUser.version).toBe(2);

              return getUser(cacheService, '123');
            }),
            Effect.andThen((freshUser) => {
              expect(freshUser.source).toBe('db'); // Cache was invalidated
              expect(freshUser.version).toBe(2);

              return true;
            }),
          ),
        ),
      );

      const program = Effect.provide(dataService, cacheLayer);
      const result = await Effect.runPromise(program);

      expect(result).toBe(true);
      await cache.close();
    });

    it('should handle concurrent access', async () => {
      const cache = createInMemoryCache();
      const cacheLayer = makeCacheService(cache);

      const concurrentTest = pipe(
        cacheServiceTag,
        Effect.andThen((cacheService) => {
          // Simulate multiple concurrent operations
          const operations = Array.from({ length: 10 }, (_, i) =>
            pipe(
              cacheService.setEffect(`concurrent:${i}`, { value: i, timestamp: Date.now() }),
              Effect.andThen(() => cacheService.getEffect(`concurrent:${i}`)),
            ),
          );

          return pipe(
            Effect.all(operations, { concurrency: 'unbounded' }),
            Effect.andThen((results) => {
              // All operations should succeed
              expect(results).toHaveLength(10);
              results.forEach((result, i) => {
                expect((result as any)?.value).toBe(i);
              });

              return results.length;
            }),
          );
        }),
      );

      const program = Effect.provide(concurrentTest, cacheLayer);
      const result = await Effect.runPromise(program);

      expect(result).toBe(10);
      await cache.close();
    });

    it('should work with complex data types and serialization', async () => {
      const cache = createInMemoryCache({ defaultTtl: 10000 });
      const cacheLayer = makeCacheService(cache);

      // Complex nested object
      const complexObject = {
        user: {
          id: '123',
          profile: {
            name: 'John Doe',
            preferences: {
              theme: 'dark',
              notifications: {
                email: true,
                push: false,
                sms: {
                  enabled: true,
                  frequency: 'daily',
                },
              },
            },
          },
        },
        metadata: {
          createdAt: new Date(),
          tags: ['test', 'complex', 'nested'],
          stats: {
            views: 42,
            likes: 15,
          },
        },
        arrayData: [
          { id: 1, value: 'first' },
          { id: 2, value: 'second' },
          { id: 3, value: 'third', nested: { prop: 'value' } },
        ],
      };

      const complexDataTest = pipe(
        cacheServiceTag,
        Effect.andThen((cacheService) =>
          pipe(
            cacheService.setEffect('complex-object', complexObject),
            Effect.andThen(() => cacheService.getEffect('complex-object')),
            Effect.andThen((retrieved) => {
              // Deep equality check
              expect(retrieved).toEqual(complexObject);
              const typedRetrieved = retrieved as typeof complexObject;
              expect(typedRetrieved?.user.profile.preferences.notifications.sms.frequency).toBe('daily');
              expect((typedRetrieved as any)?.arrayData[2]?.nested.prop).toBe('value');

              return cacheService;
            }),
            Effect.andThen((cacheService) => {
              // Test with Map and Set (if supported)
              const mapData = new Map<string, string | { nested: boolean }>([
                ['key1', 'value1'],
                ['key2', { nested: true }],
              ]);

              const setData = new Set(['a', 'b', 'c']);

              return pipe(
                cacheService.setEffect('map-data', mapData),
                Effect.andThen(() => cacheService.setEffect('set-data', setData)),
                Effect.andThen(() => cacheService.getEffect('map-data')),
                Effect.andThen((retrievedMap) =>
                  pipe(
                    cacheService.getEffect('set-data'),
                    Effect.andThen((retrievedSet) => {
                      expect(retrievedMap).toEqual(mapData);
                      expect(retrievedSet).toEqual(setData);

                      return true;
                    }),
                  ),
                ),
              );
            }),
          ),
        ),
      );

      const program = Effect.provide(complexDataTest, cacheLayer);
      const result = await Effect.runPromise(program);

      expect(result).toBe(true);
      await cache.close();
    });

    it('should handle cache size limits in real scenarios', async () => {
      const cache = createInMemoryCache({
        maxSize: 5, // Very small cache for testing
        defaultTtl: 60000, // Long TTL to focus on size limits
      });
      const cacheLayer = makeCacheService(cache);

      const sizeLimitTest = pipe(
        cacheServiceTag,
        Effect.andThen((cacheService) => {
          // Add more items than cache capacity
          const items = Array.from({ length: 10 }, (_, i) => ({
            key: `item-${i}`,
            value: `value-${i}`,
            size: i,
          }));

          // Set all items
          const setOperations = items.map(item =>
            cacheService.setEffect(item.key, item),
          );

          return pipe(
            Effect.all(setOperations, { concurrency: 'unbounded' }),
            Effect.andThen(() => cacheService.getStatsEffect()),
            Effect.andThen((stats) => {
              expect(stats.entries).toBeLessThanOrEqual(5);

              return cacheService;
            }),
            Effect.andThen((cacheService) =>
              cacheService.mgetEffect(['item-7', 'item-8', 'item-9']),
            ),
            Effect.andThen((recentItems) => {
              expect(recentItems.filter(item => item !== undefined)).toHaveLength(3);

              return cacheServiceTag;
            }),
            Effect.andThen(() => cacheService.getStatsEffect()),
            Effect.andThen((stats) => stats.entries),
          );
        }),
      );

      const program = Effect.provide(sizeLimitTest, cacheLayer);
      const finalSize = await Effect.runPromise(program);

      expect(finalSize).toBeLessThanOrEqual(5);
      await cache.close();
    });
  });

  describe('Performance characteristics', () => {
    it('should maintain reasonable performance under load', async () => {
      const cache = createInMemoryCache({ maxSize: 1000 });
      const cacheLayer = makeCacheService(cache);

      const performanceTest = pipe(
        cacheServiceTag,
        Effect.andThen((cacheService) => {
          // Bulk set operations
          const setOperations = Array.from({ length: 100 }, (_, i) =>
            cacheService.setEffect(`perf-key-${i}`, `perf-value-${i}`),
          );

          return pipe(
            Effect.all(setOperations, { concurrency: 'unbounded' }),
            Effect.andThen(() => {
              // Bulk get operations (mix of hits and misses)
              const getOperations = Array.from({ length: 150 }, (_, i) =>
                i < 100
                  ? cacheService.getEffect(`perf-key-${i}`) // Hit
                  : cacheService.getEffect(`missing-key-${i}`), // Miss
              );

              return Effect.all(getOperations, { concurrency: 'unbounded' });
            }),
            Effect.andThen((getResults) => {
              // Verify results
              expect(getResults.slice(0, 100).every((result, i) => result === `perf-value-${i}`)).toBe(true);
              expect(getResults.slice(100).every(result => result === undefined)).toBe(true);

              return { cacheService };
            }),
            Effect.andThen(({ cacheService: innerCacheService }) =>
              pipe(
                innerCacheService.getStatsEffect(),
                Effect.andThen((stats) => {
                  // Should have some hits and misses
                  expect(stats.hits).toBeGreaterThan(0);
                  expect(stats.misses).toBeGreaterThan(0);
                  expect(stats.hitRate).toBeGreaterThan(0);

                  return { stats };
                }),
              ),
            ),
          );
        }),
      );

      const program = Effect.provide(performanceTest, cacheLayer);
      const result = await Effect.runPromise(program);

      expect(result.stats.entries).toBe(100);

      await cache.close();
    });
  });
});

import { Injectable } from '@nestjs/common';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const DEFAULT_TTL = 30000;

@Injectable()
export class SimpleCacheService {
  private store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl = DEFAULT_TTL): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }
}

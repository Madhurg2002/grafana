import { LRUCache } from "lru-cache";

/**
 * Process in-memory LRU cache (research.md §2): sub-millisecond hit latency,
 * no external dependency. Default TTL is 300 seconds.
 */

export interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

export class QueryCache<T = unknown> {
  private readonly store: LRUCache<string, CacheEntry<T>>;
  public readonly ttlMs: number;

  public constructor(ttlSeconds = 300, maxEntries = 500) {
    this.ttlMs = ttlSeconds * 1000;
    this.store = new LRUCache<string, CacheEntry<T>>({
      max: maxEntries,
      ttl: this.ttlMs,
    });
  }

  public get(key: string): CacheEntry<T> | undefined {
    return this.store.get(key);
  }

  public set(key: string, value: T): CacheEntry<T> {
    const entry: CacheEntry<T> = { value, cachedAt: Date.now() };
    this.store.set(key, entry);
    return entry;
  }

  public has(key: string): boolean {
    return this.store.has(key);
  }

  public delete(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public get size(): number {
    return this.store.size;
  }
}

const globalForCache = globalThis as unknown as { __QUERY_CACHE__?: QueryCache };

export function getQueryCache(): QueryCache {
  if (!globalForCache.__QUERY_CACHE__) {
    const ttlSeconds = Number(process.env.CACHE_TTL_SECONDS ?? "300");
    globalForCache.__QUERY_CACHE__ = new QueryCache(
      Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 300
    );
  }
  return globalForCache.__QUERY_CACHE__;
}

export function setQueryCache(cache: QueryCache | undefined): void {
  globalForCache.__QUERY_CACHE__ = cache;
}

/**
 * QueryDeduplicator - Deduplicates reactive queries across browser tabs.
 *
 * When multiple tabs subscribe to the same query, only one tab
 * executes the query and shares results via BroadcastChannel.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

export interface QueryDeduplicatorConfig {
  /** Channel name. @default 'pocket-query-dedup' */
  channelName?: string;
  /** Cache TTL in ms. @default 5000 */
  cacheTtlMs?: number;
  /** Maximum cached queries. @default 100 */
  maxCachedQueries?: number;
}

export interface CachedQuery {
  key: string;
  collection: string;
  filter: Record<string, unknown>;
  results: unknown[];
  cachedAt: number;
  sourceTabId: string;
}

export interface DeduplicatorStats {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  sharedResults: number;
  cacheSize: number;
  hitRate: number;
}

export class QueryDeduplicator {
  private readonly config: Required<QueryDeduplicatorConfig>;
  private readonly tabId: string;
  private readonly destroy$ = new Subject<void>();
  private readonly stats$ = new BehaviorSubject<DeduplicatorStats>({
    totalQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    sharedResults: 0,
    cacheSize: 0,
    hitRate: 0,
  });

  private readonly cache = new Map<string, CachedQuery>();
  private channel: BroadcastChannel | null = null;
  private totalQueries = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private sharedResults = 0;

  constructor(config: QueryDeduplicatorConfig = {}) {
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.config = {
      channelName: config.channelName ?? 'pocket-query-dedup',
      cacheTtlMs: config.cacheTtlMs ?? 5_000,
      maxCachedQueries: config.maxCachedQueries ?? 100,
    };
  }

  /**
   * Start listening for shared query results.
   */
  start(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    this.channel = new BroadcastChannel(this.config.channelName);
    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; query: CachedQuery };
      if (data.type === 'query-result' && data.query.sourceTabId !== this.tabId) {
        this.cache.set(data.query.key, data.query);
        this.sharedResults++;
        this.evictExpired();
        this.updateStats();
      }
    };
  }

  /**
   * Check cache for a query result.
   */
  getCached(collection: string, filter: Record<string, unknown>): CachedQuery | null {
    const key = this.buildKey(collection, filter);
    this.totalQueries++;

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.config.cacheTtlMs) {
      this.cacheHits++;
      this.updateStats();
      return cached;
    }

    this.cacheMisses++;
    this.updateStats();
    return null;
  }

  /**
   * Store and share a query result.
   */
  cacheAndShare(collection: string, filter: Record<string, unknown>, results: unknown[]): void {
    const key = this.buildKey(collection, filter);

    const cached: CachedQuery = {
      key,
      collection,
      filter,
      results,
      cachedAt: Date.now(),
      sourceTabId: this.tabId,
    };

    this.cache.set(key, cached);
    this.evictIfNeeded();

    // Share with other tabs
    this.channel?.postMessage({
      type: 'query-result',
      query: cached,
    });

    this.updateStats();
  }

  /**
   * Invalidate cache for a collection.
   */
  invalidate(collection?: string): void {
    if (collection) {
      for (const [key, cached] of this.cache) {
        if (cached.collection === collection) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
    this.updateStats();
  }

  /**
   * Get deduplicator stats.
   */
  getStats(): Observable<DeduplicatorStats> {
    return this.stats$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get current stats snapshot.
   */
  getCurrentStats(): DeduplicatorStats {
    return this.stats$.getValue();
  }

  /**
   * Stop the deduplicator.
   */
  stop(): void {
    this.channel?.close();
    this.channel = null;
  }

  destroy(): void {
    this.stop();
    this.cache.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.stats$.complete();
  }

  private buildKey(collection: string, filter: Record<string, unknown>): string {
    return `${collection}:${JSON.stringify(filter, Object.keys(filter).sort())}`;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, cached] of this.cache) {
      if (now - cached.cachedAt > this.config.cacheTtlMs) {
        this.cache.delete(key);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.config.maxCachedQueries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }
  }

  private updateStats(): void {
    this.stats$.next({
      totalQueries: this.totalQueries,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      sharedResults: this.sharedResults,
      cacheSize: this.cache.size,
      hitRate: this.totalQueries > 0 ? this.cacheHits / this.totalQueries : 0,
    });
  }
}

export function createQueryDeduplicator(config?: QueryDeduplicatorConfig): QueryDeduplicator {
  return new QueryDeduplicator(config);
}

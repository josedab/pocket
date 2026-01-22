/**
 * Query Subscription - Reactive query with automatic updates
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { hashQuery } from './query-builder.js';
import { executeQuery } from './query-executor.js';
import type {
  QueryCacheEntry,
  QueryDefinition,
  QueryOptions,
  QueryResult,
  QuerySubscriptionEvent,
} from './types.js';

/**
 * Query subscription configuration
 */
export interface QuerySubscriptionConfig {
  /** Debounce time for updates (ms) */
  debounce?: number;
  /** Enable caching */
  enableCache?: boolean;
  /** Cache TTL (ms) */
  cacheTTL?: number;
  /** Maximum cache entries */
  maxCacheEntries?: number;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<QuerySubscriptionConfig> = {
  debounce: 50,
  enableCache: true,
  cacheTTL: 60000,
  maxCacheEntries: 100,
  debug: false,
};

/**
 * Manages a single reactive query subscription
 */
export class QuerySubscription<T extends Record<string, unknown>> {
  private readonly query: QueryDefinition;
  private readonly config: Required<QuerySubscriptionConfig>;
  private readonly result$ = new BehaviorSubject<QueryResult<T>>({
    data: [],
    total: 0,
    hasMore: false,
  });
  private readonly events$ = new Subject<QuerySubscriptionEvent<T>>();
  private dataSource: T[] = [];
  private previousResult: QueryResult<T> | null = null;
  private destroyed = false;

  constructor(query: QueryDefinition, config: QuerySubscriptionConfig = {}) {
    this.query = query;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the data source and re-execute query
   */
  setData(data: T[]): void {
    if (this.destroyed) return;

    this.dataSource = data;
    this.execute();
  }

  /**
   * Handle a document change
   */
  handleChange(changeType: 'added' | 'modified' | 'removed', doc: T): void {
    if (this.destroyed) return;

    // Update data source
    const id = (doc as Record<string, unknown>).id;
    const index = this.dataSource.findIndex((d) => (d as Record<string, unknown>).id === id);

    switch (changeType) {
      case 'added':
        if (index === -1) {
          this.dataSource = [...this.dataSource, doc];
        }
        break;
      case 'modified':
        if (index !== -1) {
          this.dataSource = [
            ...this.dataSource.slice(0, index),
            doc,
            ...this.dataSource.slice(index + 1),
          ];
        }
        break;
      case 'removed':
        if (index !== -1) {
          this.dataSource = [
            ...this.dataSource.slice(0, index),
            ...this.dataSource.slice(index + 1),
          ];
        }
        break;
    }

    // Re-execute query
    this.execute();

    // Emit specific event
    const result = this.result$.value;
    this.events$.next({
      type: changeType,
      documents: [doc],
      document: doc,
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle bulk changes
   */
  handleBulkChange(docs: T[]): void {
    if (this.destroyed) return;

    this.dataSource = docs;
    this.execute();

    this.events$.next({
      type: 'reset',
      documents: docs,
      result: this.result$.value,
      timestamp: Date.now(),
    });
  }

  /**
   * Get the current result
   */
  getResult(): QueryResult<T> {
    return this.result$.value;
  }

  /**
   * Get the result observable
   */
  get result(): Observable<QueryResult<T>> {
    return this.result$.asObservable();
  }

  /**
   * Get just the data observable
   */
  get data(): Observable<T[]> {
    return this.result$.pipe(
      map((r) => r.data),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
  }

  /**
   * Get events observable
   */
  get events(): Observable<QuerySubscriptionEvent<T>> {
    return this.events$.asObservable();
  }

  /**
   * Get debounced result observable
   */
  get debouncedResult(): Observable<QueryResult<T>> {
    return this.result$.pipe(
      debounceTime(this.config.debounce),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
  }

  /**
   * Re-execute the query
   */
  refresh(): void {
    this.execute();
  }

  /**
   * Destroy the subscription
   */
  destroy(): void {
    this.destroyed = true;
    this.result$.complete();
    this.events$.complete();
  }

  /**
   * Execute the query
   */
  private execute(): void {
    const result = executeQuery(this.query, this.dataSource);

    // Check if result changed
    const changed =
      !this.previousResult ||
      JSON.stringify(result.data) !== JSON.stringify(this.previousResult.data);

    if (changed) {
      this.previousResult = result;
      this.result$.next(result);

      if (this.config.debug) {
        console.log('[QuerySubscription] Result updated', {
          query: this.query.collection,
          count: result.data.length,
          total: result.total,
        });
      }
    }
  }
}

/**
 * Manages multiple query subscriptions with caching
 */
export class QuerySubscriptionManager<T extends Record<string, unknown>> {
  private readonly config: Required<QuerySubscriptionConfig>;
  private subscriptions = new Map<string, QuerySubscription<T>>();
  private cache = new Map<string, QueryCacheEntry<T>>();
  private dataSource: T[] = [];

  constructor(config: QuerySubscriptionConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start cache cleanup timer
    setInterval(() => {
      this.cleanupCache();
    }, this.config.cacheTTL / 2);
  }

  /**
   * Set the data source for all subscriptions
   */
  setData(data: T[]): void {
    this.dataSource = data;

    // Update all subscriptions
    for (const subscription of this.subscriptions.values()) {
      subscription.setData(data);
    }

    // Invalidate cache
    if (this.config.enableCache) {
      this.cache.clear();
    }
  }

  /**
   * Subscribe to a query
   */
  subscribe(query: QueryDefinition, options: QueryOptions = {}): QuerySubscription<T> {
    const hash = hashQuery(query);

    // Check if subscription exists
    let subscription = this.subscriptions.get(hash);
    if (subscription) {
      return subscription;
    }

    // Check cache
    if (this.config.enableCache && !options.skipCache) {
      const cached = this.cache.get(hash);
      if (cached && Date.now() < cached.expiresAt) {
        // Create subscription with cached data
        subscription = new QuerySubscription<T>(query, this.config);
        subscription.setData(this.dataSource);
        this.subscriptions.set(hash, subscription);
        return subscription;
      }
    }

    // Create new subscription
    subscription = new QuerySubscription<T>(query, this.config);
    subscription.setData(this.dataSource);
    this.subscriptions.set(hash, subscription);

    // Cache result
    if (this.config.enableCache) {
      const result = subscription.getResult();
      this.cacheResult(hash, query, result);
    }

    return subscription;
  }

  /**
   * Unsubscribe from a query
   */
  unsubscribe(query: QueryDefinition): void {
    const hash = hashQuery(query);
    const subscription = this.subscriptions.get(hash);

    if (subscription) {
      subscription.destroy();
      this.subscriptions.delete(hash);
    }
  }

  /**
   * Handle a document change
   */
  handleChange(changeType: 'added' | 'modified' | 'removed', doc: T): void {
    // Update data source
    const id = (doc as Record<string, unknown>).id;
    const index = this.dataSource.findIndex((d) => (d as Record<string, unknown>).id === id);

    switch (changeType) {
      case 'added':
        if (index === -1) {
          this.dataSource = [...this.dataSource, doc];
        }
        break;
      case 'modified':
        if (index !== -1) {
          this.dataSource = [
            ...this.dataSource.slice(0, index),
            doc,
            ...this.dataSource.slice(index + 1),
          ];
        }
        break;
      case 'removed':
        if (index !== -1) {
          this.dataSource = [
            ...this.dataSource.slice(0, index),
            ...this.dataSource.slice(index + 1),
          ];
        }
        break;
    }

    // Update all subscriptions
    for (const subscription of this.subscriptions.values()) {
      subscription.handleChange(changeType, doc);
    }

    // Invalidate cache
    if (this.config.enableCache) {
      this.cache.clear();
    }
  }

  /**
   * Execute a one-shot query (no subscription)
   */
  execute(query: QueryDefinition, options: QueryOptions = {}): QueryResult<T> {
    const hash = hashQuery(query);

    // Check cache
    if (this.config.enableCache && !options.skipCache) {
      const cached = this.cache.get(hash);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.result;
      }
    }

    // Execute query
    const result = executeQuery(query, this.dataSource);

    // Cache result
    if (this.config.enableCache) {
      this.cacheResult(hash, query, result);
    }

    return result;
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.destroy();
    }
    this.subscriptions.clear();
    this.cache.clear();
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Cache a query result
   */
  private cacheResult(hash: string, query: QueryDefinition, result: QueryResult<T>): void {
    // Enforce cache size limit
    if (this.cache.size >= this.config.maxCacheEntries) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(hash, {
      hash,
      query,
      result,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.cacheTTL,
    });
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [hash, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(hash);
      }
    }
  }
}

/**
 * Create a query subscription
 */
export function createQuerySubscription<T extends Record<string, unknown>>(
  query: QueryDefinition,
  config?: QuerySubscriptionConfig
): QuerySubscription<T> {
  return new QuerySubscription<T>(query, config);
}

/**
 * Create a query subscription manager
 */
export function createQuerySubscriptionManager<T extends Record<string, unknown>>(
  config?: QuerySubscriptionConfig
): QuerySubscriptionManager<T> {
  return new QuerySubscriptionManager<T>(config);
}

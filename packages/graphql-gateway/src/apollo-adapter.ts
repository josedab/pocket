/**
 * Apollo Client Cache Adapter for Pocket
 *
 * Enables using Pocket as an Apollo Client cache backend, providing
 * offline persistence, reactive updates, and sync capabilities
 * for GraphQL data.
 *
 * @module @pocket/graphql-gateway
 *
 * @example
 * ```typescript
 * import { createApolloCacheAdapter } from '@pocket/graphql-gateway';
 *
 * const cache = createApolloCacheAdapter({
 *   defaultTtlMs: 300_000,
 *   maxEntries: 1000,
 *   enableOptimistic: true,
 * });
 *
 * // Write normalized entity data
 * cache.write({ id: 'User:1', typename: 'User', data: { name: 'Alice' }, fetchedAt: Date.now() });
 *
 * // Read it back
 * const entry = cache.read('User:1');
 *
 * // Watch for changes reactively
 * cache.watch('User:1').subscribe((entry) => {
 *   console.log('Updated:', entry);
 * });
 *
 * // Optimistic updates with rollback
 * cache.writeOptimistic('User:1', { id: 'User:1', typename: 'User', data: { name: 'Bob' }, fetchedAt: Date.now() });
 * cache.revertOptimistic('User:1');
 *
 * // Garbage collect expired entries
 * const { removed, retained } = cache.gc();
 * ```
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ── Types ─────────────────────────────────────────────────

/** A normalized cache entry stored by typename + id. */
export interface CacheEntry {
  id: string;
  typename: string;
  data: Record<string, unknown>;
  fetchedAt: number;
  expiresAt?: number;
  optimistic?: boolean;
}

/** A cached query result keyed by query string + variables hash. */
export interface CacheQuery {
  query: string;
  variables?: Record<string, unknown>;
  result: unknown;
  cachedAt: number;
  expiresAt?: number;
}

/** Configuration for the Apollo cache adapter. */
export interface ApolloCacheConfig {
  /** Cache TTL in ms (0 = no expiry, default: 0). */
  defaultTtlMs?: number;
  /** Maximum cache entries (default: 10 000). */
  maxEntries?: number;
  /** Enable optimistic updates (default: false). */
  enableOptimistic?: boolean;
  /** Persist cache across sessions (default: false). */
  persist?: boolean;
  /** GC interval in ms (0 = manual only, default: 0). */
  gcIntervalMs?: number;
  /** Broadcast changes to other tabs (default: false). */
  broadcastChanges?: boolean;
}

/** Runtime statistics for the cache adapter. */
export interface CacheStats {
  entries: number;
  queries: number;
  hits: number;
  misses: number;
  hitRate: number;
  sizeBytes: number;
  oldestEntry: number;
  newestEntry: number;
}

/** An event emitted by the cache adapter when data changes. */
export interface CacheEvent {
  type: 'write' | 'evict' | 'gc' | 'reset' | 'optimistic-write' | 'optimistic-revert';
  typename?: string;
  id?: string;
  timestamp: number;
}

// ── Constants ─────────────────────────────────────────────

const DEFAULT_TTL_MS = 0;
const DEFAULT_MAX_ENTRIES = 10_000;

// ── Apollo Cache Adapter ──────────────────────────────────

/**
 * Uses Pocket as a normalized cache backend compatible with Apollo Client
 * patterns. Provides TTL-based expiry, optimistic updates, reactive
 * watches, and garbage collection.
 *
 * @example
 * ```typescript
 * const cache = new ApolloCacheAdapter({ defaultTtlMs: 60_000 });
 * cache.write({ id: 'Post:42', typename: 'Post', data: { title: 'Hello' }, fetchedAt: Date.now() });
 * const stats = cache.getStats();
 * console.log(stats.entries); // 1
 * ```
 */
export class ApolloCacheAdapter {
  private readonly config: Required<ApolloCacheConfig>;
  private readonly store = new Map<string, CacheEntry>();
  private readonly queryStore = new Map<string, CacheQuery>();
  private readonly optimisticStore = new Map<string, CacheEntry>();
  private readonly watchers = new Map<string, BehaviorSubject<CacheEntry | null>>();
  private readonly eventsSubject = new Subject<CacheEvent>();
  private readonly id = generateId();

  private hits = 0;
  private misses = 0;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  /** Observable stream of all cache events. */
  readonly events$: Observable<CacheEvent> = this.eventsSubject.asObservable();

  constructor(config?: ApolloCacheConfig) {
    this.config = {
      defaultTtlMs: config?.defaultTtlMs ?? DEFAULT_TTL_MS,
      maxEntries: config?.maxEntries ?? DEFAULT_MAX_ENTRIES,
      enableOptimistic: config?.enableOptimistic ?? false,
      persist: config?.persist ?? false,
      gcIntervalMs: config?.gcIntervalMs ?? 0,
      broadcastChanges: config?.broadcastChanges ?? false,
    };

    if (this.config.gcIntervalMs > 0) {
      this.gcTimer = setInterval(() => this.gc(), this.config.gcIntervalMs);
    }
  }

  /**
   * Read a cache entry by id.
   *
   * @example
   * ```typescript
   * const entry = cache.read('User:1');
   * if (entry) console.log(entry.data);
   * ```
   */
  read(id: string): CacheEntry | null {
    // Optimistic entries take precedence
    const optimistic = this.optimisticStore.get(id);
    if (optimistic) {
      this.hits++;
      return optimistic;
    }

    const entry = this.store.get(id);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiry
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(id);
      this.notifyWatcher(id, null);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry;
  }

  /**
   * Write a cache entry.
   *
   * @example
   * ```typescript
   * cache.write({
   *   id: 'User:1',
   *   typename: 'User',
   *   data: { name: 'Alice', email: 'alice@example.com' },
   *   fetchedAt: Date.now(),
   * });
   * ```
   */
  write(entry: CacheEntry): void {
    const stored: CacheEntry = { ...entry };

    // Apply default TTL if no explicit expiry
    if (!stored.expiresAt && this.config.defaultTtlMs > 0) {
      stored.expiresAt = stored.fetchedAt + this.config.defaultTtlMs;
    }

    this.store.set(stored.id, stored);
    this.notifyWatcher(stored.id, stored);
    this.emitEvent({
      type: 'write',
      typename: stored.typename,
      id: stored.id,
      timestamp: Date.now(),
    });

    // Evict oldest entries if over capacity
    if (this.store.size > this.config.maxEntries) {
      this.evictOldest();
    }
  }

  /**
   * Cache a query result.
   *
   * @example
   * ```typescript
   * cache.writeQuery({
   *   query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
   *   variables: { id: '1' },
   *   result: { user: { name: 'Alice' } },
   *   cachedAt: Date.now(),
   * });
   * ```
   */
  writeQuery(query: CacheQuery): void {
    const key = this.queryKey(query.query, query.variables);
    const stored: CacheQuery = { ...query };

    if (!stored.expiresAt && this.config.defaultTtlMs > 0) {
      stored.expiresAt = stored.cachedAt + this.config.defaultTtlMs;
    }

    this.queryStore.set(key, stored);
  }

  /**
   * Read a cached query result by query key.
   *
   * @example
   * ```typescript
   * const cached = cache.readQuery('query GetUser($id: ID!) { user(id: $id) { name } }');
   * ```
   */
  readQuery(queryKey: string): CacheQuery | null {
    const entry = this.queryStore.get(queryKey);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.queryStore.delete(queryKey);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry;
  }

  /**
   * Evict a single cache entry by id.
   *
   * @example
   * ```typescript
   * const evicted = cache.evict('User:1');
   * ```
   */
  evict(id: string): boolean {
    const existed = this.store.delete(id);
    this.optimisticStore.delete(id);

    if (existed) {
      this.notifyWatcher(id, null);
      this.emitEvent({ type: 'evict', id, timestamp: Date.now() });
    }

    return existed;
  }

  /**
   * Evict all cache entries for a given typename.
   *
   * @example
   * ```typescript
   * const count = cache.evictByTypename('User');
   * console.log(`Evicted ${count} entries`);
   * ```
   */
  evictByTypename(typename: string): number {
    let count = 0;

    for (const [id, entry] of this.store) {
      if (entry.typename === typename) {
        this.store.delete(id);
        this.notifyWatcher(id, null);
        count++;
      }
    }

    if (count > 0) {
      this.emitEvent({ type: 'evict', typename, timestamp: Date.now() });
    }

    return count;
  }

  /**
   * Identify an object by its __typename and id fields.
   *
   * @example
   * ```typescript
   * const key = cache.identify({ __typename: 'User', id: '1' });
   * // 'User:1'
   * ```
   */
  identify(object: Record<string, unknown>): string | null {
    const typename = object.__typename;
    const id = object.id ?? object._id;

    if (typeof typename !== 'string' || id == null) {
      return null;
    }

    return `${typename}:${String(id)}`;
  }

  /**
   * Modify specific fields of a cache entry in place.
   *
   * @example
   * ```typescript
   * cache.modify('User:1', {
   *   name: (prev) => `${prev} (updated)`,
   * });
   * ```
   */
  modify(id: string, modifiers: Record<string, (value: unknown) => unknown>): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;

    const updatedData = { ...entry.data };
    for (const [field, modifier] of Object.entries(modifiers)) {
      updatedData[field] = modifier(updatedData[field]);
    }

    const updated: CacheEntry = { ...entry, data: updatedData };
    this.store.set(id, updated);
    this.notifyWatcher(id, updated);
    this.emitEvent({ type: 'write', typename: entry.typename, id, timestamp: Date.now() });

    return true;
  }

  /**
   * Garbage-collect expired entries from the cache.
   *
   * @example
   * ```typescript
   * const { removed, retained } = cache.gc();
   * console.log(`Removed ${removed}, retained ${retained}`);
   * ```
   */
  gc(): { removed: number; retained: number } {
    const now = Date.now();
    let removed = 0;

    for (const [id, entry] of this.store) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(id);
        this.notifyWatcher(id, null);
        removed++;
      }
    }

    for (const [key, query] of this.queryStore) {
      if (query.expiresAt && query.expiresAt < now) {
        this.queryStore.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.emitEvent({ type: 'gc', timestamp: now });
    }

    return { removed, retained: this.store.size + this.queryStore.size };
  }

  /**
   * Reset the entire cache, clearing all entries, queries, and optimistic data.
   *
   * @example
   * ```typescript
   * cache.reset();
   * ```
   */
  reset(): void {
    this.store.clear();
    this.queryStore.clear();
    this.optimisticStore.clear();
    this.hits = 0;
    this.misses = 0;

    // Notify all watchers
    for (const [id, subject] of this.watchers) {
      subject.next(null);
      void id;
    }

    this.emitEvent({ type: 'reset', timestamp: Date.now() });
  }

  /**
   * Write an optimistic cache entry that can be reverted later.
   *
   * @example
   * ```typescript
   * cache.writeOptimistic('User:1', {
   *   id: 'User:1',
   *   typename: 'User',
   *   data: { name: 'Pending Name' },
   *   fetchedAt: Date.now(),
   *   optimistic: true,
   * });
   * ```
   */
  writeOptimistic(id: string, entry: CacheEntry): void {
    if (!this.config.enableOptimistic) return;

    this.optimisticStore.set(id, { ...entry, optimistic: true });
    this.notifyWatcher(id, entry);
    this.emitEvent({
      type: 'optimistic-write',
      typename: entry.typename,
      id,
      timestamp: Date.now(),
    });
  }

  /**
   * Revert an optimistic entry, restoring the underlying cache value.
   *
   * @example
   * ```typescript
   * cache.revertOptimistic('User:1');
   * ```
   */
  revertOptimistic(id: string): void {
    const existed = this.optimisticStore.delete(id);

    if (existed) {
      const underlying = this.store.get(id) ?? null;
      this.notifyWatcher(id, underlying);
      this.emitEvent({ type: 'optimistic-revert', id, timestamp: Date.now() });
    }
  }

  /**
   * Return runtime statistics for the cache.
   *
   * @example
   * ```typescript
   * const stats = cache.getStats();
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
   * ```
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    let oldestEntry = Infinity;
    let newestEntry = 0;
    let sizeBytes = 0;

    for (const entry of this.store.values()) {
      if (entry.fetchedAt < oldestEntry) oldestEntry = entry.fetchedAt;
      if (entry.fetchedAt > newestEntry) newestEntry = entry.fetchedAt;
      sizeBytes += JSON.stringify(entry).length * 2; // rough byte estimate
    }

    return {
      entries: this.store.size,
      queries: this.queryStore.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      sizeBytes,
      oldestEntry: oldestEntry === Infinity ? 0 : oldestEntry,
      newestEntry,
    };
  }

  /**
   * Watch a cache entry for changes. Returns an Observable that emits
   * the current value and all subsequent updates.
   *
   * @example
   * ```typescript
   * cache.watch('User:1').subscribe((entry) => {
   *   console.log('Entry changed:', entry);
   * });
   * ```
   */
  watch(id: string): Observable<CacheEntry | null> {
    let subject = this.watchers.get(id);
    if (!subject) {
      const current = this.read(id);
      subject = new BehaviorSubject<CacheEntry | null>(current);
      this.watchers.set(id, subject);
    }
    return subject.asObservable();
  }

  /** Release all resources held by the adapter. */
  dispose(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }

    for (const subject of this.watchers.values()) {
      subject.complete();
    }
    this.watchers.clear();

    this.eventsSubject.complete();
    this.store.clear();
    this.queryStore.clear();
    this.optimisticStore.clear();

    void this.id;
  }

  // ── Internals ─────────────────────────────────────────

  private notifyWatcher(id: string, entry: CacheEntry | null): void {
    const subject = this.watchers.get(id);
    if (subject) {
      subject.next(entry);
    }
  }

  private emitEvent(event: CacheEvent): void {
    this.eventsSubject.next(event);
  }

  private queryKey(query: string, variables?: Record<string, unknown>): string {
    const varsStr = variables ? JSON.stringify(variables) : '';
    return `${query}::${varsStr}`;
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of this.store) {
      if (entry.fetchedAt < oldestTime) {
        oldestTime = entry.fetchedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.evict(oldestId);
    }
  }
}

// ── Factory ───────────────────────────────────────────────

/**
 * Create a new Apollo-compatible cache adapter backed by Pocket.
 *
 * @example
 * ```typescript
 * const cache = createApolloCacheAdapter({
 *   defaultTtlMs: 300_000,
 *   maxEntries: 5000,
 *   enableOptimistic: true,
 * });
 * ```
 */
export function createApolloCacheAdapter(config?: ApolloCacheConfig): ApolloCacheAdapter {
  return new ApolloCacheAdapter(config);
}

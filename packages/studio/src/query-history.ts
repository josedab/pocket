/**
 * Persistent query history with favorites, tags, and export.
 *
 * @module query-history
 */

/** A persisted query history entry */
export interface PersistedQueryEntry {
  readonly id: string;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
  readonly sort?: Record<string, 'asc' | 'desc'>;
  readonly limit?: number;
  readonly executedAt: number;
  readonly durationMs: number;
  readonly resultCount: number;
  readonly name?: string;
  readonly tags: readonly string[];
  readonly isFavorite: boolean;
  readonly error?: string;
}

/** Query history statistics */
export interface QueryHistoryStats {
  readonly totalQueries: number;
  readonly favorites: number;
  readonly uniqueCollections: number;
  readonly avgDurationMs: number;
  readonly errorRate: number;
  readonly topCollections: readonly { collection: string; count: number }[];
  readonly topTags: readonly { tag: string; count: number }[];
}

/** Export format for query history */
export type QueryHistoryExportFormat = 'json' | 'csv';

/**
 * Persistent query history manager.
 *
 * @example
 * ```typescript
 * const history = new QueryHistoryManager({ maxEntries: 500 });
 *
 * history.add({
 *   collection: 'todos',
 *   filter: { completed: false },
 *   durationMs: 12,
 *   resultCount: 42,
 * });
 *
 * // Tag and favorite
 * history.toggleFavorite(entry.id);
 * history.addTag(entry.id, 'perf-test');
 *
 * // Search
 * const recent = history.search({ collection: 'todos', limit: 10 });
 *
 * // Export
 * const json = history.export('json');
 * ```
 */
export class QueryHistoryManager {
  private readonly entries: PersistedQueryEntry[] = [];
  private readonly maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 1000;
  }

  /** Add a query to history */
  add(input: {
    collection: string;
    filter: Record<string, unknown>;
    sort?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    durationMs: number;
    resultCount: number;
    name?: string;
    error?: string;
  }): PersistedQueryEntry {
    const entry: PersistedQueryEntry = {
      id: `qh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      collection: input.collection,
      filter: input.filter,
      sort: input.sort,
      limit: input.limit,
      executedAt: Date.now(),
      durationMs: input.durationMs,
      resultCount: input.resultCount,
      name: input.name,
      tags: [],
      isFavorite: false,
      error: input.error,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      // Remove oldest non-favorite
      const idx = this.entries.findIndex((e) => !e.isFavorite);
      if (idx >= 0) this.entries.splice(idx, 1);
      else this.entries.shift();
    }

    return entry;
  }

  /** Get all entries */
  getAll(): readonly PersistedQueryEntry[] {
    return this.entries;
  }

  /** Get entry by ID */
  getById(id: string): PersistedQueryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Search entries */
  search(criteria: {
    collection?: string;
    tags?: string[];
    favoritesOnly?: boolean;
    limit?: number;
    since?: number;
  }): readonly PersistedQueryEntry[] {
    let results = [...this.entries];

    if (criteria.collection) {
      results = results.filter((e) => e.collection === criteria.collection);
    }
    if (criteria.tags && criteria.tags.length > 0) {
      results = results.filter((e) => criteria.tags!.some((t) => e.tags.includes(t)));
    }
    if (criteria.favoritesOnly) {
      results = results.filter((e) => e.isFavorite);
    }
    if (criteria.since) {
      results = results.filter((e) => e.executedAt >= criteria.since!);
    }

    results.sort((a, b) => b.executedAt - a.executedAt);

    if (criteria.limit) {
      results = results.slice(0, criteria.limit);
    }

    return results;
  }

  /** Toggle favorite status */
  toggleFavorite(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const entry = this.entries[idx]!;
    this.entries[idx] = { ...entry, isFavorite: !entry.isFavorite };
    return true;
  }

  /** Add a tag to an entry */
  addTag(id: string, tag: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const entry = this.entries[idx]!;
    if (entry.tags.includes(tag)) return false;
    this.entries[idx] = { ...entry, tags: [...entry.tags, tag] };
    return true;
  }

  /** Remove a tag from an entry */
  removeTag(id: string, tag: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const entry = this.entries[idx]!;
    this.entries[idx] = { ...entry, tags: entry.tags.filter((t) => t !== tag) };
    return true;
  }

  /** Rename a query */
  rename(id: string, name: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries[idx] = { ...this.entries[idx]!, name };
    return true;
  }

  /** Delete an entry */
  delete(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  /** Get statistics */
  getStats(): QueryHistoryStats {
    const total = this.entries.length;
    const favorites = this.entries.filter((e) => e.isFavorite).length;
    const collections = new Map<string, number>();
    const tags = new Map<string, number>();
    let totalDuration = 0;
    let errors = 0;

    for (const e of this.entries) {
      collections.set(e.collection, (collections.get(e.collection) ?? 0) + 1);
      for (const t of e.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
      totalDuration += e.durationMs;
      if (e.error) errors++;
    }

    return {
      totalQueries: total,
      favorites,
      uniqueCollections: collections.size,
      avgDurationMs: total > 0 ? Math.round(totalDuration / total) : 0,
      errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
      topCollections: Array.from(collections.entries())
        .map(([collection, count]) => ({ collection, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topTags: Array.from(tags.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  /** Export history */
  export(format: QueryHistoryExportFormat): string {
    if (format === 'json') {
      return JSON.stringify(this.entries, null, 2);
    }

    // CSV
    const headers = ['id', 'collection', 'filter', 'executedAt', 'durationMs', 'resultCount', 'name', 'tags', 'isFavorite', 'error'];
    const rows = this.entries.map((e) => [
      e.id, e.collection, JSON.stringify(e.filter), e.executedAt,
      e.durationMs, e.resultCount, e.name ?? '', e.tags.join(';'), e.isFavorite, e.error ?? '',
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /** Clear all history */
  clear(): void {
    this.entries.length = 0;
  }

  /** Get entry count */
  get count(): number {
    return this.entries.length;
  }
}

/** Factory function */
export function createQueryHistoryManager(options?: { maxEntries?: number }): QueryHistoryManager {
  return new QueryHistoryManager(options);
}

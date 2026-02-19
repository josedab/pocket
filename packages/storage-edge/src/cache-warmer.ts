/**
 * Cache warming and prefetch for edge sync mesh.
 *
 * Warms regional caches based on access patterns and provides
 * explicit prefetch API for anticipated data needs.
 *
 * @module cache-warmer
 */

import type { EdgeRegion } from './global-sync-mesh.js';

/** Access pattern entry */
export interface AccessPattern {
  readonly collection: string;
  readonly region: EdgeRegion;
  readonly accessCount: number;
  readonly lastAccessAt: number;
  readonly avgResponseMs: number;
}

/** Prefetch request */
export interface PrefetchRequest {
  readonly collection: string;
  readonly targetRegions: readonly EdgeRegion[];
  readonly filter?: Record<string, unknown>;
  readonly priority: 'high' | 'normal' | 'low';
}

/** Prefetch result */
export interface PrefetchResult {
  readonly request: PrefetchRequest;
  readonly regionsWarmed: readonly EdgeRegion[];
  readonly documentsWarmed: number;
  readonly durationMs: number;
  readonly timestamp: number;
}

/** Cache warmer configuration */
export interface CacheWarmerConfig {
  /** Minimum access count before auto-warming (default: 5) */
  readonly minAccessCount?: number;
  /** Maximum regions to warm per pattern (default: 3) */
  readonly maxRegionsToWarm?: number;
  /** Auto-warm interval in ms (default: 60000) */
  readonly autoWarmIntervalMs?: number;
  /** Maximum concurrent prefetch operations (default: 3) */
  readonly maxConcurrent?: number;
}

/**
 * Predictive cache warmer for edge sync mesh.
 *
 * @example
 * ```typescript
 * const warmer = new CacheWarmer({ minAccessCount: 5 });
 *
 * // Record accesses
 * warmer.recordAccess('todos', 'us-east', 15);
 * warmer.recordAccess('todos', 'eu-west', 20);
 *
 * // Get warming recommendations
 * const recs = warmer.getWarmingRecommendations();
 * for (const req of recs) {
 *   const result = await warmer.executePrefetch(req);
 *   console.log(`Warmed ${result.documentsWarmed} docs in ${result.regionsWarmed}`);
 * }
 *
 * // Or explicit prefetch
 * await warmer.prefetch({
 *   collection: 'users',
 *   targetRegions: ['eu-west', 'ap-northeast'],
 *   priority: 'high',
 * });
 * ```
 */
export class CacheWarmer {
  private readonly config: Required<CacheWarmerConfig>;
  private readonly patterns = new Map<string, AccessPattern>();
  private readonly prefetchHistory: PrefetchResult[] = [];

  constructor(config: CacheWarmerConfig = {}) {
    this.config = {
      minAccessCount: config.minAccessCount ?? 5,
      maxRegionsToWarm: config.maxRegionsToWarm ?? 3,
      autoWarmIntervalMs: config.autoWarmIntervalMs ?? 60_000,
      maxConcurrent: config.maxConcurrent ?? 3,
    };
  }

  /** Record an access pattern */
  recordAccess(collection: string, region: EdgeRegion, responseMs: number): void {
    const key = `${collection}:${region}`;
    const existing = this.patterns.get(key);

    if (existing) {
      const newCount = existing.accessCount + 1;
      const avgMs = (existing.avgResponseMs * existing.accessCount + responseMs) / newCount;
      this.patterns.set(key, {
        ...existing,
        accessCount: newCount,
        lastAccessAt: Date.now(),
        avgResponseMs: Math.round(avgMs * 100) / 100,
      });
    } else {
      this.patterns.set(key, {
        collection,
        region,
        accessCount: 1,
        lastAccessAt: Date.now(),
        avgResponseMs: responseMs,
      });
    }
  }

  /** Get warming recommendations based on access patterns */
  getWarmingRecommendations(): PrefetchRequest[] {
    const hotPatterns = Array.from(this.patterns.values())
      .filter((p) => p.accessCount >= this.config.minAccessCount)
      .sort((a, b) => b.accessCount - a.accessCount);

    // Group by collection
    const collectionRegions = new Map<string, EdgeRegion[]>();
    for (const pattern of hotPatterns) {
      let regions = collectionRegions.get(pattern.collection);
      if (!regions) {
        regions = [];
        collectionRegions.set(pattern.collection, regions);
      }
      if (regions.length < this.config.maxRegionsToWarm) {
        regions.push(pattern.region);
      }
    }

    return Array.from(collectionRegions.entries()).map(([collection, targetRegions]) => ({
      collection,
      targetRegions,
      priority: 'normal' as const,
    }));
  }

  /** Execute a prefetch request (simulated) */
  async executePrefetch(request: PrefetchRequest): Promise<PrefetchResult> {
    const start = Date.now();

    // In a real implementation, this would fetch data and push to regional caches
    const docsPerRegion = 100; // simulated
    const result: PrefetchResult = {
      request,
      regionsWarmed: request.targetRegions,
      documentsWarmed: docsPerRegion * request.targetRegions.length,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };

    this.prefetchHistory.push(result);
    if (this.prefetchHistory.length > 1000) this.prefetchHistory.shift();

    return result;
  }

  /** Shorthand to prefetch a collection to regions */
  async prefetch(request: PrefetchRequest): Promise<PrefetchResult> {
    return this.executePrefetch(request);
  }

  /** Get all tracked access patterns */
  getPatterns(): readonly AccessPattern[] {
    return Array.from(this.patterns.values());
  }

  /** Get hot collections (above access threshold) */
  getHotCollections(): string[] {
    const hot = new Set<string>();
    for (const p of this.patterns.values()) {
      if (p.accessCount >= this.config.minAccessCount) hot.add(p.collection);
    }
    return Array.from(hot);
  }

  /** Get prefetch history */
  getPrefetchHistory(): readonly PrefetchResult[] {
    return this.prefetchHistory;
  }

  /** Clear all patterns and history */
  clear(): void {
    this.patterns.clear();
    this.prefetchHistory.length = 0;
  }
}

/** Factory function */
export function createCacheWarmer(config?: CacheWarmerConfig): CacheWarmer {
  return new CacheWarmer(config);
}

/**
 * @pocket/storage-tiering — Adaptive storage tiering manager.
 *
 * Automatically moves data between storage backends based on access
 * patterns, data size, and configured policies. Provides transparent
 * read/write through the tiered storage stack.
 *
 * @module @pocket/storage-tiering
 */

import { BehaviorSubject, type Observable, Subject, type Subscription, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type {
  AccessRecord,
  StorageTier,
  StorageTieringConfig,
  TierConfig,
  TierStorageBackend,
  TieringDecision,
  TieringEvent,
  TieringPolicy,
  TieringStats,
} from './types.js';

// ── In-Memory Storage Backend ─────────────────────────────

export class MemoryTierBackend implements TierStorageBackend {
  readonly tier: StorageTier = 'memory';
  private readonly store = new Map<string, unknown>();

  async get(key: string): Promise<unknown | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// ── Default Tiering Policies ──────────────────────────────

/** Promotes frequently accessed data to faster tiers */
export const accessFrequencyPolicy: TieringPolicy = {
  name: 'access-frequency',
  evaluate(record, config) {
    const threshold = config.promotionThreshold ?? 10;
    const tiers = config.tiers.filter((t) => t.available).sort((a, b) => a.priority - b.priority);
    const currentIdx = tiers.findIndex((t) => t.tier === record.currentTier);

    if (record.accessCount >= threshold && currentIdx > 0) {
      return tiers[currentIdx - 1]!.tier;
    }
    return null;
  },
};

/** Demotes data that hasn't been accessed recently */
export const coldDataPolicy: TieringPolicy = {
  name: 'cold-data',
  evaluate(record, config) {
    const demotionTime = config.demotionTimeMs ?? 5 * 60 * 1000;
    const tiers = config.tiers.filter((t) => t.available).sort((a, b) => a.priority - b.priority);
    const currentIdx = tiers.findIndex((t) => t.tier === record.currentTier);
    const timeSinceAccess = Date.now() - record.lastAccessedAt;

    if (timeSinceAccess > demotionTime && currentIdx < tiers.length - 1) {
      return tiers[currentIdx + 1]!.tier;
    }
    return null;
  },
};

/** Moves large data to tiers with more capacity */
export const dataSizePolicy: TieringPolicy = {
  name: 'data-size',
  evaluate(record, config) {
    const tiers = config.tiers.filter((t) => t.available).sort((a, b) => a.priority - b.priority);
    const currentTier = tiers.find((t) => t.tier === record.currentTier);

    if (currentTier && currentTier.maxSizeBytes > 0 && record.dataSizeBytes > currentTier.maxSizeBytes * 0.1) {
      // Large items should be in slower, larger tiers
      const currentIdx = tiers.indexOf(currentTier);
      if (currentIdx < tiers.length - 1) {
        return tiers[currentIdx + 1]!.tier;
      }
    }
    return null;
  },
};

// ── Tiering Manager ───────────────────────────────────────

const DEFAULT_CONFIG: Required<StorageTieringConfig> = {
  tiers: [
    { tier: 'memory', maxSizeBytes: 50 * 1024 * 1024, latencyBudgetMs: 1, available: true, priority: 0 },
    { tier: 'indexeddb', maxSizeBytes: 500 * 1024 * 1024, latencyBudgetMs: 10, available: true, priority: 1 },
    { tier: 'opfs', maxSizeBytes: 1024 * 1024 * 1024, latencyBudgetMs: 20, available: true, priority: 2 },
    { tier: 'sqlite', maxSizeBytes: 0, latencyBudgetMs: 5, available: true, priority: 3 },
  ],
  rebalanceIntervalMs: 60_000,
  promotionThreshold: 10,
  demotionTimeMs: 5 * 60 * 1000,
  autoTier: true,
  minDataSizeBytes: 0,
};

/**
 * Manages transparent data tiering across storage backends.
 */
export class StorageTieringManager {
  private readonly config: Required<StorageTieringConfig>;
  private readonly backends = new Map<StorageTier, TierStorageBackend>();
  private readonly accessRecords = new Map<string, AccessRecord>();
  private readonly policies: TieringPolicy[];
  private readonly events$$ = new Subject<TieringEvent>();
  private readonly stats$$: BehaviorSubject<TieringStats>;
  private readonly destroy$ = new Subject<void>();
  private rebalanceSub: Subscription | null = null;
  private promotions = 0;
  private demotions = 0;
  private totalMigrations = 0;
  private lastRebalanceAt: number | null = null;

  readonly events$ = this.events$$.asObservable();

  constructor(
    config?: Partial<StorageTieringConfig>,
    policies?: TieringPolicy[],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<StorageTieringConfig>;
    this.policies = policies ?? [accessFrequencyPolicy, coldDataPolicy, dataSizePolicy];

    this.stats$$ = new BehaviorSubject<TieringStats>(this.buildStats());

    // Start auto-rebalance
    if (this.config.autoTier && this.config.rebalanceIntervalMs > 0) {
      this.rebalanceSub = interval(this.config.rebalanceIntervalMs)
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => { void this.rebalance(); });
    }
  }

  get stats$(): Observable<TieringStats> {
    return this.stats$$.asObservable();
  }

  /** Register a storage backend for a tier */
  registerBackend(backend: TierStorageBackend): void {
    this.backends.set(backend.tier, backend);
  }

  /**
   * Read data — searches tiers from fastest to slowest.
   * Automatically tracks access patterns.
   */
  async get(key: string, collection = 'default'): Promise<unknown | null> {
    const tiers = this.getOrderedTiers();

    for (const tierConfig of tiers) {
      const backend = this.backends.get(tierConfig.tier);
      if (!backend) continue;

      const value = await backend.get(key);
      if (value !== null && value !== undefined) {
        this.recordAccess(key, collection, tierConfig.tier);
        return value;
      }
    }

    return null;
  }

  /**
   * Write data — writes to the appropriate tier based on data characteristics.
   */
  async set(key: string, value: unknown, collection = 'default'): Promise<void> {
    const sizeBytes = estimateSize(value);
    const targetTier = this.selectTierForWrite(sizeBytes);
    const backend = this.backends.get(targetTier);

    if (!backend) {
      throw new Error(`No backend registered for tier "${targetTier}"`);
    }

    await backend.set(key, value, sizeBytes);
    this.recordAccess(key, collection, targetTier, sizeBytes);
  }

  /** Delete data from all tiers */
  async delete(key: string): Promise<void> {
    for (const backend of this.backends.values()) {
      await backend.delete(key);
    }
    this.accessRecords.delete(key);
  }

  /** Check if data exists in any tier */
  async has(key: string): Promise<boolean> {
    for (const backend of this.backends.values()) {
      if (await backend.has(key)) return true;
    }
    return false;
  }

  /**
   * Rebalance data across tiers based on access patterns.
   * Evaluates all policies and executes migration decisions.
   */
  async rebalance(): Promise<TieringDecision[]> {
    const decisions: TieringDecision[] = [];

    for (const [key, record] of this.accessRecords) {
      for (const policy of this.policies) {
        const targetTier = policy.evaluate(record, this.config);
        if (targetTier && targetTier !== record.currentTier) {
          decisions.push({
            key,
            collection: record.collection,
            fromTier: record.currentTier,
            toTier: targetTier,
            reason: policy.name,
            dataSizeBytes: record.dataSizeBytes,
          });
          break; // First matching policy wins
        }
      }
    }

    // Execute migrations
    for (const decision of decisions) {
      await this.migrateData(decision);
    }

    this.lastRebalanceAt = Date.now();
    this.events$$.next({ type: 'rebalanced', decisions });
    this.stats$$.next(this.buildStats());

    return decisions;
  }

  /** Get current statistics */
  getStats(): TieringStats {
    return this.buildStats();
  }

  /** Manually promote data to a faster tier */
  async promote(key: string): Promise<boolean> {
    const record = this.accessRecords.get(key);
    if (!record) return false;

    const tiers = this.getOrderedTiers();
    const currentIdx = tiers.findIndex((t) => t.tier === record.currentTier);
    if (currentIdx <= 0) return false;

    const targetTier = tiers[currentIdx - 1]!.tier;
    await this.migrateData({
      key,
      collection: record.collection,
      fromTier: record.currentTier,
      toTier: targetTier,
      reason: 'manual-promote',
      dataSizeBytes: record.dataSizeBytes,
    });

    return true;
  }

  /** Manually demote data to a slower tier */
  async demote(key: string): Promise<boolean> {
    const record = this.accessRecords.get(key);
    if (!record) return false;

    const tiers = this.getOrderedTiers();
    const currentIdx = tiers.findIndex((t) => t.tier === record.currentTier);
    if (currentIdx >= tiers.length - 1) return false;

    const targetTier = tiers[currentIdx + 1]!.tier;
    await this.migrateData({
      key,
      collection: record.collection,
      fromTier: record.currentTier,
      toTier: targetTier,
      reason: 'manual-demote',
      dataSizeBytes: record.dataSizeBytes,
    });

    return true;
  }

  /** Dispose of the manager */
  dispose(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.rebalanceSub?.unsubscribe();
    this.events$$.complete();
    this.stats$$.complete();
  }

  // ── Internals ─────────────────────────────────────────

  private async migrateData(decision: TieringDecision): Promise<void> {
    const fromBackend = this.backends.get(decision.fromTier);
    const toBackend = this.backends.get(decision.toTier);

    if (!fromBackend || !toBackend) return;

    try {
      const data = await fromBackend.get(decision.key);
      if (data === null || data === undefined) return;

      await toBackend.set(decision.key, data, decision.dataSizeBytes);
      await fromBackend.delete(decision.key);

      // Update access record
      const record = this.accessRecords.get(decision.key);
      if (record) {
        record.currentTier = decision.toTier;
      }

      const isPromotion = this.getTierPriority(decision.toTier) < this.getTierPriority(decision.fromTier);
      if (isPromotion) {
        this.promotions++;
        this.events$$.next({ type: 'promoted', key: decision.key, from: decision.fromTier, to: decision.toTier });
      } else {
        this.demotions++;
        this.events$$.next({ type: 'demoted', key: decision.key, from: decision.fromTier, to: decision.toTier });
      }
      this.totalMigrations++;
    } catch (err) {
      this.events$$.next({ type: 'error', message: `Migration failed for "${decision.key}": ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private recordAccess(key: string, collection: string, tier: StorageTier, sizeBytes?: number): void {
    const existing = this.accessRecords.get(key);
    if (existing) {
      existing.accessCount++;
      existing.lastAccessedAt = Date.now();
      existing.currentTier = tier;
      if (sizeBytes !== undefined) existing.dataSizeBytes = sizeBytes;
    } else {
      this.accessRecords.set(key, {
        key,
        collection,
        accessCount: 1,
        lastAccessedAt: Date.now(),
        firstAccessedAt: Date.now(),
        dataSizeBytes: sizeBytes ?? 0,
        currentTier: tier,
      });
    }
  }

  private selectTierForWrite(sizeBytes: number): StorageTier {
    const tiers = this.getOrderedTiers();

    // Small data goes to fastest tier, large data to slower tiers
    for (const tier of tiers) {
      if (tier.maxSizeBytes === 0 || sizeBytes < tier.maxSizeBytes * 0.5) {
        const backend = this.backends.get(tier.tier);
        if (backend) return tier.tier;
      }
    }

    // Fallback to last available tier
    const lastTier = tiers[tiers.length - 1];
    return lastTier?.tier ?? 'memory';
  }

  private getOrderedTiers(): TierConfig[] {
    return this.config.tiers
      .filter((t) => t.available && this.backends.has(t.tier))
      .sort((a, b) => a.priority - b.priority);
  }

  private getTierPriority(tier: StorageTier): number {
    return this.config.tiers.find((t) => t.tier === tier)?.priority ?? 99;
  }

  private buildStats(): TieringStats {
    const tierDistribution: Record<string, { count: number; sizeBytes: number }> = {};
    for (const tier of this.config.tiers) {
      tierDistribution[tier.tier] = { count: 0, sizeBytes: 0 };
    }

    const accessCounts: { key: string; count: number; lastAccess: number }[] = [];
    for (const [key, record] of this.accessRecords) {
      const dist = tierDistribution[record.currentTier];
      if (dist) {
        dist.count++;
        dist.sizeBytes += record.dataSizeBytes;
      }
      accessCounts.push({ key, count: record.accessCount, lastAccess: record.lastAccessedAt });
    }

    accessCounts.sort((a, b) => b.count - a.count);
    const hotKeys = accessCounts.slice(0, 10).map((a) => a.key);

    accessCounts.sort((a, b) => a.lastAccess - b.lastAccess);
    const coldKeys = accessCounts.slice(0, 10).map((a) => a.key);

    return {
      tierDistribution: tierDistribution as Record<StorageTier, { count: number; sizeBytes: number }>,
      promotions: this.promotions,
      demotions: this.demotions,
      totalMigrations: this.totalMigrations,
      lastRebalanceAt: this.lastRebalanceAt,
      hotKeys,
      coldKeys,
    };
  }
}

function estimateSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 256;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create an adaptive storage tiering manager */
export function createStorageTiering(
  config?: Partial<StorageTieringConfig>,
  policies?: TieringPolicy[],
): StorageTieringManager {
  return new StorageTieringManager(config, policies);
}

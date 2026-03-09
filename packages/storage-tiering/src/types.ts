/**
 * @pocket/storage-tiering — Types for the adaptive storage tiering system.
 *
 * @module @pocket/storage-tiering
 */

// ── Storage Tier Types ────────────────────────────────────

export type StorageTier = 'memory' | 'indexeddb' | 'opfs' | 'sqlite';

export interface TierConfig {
  tier: StorageTier;
  /** Maximum storage size in bytes (0 = unlimited) */
  maxSizeBytes: number;
  /** Read latency budget (ms) — data accessed more frequently stays in faster tiers */
  latencyBudgetMs: number;
  /** Whether this tier is available in the current environment */
  available: boolean;
  /** Priority (lower = faster, preferred for hot data) */
  priority: number;
}

export interface StorageTieringConfig {
  /** Configured tiers in order of speed (fastest first) */
  tiers: TierConfig[];
  /** How often to analyze access patterns and rebalance (ms, default: 60_000) */
  rebalanceIntervalMs?: number;
  /** Number of accesses before data is promoted to a faster tier */
  promotionThreshold?: number;
  /** Time without access before data is demoted to a slower tier (ms) */
  demotionTimeMs?: number;
  /** Enable automatic tiering (default: true) */
  autoTier?: boolean;
  /** Minimum data size to consider for tiering (bytes, default: 0) */
  minDataSizeBytes?: number;
}

export interface AccessRecord {
  key: string;
  collection: string;
  accessCount: number;
  lastAccessedAt: number;
  firstAccessedAt: number;
  dataSizeBytes: number;
  currentTier: StorageTier;
}

export interface TieringDecision {
  key: string;
  collection: string;
  fromTier: StorageTier;
  toTier: StorageTier;
  reason: string;
  dataSizeBytes: number;
}

export interface TieringStats {
  tierDistribution: Record<StorageTier, { count: number; sizeBytes: number }>;
  promotions: number;
  demotions: number;
  totalMigrations: number;
  lastRebalanceAt: number | null;
  hotKeys: string[];
  coldKeys: string[];
}

export type TieringEvent =
  | { type: 'promoted'; key: string; from: StorageTier; to: StorageTier }
  | { type: 'demoted'; key: string; from: StorageTier; to: StorageTier }
  | { type: 'rebalanced'; decisions: TieringDecision[] }
  | { type: 'tier_full'; tier: StorageTier; sizeBytes: number }
  | { type: 'error'; message: string };

// ── Storage Backend Interface ─────────────────────────────

export interface TierStorageBackend {
  tier: StorageTier;
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, sizeBytes?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  size(): Promise<number>;
  clear(): Promise<void>;
}

// ── Policy Types ──────────────────────────────────────────

export interface TieringPolicy {
  name: string;
  evaluate(record: AccessRecord, config: StorageTieringConfig): StorageTier | null;
}

/**
 * @pocket/storage-tiering — Adaptive storage tiering for Pocket databases.
 *
 * Automatically moves data between storage backends (memory, IndexedDB,
 * OPFS, SQLite) based on access patterns, data size, and performance
 * requirements.
 *
 * @example
 * ```ts
 * import { createStorageTiering, MemoryTierBackend } from '@pocket/storage-tiering';
 *
 * const tiering = createStorageTiering({
 *   tiers: [
 *     { tier: 'memory', maxSizeBytes: 50_000_000, latencyBudgetMs: 1, available: true, priority: 0 },
 *     { tier: 'indexeddb', maxSizeBytes: 500_000_000, latencyBudgetMs: 10, available: true, priority: 1 },
 *   ],
 *   promotionThreshold: 5,
 *   demotionTimeMs: 300_000,
 * });
 *
 * tiering.registerBackend(new MemoryTierBackend());
 * // tiering.registerBackend(new IndexedDBTierBackend());
 *
 * await tiering.set('doc:123', { name: 'Alice' });
 * const doc = await tiering.get('doc:123');
 *
 * // Data is automatically promoted/demoted based on access patterns
 * const decisions = await tiering.rebalance();
 * ```
 *
 * @module @pocket/storage-tiering
 */

// Types
export type {
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

// Manager
export {
  MemoryTierBackend,
  StorageTieringManager,
  accessFrequencyPolicy,
  coldDataPolicy,
  createStorageTiering,
  dataSizePolicy,
} from './tiering-manager.js';

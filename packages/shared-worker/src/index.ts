/**
 * @module @pocket/shared-worker
 * Multi-Tab/Multi-Worker coordination with leader election, SharedWorker DB proxy,
 * query deduplication, BroadcastChannel sync, and graceful degradation.
 */

export * from './broadcast-adapter.js';
export * from './leader-election.js';
export * from './query-dedup.js';
export * from './tab-coordinator.js';
export type * from './types.js';

export * from './worker-db-proxy.js';

// Sync connection deduplication
export { createSyncConnectionDedup } from './sync-dedup.js';
export type {
  SyncConnectionDedup,
  SyncConnectionDedupConfig,
  SyncEvent,
  SyncStatus,
} from './sync-dedup.js';

// Write conflict prevention
export { createWriteCoordinator } from './write-coordinator.js';
export type {
  WriteConflict,
  WriteCoordinator,
  WriteCoordinatorConfig,
  WriteLock,
} from './write-coordinator.js';

// Graceful degradation
export { createGracefulDegradation } from './graceful-degradation.js';
export type {
  CapabilityReport,
  CoordinationMode,
  CoordinationStrategy,
  GracefulDegradation,
  GracefulDegradationConfig,
} from './graceful-degradation.js';

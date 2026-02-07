/**
 * @module @pocket/shared-worker
 * Multi-Tab/Multi-Worker coordination with leader election, SharedWorker DB proxy,
 * query deduplication, and BroadcastChannel sync.
 */

export * from './types.js';
export * from './broadcast-adapter.js';
export * from './leader-election.js';
export * from './query-dedup.js';
export * from './tab-coordinator.js';

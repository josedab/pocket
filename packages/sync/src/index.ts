/**
 * @pocket/sync - Synchronization Engine for Pocket
 *
 * This package provides the complete sync layer for synchronizing Pocket
 * databases between clients and servers. It enables multi-device sync,
 * real-time collaboration, and offline-first workflows.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                         Client Application                          │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                          SyncEngine                                  │
 * │                                                                      │
 * │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  │
 * │  │ Checkpoint   │  │ Conflict        │  │ Optimistic Update     │  │
 * │  │ Manager      │  │ Resolver        │  │ Manager               │  │
 * │  │ (progress)   │  │ (LWW/merge)     │  │ (pending changes)     │  │
 * │  └──────────────┘  └─────────────────┘  └───────────────────────┘  │
 * │                                                                      │
 * │  ┌──────────────────────────────────────────────────────────────┐   │
 * │  │                    Transport Layer                            │   │
 * │  │  ┌─────────────────────┐    ┌────────────────────────────┐   │   │
 * │  │  │  WebSocket          │    │  HTTP Polling              │   │   │
 * │  │  │  (real-time)        │    │  (fallback)                │   │   │
 * │  │  └─────────────────────┘    └────────────────────────────┘   │   │
 * │  └──────────────────────────────────────────────────────────────┘   │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                         Sync Server                                  │
 * │                    (@pocket/server package)                          │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createSyncEngine } from '@pocket/sync';
 *
 * const db = await Database.create({ name: 'my-app', storage });
 *
 * const sync = createSyncEngine(db, {
 *   serverUrl: 'wss://sync.example.com',
 *   authToken: userToken,
 *   collections: ['todos', 'notes'],
 *   conflictStrategy: 'last-write-wins'
 * });
 *
 * await sync.start();
 * ```
 *
 * ## Key Features
 *
 * - **Bidirectional Sync**: Push local changes, pull remote changes
 * - **Conflict Resolution**: Last-write-wins, server-wins, client-wins, or custom merge
 * - **Optimistic Updates**: Immediate UI feedback with rollback on failure
 * - **Checkpoints**: Resume sync from where you left off
 * - **Transport Options**: WebSocket (real-time) or HTTP polling
 * - **Selective Sync**: Sync only specific collections or documents
 *
 * ## Sync Protocol Messages
 *
 * | Message Type | Direction | Purpose |
 * |--------------|-----------|---------|
 * | `push` | Client → Server | Send local changes |
 * | `push-response` | Server → Client | Confirm/reject changes |
 * | `pull` | Client → Server | Request remote changes |
 * | `pull-response` | Server → Client | Send changes since checkpoint |
 * | `ack` | Both | Acknowledge receipt |
 * | `error` | Server → Client | Report errors |
 *
 * @packageDocumentation
 * @module @pocket/sync
 *
 * @see {@link SyncEngine} for the main sync class
 * @see {@link SyncConfig} for configuration options
 * @see {@link ConflictStrategy} for conflict resolution strategies
 */

export * from './checkpoint.js';
export * from './conflict.js';
export * from './logger.js';
export * from './optimistic.js';
export * from './rollback.js';
export * from './selective/index.js';
export * from './sync-engine.js';
export * from './transport/index.js';

// Adaptive Sync
export {
  AdaptiveSyncManager,
  createAdaptiveSyncManager,
  type AdaptiveSettings,
  type AdaptiveSyncConfig,
  type AdaptiveSyncStats,
  type NetworkQuality,
  type SyncPriorityItem,
  type SyncProfile,
} from './adaptive-sync.js';

// Device Sync
export {
  DeviceSyncManager,
  createDeviceSyncManager,
  type DeviceCapabilities,
  type DeviceInfo,
  type DeviceSyncConfig,
  type DeviceSyncStats,
  type SyncRule,
} from './device-sync.js';

// Retry Metrics + Circuit Breaker
export {
  SyncRetryMonitor,
  createSyncRetryMonitor,
  type CircuitBreakerConfig,
  type CircuitState,
  type RetryEvent,
  type RetryEventType,
  type RetryMetrics,
} from './retry-metrics.js';

// Selective Sync Filter
export {
  SyncFilterEngine,
  createSyncFilterEngine,
  type FilterOp,
  type SyncFilter,
  type SyncFilterResult,
  type SyncFilterRule,
} from './selective-filter.js';

// Federated Sync Mesh
export * from './federation/index.js';

// Optimistic Sync Queue v2
export {
  OptimisticSyncQueue,
  createOptimisticSyncQueue,
  createUseOptimisticMutationHook,
  type EnqueueInput,
  type MutationOperation,
  type MutationStatus,
  type OptimisticMutation,
  type SyncQueueConfig,
  type SyncQueueEvent,
  type SyncQueueStats,
  type UseOptimisticMutationReturn,
} from './optimistic-sync-queue.js';

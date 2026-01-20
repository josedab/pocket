/**
 * Pocket Sync - Synchronization engine for Pocket database
 *
 * @example
 * ```typescript
 * import { createSyncEngine } from 'pocket/sync';
 *
 * const sync = createSyncEngine(db, {
 *   serverUrl: 'wss://api.example.com/sync',
 *   authToken: 'user-token',
 * });
 *
 * await sync.start();
 * ```
 */

export {
  // Checkpoint
  CheckpointManager,
  // Conflict resolution
  ConflictResolver,
  // HTTP transport
  HttpTransport,
  // Optimistic updates
  OptimisticUpdateManager,
  // Rollback
  RollbackManager,
  // Sync engine
  SyncEngine,
  // WebSocket transport
  WebSocketTransport,
  createHttpTransport,
  createOptimisticUpdateManager,
  createRollbackManager,
  createSyncEngine,
  createWebSocketTransport,
  deserializeCheckpoint,
  detectConflict,
  generateMessageId,
  serializeCheckpoint,
  type AckMessage,
  type Checkpoint,
  type ConflictResolution,
  type ConflictStrategy,
  type ErrorMessage,
  type MergeFunction,
  type OptimisticUpdate,
  type PullMessage,
  type PullResponseMessage,
  type PushMessage,
  type PushResponseMessage,
  type RollbackResult,
  type SyncConfig,
  type SyncMessageType,
  type SyncProtocolMessage,
  type SyncStats,
  type SyncStatus,
  // Transport
  type SyncTransport,
  type TransportConfig,
} from '@pocket/sync';

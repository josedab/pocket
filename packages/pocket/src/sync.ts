/**
 * @packageDocumentation
 *
 * # Pocket Sync - Synchronization Engine
 *
 * Sync layer for synchronizing Pocket databases between clients and servers.
 * Enables real-time collaboration, multi-device sync, and offline-first
 * applications with automatic conflict resolution.
 *
 * ## Installation
 *
 * Sync is included in the main `pocket` package:
 *
 * ```bash
 * npm install pocket
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createDatabase, createIndexedDBStorage } from 'pocket';
 * import { createSyncEngine } from 'pocket/sync';
 *
 * // Create database
 * const db = await createDatabase({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 * });
 *
 * // Create and start sync engine
 * const sync = createSyncEngine(db, {
 *   serverUrl: 'wss://sync.example.com',
 *   authToken: await getAuthToken(),
 *   collections: ['todos', 'notes'],
 *   conflictStrategy: 'last-write-wins'
 * });
 *
 * await sync.start();
 *
 * // Monitor sync status
 * sync.getStatus().subscribe(status => {
 *   console.log('Sync status:', status);
 * });
 *
 * // Force immediate sync
 * await sync.forceSync();
 *
 * // Stop syncing (e.g., on logout)
 * await sync.stop();
 * ```
 *
 * ## Sync Flow
 *
 * ```
 * Client A                    Server                    Client B
 *    │                          │                          │
 *    │  ─────── push ────────►  │                          │
 *    │  (local changes)         │                          │
 *    │                          │  ◄───── push ──────────  │
 *    │                          │  (local changes)         │
 *    │                          │                          │
 *    │  ◄──── broadcast ──────  │  ────── broadcast ─────► │
 *    │  (other's changes)       │  (other's changes)       │
 *    │                          │                          │
 *    │  ─────── pull ────────►  │                          │
 *    │  (catch-up after         │                          │
 *    │   reconnect)             │                          │
 *    │  ◄──── pull-response ──  │                          │
 * ```
 *
 * ## Conflict Resolution
 *
 * When the same document is modified on multiple devices before sync,
 * conflicts are resolved using the configured strategy:
 *
 * - `'last-write-wins'` - Most recent timestamp wins (default)
 * - `'server-wins'` - Server's version always wins
 * - `'client-wins'` - Client's version always wins
 * - Custom merge function for field-level merging
 *
 * ```typescript
 * const sync = createSyncEngine(db, {
 *   serverUrl: 'wss://sync.example.com',
 *   conflictStrategy: 'last-write-wins'
 * });
 *
 * // Or with custom merge
 * const sync = createSyncEngine(db, {
 *   serverUrl: 'wss://sync.example.com',
 *   conflictStrategy: {
 *     merge: (local, remote) => ({
 *       ...remote,
 *       // Keep local changes to certain fields
 *       localDrafts: local.localDrafts
 *     })
 *   }
 * });
 * ```
 *
 * ## Transport Options
 *
 * The sync engine supports two transport modes:
 *
 * **WebSocket (default)** - Real-time bidirectional sync
 * ```typescript
 * createSyncEngine(db, {
 *   serverUrl: 'wss://sync.example.com',
 *   useWebSocket: true  // default
 * });
 * ```
 *
 * **HTTP Polling** - For environments without WebSocket support
 * ```typescript
 * createSyncEngine(db, {
 *   serverUrl: 'https://api.example.com/sync',
 *   useWebSocket: false,
 *   pullInterval: 5000  // Poll every 5 seconds
 * });
 * ```
 *
 * ## Server Setup
 *
 * For the server side, see `@pocket/server` or `@pocket/sync-server`:
 *
 * ```typescript
 * import { createServer } from '@pocket/server';
 *
 * const server = createServer({
 *   port: 8080,
 *   authenticate: async (token) => {
 *     const user = await verifyToken(token);
 *     return user ? { userId: user.id } : null;
 *   }
 * });
 *
 * await server.start();
 * ```
 *
 * @module pocket/sync
 *
 * @see {@link SyncEngine} for the main sync engine class
 * @see {@link createSyncEngine} for creating a sync engine
 * @see {@link SyncConfig} for configuration options
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

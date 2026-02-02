/**
 * @pocket/storage-expo-sqlite
 *
 * Expo SQLite storage adapter for Pocket - native SQLite performance on mobile.
 *
 * This package provides a StorageAdapter implementation backed by expo-sqlite,
 * delivering native SQLite performance for React Native / Expo applications.
 *
 * ## Features
 *
 * - Native SQLite via expo-sqlite's async API
 * - WAL mode for concurrent reads
 * - Full Pocket query operator support via SQL translation
 * - Transaction support
 * - Background sync manager with battery/network awareness
 * - Index management with json_extract-based column indexes
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createExpoSQLiteStorage } from '@pocket/storage-expo-sqlite';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createExpoSQLiteStorage({
 *     databaseName: 'my-app.db',
 *     enableWAL: true,
 *   }),
 * });
 * ```
 *
 * ## Background Sync
 *
 * ```typescript
 * import { BackgroundSyncManager } from '@pocket/storage-expo-sqlite';
 *
 * const syncManager = new BackgroundSyncManager({
 *   enabled: true,
 *   intervalMs: 60000,
 *   batteryAware: true,
 *   networkRequired: true,
 * });
 *
 * syncManager.onSync(async () => {
 *   await db.sync();
 * });
 *
 * syncManager.start();
 * ```
 *
 * @module @pocket/storage-expo-sqlite
 */

// Adapter factory and class
export { createExpoSQLiteStorage, ExpoSQLiteAdapter } from './expo-sqlite-adapter.js';

// Document store
export { ExpoSQLiteDocumentStore } from './expo-sqlite-store.js';

// Query translator
export { QueryTranslator } from './query-translator.js';

// Background sync
export { BackgroundSyncManager } from './background-sync.js';
export type { SyncEventListener, SyncSubscription } from './background-sync.js';

// Types
export type {
  AppStateStatus,
  BackgroundSyncConfig,
  ExpoSQLiteConfig,
  ExpoSQLiteDatabase,
  QueryTranslation,
  SerializedDocumentRow,
  SQLiteIndexMeta,
} from './types.js';

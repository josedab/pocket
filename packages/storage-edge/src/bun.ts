/**
 * Bun SQLite Storage Adapter
 *
 * @module @pocket/storage-edge/bun
 */

// Bun SQLite
export { BunSQLiteStore } from './bun/bun-sqlite-store.js';
export { createBunSQLiteStorage } from './bun/bun-sqlite-adapter.js';

// Types
export type {
  BunSQLiteConfig,
  BunSQLiteDatabase,
  BunSQLiteStatement,
} from './types.js';

// Re-export core types for convenience
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';

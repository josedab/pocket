/**
 * @pocket/tauri - Tauri Integration
 *
 * Provides storage adapters for using Pocket with Tauri desktop applications.
 *
 * @module @pocket/tauri
 */

// Storage adapter
export {
  createTauriSQLiteStorage,
  type TauriSQLiteConfig,
} from './storage/tauri-sqlite-adapter.js';

// Re-export core types
export type { Collection, Database, Document, QueryBuilder, StorageAdapter } from '@pocket/core';

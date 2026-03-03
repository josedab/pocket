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

// Studio Desktop App
export {
  StudioDesktopApp,
  createStudioDesktop,
  type DatabaseConnection,
  type ExplainPlan,
  type ProfilerSnapshot,
  type QueryResult,
  type StudioDesktopConfig,
  type StudioDesktopState,
  type SyncConflict,
  type SyncDashboardState,
  type SyncEvent,
} from './studio-desktop.js';

// Re-export core types
export type { Collection, Database, Document, QueryBuilder, StorageAdapter } from '@pocket/core';

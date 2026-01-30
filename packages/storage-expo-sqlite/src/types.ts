import type { StorageConfig } from '@pocket/core';

/**
 * Expo SQLite storage adapter configuration.
 *
 * Extends the base StorageConfig with Expo SQLite-specific options
 * for tuning performance and behavior of the native SQLite engine.
 */
export interface ExpoSQLiteConfig extends StorageConfig {
  /**
   * Database file name (without path).
   * Default: 'pocket.db'
   */
  databaseName?: string;

  /**
   * Custom directory for the database file.
   * If not provided, defaults to the app's default database directory.
   */
  directory?: string;

  /**
   * Enable WAL (Write-Ahead Logging) journal mode.
   * WAL mode provides better concurrent read/write performance.
   * Default: true
   */
  enableWAL?: boolean;

  /**
   * Enable foreign key constraints.
   * Default: true
   */
  enableForeignKeys?: boolean;

  /**
   * Factory function to open a database.
   * If provided, this is used instead of dynamically requiring expo-sqlite.
   * Useful for testing or custom database initialization.
   */
  openDatabase?: (name: string) => Promise<ExpoSQLiteDatabase>;
}

/**
 * Background sync configuration for React Native apps.
 */
export interface BackgroundSyncConfig {
  /**
   * Whether background sync is enabled.
   * Default: false
   */
  enabled: boolean;

  /**
   * Sync interval in milliseconds.
   * Default: 300000 (5 minutes)
   */
  intervalMs?: number;

  /**
   * Whether to skip sync when battery is low.
   * Uses React Native battery APIs if available.
   * Default: true
   */
  batteryAware?: boolean;

  /**
   * Whether to require network connectivity for sync.
   * When true, sync is skipped if the device is offline.
   * Default: true
   */
  networkRequired?: boolean;
}

/**
 * Represents a translated Pocket query as SQL for expo-sqlite.
 */
export interface QueryTranslation {
  /** The SQL WHERE clause (without the WHERE keyword) */
  whereClause: string;
  /** The SQL ORDER BY clause (without the ORDER BY keywords) */
  orderByClause: string;
  /** Bound parameter values */
  params: unknown[];
  /** LIMIT value, if any */
  limit?: number;
  /** OFFSET value, if any */
  offset?: number;
}

/**
 * Serialized document row as stored in the SQLite table.
 */
export interface SerializedDocumentRow {
  /** Document ID (primary key) */
  id: string;
  /** JSON-serialized document data */
  data: string;
  /** Revision string for conflict detection */
  _rev: string | null;
  /** Last update timestamp (Unix ms) */
  _updatedAt: number | null;
  /** Soft delete marker (0 or 1) */
  _deleted: number;
}

/**
 * SQLite index metadata stored for tracking custom indexes.
 */
export interface SQLiteIndexMeta {
  /** Index name */
  name: string;
  /** Collection (store) name this index belongs to */
  collection: string;
  /** JSON-serialized array of IndexField objects */
  fields: string;
  /** Whether the index enforces uniqueness (0 or 1) */
  isUnique: number;
  /** Whether the index is sparse (0 or 1) */
  isSparse: number;
}

/**
 * Expo SQLite database interface.
 *
 * Mirrors the subset of the expo-sqlite SQLiteDatabase API
 * used by this adapter, enabling type-safe usage without
 * importing expo-sqlite directly at compile time.
 */
export interface ExpoSQLiteDatabase {
  /** Execute a SQL statement that does not return rows (DDL, multi-statement) */
  execAsync(sql: string): Promise<void>;
  /** Execute a SQL statement and return all result rows */
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Execute a SQL statement and return the first result row */
  getFirstAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Execute a SQL write statement (INSERT, UPDATE, DELETE) */
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  /** Execute a function within a database transaction */
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
  /** Close the database connection */
  closeAsync(): Promise<void>;
}

/**
 * App state types matching React Native's AppState.
 */
export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

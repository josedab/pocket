import type { StorageConfig } from '@pocket/core';

/**
 * WebAssembly SQLite adapter configuration.
 *
 * Extends the base StorageConfig with SQLite-specific options
 * for tuning performance and behavior of the WASM-based SQLite engine.
 */
export interface WaSQLiteConfig extends StorageConfig {
  /**
   * SQLite page size in bytes.
   * Must be a power of 2 between 512 and 65536.
   * Default: 4096
   */
  pageSize?: number;

  /**
   * Cache size in number of pages.
   * Negative values are interpreted as KB (e.g., -2000 = 2000 KB).
   * Default: -2000 (2 MB)
   */
  cacheSize?: number;

  /**
   * SQLite journal mode.
   * WAL mode provides better concurrent read performance.
   * MEMORY mode is fastest but data may be lost on crash.
   * Default: 'MEMORY'
   */
  journalMode?: 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'WAL' | 'OFF';

  /**
   * Enable foreign key constraints.
   * Default: false
   */
  foreignKeys?: boolean;

  /**
   * Factory function to initialize sql.js.
   * If not provided, the adapter will attempt to import sql.js directly.
   *
   * @example
   * ```typescript
   * import initSqlJs from 'sql.js';
   *
   * createWaSQLiteStorage({
   *   name: 'my-db',
   *   sqlJsFactory: () => initSqlJs({
   *     locateFile: file => `https://sql.js.org/dist/${file}`
   *   })
   * });
   * ```
   */
  sqlJsFactory?: () => Promise<SqlJsStatic>;
}

/**
 * Static interface returned by initSqlJs().
 * Used to construct new Database instances.
 */
export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

/**
 * sql.js Database instance interface.
 */
export interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): SqlJsExecResult[];
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

/**
 * Result from db.exec() calls.
 */
export interface SqlJsExecResult {
  columns: string[];
  values: unknown[][];
}

/**
 * sql.js prepared statement interface.
 */
export interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

/**
 * SQLite index definition stored in the metadata table.
 */
export interface SQLiteIndex {
  /** Index name */
  name: string;
  /** Collection (store) name this index belongs to */
  collection: string;
  /** JSON-serialized array of field names */
  fields: string;
  /** Whether the index enforces uniqueness (0 or 1) */
  is_unique: number;
  /** Whether the index is sparse (0 or 1) */
  sparse: number;
}

/**
 * Represents a translated Pocket query as SQL.
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
 * Serialized document row as stored in SQLite.
 */
export interface SerializedDocument {
  _id: string;
  _rev?: string;
  _deleted?: number;
  _updatedAt?: number;
  _vclock?: string;
  _data: string;
}

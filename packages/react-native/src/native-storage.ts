/**
 * Native SQLite storage adapter for React Native.
 *
 * Provides a high-performance document store using native SQLite with WAL mode
 * for optimal concurrent read/write performance on mobile devices.
 *
 * ## Features
 *
 * - **WAL Mode**: Write-Ahead Logging for better concurrency
 * - **Transaction Support**: Atomic operations with `runInTransaction`
 * - **Configurable**: Database name, journal size, busy timeout
 * - **Storage Stats**: Track document count, size, and last write time
 *
 * @module native-storage
 *
 * @example
 * ```typescript
 * const storage = createNativeSQLiteStorage({
 *   dbName: 'my-app',
 *   walMode: true,
 *   busyTimeout: 5000,
 * });
 *
 * await storage.set('doc1', { title: 'Hello' });
 * const doc = await storage.get('doc1');
 * ```
 */

// ────────────────────────────── SQLite Interface ──────────────────────────────

/**
 * Generic SQLite database interface.
 *
 * Abstracts the underlying native SQLite module so this adapter works
 * with expo-sqlite, react-native-sqlite-storage, or any compatible driver.
 */
export interface SQLiteDatabase {
  /** Execute a SQL statement that returns no rows */
  executeSql(sql: string, params?: unknown[]): Promise<void>;

  /** Execute a SQL query and return all matching rows */
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute a SQL query and return the first matching row */
  queryFirst<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /** Run multiple statements inside a transaction */
  transaction(fn: (tx: SQLiteTransaction) => Promise<void>): Promise<void>;

  /** Close the database connection */
  close(): Promise<void>;
}

/**
 * Transaction handle used inside {@link SQLiteDatabase.transaction}.
 */
export interface SQLiteTransaction {
  /** Execute a SQL statement within the transaction */
  executeSql(sql: string, params?: unknown[]): Promise<void>;

  /** Query rows within the transaction */
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

// ────────────────────────────── Configuration ──────────────────────────────

/**
 * Configuration for {@link NativeSQLiteStorage}.
 */
export interface NativeSQLiteStorageConfig {
  /** Database name */
  dbName: string;

  /** SQLite database instance */
  database: SQLiteDatabase;

  /** Enable WAL mode for better concurrent read/write (default: true) */
  walMode?: boolean;

  /** Journal size limit in bytes (default: -1, unlimited) */
  journalSizeLimit?: number;

  /** Busy timeout in milliseconds (default: 5000) */
  busyTimeout?: number;
}

// ────────────────────────────── Storage Stats ──────────────────────────────

/**
 * Storage statistics tracked by {@link NativeSQLiteStorage}.
 */
export interface StorageStats {
  /** Number of documents stored */
  documentCount: number;

  /** Approximate storage size in bytes */
  storageSize: number;

  /** Timestamp of the last write operation */
  lastWriteTime: number | null;
}

// ────────────────────────────── Storage Row ──────────────────────────────

/** @internal Row shape in the key-value table */
interface StorageRow {
  key: string;
  value: string;
}

/** @internal Row shape for count queries */
interface CountRow {
  count: number;
}

/** @internal Row shape for size queries */
interface SizeRow {
  size: number;
}

// ────────────────────────────── NativeSQLiteStorage ──────────────────────────────

/**
 * SQLite-backed key-value storage for React Native.
 *
 * Implements a StorageAdapter-like interface backed by a native SQLite
 * database. Supports WAL mode, transactions, and storage stats tracking.
 *
 * @example
 * ```typescript
 * const db: SQLiteDatabase = getMyDatabase();
 * const storage = new NativeSQLiteStorage({
 *   dbName: 'my-app',
 *   database: db,
 * });
 *
 * await storage.initialize();
 * await storage.set('key1', { hello: 'world' });
 * ```
 */
export class NativeSQLiteStorage {
  private readonly db: SQLiteDatabase;
  private readonly dbName: string;
  private readonly walMode: boolean;
  private readonly journalSizeLimit: number;
  private readonly busyTimeout: number;
  private readonly tableName: string;

  private _initialized = false;
  private _stats: StorageStats = {
    documentCount: 0,
    storageSize: 0,
    lastWriteTime: null,
  };

  constructor(config: NativeSQLiteStorageConfig) {
    this.db = config.database;
    this.dbName = config.dbName;
    this.walMode = config.walMode ?? true;
    this.journalSizeLimit = config.journalSizeLimit ?? -1;
    this.busyTimeout = config.busyTimeout ?? 5000;
    this.tableName = `${config.dbName}_store`;
  }

  /**
   * Current storage statistics.
   */
  get stats(): Readonly<StorageStats> {
    return { ...this._stats };
  }

  /**
   * Whether the storage has been initialized.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize the storage table and configure pragmas.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    if (this.walMode) {
      await this.db.executeSql('PRAGMA journal_mode = WAL;');
    }

    if (this.journalSizeLimit >= 0) {
      await this.db.executeSql(`PRAGMA journal_size_limit = ${this.journalSizeLimit};`);
    }

    await this.db.executeSql(`PRAGMA busy_timeout = ${this.busyTimeout};`);

    await this.db.executeSql(
      `CREATE TABLE IF NOT EXISTS "${this.tableName}" (key TEXT PRIMARY KEY, value TEXT NOT NULL);`
    );

    await this.refreshStats();
    this._initialized = true;
  }

  /**
   * Get a value by key.
   *
   * @param key - The document key
   * @returns The parsed value, or `null` if not found
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    this.ensureInitialized();

    const row = await this.db.queryFirst<StorageRow>(
      `SELECT value FROM "${this.tableName}" WHERE key = ?;`,
      [key]
    );

    if (!row) return null;

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set a value by key.
   *
   * @param key - The document key
   * @param value - The value to store (will be JSON-serialized)
   */
  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.ensureInitialized();

    const serialized = JSON.stringify(value);
    await this.db.executeSql(
      `INSERT OR REPLACE INTO "${this.tableName}" (key, value) VALUES (?, ?);`,
      [key, serialized]
    );

    this._stats.lastWriteTime = Date.now();
    this._stats.documentCount = await this.countRows();
    this._stats.storageSize += serialized.length;
  }

  /**
   * Delete a value by key.
   *
   * @param key - The document key
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();

    await this.db.executeSql(
      `DELETE FROM "${this.tableName}" WHERE key = ?;`,
      [key]
    );

    this._stats.lastWriteTime = Date.now();
    this._stats.documentCount = await this.countRows();
  }

  /**
   * Query all stored key-value pairs, optionally filtering by key prefix.
   *
   * @param prefix - Optional key prefix to filter by
   * @returns Array of `{ key, value }` entries
   */
  async query<T = unknown>(prefix?: string): Promise<{ key: string; value: T }[]> {
    this.ensureInitialized();

    let rows: StorageRow[];
    if (prefix) {
      rows = await this.db.queryAll<StorageRow>(
        `SELECT key, value FROM "${this.tableName}" WHERE key LIKE ?;`,
        [`${prefix}%`]
      );
    } else {
      rows = await this.db.queryAll<StorageRow>(
        `SELECT key, value FROM "${this.tableName}";`
      );
    }

    return rows.map((row) => ({
      key: row.key,
      value: JSON.parse(row.value) as T,
    }));
  }

  /**
   * Get multiple values by keys.
   *
   * @param keys - The document keys
   * @returns Map of key to parsed value (missing keys are omitted)
   */
  async bulkGet<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    this.ensureInitialized();

    if (keys.length === 0) return new Map();

    const placeholders = keys.map(() => '?').join(', ');
    const rows = await this.db.queryAll<StorageRow>(
      `SELECT key, value FROM "${this.tableName}" WHERE key IN (${placeholders});`,
      keys
    );

    const result = new Map<string, T>();
    for (const row of rows) {
      try {
        result.set(row.key, JSON.parse(row.value) as T);
      } catch {
        // Skip invalid JSON
      }
    }

    return result;
  }

  /**
   * Set multiple key-value pairs in a single transaction.
   *
   * @param entries - Array of `[key, value]` tuples
   */
  async bulkSet<T = unknown>(entries: [string, T][]): Promise<void> {
    this.ensureInitialized();

    if (entries.length === 0) return;

    await this.db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.executeSql(
          `INSERT OR REPLACE INTO "${this.tableName}" (key, value) VALUES (?, ?);`,
          [key, JSON.stringify(value)]
        );
      }
    });

    this._stats.lastWriteTime = Date.now();
    this._stats.documentCount = await this.countRows();
  }

  /**
   * Count the number of stored documents.
   */
  async count(): Promise<number> {
    this.ensureInitialized();
    return this.countRows();
  }

  /**
   * Delete all stored documents.
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    await this.db.executeSql(`DELETE FROM "${this.tableName}";`);

    this._stats.documentCount = 0;
    this._stats.storageSize = 0;
    this._stats.lastWriteTime = Date.now();
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    await this.db.close();
    this._initialized = false;
  }

  /**
   * Execute a function within a database transaction.
   *
   * All operations performed by `fn` will be committed atomically.
   * If `fn` throws, the transaction is rolled back.
   *
   * @param fn - The function to run inside a transaction
   */
  async runInTransaction<R>(fn: (storage: NativeSQLiteTransactionHelper) => Promise<R>): Promise<R> {
    this.ensureInitialized();

    let result!: R;

    await this.db.transaction(async (tx) => {
      const helper = new NativeSQLiteTransactionHelper(tx, this.tableName);
      result = await fn(helper);
    });

    this._stats.lastWriteTime = Date.now();
    this._stats.documentCount = await this.countRows();

    return result;
  }

  // ──────────────── Private helpers ────────────────

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error(`NativeSQLiteStorage "${this.dbName}" is not initialized. Call initialize() first.`);
    }
  }

  private async countRows(): Promise<number> {
    const row = await this.db.queryFirst<CountRow>(
      `SELECT COUNT(*) as count FROM "${this.tableName}";`
    );
    return row?.count ?? 0;
  }

  private async refreshStats(): Promise<void> {
    this._stats.documentCount = await this.countRows();

    const sizeRow = await this.db.queryFirst<SizeRow>(
      `SELECT COALESCE(SUM(LENGTH(value)), 0) as size FROM "${this.tableName}";`
    );
    this._stats.storageSize = sizeRow?.size ?? 0;
  }
}

// ────────────────────────────── Transaction Helper ──────────────────────────────

/**
 * Helper class providing get/set/delete inside a {@link NativeSQLiteStorage.runInTransaction} callback.
 */
export class NativeSQLiteTransactionHelper {
  private readonly tx: SQLiteTransaction;
  private readonly tableName: string;

  /** @internal */
  constructor(tx: SQLiteTransaction, tableName: string) {
    this.tx = tx;
    this.tableName = tableName;
  }

  /**
   * Get a value by key within the transaction.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const rows = await this.tx.queryAll<StorageRow>(
      `SELECT value FROM "${this.tableName}" WHERE key = ?;`,
      [key]
    );

    if (rows.length === 0) return null;

    try {
      return JSON.parse(rows[0]!.value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set a value by key within the transaction.
   */
  async set<T = unknown>(key: string, value: T): Promise<void> {
    await this.tx.executeSql(
      `INSERT OR REPLACE INTO "${this.tableName}" (key, value) VALUES (?, ?);`,
      [key, JSON.stringify(value)]
    );
  }

  /**
   * Delete a value by key within the transaction.
   */
  async delete(key: string): Promise<void> {
    await this.tx.executeSql(
      `DELETE FROM "${this.tableName}" WHERE key = ?;`,
      [key]
    );
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link NativeSQLiteStorage} instance.
 *
 * @param config - Storage configuration
 * @returns An uninitialized NativeSQLiteStorage — call `initialize()` before use
 *
 * @example
 * ```typescript
 * const storage = createNativeSQLiteStorage({
 *   dbName: 'my-app',
 *   database: myDb,
 *   walMode: true,
 *   busyTimeout: 5000,
 * });
 *
 * await storage.initialize();
 * ```
 */
export function createNativeSQLiteStorage(
  config: NativeSQLiteStorageConfig
): NativeSQLiteStorage {
  return new NativeSQLiteStorage(config);
}

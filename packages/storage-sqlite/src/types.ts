/**
 * SQLite adapter configuration
 */
export interface SQLiteAdapterConfig {
  /** Path to database file (for file-based SQLite) */
  path?: string;
  /** In-memory database */
  inMemory?: boolean;
  /** Enable WAL mode for better concurrency */
  walMode?: boolean;
  /** Enable foreign keys */
  foreignKeys?: boolean;
  /** Journal mode */
  journalMode?: 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'WAL' | 'OFF';
  /** Synchronous mode */
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
  /** Cache size in KB */
  cacheSize?: number;
  /** Page size in bytes */
  pageSize?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * SQLite statement prepared for execution
 */
export interface PreparedStatement {
  run(...params: unknown[]): RunResult;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T = unknown>(...params: unknown[]): T | undefined;

  all<T = unknown>(...params: unknown[]): T[];
  finalize(): void;
}

/**
 * Run result from statement execution
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * SQLite driver interface (abstraction over better-sqlite3 and sql.js)
 */
export interface SQLiteDriver {
  /** Execute a SQL statement */
  exec(sql: string): void;

  /** Prepare a statement */
  prepare<T = unknown>(
    sql: string
  ): {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
    finalize?(): void;
  };

  /** Close the database */
  close(): void;

  /** Check if database is open */
  isOpen(): boolean;

  /** Export database to buffer (for sql.js) */
  export?(): Uint8Array;

  /** Get pragma value */
  pragma(name: string): unknown;
}

/**
 * Serialized document for storage
 */
export interface SerializedDocument {
  _id: string;
  _rev?: string;
  _deleted?: number;
  _updatedAt?: number;
  _vclock?: string;
  _data: string;
}

/**
 * Index metadata stored in SQLite
 */
export interface IndexMetadata {
  name: string;
  collection: string;
  fields: string;
  unique: number;
  sparse: number;
}

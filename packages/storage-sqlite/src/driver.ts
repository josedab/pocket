import type { SQLiteAdapterConfig, SQLiteDriver } from './types.js';

/**
 * Create a better-sqlite3 driver (Node.js)
 */
export function createBetterSqliteDriver(config: SQLiteAdapterConfig): SQLiteDriver {
  // Dynamic import to allow optional dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');

  const dbPath = config.inMemory ? ':memory:' : (config.path ?? ':memory:');
  const db = new Database(dbPath, {
    verbose: config.verbose ? console.log : undefined,
  });

  // Configure pragmas
  if (config.walMode || config.journalMode === 'WAL') {
    db.pragma('journal_mode = WAL');
  } else if (config.journalMode) {
    db.pragma(`journal_mode = ${config.journalMode}`);
  }

  if (config.foreignKeys) {
    db.pragma('foreign_keys = ON');
  }

  if (config.synchronous) {
    db.pragma(`synchronous = ${config.synchronous}`);
  }

  if (config.cacheSize) {
    db.pragma(`cache_size = -${config.cacheSize}`);
  }

  if (config.pageSize) {
    db.pragma(`page_size = ${config.pageSize}`);
  }

  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
    isOpen: () => db.open,
    pragma: (name: string) => db.pragma(name, { simple: true }),
  };
}

/**
 * Create a SQL.js driver (browser/WASM)
 */
export async function createSqlJsDriver(
  config: SQLiteAdapterConfig,
  initSqlJs?: () => Promise<{ Database: new (data?: ArrayLike<number>) => SqlJsDatabase }>
): Promise<SQLiteDriver> {
  // Dynamic import or use provided init function
  let SQL: { Database: new (data?: ArrayLike<number>) => SqlJsDatabase };

  if (initSqlJs) {
    SQL = await initSqlJs();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJsDefault = require('sql.js');
    SQL = await initSqlJsDefault();
  }

  const db = new SQL.Database();

  // Configure pragmas
  if (config.foreignKeys) {
    db.run('PRAGMA foreign_keys = ON');
  }

  if (config.cacheSize) {
    db.run(`PRAGMA cache_size = -${config.cacheSize}`);
  }

  let isDbOpen = true;

  return {
    exec: (sql: string) => db.run(sql),
    prepare: (sql: string) => {
      return {
        run: (...params: unknown[]) => {
          db.run(sql, params);
          return { changes: db.getRowsModified(), lastInsertRowid: 0 };
        },
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
        get: <T>(...params: unknown[]): T | undefined => {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject() as T;
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all: <T>(...params: unknown[]): T[] => {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          const results: T[] = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject() as T);
          }
          stmt.free();
          return results;
        },
        finalize: () => {},
      };
    },
    close: () => {
      db.close();
      isDbOpen = false;
    },
    isOpen: () => isDbOpen,
    export: () => db.export(),
    pragma: (name: string) => {
      const result = db.exec(`PRAGMA ${name}`);
      return result[0]?.values[0]?.[0];
    },
  };
}

/**
 * SQL.js Database interface
 */
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

/**
 * SQL.js Statement interface
 */
interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

/**
 * Detect environment and create appropriate driver
 */
export async function createDriver(config: SQLiteAdapterConfig): Promise<SQLiteDriver> {
  // Check if we're in Node.js with better-sqlite3 available
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      return createBetterSqliteDriver(config);
    } catch {
      // Fall through to sql.js
    }
  }

  // Fall back to sql.js
  return createSqlJsDriver(config);
}

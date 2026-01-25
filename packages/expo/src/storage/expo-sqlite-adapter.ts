/**
 * Expo SQLite Storage Adapter
 *
 * Storage adapter that uses expo-sqlite for data persistence.
 *
 * @module @pocket/expo/storage
 */

import type {
  ChangeEvent,
  ChangeOperation,
  Document,
  DocumentStore,
  IndexDefinition,
  IndexField,
  NormalizedIndex,
  StorageAdapter,
  StorageConfig,
  StorageQuery,
  StorageStats,
} from '@pocket/core';
import { type Observable, Subject } from 'rxjs';

/** Helper to get field name from string or IndexField */
function getFieldName(field: string | IndexField): string {
  return typeof field === 'string' ? field : field.field;
}

/**
 * Expo SQLite configuration
 */
export interface ExpoSQLiteConfig {
  /** Database file name */
  name?: string;
  /** Enable WAL mode for better performance */
  walMode?: boolean;
}

/**
 * Document store implementation for Expo SQLite
 */
class ExpoSQLiteDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private changes$ = new Subject<ChangeEvent<T>>();
  private db: unknown;
  private tableName: string;
  private sequenceCounter = 0;

  constructor(db: unknown, tableName: string) {
    this.db = db;
    this.tableName = tableName;
    this.name = tableName;
    void this.initializeTable();
  }

  private emitChange(
    operation: ChangeOperation,
    documentId: string,
    document: T | null,
    previousDocument?: T
  ): void {
    this.changes$.next({
      operation,
      documentId,
      document,
      previousDocument,
      isFromSync: false,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
    });
  }

  private async initializeTable(): Promise<void> {
    const db = this.db as {
      execAsync: (sql: string) => Promise<void>;
    };

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      CREATE INDEX IF NOT EXISTS "${this.tableName}_updated" ON "${this.tableName}" (updated_at);
    `);
  }

  async get(id: string): Promise<T | null> {
    const db = this.db as {
      getFirstAsync: (sql: string, params: unknown[]) => Promise<{ data: string } | null>;
    };

    const row = await db.getFirstAsync(`SELECT data FROM "${this.tableName}" WHERE id = ?`, [id]);

    if (!row) return null;
    return JSON.parse(row.data) as T;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async getAll(): Promise<T[]> {
    const db = this.db as {
      getAllAsync: (sql: string) => Promise<{ data: string }[]>;
    };

    const rows = await db.getAllAsync(`SELECT data FROM "${this.tableName}"`);
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  async put(doc: T): Promise<T> {
    const db = this.db as {
      runAsync: (sql: string, params: unknown[]) => Promise<void>;
    };

    const id = doc._id;
    const existing = await this.get(id);
    const data = JSON.stringify(doc);

    await db.runAsync(
      `INSERT OR REPLACE INTO "${this.tableName}" (id, data, updated_at) VALUES (?, ?, strftime('%s', 'now'))`,
      [id, data]
    );

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing ?? undefined);
    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    for (const doc of docs) {
      await this.put(doc);
    }
    return docs;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const db = this.db as {
      runAsync: (sql: string, params: unknown[]) => Promise<void>;
    };

    await db.runAsync(`DELETE FROM "${this.tableName}" WHERE id = ?`, [id]);
    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    // Basic query implementation - in production, this would build SQL queries
    let results = await this.getAll();

    if (query.spec.filter) {
      results = results.filter((doc) => {
        for (const [key, value] of Object.entries(query.spec.filter!)) {
          if ((doc as Record<string, unknown>)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    if (query.spec.sort && query.spec.sort.length > 0) {
      results.sort((a, b) => {
        for (const sort of query.spec.sort!) {
          const aVal = (a as Record<string, unknown>)[sort.field] as
            | string
            | number
            | boolean
            | null
            | undefined;
          const bVal = (b as Record<string, unknown>)[sort.field] as
            | string
            | number
            | boolean
            | null
            | undefined;

          let cmp = 0;
          if (aVal == null && bVal != null) cmp = -1;
          else if (aVal != null && bVal == null) cmp = 1;
          else if (aVal != null && bVal != null) {
            if (aVal < bVal) cmp = -1;
            else if (aVal > bVal) cmp = 1;
          }

          if (cmp !== 0) {
            return sort.direction === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    if (query.spec.skip) {
      results = results.slice(query.spec.skip);
    }

    if (query.spec.limit) {
      results = results.slice(0, query.spec.limit);
    }

    return results;
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    if (!query) {
      const db = this.db as {
        getFirstAsync: (sql: string) => Promise<{ count: number }>;
      };

      const row = await db.getFirstAsync(`SELECT COUNT(*) as count FROM "${this.tableName}"`);
      return row?.count ?? 0;
    }

    const results = await this.query(query);
    return results.length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    const db = this.db as {
      execAsync: (sql: string) => Promise<void>;
    };

    const fieldNames = index.fields.map(getFieldName);
    const indexName = index.name ?? `idx_${this.tableName}_${fieldNames.join('_')}`;
    const unique = index.unique ? 'UNIQUE' : '';

    // For JSON fields, we'd need to use JSON extract functions
    // This is a simplified implementation
    await db.execAsync(`
      CREATE ${unique} INDEX IF NOT EXISTS "${indexName}"
      ON "${this.tableName}" (json_extract(data, '$.${fieldNames[0]}'))
    `);
  }

  async dropIndex(name: string): Promise<void> {
    const db = this.db as {
      execAsync: (sql: string) => Promise<void>;
    };

    await db.execAsync(`DROP INDEX IF EXISTS "${name}"`);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    // Return empty for now - would query SQLite's index metadata
    return [];
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    // Get all documents to emit delete events
    const docs = await this.getAll();

    const db = this.db as {
      runAsync: (sql: string) => Promise<void>;
    };

    await db.runAsync(`DELETE FROM "${this.tableName}"`);

    // Emit delete events for all documents
    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }
}

/**
 * Expo SQLite storage adapter
 */
class ExpoSQLiteAdapter implements StorageAdapter {
  readonly name = 'expo-sqlite';
  private db: unknown = null;
  private stores = new Map<string, DocumentStore<Document>>();
  private config: ExpoSQLiteConfig;
  private sqliteModule: { openDatabaseAsync: (name: string) => Promise<unknown> } | null = null;

  constructor(config: ExpoSQLiteConfig = {}) {
    this.config = config;
  }

  isAvailable(): boolean {
    try {
      // Check if expo-sqlite is available - this is a runtime check
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime availability check for React Native
      require('expo-sqlite');
      return true;
    } catch {
      return false;
    }
  }

  async initialize(config: StorageConfig): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic import for React Native
    const SQLite = require('expo-sqlite') as {
      openDatabaseAsync: (name: string) => Promise<unknown>;
    };
    this.sqliteModule = SQLite;
    const dbName = this.config.name ?? config.name ?? 'pocket.db';

    this.db = await SQLite.openDatabaseAsync(dbName);

    if (this.config.walMode !== false) {
      const db = this.db as { execAsync: (sql: string) => Promise<void> };
      await db.execAsync('PRAGMA journal_mode = WAL;');
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      const db = this.db as { closeAsync: () => Promise<void> };
      await db.closeAsync();
      this.db = null;
    }
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (!this.stores.has(name)) {
      this.stores.set(name, new ExpoSQLiteDocumentStore<Document>(this.db, name));
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    if (!this.db) return [];

    const db = this.db as {
      getAllAsync: (sql: string) => Promise<{ name: string }[]>;
    };

    const rows = await db.getAllAsync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );

    return rows.map((row) => row.name);
  }

  async deleteStore(name: string): Promise<void> {
    if (!this.db) return;

    const db = this.db as {
      execAsync: (sql: string) => Promise<void>;
    };

    await db.execAsync(`DROP TABLE IF EXISTS "${name}"`);
    this.stores.delete(name);
  }

  async transaction<R>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    // SQLite transactions
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const db = this.db as {
      execAsync: (sql: string) => Promise<void>;
    };

    await db.execAsync('BEGIN TRANSACTION');

    try {
      const result = await fn();
      await db.execAsync('COMMIT');
      return result;
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  }

  async getStats(): Promise<StorageStats> {
    const stores = await this.listStores();
    let documentCount = 0;
    let indexCount = 0;

    for (const storeName of stores) {
      const store = this.getStore(storeName);
      documentCount += await store.count();
      const indexes = await store.getIndexes();
      indexCount += indexes.length;
    }

    return {
      documentCount,
      storeCount: stores.length,
      storageSize: 0, // Would need to check file size
      indexCount,
    };
  }
}

/**
 * Create an Expo SQLite storage adapter
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createExpoSQLiteStorage } from '@pocket/expo';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createExpoSQLiteStorage(),
 * });
 * ```
 */
export function createExpoSQLiteStorage(config: ExpoSQLiteConfig = {}): StorageAdapter {
  return new ExpoSQLiteAdapter(config);
}

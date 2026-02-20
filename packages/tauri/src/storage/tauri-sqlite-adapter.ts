/**
 * Tauri SQLite Storage Adapter
 *
 * Storage adapter that uses tauri-plugin-sql for SQLite database operations.
 *
 * @module @pocket/tauri/storage
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
 * Tauri SQLite configuration
 */
export interface TauriSQLiteConfig {
  /** Database file path (relative to app data directory) */
  path?: string;
}

/**
 * Tauri SQL database interface
 */
interface TauriDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
  close(): Promise<boolean>;
}

/**
 * Document store implementation for Tauri SQLite
 */
class TauriSQLiteDocumentStore<T extends Document> implements DocumentStore<T> {
  readonly name: string;
  private changes$ = new Subject<ChangeEvent<T>>();
  private db: TauriDatabase;
  private tableName: string;
  private initialized = false;
  private sequenceCounter = 0;

  constructor(db: TauriDatabase, tableName: string) {
    this.db = db;
    this.tableName = tableName;
    this.name = tableName;
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

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS "${this.tableName}_updated"
      ON "${this.tableName}" (updated_at)
    `);

    this.initialized = true;
  }

  async get(id: string): Promise<T | null> {
    await this.ensureInitialized();

    const rows = await this.db.select<{ data: string }>(
      `SELECT data FROM "${this.tableName}" WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) return null;
    return JSON.parse(rows[0].data) as T;
  }

  async getMany(ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async getAll(): Promise<T[]> {
    await this.ensureInitialized();

    const rows = await this.db.select<{ data: string }>(`SELECT data FROM "${this.tableName}"`);

    return rows.map((row) => JSON.parse(row.data) as T);
  }

  async put(doc: T): Promise<T> {
    await this.ensureInitialized();

    const id = doc._id;
    const existing = await this.get(id);
    const data = JSON.stringify(doc);

    await this.db.execute(
      `INSERT OR REPLACE INTO "${this.tableName}" (id, data, updated_at)
       VALUES (?, ?, strftime('%s', 'now'))`,
      [id, data]
    );

    const operation: ChangeOperation = existing ? 'update' : 'insert';
    this.emitChange(operation, id, doc, existing ?? undefined);
    return doc;
  }

  async bulkPut(docs: T[]): Promise<T[]> {
    await this.ensureInitialized();

    for (const doc of docs) {
      await this.put(doc);
    }

    return docs;
  }

  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) return;

    await this.db.execute(`DELETE FROM "${this.tableName}" WHERE id = ?`, [id]);

    this.emitChange('delete', id, null, existing);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async query(query: StorageQuery<T>): Promise<T[]> {
    await this.ensureInitialized();

    let sql = `SELECT data FROM "${this.tableName}"`;
    const params: unknown[] = [];

    // Build WHERE clause from filter
    if (query.spec.filter) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(query.spec.filter)) {
        conditions.push(`json_extract(data, '$.${key}') = ?`);
        params.push(value);
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }
    }

    // Add ORDER BY
    if (query.spec.sort && query.spec.sort.length > 0) {
      const orderParts = query.spec.sort.map(
        (s) => `json_extract(data, '$.${s.field}') ${s.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    // Add LIMIT and OFFSET
    if (query.spec.limit) {
      sql += ` LIMIT ${query.spec.limit}`;
    }
    if (query.spec.skip) {
      sql += ` OFFSET ${query.spec.skip}`;
    }

    const rows = await this.db.select<{ data: string }>(sql, params);
    return rows.map((row) => JSON.parse(row.data) as T);
  }

  async count(query?: StorageQuery<T>): Promise<number> {
    await this.ensureInitialized();

    if (!query?.spec.filter) {
      const rows = await this.db.select<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${this.tableName}"`
      );
      return rows[0]?.count ?? 0;
    }

    const results = await this.query(query);
    return results.length;
  }

  async createIndex(index: IndexDefinition): Promise<void> {
    await this.ensureInitialized();

    const fieldNames = index.fields.map(getFieldName);
    const indexName = index.name ?? `idx_${this.tableName}_${fieldNames.join('_')}`;
    const unique = index.unique ? 'UNIQUE' : '';
    const firstField = fieldNames[0];

    await this.db.execute(`
      CREATE ${unique} INDEX IF NOT EXISTS "${indexName}"
      ON "${this.tableName}" (json_extract(data, '$.${firstField}'))
    `);
  }

  async dropIndex(name: string): Promise<void> {
    await this.db.execute(`DROP INDEX IF EXISTS "${name}"`);
  }

  async getIndexes(): Promise<NormalizedIndex[]> {
    const rows = await this.db.select<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name = ?`,
      [this.tableName]
    );

    return rows
      .filter((row) => row.name && !row.name.startsWith('sqlite_'))
      .map((row) => ({
        name: row.name,
        fields: [],
        unique: row.sql?.includes('UNIQUE') ?? false,
        sparse: false,
      }));
  }

  changes(): Observable<ChangeEvent<T>> {
    return this.changes$.asObservable();
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();

    // Get all documents to emit delete events
    const docs = await this.getAll();
    await this.db.execute(`DELETE FROM "${this.tableName}"`);

    // Emit delete events for all documents
    for (const doc of docs) {
      this.emitChange('delete', doc._id, null, doc);
    }
  }

  /** Release resources */
  destroy(): void {
    this.changes$.complete();
  }
}

/**
 * Tauri SQLite storage adapter
 */
class TauriSQLiteAdapter implements StorageAdapter {
  readonly name = 'tauri-sqlite';
  private db: TauriDatabase | null = null;
  private stores = new Map<string, TauriSQLiteDocumentStore<Document>>();
  private config: TauriSQLiteConfig;

  constructor(config: TauriSQLiteConfig = {}) {
    this.config = config;
  }

  isAvailable(): boolean {
    // Check if we're in a Tauri environment
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  async initialize(config: StorageConfig): Promise<void> {
    // Dynamic import to avoid bundling issues
    const Database = (await import('@tauri-apps/plugin-sql')).default;

    const dbPath = this.config.path ?? `sqlite:${config.name}.db`;
    this.db = (await Database.load(dbPath)) as unknown as TauriDatabase;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.stores.clear();
  }

  getStore<T extends Document>(name: string): DocumentStore<T> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (!this.stores.has(name)) {
      this.stores.set(name, new TauriSQLiteDocumentStore<Document>(this.db, name));
    }

    return this.stores.get(name) as unknown as DocumentStore<T>;
  }

  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  async listStores(): Promise<string[]> {
    if (!this.db) return [];

    const rows = await this.db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );

    return rows.map((row) => row.name);
  }

  async deleteStore(name: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute(`DROP TABLE IF EXISTS "${name}"`);
    this.stores.delete(name);
  }

  async transaction<R>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    fn: () => Promise<R>
  ): Promise<R> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await this.db.execute('BEGIN TRANSACTION');

    try {
      const result = await fn();
      await this.db.execute('COMMIT');
      return result;
    } catch (error) {
      await this.db.execute('ROLLBACK');
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
      storageSize: 0, // Would need file system access
      indexCount,
    };
  }
}

/**
 * Create a Tauri SQLite storage adapter
 *
 * @example
 * ```typescript
 * import { Database } from '@pocket/core';
 * import { createTauriSQLiteStorage } from '@pocket/tauri';
 *
 * const db = await Database.create({
 *   name: 'my-app',
 *   storage: createTauriSQLiteStorage(),
 * });
 * ```
 */
export function createTauriSQLiteStorage(config: TauriSQLiteConfig = {}): StorageAdapter {
  return new TauriSQLiteAdapter(config);
}

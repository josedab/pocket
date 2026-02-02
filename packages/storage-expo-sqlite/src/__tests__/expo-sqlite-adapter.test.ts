import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Document } from '@pocket/core';
import type { ExpoSQLiteDatabase } from '../types.js';
import { ExpoSQLiteAdapter, createExpoSQLiteStorage } from '../expo-sqlite-adapter.js';
import { ExpoSQLiteDocumentStore } from '../expo-sqlite-store.js';
import { QueryTranslator } from '../query-translator.js';
import { BackgroundSyncManager } from '../background-sync.js';

// ────────────────────────────── Test Document Type ──────────────────────────────

interface TestDocument extends Document {
  _id: string;
  title: string;
  status: string;
  count: number;
  tags?: string[];
}

// ────────────────────────────── Mock expo-sqlite Database ──────────────────────────────

function createMockDatabase(): ExpoSQLiteDatabase {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();

  function getTable(name: string): Map<string, Record<string, unknown>> {
    if (!tables.has(name)) {
      tables.set(name, new Map());
    }
    return tables.get(name)!;
  }

  function extractTableName(sql: string): string | null {
    const match = sql.match(/(?:FROM|INTO|TABLE|UPDATE)\s+"?([a-zA-Z0-9_]+)"?/i);
    return match?.[1] ?? null;
  }

  const mockDb: ExpoSQLiteDatabase = {
    execAsync: vi.fn(async (_sql: string): Promise<void> => {
      // DDL operations - no-op in mock
    }),

    getAllAsync: vi.fn(async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
      const tableName = extractTableName(sql);

      if (!tableName || tableName === 'sqlite_master') {
        if (sql.includes('sqlite_master')) {
          const storeNames = Array.from(tables.keys())
            .filter((n) => n !== '_pocket_indexes')
            .map((n) => ({ name: n }));
          return storeNames as unknown as T[];
        }
        return [];
      }

      if (tableName === '_pocket_indexes') {
        return [] as unknown as T[];
      }

      const table = getTable(tableName);
      let rows = Array.from(table.values());

      // Filter by _deleted = 0
      if (sql.includes('_deleted = 0')) {
        rows = rows.filter((r) => r['_deleted'] === 0);
      }

      // Simple IN clause handling for getMany
      if (sql.includes('IN (') && params && params.length > 0) {
        rows = rows.filter((r) => params.includes(r['id']));
      }

      return rows.map((r) => ({
        id: r['id'],
        data: r['data'],
        _rev: r['_rev'],
        _updatedAt: r['_updatedAt'],
        _deleted: r['_deleted'],
      })) as unknown as T[];
    }),

    getFirstAsync: vi.fn(async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (sql.includes('COUNT(*)')) {
        const tableName = extractTableName(sql);
        if (!tableName) return { count: 0 } as unknown as T;

        if (tableName === '_pocket_indexes') {
          return { count: 0 } as unknown as T;
        }

        const table = getTable(tableName);
        let count = 0;
        for (const row of table.values()) {
          if (row['_deleted'] === 0) count++;
        }
        return { count } as unknown as T;
      }

      if (sql.includes('PRAGMA page_count')) {
        return { page_count: 10 } as unknown as T;
      }
      if (sql.includes('PRAGMA page_size')) {
        return { page_size: 4096 } as unknown as T;
      }

      const tableName = extractTableName(sql);
      if (!tableName) return null;

      const table = getTable(tableName);
      if (params && params.length > 0) {
        const id = params[0] as string;
        const row = table.get(id);
        if (!row || row['_deleted'] === 1) return null;
        return { data: row['data'] } as unknown as T;
      }

      return null;
    }),

    runAsync: vi.fn(async (sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> => {
      const tableName = extractTableName(sql);
      if (!tableName) return { changes: 0, lastInsertRowId: 0 };

      if (sql.trimStart().startsWith('INSERT')) {
        const table = getTable(tableName);
        if (tableName === '_pocket_indexes') {
          return { changes: 1, lastInsertRowId: 0 };
        }
        if (params && params.length >= 5) {
          const id = params[0] as string;
          table.set(id, {
            id,
            data: params[1],
            _rev: params[2],
            _updatedAt: params[3],
            _deleted: params[4],
          });
        }
        return { changes: 1, lastInsertRowId: 0 };
      }

      if (sql.trimStart().startsWith('DELETE')) {
        const table = getTable(tableName);
        if (tableName === '_pocket_indexes') {
          return { changes: 1, lastInsertRowId: 0 };
        }
        if (params && params.length > 0) {
          if (sql.includes('IN (')) {
            let deleted = 0;
            for (const id of params) {
              if (table.delete(id as string)) deleted++;
            }
            return { changes: deleted, lastInsertRowId: 0 };
          }
          const id = params[0] as string;
          table.delete(id);
        } else {
          const count = table.size;
          table.clear();
          return { changes: count, lastInsertRowId: 0 };
        }
        return { changes: 1, lastInsertRowId: 0 };
      }

      return { changes: 0, lastInsertRowId: 0 };
    }),

    withTransactionAsync: vi.fn(async (fn: () => Promise<void>): Promise<void> => {
      await fn();
    }),

    closeAsync: vi.fn(async (): Promise<void> => {}),
  };

  return mockDb;
}

/**
 * Creates a mock openDatabase factory that returns the given mock db.
 */
function createMockOpener(mockDb: ExpoSQLiteDatabase) {
  return vi.fn(async (_name: string) => mockDb);
}

// ────────────────────────────── Adapter Tests ──────────────────────────────

describe('ExpoSQLiteAdapter', () => {
  let mockDb: ExpoSQLiteDatabase;
  let openDatabase: ReturnType<typeof createMockOpener>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    openDatabase = createMockOpener(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────── Initialization ──────────────────

  describe('initialization', () => {
    it('should create adapter with default config', () => {
      const adapter = new ExpoSQLiteAdapter();
      expect(adapter.name).toBe('expo-sqlite');
    });

    it('should initialize and open database via injected factory', async () => {
      const adapter = new ExpoSQLiteAdapter({
        name: 'test',
        databaseName: 'test.db',
        openDatabase,
      });

      await adapter.initialize({ name: 'test' });

      expect(openDatabase).toHaveBeenCalledWith('test.db');
    });

    it('should enable WAL mode by default', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      await adapter.initialize({ name: 'test' });

      expect(mockDb.execAsync).toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
    });

    it('should enable foreign keys by default', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      await adapter.initialize({ name: 'test' });

      expect(mockDb.execAsync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    });

    it('should skip WAL mode when disabled', async () => {
      const adapter = new ExpoSQLiteAdapter({
        name: 'test',
        enableWAL: false,
        openDatabase,
      });

      await adapter.initialize({ name: 'test' });

      expect(mockDb.execAsync).not.toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
    });

    it('should skip foreign keys when disabled', async () => {
      const adapter = new ExpoSQLiteAdapter({
        name: 'test',
        enableForeignKeys: false,
        openDatabase,
      });

      await adapter.initialize({ name: 'test' });

      expect(mockDb.execAsync).not.toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    });

    it('should not reinitialize if already initialized', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      await adapter.initialize({ name: 'test' });
      await adapter.initialize({ name: 'test' });

      expect(openDatabase).toHaveBeenCalledTimes(1);
    });

    it('should use config.name as fallback database name', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      await adapter.initialize({ name: 'my-app' });

      // databaseName not set, so falls back to StorageConfig.name
      expect(openDatabase).toHaveBeenCalledWith('my-app');
    });

    it('should report isAvailable true when openDatabase is provided', () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  // ────────────────── Close ──────────────────

  describe('close', () => {
    it('should close the database connection', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      await adapter.close();

      expect(mockDb.closeAsync).toHaveBeenCalled();
    });

    it('should clear stores on close', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      adapter.getStore('users');
      expect(adapter.hasStore('users')).toBe(true);

      await adapter.close();
      expect(adapter.hasStore('users')).toBe(false);
    });

    it('should be safe to call close without initialization', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.close(); // Should not throw
    });
  });

  // ────────────────── Store Management ──────────────────

  describe('store management', () => {
    it('should create and cache stores', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      const store1 = adapter.getStore('users');
      const store2 = adapter.getStore('users');

      expect(store1).toBe(store2);
      expect(store1.name).toBe('users');
    });

    it('should throw when getting store before initialization', () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      expect(() => adapter.getStore('users')).toThrow('Database not initialized');
    });

    it('should report hasStore correctly', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      expect(adapter.hasStore('users')).toBe(false);
      adapter.getStore('users');
      expect(adapter.hasStore('users')).toBe(true);
    });

    it('should list stores from SQLite', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      const stores = await adapter.listStores();
      expect(Array.isArray(stores)).toBe(true);
    });

    it('should return empty list when not initialized', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      const stores = await adapter.listStores();
      expect(stores).toEqual([]);
    });

    it('should delete a store', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      adapter.getStore('users');
      expect(adapter.hasStore('users')).toBe(true);

      await adapter.deleteStore('users');
      expect(adapter.hasStore('users')).toBe(false);
      expect(mockDb.execAsync).toHaveBeenCalled();
    });

    it('should be safe to delete store when not initialized', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.deleteStore('users'); // Should not throw
    });
  });

  // ────────────────── Transactions ──────────────────

  describe('transactions', () => {
    it('should execute function within transaction', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      const result = await adapter.transaction(['users'], 'readwrite', async () => {
        return 'result';
      });

      expect(result).toBe('result');
      expect(mockDb.withTransactionAsync).toHaveBeenCalled();
    });

    it('should throw when running transaction before initialization', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      await expect(
        adapter.transaction(['users'], 'readwrite', async () => 'value'),
      ).rejects.toThrow('Database not initialized');
    });
  });

  // ────────────────── Stats ──────────────────

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      const stats = await adapter.getStats();

      expect(stats).toEqual({
        documentCount: expect.any(Number),
        storeCount: expect.any(Number),
        storageSize: expect.any(Number),
        indexCount: expect.any(Number),
      });
    });

    it('should return zero stats when not initialized', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });

      const stats = await adapter.getStats();

      expect(stats).toEqual({
        documentCount: 0,
        storeCount: 0,
        storageSize: 0,
        indexCount: 0,
      });
    });

    it('should compute storage size from page count and size', async () => {
      const adapter = new ExpoSQLiteAdapter({ name: 'test', openDatabase });
      await adapter.initialize({ name: 'test' });

      const stats = await adapter.getStats();

      // 10 pages * 4096 bytes = 40960
      expect(stats.storageSize).toBe(40960);
    });
  });

  // ────────────────── Factory Function ──────────────────

  describe('createExpoSQLiteStorage', () => {
    it('should create an adapter instance', () => {
      const adapter = createExpoSQLiteStorage({
        name: 'test',
        databaseName: 'test.db',
        openDatabase,
      });

      expect(adapter.name).toBe('expo-sqlite');
    });

    it('should create adapter with no config', () => {
      const adapter = createExpoSQLiteStorage();
      expect(adapter.name).toBe('expo-sqlite');
    });
  });
});

// ────────────────── Document Store CRUD ──────────────────

describe('ExpoSQLiteDocumentStore', () => {
  let mockDb: ExpoSQLiteDatabase;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should return null for non-existent document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const doc = await store.get('non-existent');
      expect(doc).toBeNull();
    });

    it('should return a stored document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const testDoc: TestDocument = {
        _id: 'doc-1',
        title: 'Test',
        status: 'active',
        count: 5,
      };

      await store.put(testDoc);
      const retrieved = await store.get('doc-1');

      expect(retrieved).toEqual(testDoc);
    });
  });

  describe('getMany', () => {
    it('should return empty array for empty ids', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const result = await store.getMany([]);
      expect(result).toEqual([]);
    });

    it('should return nulls for missing documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const result = await store.getMany(['missing-1', 'missing-2']);
      expect(result).toEqual([null, null]);
    });
  });

  describe('getAll', () => {
    it('should return all non-deleted documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'doc-1', title: 'One', status: 'active', count: 1 });
      await store.put({ _id: 'doc-2', title: 'Two', status: 'done', count: 2 });

      const all = await store.getAll();
      expect(all.length).toBe(2);
    });
  });

  describe('put', () => {
    it('should insert a new document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const doc: TestDocument = { _id: 'new-1', title: 'New', status: 'active', count: 0 };
      const result = await store.put(doc);

      expect(result).toEqual(doc);
      expect(mockDb.runAsync).toHaveBeenCalled();
    });

    it('should emit insert change event for new document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: 'new-1', title: 'New', status: 'active', count: 0 });

      expect(events.length).toBe(1);
      expect((events[0] as { operation: string }).operation).toBe('insert');
    });

    it('should emit update change event for existing document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'doc-1', title: 'Original', status: 'active', count: 0 });

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: 'doc-1', title: 'Updated', status: 'active', count: 1 });

      expect(events.length).toBe(1);
      expect((events[0] as { operation: string }).operation).toBe('update');
    });

    it('should include previous document in update events', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const original: TestDocument = { _id: 'doc-1', title: 'Original', status: 'active', count: 0 };
      await store.put(original);

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: 'doc-1', title: 'Updated', status: 'active', count: 1 });

      const event = events[0] as { previousDocument: TestDocument };
      expect(event.previousDocument).toEqual(original);
    });

    it('should include timestamp and sequence in change events', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: 'new-1', title: 'New', status: 'active', count: 0 });

      const event = events[0] as { timestamp: number; sequence: number; isFromSync: boolean };
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.sequence).toBe(1);
      expect(event.isFromSync).toBe(false);
    });
  });

  describe('bulkPut', () => {
    it('should insert multiple documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const docs: TestDocument[] = [
        { _id: 'bulk-1', title: 'A', status: 'active', count: 1 },
        { _id: 'bulk-2', title: 'B', status: 'done', count: 2 },
      ];

      const result = await store.bulkPut(docs);
      expect(result.length).toBe(2);
    });

    it('should return empty for empty input', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const result = await store.bulkPut([]);
      expect(result).toEqual([]);
    });

    it('should emit change events for each document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.bulkPut([
        { _id: 'bulk-1', title: 'A', status: 'active', count: 1 },
        { _id: 'bulk-2', title: 'B', status: 'done', count: 2 },
      ]);

      expect(events.length).toBe(2);
    });
  });

  describe('delete', () => {
    it('should delete an existing document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'del-1', title: 'Delete Me', status: 'active', count: 0 });
      await store.delete('del-1');

      const retrieved = await store.get('del-1');
      expect(retrieved).toBeNull();
    });

    it('should emit delete change event', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'del-1', title: 'Delete Me', status: 'active', count: 0 });

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.delete('del-1');

      expect(events.length).toBe(1);
      expect((events[0] as { operation: string }).operation).toBe('delete');
      expect((events[0] as { document: null }).document).toBeNull();
    });

    it('should be no-op for non-existent document', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.delete('non-existent');

      expect(events.length).toBe(0);
    });
  });

  describe('bulkDelete', () => {
    it('should delete multiple documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'bd-1', title: 'A', status: 'active', count: 0 });
      await store.put({ _id: 'bd-2', title: 'B', status: 'done', count: 1 });

      await store.bulkDelete(['bd-1', 'bd-2']);

      expect(await store.get('bd-1')).toBeNull();
      expect(await store.get('bd-2')).toBeNull();
    });

    it('should handle empty ids array', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.bulkDelete([]);
      // Should not throw
    });

    it('should emit delete events for existing documents only', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'bd-1', title: 'A', status: 'active', count: 0 });

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.bulkDelete(['bd-1', 'non-existent']);

      // Only bd-1 should emit a delete event
      expect(events.length).toBe(1);
      expect((events[0] as { documentId: string }).documentId).toBe('bd-1');
    });
  });

  describe('count', () => {
    it('should count all non-deleted documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'c-1', title: 'A', status: 'active', count: 0 });
      await store.put({ _id: 'c-2', title: 'B', status: 'done', count: 1 });

      const count = await store.count();
      expect(count).toBe(2);
    });

    it('should return 0 for empty store', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');
      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'cl-1', title: 'A', status: 'active', count: 0 });
      await store.put({ _id: 'cl-2', title: 'B', status: 'done', count: 1 });

      await store.clear();

      const all = await store.getAll();
      expect(all.length).toBe(0);
    });

    it('should emit delete events for all documents', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.put({ _id: 'cl-1', title: 'A', status: 'active', count: 0 });
      await store.put({ _id: 'cl-2', title: 'B', status: 'done', count: 1 });

      const events: unknown[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.clear();

      expect(events.length).toBe(2);
      for (const event of events) {
        expect((event as { operation: string }).operation).toBe('delete');
      }
    });
  });

  describe('indexes', () => {
    it('should create an index', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.createIndex({
        name: 'idx_users_status',
        fields: ['status'],
      });

      expect(mockDb.execAsync).toHaveBeenCalled();
      expect(mockDb.runAsync).toHaveBeenCalled();
    });

    it('should create a unique index', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.createIndex({
        name: 'idx_users_id_unique',
        fields: ['_id'],
        unique: true,
      });

      // Verify execAsync was called with UNIQUE
      const calls = (mockDb.execAsync as ReturnType<typeof vi.fn>).mock.calls;
      const hasUnique = calls.some((call: unknown[]) =>
        (call[0] as string).includes('UNIQUE'),
      );
      expect(hasUnique).toBe(true);
    });

    it('should create a multi-field index', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.createIndex({
        fields: ['status', 'count'],
      });

      expect(mockDb.execAsync).toHaveBeenCalled();
    });

    it('should drop an index', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      await store.dropIndex('idx_users_status');

      expect(mockDb.execAsync).toHaveBeenCalled();
    });

    it('should get indexes (empty by default)', async () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');

      const indexes = await store.getIndexes();
      expect(indexes).toEqual([]);
    });
  });

  describe('name property', () => {
    it('should expose the store name', () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');
      expect(store.name).toBe('users');
    });
  });

  describe('changes observable', () => {
    it('should return an observable', () => {
      const store = new ExpoSQLiteDocumentStore<TestDocument>(mockDb, 'users');
      const obs = store.changes();
      expect(obs).toBeDefined();
      expect(typeof obs.subscribe).toBe('function');
    });
  });
});

// ────────────────── Query Translator ──────────────────

describe('QueryTranslator', () => {
  describe('translateFilter', () => {
    it('should translate $eq operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ status: { $eq: 'active' } }, params);

      expect(result).toContain("json_extract(data, '$.status') = ?");
      expect(params).toEqual(['active']);
    });

    it('should translate $ne operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ status: { $ne: 'archived' } }, params);

      expect(result).toContain("json_extract(data, '$.status') != ?");
      expect(params).toEqual(['archived']);
    });

    it('should translate $gt operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ count: { $gt: 5 } }, params);

      expect(result).toContain("json_extract(data, '$.count') > ?");
      expect(params).toEqual([5]);
    });

    it('should translate $gte operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ count: { $gte: 10 } }, params);

      expect(result).toContain("json_extract(data, '$.count') >= ?");
      expect(params).toEqual([10]);
    });

    it('should translate $lt operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ count: { $lt: 3 } }, params);

      expect(result).toContain("json_extract(data, '$.count') < ?");
      expect(params).toEqual([3]);
    });

    it('should translate $lte operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ count: { $lte: 0 } }, params);

      expect(result).toContain("json_extract(data, '$.count') <= ?");
      expect(params).toEqual([0]);
    });

    it('should translate $in operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { status: { $in: ['active', 'pending'] } },
        params,
      );

      expect(result).toContain("json_extract(data, '$.status') IN (?, ?)");
      expect(params).toEqual(['active', 'pending']);
    });

    it('should translate $nin operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { status: { $nin: ['archived', 'deleted'] } },
        params,
      );

      expect(result).toContain("json_extract(data, '$.status') NOT IN (?, ?)");
      expect(params).toEqual(['archived', 'deleted']);
    });

    it('should translate $exists: true', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ tags: { $exists: true } }, params);

      expect(result).toContain("json_extract(data, '$.tags') IS NOT NULL");
    });

    it('should translate $exists: false', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ tags: { $exists: false } }, params);

      expect(result).toContain("json_extract(data, '$.tags') IS NULL");
    });

    it('should translate $regex with ^prefix pattern', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ title: { $regex: '^Test' } }, params);

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['Test%']);
    });

    it('should translate $regex with suffix$ pattern', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ title: { $regex: 'World$' } }, params);

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['%World']);
    });

    it('should translate $regex with simple substring', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ title: { $regex: 'test' } }, params);

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['%test%']);
    });

    it('should translate $regex with RegExp object', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { title: /^Hello/ as unknown as undefined },
        params,
      );

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['Hello%']);
    });

    it('should translate $startsWith', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ title: { $startsWith: 'Hello' } }, params);

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['Hello%']);
    });

    it('should translate $endsWith', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ title: { $endsWith: 'World' } }, params);

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['%World']);
    });

    it('should translate $contains', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ title: { $contains: 'foo' } }, params);

      expect(result).toContain("json_extract(data, '$.title') LIKE ?");
      expect(params).toEqual(['%foo%']);
    });

    it('should translate implicit $eq for primitive values', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { status: 'active' as unknown as undefined },
        params,
      );

      expect(result).toContain("json_extract(data, '$.status') = ?");
      expect(params).toEqual(['active']);
    });

    it('should translate null equality', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { status: null as unknown as undefined },
        params,
      );

      expect(result).toContain("json_extract(data, '$.status') IS NULL");
    });

    it('should translate $eq null', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ status: { $eq: null } }, params);

      expect(result).toContain("json_extract(data, '$.status') IS NULL");
    });

    it('should translate $ne null', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ status: { $ne: null } }, params);

      expect(result).toContain("json_extract(data, '$.status') IS NOT NULL");
    });

    it('should translate $and logical operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        {
          $and: [
            { status: { $eq: 'active' } },
            { count: { $gt: 5 } },
          ],
        },
        params,
      );

      expect(result).toContain('AND');
      expect(params.length).toBe(2);
    });

    it('should translate $or logical operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        {
          $or: [
            { status: { $eq: 'active' } },
            { status: { $eq: 'pending' } },
          ],
        },
        params,
      );

      expect(result).toContain('OR');
      expect(params.length).toBe(2);
    });

    it('should translate $not logical operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        {
          $not: { status: { $eq: 'archived' } },
        },
        params,
      );

      expect(result).toContain('NOT');
      expect(params.length).toBe(1);
    });

    it('should translate $nor logical operator', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        {
          $nor: [
            { status: { $eq: 'deleted' } },
            { status: { $eq: 'archived' } },
          ],
        },
        params,
      );

      expect(result).toContain('NOT');
      expect(result).toContain('OR');
    });

    it('should handle empty $in array (always false)', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { status: { $in: [] } },
        params,
      );

      expect(result).toContain('0 = 1');
    });

    it('should handle empty $nin array (always true)', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        { status: { $nin: [] } },
        params,
      );

      expect(result).toContain('1 = 1');
    });

    it('should map _id field to id column', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ _id: { $eq: 'doc-1' } }, params);

      expect(result).toContain('id = ?');
      expect(result).not.toContain('json_extract');
    });

    it('should map _rev field to _rev column directly', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ _rev: { $eq: '1-abc' } }, params);

      expect(result).toContain('_rev = ?');
      expect(result).not.toContain('json_extract');
    });

    it('should skip undefined values', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter({ status: undefined }, params);

      expect(result).toBe('');
      expect(params).toEqual([]);
    });

    it('should combine multiple field conditions with AND', () => {
      const translator = new QueryTranslator();
      const params: unknown[] = [];

      const result = translator.translateFilter(
        {
          status: { $eq: 'active' },
          count: { $gt: 5 },
        },
        params,
      );

      expect(result).toContain('AND');
      expect(params).toEqual(['active', 5]);
    });
  });

  describe('translateSort', () => {
    it('should translate ascending sort', () => {
      const translator = new QueryTranslator();

      const result = translator.translateSort([{ field: 'title', direction: 'asc' }]);

      expect(result).toContain("json_extract(data, '$.title') ASC");
    });

    it('should translate descending sort', () => {
      const translator = new QueryTranslator();

      const result = translator.translateSort([{ field: 'count', direction: 'desc' }]);

      expect(result).toContain("json_extract(data, '$.count') DESC");
    });

    it('should translate multi-field sort', () => {
      const translator = new QueryTranslator();

      const result = translator.translateSort([
        { field: 'status', direction: 'asc' },
        { field: 'count', direction: 'desc' },
      ]);

      expect(result).toContain('ASC');
      expect(result).toContain('DESC');
      expect(result).toContain(',');
    });

    it('should return empty string for no sort', () => {
      const translator = new QueryTranslator();
      expect(translator.translateSort(undefined)).toBe('');
    });

    it('should return empty string for empty sort array', () => {
      const translator = new QueryTranslator();
      expect(translator.translateSort([])).toBe('');
    });

    it('should map internal fields in sort', () => {
      const translator = new QueryTranslator();

      const result = translator.translateSort([{ field: '_updatedAt', direction: 'desc' }]);

      expect(result).toBe('_updatedAt DESC');
      expect(result).not.toContain('json_extract');
    });
  });

  describe('translate (full query)', () => {
    it('should translate a complete query spec', () => {
      const translator = new QueryTranslator();

      const result = translator.translate({
        filter: { status: { $eq: 'active' } },
        sort: [{ field: 'count', direction: 'desc' }],
        limit: 10,
        skip: 5,
      });

      expect(result.whereClause).toContain('_deleted = 0');
      expect(result.whereClause).toContain("json_extract(data, '$.status') = ?");
      expect(result.orderByClause).toContain('DESC');
      expect(result.params).toEqual(['active']);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
    });

    it('should add _deleted = 0 clause by default', () => {
      const translator = new QueryTranslator();

      const result = translator.translate({});

      expect(result.whereClause).toBe('_deleted = 0');
    });

    it('should not add duplicate _deleted filter when filter references _deleted', () => {
      const translator = new QueryTranslator();

      const result = translator.translate({
        filter: { _deleted: true as unknown as undefined },
      });

      const matches = result.whereClause.match(/_deleted/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(1);
    });

    it('should handle query with only sort', () => {
      const translator = new QueryTranslator();

      const result = translator.translate({
        sort: [{ field: 'title', direction: 'asc' }],
      });

      expect(result.whereClause).toBe('_deleted = 0');
      expect(result.orderByClause).toContain('ASC');
      expect(result.params).toEqual([]);
    });

    it('should handle query with only limit and skip', () => {
      const translator = new QueryTranslator();

      const result = translator.translate({
        limit: 20,
        skip: 10,
      });

      expect(result.limit).toBe(20);
      expect(result.offset).toBe(10);
    });
  });
});

// ────────────────── Background Sync Manager ──────────────────

describe('BackgroundSyncManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 60000,
      });

      expect(manager.isRunning).toBe(false);

      manager.start();
      expect(manager.isRunning).toBe(true);

      manager.stop();
      expect(manager.isRunning).toBe(false);
    });

    it('should not start when disabled', () => {
      const manager = new BackgroundSyncManager({
        enabled: false,
      });

      manager.start();
      expect(manager.isRunning).toBe(false);
    });

    it('should not start twice', () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 60000,
      });

      manager.start();
      manager.start();

      expect(manager.isRunning).toBe(true);
      manager.stop();
    });

    it('should default intervalMs to 300000', () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
      });

      // We can verify the default by checking that no sync fires before 300s
      const listener = vi.fn().mockResolvedValue(undefined);
      manager.onSync(listener);
      manager.start();

      vi.advanceTimersByTime(299999);
      expect(listener).not.toHaveBeenCalled();

      manager.stop();
    });
  });

  describe('sync listeners', () => {
    it('should register and call sync listeners', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 60000,
        batteryAware: false,
        networkRequired: false,
      });

      const listener = vi.fn().mockResolvedValue(undefined);
      manager.onSync(listener);

      await manager.triggerSync(true);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should unregister sync listener via subscription', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        batteryAware: false,
        networkRequired: false,
      });

      const listener = vi.fn().mockResolvedValue(undefined);
      const subscription = manager.onSync(listener);

      subscription.remove();

      await manager.triggerSync(true);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle multiple listeners', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        batteryAware: false,
        networkRequired: false,
      });

      const listener1 = vi.fn().mockResolvedValue(undefined);
      const listener2 = vi.fn().mockResolvedValue(undefined);
      manager.onSync(listener1);
      manager.onSync(listener2);

      await manager.triggerSync(true);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should update lastSync timestamp after sync', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        batteryAware: false,
        networkRequired: false,
      });

      expect(manager.lastSync).toBe(0);

      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      await manager.triggerSync(true);

      expect(manager.lastSync).toBeGreaterThan(0);
    });

    it('should continue if a listener throws', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        batteryAware: false,
        networkRequired: false,
      });

      const failingListener = vi.fn().mockRejectedValue(new Error('sync failed'));
      const successListener = vi.fn().mockResolvedValue(undefined);

      manager.onSync(failingListener);
      manager.onSync(successListener);

      await manager.triggerSync(true);

      expect(failingListener).toHaveBeenCalled();
      expect(successListener).toHaveBeenCalled();
    });
  });

  describe('periodic sync', () => {
    it('should trigger sync on interval', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 10000,
        batteryAware: false,
        networkRequired: false,
      });

      const listener = vi.fn().mockResolvedValue(undefined);
      manager.onSync(listener);

      manager.start();

      await vi.advanceTimersByTimeAsync(10000);
      expect(listener).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10000);
      expect(listener).toHaveBeenCalledTimes(2);

      manager.stop();
    });

    it('should stop periodic sync on stop', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 10000,
        batteryAware: false,
        networkRequired: false,
      });

      const listener = vi.fn().mockResolvedValue(undefined);
      manager.onSync(listener);

      manager.start();
      manager.stop();

      await vi.advanceTimersByTimeAsync(20000);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('config updates', () => {
    it('should update config at runtime', () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 60000,
      });

      manager.start();
      expect(manager.isRunning).toBe(true);

      manager.updateConfig({ enabled: false });
      expect(manager.isRunning).toBe(false);
    });

    it('should restart with new config when still enabled', () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 60000,
      });

      manager.start();
      manager.updateConfig({ intervalMs: 30000 });

      expect(manager.isRunning).toBe(true);
      manager.stop();
    });

    it('should not restart when disabled after update', () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        intervalMs: 60000,
      });

      manager.start();
      manager.updateConfig({ enabled: false });

      expect(manager.isRunning).toBe(false);
    });
  });

  describe('force trigger', () => {
    it('should sync when force is true regardless of conditions', async () => {
      const manager = new BackgroundSyncManager({
        enabled: true,
        batteryAware: true,
        networkRequired: true,
      });

      const listener = vi.fn().mockResolvedValue(undefined);
      manager.onSync(listener);

      await manager.triggerSync(true);

      expect(listener).toHaveBeenCalled();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundSyncManager,
  createBackgroundSyncManager,
  type BackgroundSyncStatus,
} from '../background-sync.js';
import {
  NativeSQLiteStorage,
  createNativeSQLiteStorage,
  type SQLiteDatabase,
  type SQLiteTransaction,
} from '../native-storage.js';

// ────────────────────────────── Mock SQLite Database ──────────────────────────────

function createMockSQLiteDatabase(): SQLiteDatabase & { _store: Map<string, Map<string, string>> } {
  const store = new Map<string, Map<string, string>>();

  function getTable(sql: string): Map<string, string> {
    const match = sql.match(/"([^"]+)"/);
    const tableName = match?.[1] ?? 'default';
    if (!store.has(tableName)) {
      store.set(tableName, new Map());
    }
    return store.get(tableName)!;
  }

  const db: SQLiteDatabase & { _store: Map<string, Map<string, string>> } = {
    _store: store,

    executeSql: vi.fn(async (sql: string, params?: unknown[]): Promise<void> => {
      if (sql.startsWith('PRAGMA')) return;
      if (sql.startsWith('CREATE TABLE')) return;

      const table = getTable(sql);

      if (sql.includes('INSERT OR REPLACE')) {
        const key = params?.[0] as string;
        const value = params?.[1] as string;
        table.set(key, value);
      } else if (sql.includes('DELETE') && params && params.length > 0) {
        const key = params[0] as string;
        table.delete(key);
      } else if (sql.includes('DELETE')) {
        table.clear();
      }
    }),

    queryAll: vi.fn(
      async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
        const table = getTable(sql);

        if (sql.includes('WHERE key IN')) {
          const keys = params as string[];
          return keys
            .filter((k) => table.has(k))
            .map((k) => ({ key: k, value: table.get(k)! }) as unknown as T);
        }

        if (sql.includes('WHERE key LIKE')) {
          const prefix = (params?.[0] as string).replace('%', '');
          return Array.from(table.entries())
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => ({ key: k, value: v }) as unknown as T);
        }

        if (sql.includes('WHERE key = ?')) {
          const key = params?.[0] as string;
          if (table.has(key)) {
            return [{ key, value: table.get(key)! } as unknown as T];
          }
          return [];
        }

        if (sql.includes('COUNT(*)')) {
          return [{ count: table.size } as unknown as T];
        }

        if (sql.includes('SUM(LENGTH')) {
          let size = 0;
          for (const v of table.values()) size += v.length;
          return [{ size } as unknown as T];
        }

        return Array.from(table.entries()).map(([k, v]) => ({ key: k, value: v }) as unknown as T);
      }
    ),

    queryFirst: vi.fn(
      async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> => {
        const results = await db.queryAll<T>(sql, params);
        return results[0] ?? null;
      }
    ),

    transaction: vi.fn(async (fn: (tx: SQLiteTransaction) => Promise<void>): Promise<void> => {
      const tx: SQLiteTransaction = {
        executeSql: db.executeSql,
        queryAll: db.queryAll,
      };
      await fn(tx);
    }),

    close: vi.fn(async (): Promise<void> => {}),
  };

  return db;
}

// ════════════════════════════════════════════════════════════════════════════════
//  NativeSQLiteStorage Tests
// ════════════════════════════════════════════════════════════════════════════════

describe('NativeSQLiteStorage', () => {
  let db: ReturnType<typeof createMockSQLiteDatabase>;
  let storage: NativeSQLiteStorage;

  beforeEach(async () => {
    db = createMockSQLiteDatabase();
    storage = createNativeSQLiteStorage({ dbName: 'test', database: db });
    await storage.initialize();
  });

  // ──────────────── CRUD Operations ────────────────

  describe('CRUD operations', () => {
    it('should set and get a value', async () => {
      await storage.set('key1', { title: 'Hello' });
      const result = await storage.get<{ title: string }>('key1');

      expect(result).toEqual({ title: 'Hello' });
    });

    it('should return null for a missing key', async () => {
      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete a value', async () => {
      await storage.set('key1', { title: 'Hello' });
      await storage.delete('key1');

      const result = await storage.get('key1');
      expect(result).toBeNull();
    });

    it('should overwrite an existing value', async () => {
      await storage.set('key1', { title: 'First' });
      await storage.set('key1', { title: 'Second' });

      const result = await storage.get<{ title: string }>('key1');
      expect(result).toEqual({ title: 'Second' });
    });

    it('should query all entries', async () => {
      await storage.set('item:1', { name: 'A' });
      await storage.set('item:2', { name: 'B' });

      const results = await storage.query();
      expect(results.length).toBe(2);
    });

    it('should query entries by prefix', async () => {
      await storage.set('item:1', { name: 'A' });
      await storage.set('item:2', { name: 'B' });
      await storage.set('other:1', { name: 'C' });

      const results = await storage.query('item:');
      expect(results.length).toBe(2);
    });

    it('should bulk get multiple values', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);
      await storage.set('c', 3);

      const result = await storage.bulkGet<number>(['a', 'c']);
      expect(result.size).toBe(2);
      expect(result.get('a')).toBe(1);
      expect(result.get('c')).toBe(3);
    });

    it('should bulk set multiple values', async () => {
      await storage.bulkSet([
        ['x', 10],
        ['y', 20],
      ]);

      const x = await storage.get<number>('x');
      const y = await storage.get<number>('y');
      expect(x).toBe(10);
      expect(y).toBe(20);
    });

    it('should count documents', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);

      const count = await storage.count();
      expect(count).toBe(2);
    });

    it('should clear all documents', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);
      await storage.clear();

      const count = await storage.count();
      expect(count).toBe(0);
    });
  });

  // ──────────────── WAL Mode Configuration ────────────────

  describe('WAL mode configuration', () => {
    it('should enable WAL mode by default', async () => {
      const freshDb = createMockSQLiteDatabase();
      const freshStorage = createNativeSQLiteStorage({
        dbName: 'wal-test',
        database: freshDb,
      });

      await freshStorage.initialize();

      expect(freshDb.executeSql).toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
    });

    it('should not enable WAL mode when walMode is false', async () => {
      const freshDb = createMockSQLiteDatabase();
      const freshStorage = createNativeSQLiteStorage({
        dbName: 'no-wal',
        database: freshDb,
        walMode: false,
      });

      await freshStorage.initialize();

      expect(freshDb.executeSql).not.toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
    });

    it('should set busy timeout', async () => {
      const freshDb = createMockSQLiteDatabase();
      const freshStorage = createNativeSQLiteStorage({
        dbName: 'timeout-test',
        database: freshDb,
        busyTimeout: 10000,
      });

      await freshStorage.initialize();

      expect(freshDb.executeSql).toHaveBeenCalledWith('PRAGMA busy_timeout = 10000;');
    });

    it('should set journal size limit when configured', async () => {
      const freshDb = createMockSQLiteDatabase();
      const freshStorage = createNativeSQLiteStorage({
        dbName: 'journal-test',
        database: freshDb,
        journalSizeLimit: 1024,
      });

      await freshStorage.initialize();

      expect(freshDb.executeSql).toHaveBeenCalledWith('PRAGMA journal_size_limit = 1024;');
    });
  });

  // ──────────────── Transaction Support ────────────────

  describe('transaction support', () => {
    it('should run operations inside a transaction', async () => {
      await storage.runInTransaction(async (tx) => {
        await tx.set('t1', 'value1');
        await tx.set('t2', 'value2');
      });

      expect(db.transaction).toHaveBeenCalled();
      const v1 = await storage.get('t1');
      const v2 = await storage.get('t2');
      expect(v1).toBe('value1');
      expect(v2).toBe('value2');
    });

    it('should support get inside a transaction', async () => {
      await storage.set('existing', 42);

      let fetched: number | null = null;
      await storage.runInTransaction(async (tx) => {
        fetched = await tx.get<number>('existing');
      });

      expect(fetched).toBe(42);
    });

    it('should support delete inside a transaction', async () => {
      await storage.set('to-delete', 'bye');

      await storage.runInTransaction(async (tx) => {
        await tx.delete('to-delete');
      });

      const result = await storage.get('to-delete');
      expect(result).toBeNull();
    });

    it('should return a value from runInTransaction', async () => {
      await storage.set('key', 100);

      const result = await storage.runInTransaction(async (tx) => {
        const val = await tx.get<number>('key');
        return (val ?? 0) + 1;
      });

      expect(result).toBe(101);
    });
  });

  // ──────────────── Storage Stats ────────────────

  describe('storage stats', () => {
    it('should track document count', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);

      expect(storage.stats.documentCount).toBe(2);
    });

    it('should track last write time', async () => {
      const before = Date.now();
      await storage.set('a', 1);
      const after = Date.now();

      expect(storage.stats.lastWriteTime).toBeGreaterThanOrEqual(before);
      expect(storage.stats.lastWriteTime).toBeLessThanOrEqual(after);
    });

    it('should update stats on delete', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);
      await storage.delete('a');

      expect(storage.stats.documentCount).toBe(1);
    });

    it('should reset stats on clear', async () => {
      await storage.set('a', 1);
      await storage.clear();

      expect(storage.stats.documentCount).toBe(0);
      expect(storage.stats.storageSize).toBe(0);
    });
  });

  // ──────────────── Initialization ────────────────

  describe('initialization', () => {
    it('should throw if used before initialization', async () => {
      const uninitStorage = createNativeSQLiteStorage({
        dbName: 'uninit',
        database: createMockSQLiteDatabase(),
      });

      await expect(uninitStorage.get('key')).rejects.toThrow('not initialized');
    });

    it('should close the database', async () => {
      await storage.close();
      expect(db.close).toHaveBeenCalled();
      expect(storage.initialized).toBe(false);
    });

    it('should not re-initialize if already initialized', async () => {
      const callCount = (db.executeSql as ReturnType<typeof vi.fn>).mock.calls.length;
      await storage.initialize();
      expect((db.executeSql as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });
  });

  // ──────────────── Factory Function ────────────────

  describe('createNativeSQLiteStorage', () => {
    it('should create a NativeSQLiteStorage instance', () => {
      const instance = createNativeSQLiteStorage({
        dbName: 'factory-test',
        database: createMockSQLiteDatabase(),
      });

      expect(instance).toBeInstanceOf(NativeSQLiteStorage);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
//  BackgroundSyncManager Tests
// ════════════════════════════════════════════════════════════════════════════════

describe('BackgroundSyncManager', () => {
  let manager: BackgroundSyncManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = createBackgroundSyncManager({
      minIntervalMs: 1000,
      batchSize: 10,
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  // ──────────────── Status Transitions ────────────────

  describe('sync state transitions', () => {
    it('should start in disabled state', () => {
      expect(manager.getStatus()).toBe('disabled');
    });

    it('should transition to idle when enabled', () => {
      manager.enable();
      expect(manager.getStatus()).toBe('idle');
    });

    it('should transition to syncing during triggerSync', async () => {
      const statuses: BackgroundSyncStatus[] = [];
      manager.status$.subscribe((s) => statuses.push(s));

      manager.enable();
      await manager.triggerSync();

      expect(statuses).toContain('syncing');
    });

    it('should transition back to idle after successful sync', async () => {
      manager.enable();
      manager.setPendingChanges([{ id: 1 }]);
      await manager.triggerSync();

      expect(manager.getStatus()).toBe('idle');
    });

    it('should transition to disabled on disable', () => {
      manager.enable();
      manager.disable();

      expect(manager.getStatus()).toBe('disabled');
    });

    it('should transition to disabled on destroy', () => {
      manager.enable();
      const statuses: BackgroundSyncStatus[] = [];
      manager.status$.subscribe((s) => statuses.push(s));
      manager.destroy();

      expect(statuses).toContain('disabled');
    });
  });

  // ──────────────── Enable / Disable ────────────────

  describe('enable and disable', () => {
    it('should not enable twice', () => {
      manager.enable();
      manager.enable();

      expect(manager.isEnabled()).toBe(true);
    });

    it('should disable cleanly', () => {
      manager.enable();
      manager.disable();

      expect(manager.isEnabled()).toBe(false);
      expect(manager.getStatus()).toBe('disabled');
    });

    it('should not sync after disable', () => {
      manager.enable();
      manager.setPendingChanges([{ id: 1 }]);
      manager.disable();

      vi.advanceTimersByTime(10000);
      expect(manager.getStatus()).toBe('disabled');
    });
  });

  // ──────────────── Sync Operations ────────────────

  describe('sync operations', () => {
    it('should process pending changes in batch', async () => {
      manager.enable();
      manager.setPendingChanges([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const result = await manager.triggerSync();

      expect(result.synced).toBe(3);
      expect(result.failed).toBe(0);
      expect(manager.getPendingCount()).toBe(0);
    });

    it('should respect batch size', async () => {
      const smallBatch = createBackgroundSyncManager({ batchSize: 2 });
      smallBatch.enable();
      smallBatch.setPendingChanges([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const result = await smallBatch.triggerSync();

      expect(result.synced).toBe(2);
      expect(smallBatch.getPendingCount()).toBe(1);

      smallBatch.destroy();
    });

    it('should track sync history', async () => {
      manager.enable();
      manager.setPendingChanges([{ id: 1 }]);
      await manager.triggerSync();

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].synced).toBe(1);
    });

    it('should return last result on duplicate sync call', async () => {
      manager.enable();
      const result = await manager.triggerSync();
      expect(result.synced).toBe(0);
    });
  });

  // ──────────────── Timer-Based Sync ────────────────

  describe('timer-based sync', () => {
    it('should trigger sync on interval when changes are pending', async () => {
      manager.enable();
      manager.setPendingChanges([{ id: 1 }]);

      vi.advanceTimersByTime(999);
      expect(manager.getPendingCount()).toBe(1);

      // Advance past the interval and let the async sync complete
      await vi.advanceTimersByTimeAsync(1);
      expect(manager.getPendingCount()).toBe(0);
    });
  });

  // ──────────────── Factory Function ────────────────

  describe('createBackgroundSyncManager', () => {
    it('should create a BackgroundSyncManager instance', () => {
      const instance = createBackgroundSyncManager();
      expect(instance).toBeInstanceOf(BackgroundSyncManager);
      instance.destroy();
    });
  });
});

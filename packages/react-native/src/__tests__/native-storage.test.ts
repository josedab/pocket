import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import {
  NativeSQLiteStorage,
  createNativeSQLiteStorage,
  type SQLiteDatabase,
  type SQLiteTransaction,
} from '../native-storage.js';
import {
  BackgroundSyncManager,
  createBackgroundSyncManager,
  type AppStateProvider,
  type NetworkInfoProvider,
  type BackgroundSyncAppState,
  type SyncState,
} from '../background-sync.js';

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

    queryAll: vi.fn(async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
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

      return Array.from(table.entries()).map(
        ([k, v]) => ({ key: k, value: v }) as unknown as T
      );
    }),

    queryFirst: vi.fn(async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> => {
      const results = await db.queryAll<T>(sql, params);
      return results[0] ?? null;
    }),

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

// ────────────────────────────── Mock App State Provider ──────────────────────────────

function createMockAppStateProvider(initialState: BackgroundSyncAppState = 'active'): AppStateProvider & {
  _setState: (state: BackgroundSyncAppState) => void;
} {
  let currentState = initialState;
  let listener: ((state: BackgroundSyncAppState) => void) | null = null;

  return {
    getCurrentState: () => currentState,
    addEventListener: (callback) => {
      listener = callback;
      return () => { listener = null; };
    },
    _setState: (state) => {
      currentState = state;
      listener?.(state);
    },
  };
}

// ────────────────────────────── Mock Network Info Provider ──────────────────────────────

function createMockNetworkInfoProvider(initialConnected = true): NetworkInfoProvider & {
  _setConnected: (connected: boolean) => void;
} {
  let connected = initialConnected;
  let listener: ((isConnected: boolean) => void) | null = null;

  return {
    isConnected: () => connected,
    addEventListener: (callback) => {
      listener = callback;
      return () => { listener = null; };
    },
    _setConnected: (value) => {
      connected = value;
      listener?.(value);
    },
  };
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
  let appState: ReturnType<typeof createMockAppStateProvider>;
  let network: ReturnType<typeof createMockNetworkInfoProvider>;
  let syncFn: ReturnType<typeof vi.fn>;
  let manager: BackgroundSyncManager;

  beforeEach(() => {
    vi.useFakeTimers();
    appState = createMockAppStateProvider('active');
    network = createMockNetworkInfoProvider(true);
    syncFn = vi.fn(async () => {});
    manager = createBackgroundSyncManager({
      syncFn,
      appStateProvider: appState,
      networkInfoProvider: network,
      foregroundIntervalMs: 1000,
      backgroundIntervalMs: 5000,
    });
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  // ──────────────── Sync State Transitions ────────────────

  describe('sync state transitions', () => {
    it('should start in idle state', () => {
      expect(manager.currentState).toBe('idle');
    });

    it('should transition to syncing when sync runs', async () => {
      const states: SyncState[] = [];
      manager.syncState$.subscribe((s) => states.push(s));

      manager.start();
      await manager.forceSync();

      expect(states).toContain('syncing');
    });

    it('should transition back to idle after successful sync', async () => {
      manager.start();
      await manager.forceSync();

      expect(manager.currentState).toBe('idle');
    });

    it('should transition to error on sync failure', async () => {
      syncFn.mockRejectedValueOnce(new Error('Sync failed'));
      manager.start();
      await manager.forceSync();

      expect(manager.currentState).toBe('error');
    });

    it('should transition to paused when offline', () => {
      manager.start();
      network._setConnected(false);

      expect(manager.currentState).toBe('paused');
    });

    it('should return to idle state on stop', async () => {
      manager.start();
      await manager.forceSync();
      manager.stop();

      expect(manager.currentState).toBe('idle');
    });
  });

  // ──────────────── AppState Handling ────────────────

  describe('app state handling', () => {
    it('should use foreground interval when active', () => {
      manager.start();

      vi.advanceTimersByTime(999);
      expect(syncFn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(syncFn).toHaveBeenCalledTimes(1);
    });

    it('should reschedule on app state change to background', () => {
      manager.start();

      appState._setState('background');

      syncFn.mockClear();
      vi.advanceTimersByTime(1000);
      expect(syncFn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(4000);
      expect(syncFn).toHaveBeenCalledTimes(1);
    });

    it('should reschedule on app state change back to active', () => {
      manager.start();

      appState._setState('background');
      syncFn.mockClear();

      appState._setState('active');
      vi.advanceTimersByTime(1000);
      expect(syncFn).toHaveBeenCalledTimes(1);
    });

    it('should not sync when force synced while offline', async () => {
      manager.start();
      network._setConnected(false);

      await manager.forceSync();
      expect(syncFn).not.toHaveBeenCalled();
      expect(manager.currentState).toBe('paused');
    });
  });

  // ──────────────── Battery Handling ────────────────

  describe('battery handling', () => {
    it('should pause sync when battery is low', async () => {
      const lowBatteryManager = createBackgroundSyncManager({
        syncFn,
        appStateProvider: appState,
        networkInfoProvider: network,
        batteryInfoProvider: { getBatteryLevel: () => 0.1 },
        minBatteryLevel: 0.2,
        foregroundIntervalMs: 1000,
      });

      lowBatteryManager.start();
      await lowBatteryManager.forceSync();

      expect(syncFn).not.toHaveBeenCalled();
      expect(lowBatteryManager.currentState).toBe('paused');

      lowBatteryManager.stop();
    });
  });

  // ──────────────── Start / Stop ────────────────

  describe('start and stop', () => {
    it('should not start twice', () => {
      manager.start();
      manager.start();

      expect(manager.running).toBe(true);
    });

    it('should stop cleanly', () => {
      manager.start();
      manager.stop();

      expect(manager.running).toBe(false);
      expect(manager.currentState).toBe('idle');
    });

    it('should not sync after stop', () => {
      manager.start();
      manager.stop();

      vi.advanceTimersByTime(10000);
      expect(syncFn).not.toHaveBeenCalled();
    });
  });

  // ──────────────── Factory Function ────────────────

  describe('createBackgroundSyncManager', () => {
    it('should create a BackgroundSyncManager instance', () => {
      const instance = createBackgroundSyncManager({
        syncFn: async () => {},
        appStateProvider: appState,
        networkInfoProvider: network,
      });

      expect(instance).toBeInstanceOf(BackgroundSyncManager);
    });
  });
});

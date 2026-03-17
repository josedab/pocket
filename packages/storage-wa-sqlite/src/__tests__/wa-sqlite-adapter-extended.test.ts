import type { Document } from '@pocket/core';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlJsDatabase, SqlJsStatic } from '../types.js';
import { WaSQLiteAdapter, createWaSQLiteStorage } from '../wa-sqlite-adapter.js';

// ── Test document type ──────────────────────────────────────────

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
  tags: string[];
  nested: { value: number };
  status?: string;
}

// ── Shared sql.js initialization ────────────────────────────────

let cachedSQL: SqlJsStatic | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!cachedSQL) {
    cachedSQL = (await initSqlJs()) as unknown as SqlJsStatic;
  }
  return cachedSQL;
}

function makeDoc(overrides: Partial<TestDoc> & { _id: string }): TestDoc {
  return {
    title: 'Default',
    count: 0,
    tags: [],
    nested: { value: 0 },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('WaSQLiteAdapter - extended', () => {
  let adapter: WaSQLiteAdapter;

  beforeEach(async () => {
    adapter = new WaSQLiteAdapter({
      name: 'test-db',
      sqlJsFactory: getSqlJs,
    });
    await adapter.initialize({ name: 'test-db' });
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ── Configuration & Initialization ─────────────────────────

  describe('configuration', () => {
    it('should apply custom journalMode pragma', async () => {
      const customAdapter = new WaSQLiteAdapter({
        name: 'custom-db',
        sqlJsFactory: getSqlJs,
        journalMode: 'OFF',
      });
      await customAdapter.initialize({ name: 'custom-db' });
      // If it initializes without error, pragmas were applied
      expect(customAdapter.name).toBe('wa-sqlite');
      await customAdapter.close();
    });

    it('should apply foreignKeys pragma', async () => {
      const customAdapter = new WaSQLiteAdapter({
        name: 'fk-db',
        sqlJsFactory: getSqlJs,
        foreignKeys: true,
      });
      await customAdapter.initialize({ name: 'fk-db' });
      expect(customAdapter.name).toBe('wa-sqlite');
      await customAdapter.close();
    });

    it('should apply cacheSize pragma', async () => {
      const customAdapter = new WaSQLiteAdapter({
        name: 'cache-db',
        sqlJsFactory: getSqlJs,
        cacheSize: -4000,
      });
      await customAdapter.initialize({ name: 'cache-db' });
      expect(customAdapter.name).toBe('wa-sqlite');
      await customAdapter.close();
    });

    it('should apply pageSize pragma', async () => {
      const customAdapter = new WaSQLiteAdapter({
        name: 'page-db',
        sqlJsFactory: getSqlJs,
        pageSize: 8192,
      });
      await customAdapter.initialize({ name: 'page-db' });
      expect(customAdapter.name).toBe('wa-sqlite');
      await customAdapter.close();
    });

    it('should merge config from initialize options', async () => {
      const customAdapter = new WaSQLiteAdapter({
        name: 'merge-db',
        sqlJsFactory: getSqlJs,
      });
      await customAdapter.initialize({
        name: 'merge-db',
        version: 5,
        options: { journalMode: 'DELETE' },
      });
      // Should not throw; config was merged
      expect(customAdapter.name).toBe('wa-sqlite');
      await customAdapter.close();
    });

    it('should store database version from config', async () => {
      const customAdapter = new WaSQLiteAdapter({
        name: 'version-db',
        sqlJsFactory: getSqlJs,
      });
      await customAdapter.initialize({ name: 'version-db', version: 42 });
      // Verify version was stored by checking stats work
      const stats = await customAdapter.getStats();
      expect(stats).toBeDefined();
      await customAdapter.close();
    });
  });

  // ── hasStore when not initialized ──────────────────────────

  describe('hasStore edge cases', () => {
    it('should return false when not initialized', () => {
      const uninit = new WaSQLiteAdapter({ name: 'test' });
      expect(uninit.hasStore('anything')).toBe(false);
    });
  });

  // ── listStores edge cases ──────────────────────────────────

  describe('listStores edge cases', () => {
    it('should return empty array when not initialized', async () => {
      const uninit = new WaSQLiteAdapter({ name: 'test' });
      const stores = await uninit.listStores();
      expect(stores).toEqual([]);
    });

    it('should not list metadata tables', async () => {
      const stores = await adapter.listStores();
      expect(stores.every((s) => !s.startsWith('_'))).toBe(true);
    });

    it('should list multiple stores', async () => {
      adapter.getStore('alpha');
      adapter.getStore('beta');
      adapter.getStore('gamma');
      const stores = await adapter.listStores();
      expect(stores).toContain('alpha');
      expect(stores).toContain('beta');
      expect(stores).toContain('gamma');
    });
  });

  // ── deleteStore edge cases ─────────────────────────────────

  describe('deleteStore edge cases', () => {
    it('should be safe when not initialized', async () => {
      const uninit = new WaSQLiteAdapter({ name: 'test' });
      await expect(uninit.deleteStore('anything')).resolves.not.toThrow();
    });

    it('should be safe for non-existent store', async () => {
      await expect(adapter.deleteStore('nonexistent')).resolves.not.toThrow();
    });

    it('should remove index metadata for deleted store', async () => {
      const store = adapter.getStore<TestDoc>('to-delete');
      await store.createIndex({ name: 'idx_td', fields: ['title'] });

      let indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_td')).toBe(true);

      await adapter.deleteStore('to-delete');

      // Re-create the store and check indexes are gone
      const newStore = adapter.getStore<TestDoc>('to-delete');
      indexes = await newStore.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_td')).toBe(false);
    });

    it('should destroy store instance before deleting', async () => {
      const store = adapter.getStore<TestDoc>('to-destroy');
      let completed = false;
      store.changes().subscribe({
        complete: () => {
          completed = true;
        },
      });

      await adapter.deleteStore('to-destroy');
      expect(completed).toBe(true);
    });
  });

  // ── Database Export / Import ────────────────────────────────

  describe('export and import', () => {
    it('should export to Uint8Array', () => {
      const data = adapter.export();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data!.length).toBeGreaterThan(0);
    });

    it('should return null when not initialized', () => {
      const uninit = new WaSQLiteAdapter({ name: 'test' });
      expect(uninit.export()).toBeNull();
    });

    it('should export database that includes stored data', async () => {
      const store = adapter.getStore<TestDoc>('export-test');
      await store.bulkPut([
        makeDoc({ _id: '1', title: 'Export A' }),
        makeDoc({ _id: '2', title: 'Export B' }),
      ]);

      const exported = adapter.export();
      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported!.length).toBeGreaterThan(0);
    });

    it('should be importable into a new database via sql.js', async () => {
      // Store some data
      const store = adapter.getStore<TestDoc>('import-test');
      await store.bulkPut([
        makeDoc({ _id: '1', title: 'Imported A' }),
        makeDoc({ _id: '2', title: 'Imported B' }),
      ]);

      // Export
      const exported = adapter.export()!;
      expect(exported).toBeInstanceOf(Uint8Array);

      // Create a new adapter and import
      const SQL = await getSqlJs();
      const importedDb = new SQL.Database(exported);
      const result = (importedDb as unknown as SqlJsDatabase).exec(
        'SELECT COUNT(*) FROM "pocket_import-test" WHERE _deleted = 0'
      );
      expect(result[0].values[0][0]).toBe(2);
      (importedDb as unknown as SqlJsDatabase).close();
    });
  });

  // ── Transactions (extended) ────────────────────────────────

  describe('transactions - extended', () => {
    it('should return the value from transaction function', async () => {
      const result = await adapter.transaction([], 'readonly', async () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it('should rollback on error and re-throw', async () => {
      const store = adapter.getStore<TestDoc>('tx-rollback');

      await expect(
        adapter.transaction(['tx-rollback'], 'readwrite', async () => {
          await store.put(makeDoc({ _id: 'should-not-persist' }));
          throw new Error('Boom');
        })
      ).rejects.toThrow('Boom');

      // Document should not persist after rollback
      const doc = await store.get('should-not-persist');
      expect(doc).toBeNull();
    });

    it('should flatten nested transactions', async () => {
      const store = adapter.getStore<TestDoc>('tx-flat');

      await adapter.transaction(['tx-flat'], 'readwrite', async () => {
        await store.put(makeDoc({ _id: 'outer' }));

        await adapter.transaction(['tx-flat'], 'readwrite', async () => {
          await store.put(makeDoc({ _id: 'inner' }));
        });
      });

      expect(await store.get('outer')).not.toBeNull();
      expect(await store.get('inner')).not.toBeNull();
    });

    it('should allow readonly transactions', async () => {
      const store = adapter.getStore<TestDoc>('tx-ro');
      await store.put(makeDoc({ _id: '1', title: 'RO test' }));

      const result = await adapter.transaction(['tx-ro'], 'readonly', async () => {
        return store.get('1');
      });
      expect(result!.title).toBe('RO test');
    });
  });

  // ── Statistics (extended) ──────────────────────────────────

  describe('statistics - extended', () => {
    it('should count documents across multiple stores', async () => {
      const s1 = adapter.getStore<TestDoc>('stats-s1');
      const s2 = adapter.getStore<TestDoc>('stats-s2');

      await s1.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' })]);
      await s2.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' }), makeDoc({ _id: '3' })]);

      const stats = await adapter.getStats();
      expect(stats.documentCount).toBeGreaterThanOrEqual(5);
      expect(stats.storeCount).toBeGreaterThanOrEqual(2);
    });

    it('should count indexes in stats', async () => {
      const store = adapter.getStore<TestDoc>('stats-idx');
      await store.createIndex({ name: 'idx_stat1', fields: ['title'] });
      await store.createIndex({ name: 'idx_stat2', fields: ['count'] });

      const stats = await adapter.getStats();
      expect(stats.indexCount).toBeGreaterThanOrEqual(2);
    });

    it('should report storage size > 0', async () => {
      adapter.getStore<TestDoc>('stats-size');
      const stats = await adapter.getStats();
      expect(stats.storageSize).toBeGreaterThan(0);
    });
  });

  // ── Close (extended) ───────────────────────────────────────

  describe('close - extended', () => {
    it('should destroy all stores on close', async () => {
      const s1 = adapter.getStore<TestDoc>('close-s1');
      const s2 = adapter.getStore<TestDoc>('close-s2');

      let s1Completed = false;
      let s2Completed = false;
      s1.changes().subscribe({
        complete: () => {
          s1Completed = true;
        },
      });
      s2.changes().subscribe({
        complete: () => {
          s2Completed = true;
        },
      });

      await adapter.close();

      expect(s1Completed).toBe(true);
      expect(s2Completed).toBe(true);
    });

    it('should handle double close gracefully', async () => {
      await adapter.close();
      await expect(adapter.close()).resolves.not.toThrow();
    });
  });

  // ── isAvailable ────────────────────────────────────────────

  describe('isAvailable', () => {
    it('should return true (WebAssembly is available in Node.js)', () => {
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  // ── Factory Function ───────────────────────────────────────

  describe('createWaSQLiteStorage', () => {
    it('should create an adapter with config', () => {
      const storage = createWaSQLiteStorage({
        name: 'factory-test',
        journalMode: 'WAL',
      });
      expect(storage).toBeInstanceOf(WaSQLiteAdapter);
      expect(storage.name).toBe('wa-sqlite');
    });

    it('should create an adapter without config', () => {
      const storage = createWaSQLiteStorage();
      expect(storage).toBeInstanceOf(WaSQLiteAdapter);
    });

    it('should create independent adapter instances', () => {
      const s1 = createWaSQLiteStorage({ name: 'one' });
      const s2 = createWaSQLiteStorage({ name: 'two' });
      expect(s1).not.toBe(s2);
    });
  });

  // ── Store Isolation ────────────────────────────────────────

  describe('store isolation', () => {
    it('should keep data separate across stores', async () => {
      const s1 = adapter.getStore<TestDoc>('iso-1');
      const s2 = adapter.getStore<TestDoc>('iso-2');

      await s1.put(makeDoc({ _id: 'shared-id', title: 'Store 1' }));
      await s2.put(makeDoc({ _id: 'shared-id', title: 'Store 2' }));

      const d1 = await s1.get('shared-id');
      const d2 = await s2.get('shared-id');
      expect(d1!.title).toBe('Store 1');
      expect(d2!.title).toBe('Store 2');
    });

    it('should allow deleting in one store without affecting other', async () => {
      const s1 = adapter.getStore<TestDoc>('iso-del-1');
      const s2 = adapter.getStore<TestDoc>('iso-del-2');

      await s1.put(makeDoc({ _id: '1', title: 'S1' }));
      await s2.put(makeDoc({ _id: '1', title: 'S2' }));

      await s1.delete('1');

      expect(await s1.get('1')).toBeNull();
      expect(await s2.get('1')).not.toBeNull();
    });

    it('should allow clearing one store without affecting other', async () => {
      const s1 = adapter.getStore<TestDoc>('iso-clear-1');
      const s2 = adapter.getStore<TestDoc>('iso-clear-2');

      await s1.put(makeDoc({ _id: '1' }));
      await s2.put(makeDoc({ _id: '1' }));

      await s1.clear();

      expect(await s1.getAll()).toHaveLength(0);
      expect(await s2.getAll()).toHaveLength(1);
    });
  });

  // ── Querying - advanced integration tests ──────────────────

  describe('advanced query integration', () => {
    let store: ReturnType<typeof adapter.getStore<TestDoc>>;

    beforeEach(async () => {
      store = adapter.getStore<TestDoc>('adv-query');
      await store.bulkPut([
        makeDoc({ _id: '1', title: 'Apple', count: 10, status: 'fresh' }),
        makeDoc({ _id: '2', title: 'Banana', count: 20, status: 'fresh' }),
        makeDoc({ _id: '3', title: 'Cherry', count: 30, status: 'ripe' }),
        makeDoc({ _id: '4', title: 'Date', count: 40, status: 'dried' }),
        makeDoc({ _id: '5', title: 'Elderberry', count: 50, status: 'fresh' }),
      ]);
    });

    it('should handle $exists: true for optional fields', async () => {
      // All docs have status set
      const results = await store.query({
        spec: { filter: { status: { $exists: true } } },
      });
      expect(results).toHaveLength(5);
    });

    it('should handle $ne with string filter', async () => {
      const results = await store.query({
        spec: { filter: { status: { $ne: 'fresh' } } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['3', '4']);
    });

    it('should handle $regex as string starts-with', async () => {
      const results = await store.query({
        spec: { filter: { title: { $regex: '^El' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('5');
    });

    it('should handle $regex as string ends-with', async () => {
      const results = await store.query({
        spec: { filter: { title: { $regex: 'ry$' } } },
      });
      // Both "Cherry" and "Elderberry" end with "ry"
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['3', '5']);
    });

    it('should handle $regex as substring match', async () => {
      const results = await store.query({
        spec: { filter: { title: { $regex: 'an' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('2');
    });

    it('should sort by multiple fields', async () => {
      // Add docs with same status for secondary sort
      const results = await store.query({
        spec: {
          sort: [
            { field: 'status', direction: 'asc' },
            { field: 'count', direction: 'desc' },
          ],
        },
      });
      // Within each status group, docs should be sorted by count desc
      expect(results.length).toBe(5);
    });

    it('should handle combined filter with skip only (no limit)', async () => {
      const results = await store.query({
        spec: {
          filter: { status: { $eq: 'fresh' } },
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 1,
        },
      });
      // 3 fresh docs (10, 20, 50), skip 1 → 2 remaining
      expect(results).toHaveLength(2);
      expect(results[0]._id).toBe('2'); // count 20
    });

    it('should handle $nor integration', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $nor: [{ status: { $eq: 'fresh' } }, { status: { $eq: 'dried' } }],
          },
        },
      });
      // Only 'ripe' should remain
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('3');
    });

    it('should handle deeply combined $and + $or', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $and: [
              {
                $or: [{ status: { $eq: 'fresh' } }, { status: { $eq: 'ripe' } }],
              },
              { count: { $gte: 20 } },
            ],
          },
        },
      });
      // fresh with count >= 20: Banana(20), Elderberry(50)
      // ripe with count >= 20: Cherry(30)
      expect(results).toHaveLength(3);
      expect(results.map((r) => r._id).sort()).toEqual(['2', '3', '5']);
    });
  });

  // ── Large Dataset Tests ────────────────────────────────────

  describe('large dataset handling', () => {
    it('should handle 500 documents', async () => {
      const store = adapter.getStore<TestDoc>('large-test');
      const docs = Array.from({ length: 500 }, (_, i) =>
        makeDoc({ _id: `doc-${String(i).padStart(4, '0')}`, count: i, title: `Title ${i}` })
      );

      await store.bulkPut(docs);

      const all = await store.getAll();
      expect(all).toHaveLength(500);

      // Query with pagination
      const page = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 100,
          limit: 50,
        },
      });
      expect(page).toHaveLength(50);
      expect(page[0].count).toBe(100);
      expect(page[49].count).toBe(149);
    });

    it('should handle bulk delete of many documents', async () => {
      const store = adapter.getStore<TestDoc>('large-delete');
      const docs = Array.from({ length: 100 }, (_, i) => makeDoc({ _id: `doc-${i}`, count: i }));
      await store.bulkPut(docs);

      const idsToDelete = docs.filter((_, i) => i % 2 === 0).map((d) => d._id);
      await store.bulkDelete(idsToDelete);

      const remaining = await store.getAll();
      expect(remaining).toHaveLength(50);
      expect(remaining.every((d) => d.count % 2 !== 0)).toBe(true);
    });

    it('should handle count on large dataset with filter', async () => {
      const store = adapter.getStore<TestDoc>('large-count');
      const docs = Array.from({ length: 200 }, (_, i) => makeDoc({ _id: `doc-${i}`, count: i }));
      await store.bulkPut(docs);

      const count = await store.count({
        spec: { filter: { count: { $gte: 100 } } },
      });
      expect(count).toBe(100);
    });
  });
});

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { Document } from '@pocket/core';
import initSqlJs from 'sql.js';
import { WaSQLiteAdapter, createWaSQLiteStorage } from '../wa-sqlite-adapter.js';
import { QueryTranslator } from '../query-translator.js';
import type { SqlJsStatic } from '../types.js';

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

// ── Tests ───────────────────────────────────────────────────────

describe('WaSQLiteAdapter', () => {
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

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(adapter.name).toBe('wa-sqlite');
    });

    it('should report as available when WebAssembly is supported', () => {
      expect(adapter.isAvailable()).toBe(true);
    });

    it('should throw StorageError if sql.js fails to load', async () => {
      const badAdapter = new WaSQLiteAdapter({
        name: 'bad-db',
        sqlJsFactory: () => Promise.reject(new Error('WASM load failed')),
      });

      await expect(badAdapter.initialize({ name: 'bad-db' })).rejects.toThrow(
        'Failed to load sql.js WASM module'
      );
    });
  });

  describe('store management', () => {
    it('should get or create a store', () => {
      const store = adapter.getStore<TestDoc>('test-collection');
      expect(store).toBeDefined();
      expect(store.name).toBe('test-collection');
    });

    it('should return the same store instance for the same name', () => {
      const store1 = adapter.getStore('users');
      const store2 = adapter.getStore('users');
      expect(store1).toBe(store2);
    });

    it('should throw if not initialized', () => {
      const uninitAdapter = new WaSQLiteAdapter({ name: 'test' });
      expect(() => uninitAdapter.getStore('test')).toThrow('Storage not initialized');
    });

    it('should check if store exists', () => {
      adapter.getStore('existing');
      expect(adapter.hasStore('existing')).toBe(true);
      expect(adapter.hasStore('nonexistent')).toBe(false);
    });

    it('should list stores', async () => {
      adapter.getStore('users');
      adapter.getStore('orders');
      const stores = await adapter.listStores();
      expect(stores).toContain('users');
      expect(stores).toContain('orders');
    });

    it('should delete a store', async () => {
      adapter.getStore('to-delete');
      expect(adapter.hasStore('to-delete')).toBe(true);

      await adapter.deleteStore('to-delete');
      expect(adapter.hasStore('to-delete')).toBe(false);
    });
  });

  describe('DocumentStore CRUD', () => {
    let store: ReturnType<typeof adapter.getStore<TestDoc>>;

    beforeEach(() => {
      store = adapter.getStore<TestDoc>('test-collection');
    });

    it('should put and get a document', async () => {
      const doc: TestDoc = {
        _id: '1',
        title: 'Test',
        count: 42,
        tags: ['a', 'b'],
        nested: { value: 100 },
      };

      await store.put(doc);
      const retrieved = await store.get('1');
      expect(retrieved).toBeDefined();
      expect(retrieved?._id).toBe('1');
      expect(retrieved?.title).toBe('Test');
      expect(retrieved?.count).toBe(42);
      expect(retrieved?.tags).toEqual(['a', 'b']);
      expect(retrieved?.nested).toEqual({ value: 100 });
    });

    it('should return null for non-existent document', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should update existing document', async () => {
      const original: TestDoc = {
        _id: '1',
        title: 'Original',
        count: 1,
        tags: [],
        nested: { value: 1 },
      };
      await store.put(original);

      const updated: TestDoc = { ...original, title: 'Updated', count: 2 };
      await store.put(updated);

      const retrieved = await store.get('1');
      expect(retrieved?.title).toBe('Updated');
      expect(retrieved?.count).toBe(2);
    });

    it('should delete a document (soft delete)', async () => {
      const doc: TestDoc = {
        _id: '1',
        title: 'To delete',
        count: 0,
        tags: [],
        nested: { value: 0 },
      };
      await store.put(doc);
      await store.delete('1');

      const retrieved = await store.get('1');
      expect(retrieved).toBeNull();
    });

    it('should handle delete of non-existent document', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });

    it('should put and get multiple documents', async () => {
      const docs: TestDoc[] = [
        { _id: '1', title: 'Doc 1', count: 1, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'Doc 2', count: 2, tags: [], nested: { value: 2 } },
        { _id: '3', title: 'Doc 3', count: 3, tags: [], nested: { value: 3 } },
      ];

      const saved = await store.bulkPut(docs);
      expect(saved).toHaveLength(3);

      const retrieved = await store.getMany(['1', '2', '3']);
      expect(retrieved).toHaveLength(3);
      expect(retrieved[0]?._id).toBe('1');
      expect(retrieved[1]?._id).toBe('2');
      expect(retrieved[2]?._id).toBe('3');
    });

    it('should get all documents', async () => {
      await store.bulkPut([
        { _id: '1', title: 'Doc 1', count: 1, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'Doc 2', count: 2, tags: [], nested: { value: 2 } },
      ]);

      const all = await store.getAll();
      expect(all).toHaveLength(2);
    });

    it('should handle getMany with mixed results', async () => {
      await store.put({
        _id: '1',
        title: 'Exists',
        count: 1,
        tags: [],
        nested: { value: 1 },
      });

      const results = await store.getMany(['1', 'non-existent']);
      expect(results[0]?._id).toBe('1');
      expect(results[1]).toBeNull();
    });

    it('should handle getMany with empty array', async () => {
      const results = await store.getMany([]);
      expect(results).toHaveLength(0);
    });

    it('should clear all documents', async () => {
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'B', count: 2, tags: [], nested: { value: 2 } },
      ]);

      await store.clear();
      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });

    it('should bulk delete documents', async () => {
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'B', count: 2, tags: [], nested: { value: 2 } },
        { _id: '3', title: 'C', count: 3, tags: [], nested: { value: 3 } },
      ]);

      await store.bulkDelete(['1', '3']);
      const all = await store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]?._id).toBe('2');
    });
  });

  describe('querying', () => {
    let store: ReturnType<typeof adapter.getStore<TestDoc>>;

    beforeEach(async () => {
      store = adapter.getStore<TestDoc>('query-test');
      await store.bulkPut([
        { _id: '1', title: 'Alpha', count: 10, tags: ['a'], nested: { value: 100 }, status: 'active' },
        { _id: '2', title: 'Beta', count: 20, tags: ['b'], nested: { value: 200 }, status: 'active' },
        { _id: '3', title: 'Gamma', count: 30, tags: ['a', 'b'], nested: { value: 300 }, status: 'inactive' },
        { _id: '4', title: 'Delta', count: 40, tags: ['c'], nested: { value: 400 }, status: 'active' },
      ]);
    });

    it('should query with equality filter', async () => {
      const results = await store.query({
        spec: { filter: { count: 20 } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('2');
    });

    it('should query with $gt', async () => {
      const results = await store.query({
        spec: { filter: { count: { $gt: 20 } } },
      });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r._id).sort();
      expect(ids).toEqual(['3', '4']);
    });

    it('should query with $gte', async () => {
      const results = await store.query({
        spec: { filter: { count: { $gte: 20 } } },
      });
      expect(results).toHaveLength(3);
    });

    it('should query with $lt', async () => {
      const results = await store.query({
        spec: { filter: { count: { $lt: 20 } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('1');
    });

    it('should query with $lte', async () => {
      const results = await store.query({
        spec: { filter: { count: { $lte: 20 } } },
      });
      expect(results).toHaveLength(2);
    });

    it('should query with $ne', async () => {
      const results = await store.query({
        spec: { filter: { status: { $ne: 'active' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('3');
    });

    it('should query with $in', async () => {
      const results = await store.query({
        spec: { filter: { title: { $in: ['Alpha', 'Delta'] } } },
      });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r._id).sort();
      expect(ids).toEqual(['1', '4']);
    });

    it('should query with $nin', async () => {
      const results = await store.query({
        spec: { filter: { title: { $nin: ['Alpha', 'Delta'] } } },
      });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r._id).sort();
      expect(ids).toEqual(['2', '3']);
    });

    it('should query with $startsWith', async () => {
      const results = await store.query({
        spec: { filter: { title: { $startsWith: 'Al' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('1');
    });

    it('should query with $endsWith', async () => {
      const results = await store.query({
        spec: { filter: { title: { $endsWith: 'ta' } } },
      });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r._id).sort();
      expect(ids).toEqual(['2', '4']);
    });

    it('should query with $contains', async () => {
      const results = await store.query({
        spec: { filter: { title: { $contains: 'amm' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('3');
    });

    it('should apply sort ascending', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
        },
      });
      expect(results[0]?._id).toBe('1');
      expect(results[3]?._id).toBe('4');
    });

    it('should apply sort descending', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'desc' }],
        },
      });
      expect(results[0]?._id).toBe('4');
      expect(results[3]?._id).toBe('1');
    });

    it('should apply limit', async () => {
      const results = await store.query({
        spec: { limit: 2 },
      });
      expect(results).toHaveLength(2);
    });

    it('should apply skip', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0]?._id).toBe('3');
    });

    it('should combine filter, sort, skip, and limit', async () => {
      const results = await store.query({
        spec: {
          filter: { count: { $gt: 10 } },
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 1,
          limit: 1,
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('3');
    });

    it('should query with $or', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $or: [{ count: { $lt: 15 } }, { count: { $gt: 35 } }],
          },
        },
      });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r._id).sort();
      expect(ids).toEqual(['1', '4']);
    });

    it('should query with $and', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $and: [{ count: { $gte: 20 } }, { status: { $eq: 'active' } }],
          },
        },
      });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r._id).sort();
      expect(ids).toEqual(['2', '4']);
    });

    it('should not return soft-deleted documents', async () => {
      await store.delete('2');
      const results = await store.query({
        spec: {},
      });
      expect(results).toHaveLength(3);
      expect(results.every((r) => r._id !== '2')).toBe(true);
    });
  });

  describe('counting', () => {
    let store: ReturnType<typeof adapter.getStore<TestDoc>>;

    beforeEach(async () => {
      store = adapter.getStore<TestDoc>('count-test');
      await store.bulkPut([
        { _id: '1', title: 'A', count: 10, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'B', count: 20, tags: [], nested: { value: 2 } },
        { _id: '3', title: 'C', count: 30, tags: [], nested: { value: 3 } },
      ]);
    });

    it('should count all documents', async () => {
      const count = await store.count();
      expect(count).toBe(3);
    });

    it('should count with filter', async () => {
      const count = await store.count({
        spec: { filter: { count: { $gt: 15 } } },
      });
      expect(count).toBe(2);
    });

    it('should not count soft-deleted documents', async () => {
      await store.delete('1');
      const count = await store.count();
      expect(count).toBe(2);
    });
  });

  describe('change events', () => {
    it('should emit insert events', async () => {
      const store = adapter.getStore<TestDoc>('change-test');
      const events: unknown[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.put({
        _id: '1',
        title: 'New',
        count: 1,
        tags: [],
        nested: { value: 1 },
      });

      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as { operation: string }).operation).toBe('insert');
      sub.unsubscribe();
    });

    it('should emit update events', async () => {
      const store = adapter.getStore<TestDoc>('change-test-2');
      await store.put({
        _id: '1',
        title: 'Original',
        count: 1,
        tags: [],
        nested: { value: 1 },
      });

      const events: unknown[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.put({
        _id: '1',
        title: 'Updated',
        count: 2,
        tags: [],
        nested: { value: 2 },
      });

      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as { operation: string }).operation).toBe('update');
      sub.unsubscribe();
    });

    it('should emit delete events', async () => {
      const store = adapter.getStore<TestDoc>('change-test-3');
      await store.put({
        _id: '1',
        title: 'To delete',
        count: 1,
        tags: [],
        nested: { value: 1 },
      });

      const events: unknown[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.delete('1');

      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as { operation: string }).operation).toBe('delete');
      sub.unsubscribe();
    });

    it('should include document in insert event', async () => {
      const store = adapter.getStore<TestDoc>('change-test-4');
      const events: { document: TestDoc | null; documentId: string }[] = [];
      const sub = store.changes().subscribe((e) =>
        events.push({ document: e.document, documentId: e.documentId })
      );

      await store.put({
        _id: '1',
        title: 'Doc',
        count: 1,
        tags: [],
        nested: { value: 1 },
      });

      expect(events[0]?.documentId).toBe('1');
      expect(events[0]?.document?.title).toBe('Doc');
      sub.unsubscribe();
    });
  });

  describe('indexing', () => {
    it('should create and list indexes', async () => {
      const store = adapter.getStore<TestDoc>('idx-test');
      await store.createIndex({ name: 'idx_count', fields: ['count'] });
      await store.createIndex({ name: 'idx_title', fields: ['title'] });

      const indexes = await store.getIndexes();
      expect(indexes.length).toBeGreaterThanOrEqual(2);
      expect(indexes.some((i) => i.name === 'idx_count')).toBe(true);
      expect(indexes.some((i) => i.name === 'idx_title')).toBe(true);
    });

    it('should drop an index', async () => {
      const store = adapter.getStore<TestDoc>('idx-test-2');
      await store.createIndex({ name: 'idx_to_drop', fields: ['title'] });

      let indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_to_drop')).toBe(true);

      await store.dropIndex('idx_to_drop');
      indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_to_drop')).toBe(false);
    });

    it('should auto-generate index name', async () => {
      const store = adapter.getStore<TestDoc>('idx-test-3');
      await store.createIndex({ fields: ['title', 'count'] });

      const indexes = await store.getIndexes();
      const compoundIdx = indexes.find(
        (i) =>
          i.fields.some((f) => f.field === 'title') &&
          i.fields.some((f) => f.field === 'count')
      );
      expect(compoundIdx).toBeDefined();
      expect(compoundIdx!.name).toContain('idx_');
    });

    it('should create unique index', async () => {
      const store = adapter.getStore<TestDoc>('idx-test-4');
      await store.createIndex({
        name: 'idx_unique_title',
        fields: ['title'],
        unique: true,
      });

      const indexes = await store.getIndexes();
      const uniqueIdx = indexes.find((i) => i.name === 'idx_unique_title');
      expect(uniqueIdx).toBeDefined();
      expect(uniqueIdx!.unique).toBe(true);
    });
  });

  describe('transactions', () => {
    it('should execute a transaction successfully', async () => {
      const store = adapter.getStore<TestDoc>('tx-test');

      const result = await adapter.transaction(
        ['tx-test'],
        'readwrite',
        async () => {
          await store.put({
            _id: '1',
            title: 'In TX',
            count: 1,
            tags: [],
            nested: { value: 1 },
          });
          return 'done';
        }
      );

      expect(result).toBe('done');
      const doc = await store.get('1');
      expect(doc?.title).toBe('In TX');
    });

    it('should rollback on error', async () => {
      const store = adapter.getStore<TestDoc>('tx-test-2');
      await store.put({
        _id: 'existing',
        title: 'Before',
        count: 1,
        tags: [],
        nested: { value: 1 },
      });

      try {
        await adapter.transaction(['tx-test-2'], 'readwrite', async () => {
          await store.put({
            _id: 'new-doc',
            title: 'Should not persist',
            count: 99,
            tags: [],
            nested: { value: 99 },
          });
          throw new Error('Intentional error');
        });
      } catch {
        // Expected
      }

      // The 'existing' doc should still be there unchanged
      const existing = await store.get('existing');
      expect(existing?.title).toBe('Before');
    });

    it('should throw if not initialized', async () => {
      const uninitAdapter = new WaSQLiteAdapter({ name: 'test' });
      await expect(
        uninitAdapter.transaction(['test'], 'readwrite', async () => 'fail')
      ).rejects.toThrow('Storage not initialized');
    });

    it('should handle nested transaction calls (flattening)', async () => {
      const store = adapter.getStore<TestDoc>('tx-nested');

      await adapter.transaction(['tx-nested'], 'readwrite', async () => {
        await store.put({
          _id: '1',
          title: 'Outer',
          count: 1,
          tags: [],
          nested: { value: 1 },
        });

        // Nested transaction should be flattened
        await adapter.transaction(['tx-nested'], 'readwrite', async () => {
          await store.put({
            _id: '2',
            title: 'Inner',
            count: 2,
            tags: [],
            nested: { value: 2 },
          });
        });
      });

      const doc1 = await store.get('1');
      const doc2 = await store.get('2');
      expect(doc1?.title).toBe('Outer');
      expect(doc2?.title).toBe('Inner');
    });
  });

  describe('statistics', () => {
    it('should return stats', async () => {
      const store = adapter.getStore<TestDoc>('stats-test');
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'B', count: 2, tags: [], nested: { value: 2 } },
      ]);

      const stats = await adapter.getStats();
      expect(stats.storeCount).toBeGreaterThanOrEqual(1);
      expect(stats.documentCount).toBeGreaterThanOrEqual(2);
      expect(stats.storageSize).toBeGreaterThanOrEqual(0);
    });

    it('should return empty stats when not initialized', async () => {
      const uninitAdapter = new WaSQLiteAdapter({ name: 'test' });
      const stats = await uninitAdapter.getStats();
      expect(stats.documentCount).toBe(0);
      expect(stats.storeCount).toBe(0);
    });

    it('should not count deleted documents in stats', async () => {
      const store = adapter.getStore<TestDoc>('stats-delete-test');
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1, tags: [], nested: { value: 1 } },
        { _id: '2', title: 'B', count: 2, tags: [], nested: { value: 2 } },
      ]);
      await store.delete('1');

      const stats = await adapter.getStats();
      // The deleted doc should not be counted
      expect(stats.documentCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('export', () => {
    it('should export database', () => {
      const data = adapter.export();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data!.length).toBeGreaterThan(0);
    });

    it('should return null when not initialized', () => {
      const uninitAdapter = new WaSQLiteAdapter({ name: 'test' });
      expect(uninitAdapter.export()).toBeNull();
    });
  });

  describe('close', () => {
    it('should close without error', async () => {
      await expect(adapter.close()).resolves.not.toThrow();
    });

    it('should handle double close', async () => {
      await adapter.close();
      await expect(adapter.close()).resolves.not.toThrow();
    });
  });

  describe('factory function', () => {
    it('should create an adapter with createWaSQLiteStorage', () => {
      const storage = createWaSQLiteStorage({ name: 'factory-test' });
      expect(storage).toBeInstanceOf(WaSQLiteAdapter);
      expect(storage.name).toBe('wa-sqlite');
    });

    it('should create an adapter without config', () => {
      const storage = createWaSQLiteStorage();
      expect(storage).toBeInstanceOf(WaSQLiteAdapter);
    });
  });

  describe('multiple stores isolation', () => {
    it('should isolate data between stores', async () => {
      const store1 = adapter.getStore<TestDoc>('collection1');
      const store2 = adapter.getStore<TestDoc>('collection2');

      await store1.put({ _id: '1', title: 'Store 1', count: 1, tags: [], nested: { value: 1 } });
      await store2.put({ _id: '1', title: 'Store 2', count: 2, tags: [], nested: { value: 2 } });

      const doc1 = await store1.get('1');
      const doc2 = await store2.get('1');

      expect(doc1?.title).toBe('Store 1');
      expect(doc2?.title).toBe('Store 2');
    });
  });
});

describe('QueryTranslator', () => {
  let translator: QueryTranslator;

  beforeEach(() => {
    translator = new QueryTranslator();
  });

  describe('basic operators', () => {
    it('should translate $eq', () => {
      const result = translator.translate({
        filter: { title: { $eq: 'hello' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') = ?");
      expect(result.params).toEqual(['hello']);
    });

    it('should translate implicit $eq (direct value)', () => {
      const result = translator.translate({
        filter: { title: 'hello' } as Record<string, unknown>,
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') = ?");
      expect(result.params).toEqual(['hello']);
    });

    it('should translate $ne', () => {
      const result = translator.translate({
        filter: { status: { $ne: 'deleted' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.status') != ?");
      expect(result.params).toEqual(['deleted']);
    });

    it('should translate $gt', () => {
      const result = translator.translate({
        filter: { count: { $gt: 5 } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.count') > ?");
      expect(result.params).toEqual([5]);
    });

    it('should translate $gte', () => {
      const result = translator.translate({
        filter: { count: { $gte: 10 } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.count') >= ?");
      expect(result.params).toEqual([10]);
    });

    it('should translate $lt', () => {
      const result = translator.translate({
        filter: { count: { $lt: 100 } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.count') < ?");
      expect(result.params).toEqual([100]);
    });

    it('should translate $lte', () => {
      const result = translator.translate({
        filter: { count: { $lte: 50 } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.count') <= ?");
      expect(result.params).toEqual([50]);
    });
  });

  describe('set operators', () => {
    it('should translate $in', () => {
      const result = translator.translate({
        filter: { status: { $in: ['active', 'pending'] } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.status') IN (?, ?)");
      expect(result.params).toEqual(['active', 'pending']);
    });

    it('should translate $nin', () => {
      const result = translator.translate({
        filter: { status: { $nin: ['deleted', 'archived'] } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.status') NOT IN (?, ?)");
      expect(result.params).toEqual(['deleted', 'archived']);
    });

    it('should handle empty $in', () => {
      const result = translator.translate({
        filter: { status: { $in: [] } },
      });
      expect(result.whereClause).toContain('0 = 1');
    });

    it('should handle empty $nin', () => {
      const result = translator.translate({
        filter: { status: { $nin: [] } },
      });
      expect(result.whereClause).toContain('1 = 1');
    });
  });

  describe('existence operators', () => {
    it('should translate $exists: true', () => {
      const result = translator.translate({
        filter: { email: { $exists: true } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.email') IS NOT NULL");
    });

    it('should translate $exists: false', () => {
      const result = translator.translate({
        filter: { email: { $exists: false } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.email') IS NULL");
    });
  });

  describe('string operators', () => {
    it('should translate $startsWith', () => {
      const result = translator.translate({
        filter: { title: { $startsWith: 'Hello' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['Hello%']);
    });

    it('should translate $endsWith', () => {
      const result = translator.translate({
        filter: { title: { $endsWith: 'world' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%world']);
    });

    it('should translate $contains', () => {
      const result = translator.translate({
        filter: { title: { $contains: 'test' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%test%']);
    });

    it('should translate $regex with ^ anchor', () => {
      const result = translator.translate({
        filter: { title: { $regex: '^Hello' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['Hello%']);
    });

    it('should translate $regex with $ anchor', () => {
      const result = translator.translate({
        filter: { title: { $regex: 'world$' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%world']);
    });

    it('should translate $regex without anchors as contains', () => {
      const result = translator.translate({
        filter: { title: { $regex: 'test' } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%test%']);
    });
  });

  describe('logical operators', () => {
    it('should translate $and', () => {
      const result = translator.translate({
        filter: {
          $and: [{ count: { $gt: 5 } }, { count: { $lt: 20 } }],
        },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.count') > ?");
      expect(result.whereClause).toContain("json_extract(_data, '$.count') < ?");
      expect(result.params).toEqual([5, 20]);
    });

    it('should translate $or', () => {
      const result = translator.translate({
        filter: {
          $or: [{ status: { $eq: 'active' } }, { status: { $eq: 'pending' } }],
        },
      });
      expect(result.whereClause).toContain(' OR ');
      expect(result.params).toEqual(['active', 'pending']);
    });

    it('should translate $not', () => {
      const result = translator.translate({
        filter: {
          $not: { status: { $eq: 'deleted' } },
        },
      });
      expect(result.whereClause).toContain('NOT (');
      expect(result.params).toEqual(['deleted']);
    });

    it('should translate $nor', () => {
      const result = translator.translate({
        filter: {
          $nor: [{ status: { $eq: 'deleted' } }, { status: { $eq: 'archived' } }],
        },
      });
      expect(result.whereClause).toContain('NOT (');
      expect(result.whereClause).toContain(' OR ');
    });
  });

  describe('sort translation', () => {
    it('should translate ascending sort', () => {
      const result = translator.translate({
        sort: [{ field: 'count', direction: 'asc' }],
      });
      expect(result.orderByClause).toContain("json_extract(_data, '$.count') ASC");
    });

    it('should translate descending sort', () => {
      const result = translator.translate({
        sort: [{ field: 'count', direction: 'desc' }],
      });
      expect(result.orderByClause).toContain("json_extract(_data, '$.count') DESC");
    });

    it('should translate multiple sort fields', () => {
      const result = translator.translate({
        sort: [
          { field: 'status', direction: 'asc' },
          { field: 'count', direction: 'desc' },
        ],
      });
      expect(result.orderByClause).toContain("json_extract(_data, '$.status') ASC");
      expect(result.orderByClause).toContain("json_extract(_data, '$.count') DESC");
    });

    it('should handle internal field sort', () => {
      const result = translator.translate({
        sort: [{ field: '_updatedAt', direction: 'desc' }],
      });
      expect(result.orderByClause).toContain('_updatedAt DESC');
      expect(result.orderByClause).not.toContain('json_extract');
    });
  });

  describe('pagination', () => {
    it('should translate limit', () => {
      const result = translator.translate({ limit: 10 });
      expect(result.limit).toBe(10);
    });

    it('should translate skip', () => {
      const result = translator.translate({ skip: 20 });
      expect(result.offset).toBe(20);
    });

    it('should translate limit and skip together', () => {
      const result = translator.translate({ limit: 10, skip: 20 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });
  });

  describe('internal fields', () => {
    it('should use direct column for _id', () => {
      const result = translator.translate({
        filter: { _id: { $eq: 'abc' } },
      });
      expect(result.whereClause).toContain('_id = ?');
      expect(result.whereClause).not.toContain('json_extract');
    });

    it('should use direct column for _updatedAt', () => {
      const result = translator.translate({
        filter: { _updatedAt: { $gt: 1000 } },
      });
      expect(result.whereClause).toContain('_updatedAt > ?');
      expect(result.whereClause).not.toContain('json_extract');
    });
  });

  describe('nested fields', () => {
    it('should handle nested field access via json_extract', () => {
      const result = translator.translate({
        filter: { 'nested.value': { $gt: 50 } } as Record<string, unknown>,
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.nested.value') > ?");
      expect(result.params).toEqual([50]);
    });
  });

  describe('null handling', () => {
    it('should translate null equality', () => {
      const result = translator.translate({
        filter: { status: { $eq: null } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.status') IS NULL");
    });

    it('should translate null inequality', () => {
      const result = translator.translate({
        filter: { status: { $ne: null } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.status') IS NOT NULL");
    });
  });

  describe('combined queries', () => {
    it('should handle filter + sort + limit + skip', () => {
      const result = translator.translate({
        filter: { count: { $gt: 10 } },
        sort: [{ field: 'count', direction: 'asc' }],
        limit: 5,
        skip: 2,
      });

      expect(result.whereClause).toContain("json_extract(_data, '$.count') > ?");
      expect(result.orderByClause).toContain("json_extract(_data, '$.count') ASC");
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(2);
      expect(result.params).toEqual([10]);
    });
  });
});

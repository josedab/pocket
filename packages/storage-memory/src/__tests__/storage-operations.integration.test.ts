import type { Document } from '@pocket/core';
import { MemoryStorageAdapter, createMemoryStorage } from '../adapter.js';

interface TestDoc extends Document {
  _id: string;
  title: string;
  category: string;
  priority: number;
  tags: string[];
  metadata: { author: string; version: number };
}

describe('Storage Operations Integration', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.initialize({ name: 'test-storage' });
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('storage adapter lifecycle', () => {
    it('should initialize and report availability', () => {
      expect(storage.isAvailable()).toBe(true);
      expect(storage.name).toBe('memory');
    });

    it('should create stores lazily on first access', () => {
      expect(storage.hasStore('new-store')).toBe(false);

      storage.getStore('new-store');
      expect(storage.hasStore('new-store')).toBe(true);
    });

    it('should list all stores', async () => {
      storage.getStore('users');
      storage.getStore('posts');
      storage.getStore('comments');

      const stores = await storage.listStores();
      expect(stores).toContain('users');
      expect(stores).toContain('posts');
      expect(stores).toContain('comments');
      expect(stores).toHaveLength(3);
    });

    it('should delete a store', async () => {
      const store = storage.getStore<TestDoc>('temp');
      await store.put({ _id: '1', title: 'A', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } });

      await storage.deleteStore('temp');
      expect(storage.hasStore('temp')).toBe(false);
    });

    it('should return storage stats', async () => {
      const store = storage.getStore<TestDoc>('items');
      await store.bulkPut([
        { _id: '1', title: 'A', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } },
        { _id: '2', title: 'B', category: 'y', priority: 2, tags: [], metadata: { author: 'b', version: 1 } },
      ]);

      const stats = await storage.getStats();
      expect(stats.documentCount).toBe(2);
      expect(stats.storeCount).toBe(1);
    });

    it('should clean up all stores on close', async () => {
      storage.getStore('store1');
      storage.getStore('store2');

      await storage.close();

      const stores = await storage.listStores();
      expect(stores).toHaveLength(0);
    });
  });

  describe('bulk insert operations', () => {
    it('should bulk insert many documents', async () => {
      const store = storage.getStore<TestDoc>('items');

      const docs: TestDoc[] = Array.from({ length: 100 }, (_, i) => ({
        _id: `doc-${i}`,
        title: `Document ${i}`,
        category: i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C',
        priority: i % 10,
        tags: [`tag${i % 5}`],
        metadata: { author: `author-${i % 4}`, version: 1 },
      }));

      const saved = await store.bulkPut(docs);
      expect(saved).toHaveLength(100);

      const all = await store.getAll();
      expect(all).toHaveLength(100);
    });

    it('should handle bulk delete', async () => {
      const store = storage.getStore<TestDoc>('items');

      await store.bulkPut([
        { _id: '1', title: 'A', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } },
        { _id: '2', title: 'B', category: 'x', priority: 2, tags: [], metadata: { author: 'b', version: 1 } },
        { _id: '3', title: 'C', category: 'y', priority: 3, tags: [], metadata: { author: 'c', version: 1 } },
      ]);

      await store.bulkDelete(['1', '2']);

      const remaining = await store.getAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]._id).toBe('3');
    });
  });

  describe('query with various filter operators', () => {
    let store: ReturnType<typeof storage.getStore<TestDoc>>;

    beforeEach(async () => {
      store = storage.getStore<TestDoc>('items');
      await store.bulkPut([
        { _id: '1', title: 'Alpha', category: 'tech', priority: 1, tags: ['js', 'web'], metadata: { author: 'alice', version: 1 } },
        { _id: '2', title: 'Beta', category: 'tech', priority: 5, tags: ['python'], metadata: { author: 'bob', version: 2 } },
        { _id: '3', title: 'Gamma', category: 'science', priority: 3, tags: ['js'], metadata: { author: 'charlie', version: 1 } },
        { _id: '4', title: 'Delta', category: 'science', priority: 8, tags: ['rust', 'wasm'], metadata: { author: 'alice', version: 3 } },
        { _id: '5', title: 'Epsilon', category: 'arts', priority: 2, tags: ['design'], metadata: { author: 'diana', version: 1 } },
      ]);
    });

    it('should filter with $eq', async () => {
      const results = await store.query({
        spec: { filter: { category: { $eq: 'tech' } } },
      });
      expect(results).toHaveLength(2);
    });

    it('should filter with $ne', async () => {
      const results = await store.query({
        spec: { filter: { category: { $ne: 'tech' } } },
      });
      expect(results).toHaveLength(3);
    });

    it('should filter with $gt and $lt', async () => {
      const results = await store.query({
        spec: { filter: { priority: { $gt: 2, $lt: 8 } } },
      });
      expect(results).toHaveLength(2); // priority 3 and 5
    });

    it('should filter with $gte and $lte', async () => {
      const results = await store.query({
        spec: { filter: { priority: { $gte: 3, $lte: 5 } } },
      });
      expect(results).toHaveLength(2); // priority 3 and 5
    });

    it('should filter with $in', async () => {
      const results = await store.query({
        spec: { filter: { category: { $in: ['tech', 'arts'] } } },
      });
      expect(results).toHaveLength(3); // 2 tech + 1 arts
    });

    it('should filter with direct equality (shorthand)', async () => {
      const results = await store.query({
        spec: { filter: { category: 'science' } },
      });
      expect(results).toHaveLength(2);
    });

    it('should filter on nested fields', async () => {
      const results = await store.query({
        spec: { filter: { 'metadata.author': 'alice' } },
      });
      expect(results).toHaveLength(2);
    });

    it('should combine sort with limit and skip', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'priority', direction: 'desc' }],
          skip: 1,
          limit: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0].priority).toBe(5);
      expect(results[1].priority).toBe(3);
    });

    it('should count documents with filter', async () => {
      const total = await store.count();
      expect(total).toBe(5);

      const techCount = await store.count({
        spec: { filter: { category: 'tech' } },
      });
      expect(techCount).toBe(2);
    });
  });

  describe('index operations', () => {
    let store: ReturnType<typeof storage.getStore<TestDoc>>;

    beforeEach(async () => {
      store = storage.getStore<TestDoc>('items');
      await store.bulkPut([
        { _id: '1', title: 'Alpha', category: 'tech', priority: 1, tags: ['js'], metadata: { author: 'alice', version: 1 } },
        { _id: '2', title: 'Beta', category: 'tech', priority: 5, tags: ['py'], metadata: { author: 'bob', version: 2 } },
        { _id: '3', title: 'Gamma', category: 'science', priority: 3, tags: ['js'], metadata: { author: 'charlie', version: 1 } },
      ]);
    });

    it('should create single-field index and use it for queries', async () => {
      await store.createIndex({ name: 'idx_category', fields: ['category'] });

      const indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_category')).toBe(true);

      // Query using index hint
      const results = await store.query({
        spec: { filter: { category: 'tech' } },
        indexHint: 'idx_category',
      });
      expect(results).toHaveLength(2);
    });

    it('should create compound index', async () => {
      await store.createIndex({
        name: 'idx_cat_priority',
        fields: ['category', { field: 'priority', direction: 'desc' }],
      });

      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_cat_priority');
      expect(idx).toBeDefined();
      expect(idx!.fields).toHaveLength(2);
    });

    it('should create sparse index', async () => {
      await store.createIndex({
        name: 'idx_sparse',
        fields: ['tags'],
        sparse: true,
      });

      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_sparse');
      expect(idx).toBeDefined();
      expect(idx!.sparse).toBe(true);
    });

    it('should drop an index', async () => {
      await store.createIndex({ name: 'idx_to_drop', fields: ['priority'] });
      let indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_to_drop')).toBe(true);

      await store.dropIndex('idx_to_drop');
      indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_to_drop')).toBe(false);
    });

    it('should maintain index after document mutations', async () => {
      await store.createIndex({ name: 'idx_category', fields: ['category'] });

      // Add a new document
      await store.put({
        _id: '4',
        title: 'Delta',
        category: 'tech',
        priority: 7,
        tags: [],
        metadata: { author: 'diana', version: 1 },
      });

      const results = await store.query({
        spec: { filter: { category: 'tech' } },
        indexHint: 'idx_category',
      });
      expect(results).toHaveLength(3);

      // Delete a document
      await store.delete('1');

      const afterDelete = await store.query({
        spec: { filter: { category: 'tech' } },
        indexHint: 'idx_category',
      });
      expect(afterDelete).toHaveLength(2);
    });
  });

  describe('storage cleanup', () => {
    it('should clear all documents from a store', async () => {
      const store = storage.getStore<TestDoc>('items');
      await store.bulkPut([
        { _id: '1', title: 'A', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } },
        { _id: '2', title: 'B', category: 'y', priority: 2, tags: [], metadata: { author: 'b', version: 1 } },
      ]);

      await store.clear();

      const all = await store.getAll();
      expect(all).toHaveLength(0);
      expect(await store.count()).toBe(0);
    });

    it('should emit change events on clear', async () => {
      const store = storage.getStore<TestDoc>('items');
      await store.bulkPut([
        { _id: '1', title: 'A', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } },
        { _id: '2', title: 'B', category: 'y', priority: 2, tags: [], metadata: { author: 'b', version: 1 } },
      ]);

      const changes: unknown[] = [];
      const sub = store.changes().subscribe((e) => changes.push(e));

      await store.clear();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should emit delete events for each document
      expect(changes.length).toBeGreaterThanOrEqual(2);
      sub.unsubscribe();
    });

    it('should handle transaction wrapper', async () => {
      const store = storage.getStore<TestDoc>('items');

      const result = await storage.transaction(['items'], 'readwrite', async () => {
        await store.put({ _id: '1', title: 'In Tx', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } });
        const doc = await store.get('1');
        return doc;
      });

      expect(result).not.toBeNull();
      expect(result!.title).toBe('In Tx');
    });
  });

  describe('data isolation between stores', () => {
    it('should keep stores completely isolated', async () => {
      const store1 = storage.getStore<TestDoc>('store1');
      const store2 = storage.getStore<TestDoc>('store2');

      await store1.put({ _id: 'shared-id', title: 'From Store 1', category: 'a', priority: 1, tags: [], metadata: { author: 'x', version: 1 } });
      await store2.put({ _id: 'shared-id', title: 'From Store 2', category: 'b', priority: 2, tags: [], metadata: { author: 'y', version: 1 } });

      const doc1 = await store1.get('shared-id');
      const doc2 = await store2.get('shared-id');

      expect(doc1!.title).toBe('From Store 1');
      expect(doc2!.title).toBe('From Store 2');
    });

    it('should not cross-contaminate on clear', async () => {
      const store1 = storage.getStore<TestDoc>('store1');
      const store2 = storage.getStore<TestDoc>('store2');

      await store1.put({ _id: '1', title: 'A', category: 'x', priority: 1, tags: [], metadata: { author: 'a', version: 1 } });
      await store2.put({ _id: '1', title: 'B', category: 'y', priority: 2, tags: [], metadata: { author: 'b', version: 1 } });

      await store1.clear();

      expect(await store1.count()).toBe(0);
      expect(await store2.count()).toBe(1);
    });
  });
});

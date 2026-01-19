import { beforeEach, describe, expect, it } from 'vitest';
import type { Document } from '../../core/src/types/document.js';
import { MemoryStorageAdapter, createMemoryStorage } from './adapter.js';

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
  tags: string[];
  nested: { value: number };
}

describe('MemoryStorageAdapter Integration', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.initialize({ name: 'test-db' });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.initialize({ name: 'new-db' });
      expect(adapter.isAvailable()).toBe(true);
    });

    it('should report as available', () => {
      expect(storage.isAvailable()).toBe(true);
    });

    it('should have correct name', () => {
      expect(storage.name).toBe('memory');
    });
  });

  describe('DocumentStore operations', () => {
    let store: ReturnType<typeof storage.getStore<TestDoc>>;

    beforeEach(() => {
      store = storage.getStore<TestDoc>('test-collection');
    });

    describe('basic CRUD', () => {
      it('should put and get a document', async () => {
        const doc: TestDoc = {
          _id: '1',
          title: 'Test',
          count: 42,
          tags: ['a', 'b'],
          nested: { value: 100 },
        };

        const saved = await store.put(doc);
        expect(saved).toEqual(doc);

        const retrieved = await store.get('1');
        expect(retrieved).toEqual(doc);
      });

      it('should return null for non-existent document', async () => {
        const doc = await store.get('non-existent');
        expect(doc).toBeNull();
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

        const updated: TestDoc = {
          ...original,
          title: 'Updated',
          count: 2,
        };
        await store.put(updated);

        const retrieved = await store.get('1');
        expect(retrieved?.title).toBe('Updated');
        expect(retrieved?.count).toBe(2);
      });

      it('should delete a document', async () => {
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
    });

    describe('bulk operations', () => {
      it('should put multiple documents', async () => {
        const docs: TestDoc[] = [
          { _id: '1', title: 'Doc 1', count: 1, tags: [], nested: { value: 1 } },
          { _id: '2', title: 'Doc 2', count: 2, tags: [], nested: { value: 2 } },
          { _id: '3', title: 'Doc 3', count: 3, tags: [], nested: { value: 3 } },
        ];

        const saved = await store.bulkPut(docs);
        expect(saved).toHaveLength(3);

        const retrieved = await store.getMany(['1', '2', '3']);
        expect(retrieved).toHaveLength(3);
      });

      it('should get multiple documents with mixed results', async () => {
        const doc: TestDoc = {
          _id: '1',
          title: 'Exists',
          count: 1,
          tags: [],
          nested: { value: 1 },
        };
        await store.put(doc);

        const retrieved = await store.getMany(['1', 'non-existent']);
        expect(retrieved[0]?._id).toBe('1');
        expect(retrieved[1]).toBeNull();
      });

      it('should get all documents', async () => {
        await store.bulkPut([
          { _id: '1', title: 'Doc 1', count: 1, tags: [], nested: { value: 1 } },
          { _id: '2', title: 'Doc 2', count: 2, tags: [], nested: { value: 2 } },
        ]);

        const all = await store.getAll();
        expect(all).toHaveLength(2);
      });
    });

    describe('querying', () => {
      beforeEach(async () => {
        await store.bulkPut([
          { _id: '1', title: 'Alpha', count: 10, tags: ['a'], nested: { value: 100 } },
          { _id: '2', title: 'Beta', count: 20, tags: ['b'], nested: { value: 200 } },
          { _id: '3', title: 'Gamma', count: 30, tags: ['a', 'b'], nested: { value: 300 } },
          { _id: '4', title: 'Delta', count: 40, tags: ['c'], nested: { value: 400 } },
        ]);
      });

      it('should query with equality filter', async () => {
        const results = await store.query({
          spec: { filter: { count: 20 } },
        });
        expect(results).toHaveLength(1);
        expect(results[0]._id).toBe('2');
      });

      it('should query with comparison operators', async () => {
        const results = await store.query({
          spec: { filter: { count: { $gt: 20 } } },
        });
        expect(results).toHaveLength(2);
      });

      it('should query with nested field', async () => {
        const results = await store.query({
          spec: { filter: { 'nested.value': { $gte: 300 } } },
        });
        expect(results).toHaveLength(2);
      });

      it('should apply sort', async () => {
        const results = await store.query({
          spec: {
            sort: [{ field: 'count', direction: 'desc' }],
          },
        });
        expect(results[0]._id).toBe('4');
        expect(results[3]._id).toBe('1');
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
        expect(results[0]._id).toBe('3');
      });

      it('should combine filter, sort, skip and limit', async () => {
        const results = await store.query({
          spec: {
            filter: { count: { $gt: 10 } },
            sort: [{ field: 'count', direction: 'asc' }],
            skip: 1,
            limit: 1,
          },
        });
        expect(results).toHaveLength(1);
        expect(results[0]._id).toBe('3');
      });
    });

    describe('indexing', () => {
      it('should create and list indexes', async () => {
        await store.createIndex({ fields: ['count'] });
        await store.createIndex({ name: 'title-idx', fields: ['title'] });

        const indexes = await store.getIndexes();
        expect(indexes.length).toBeGreaterThanOrEqual(2);
        expect(indexes.some((i) => i.fields.some((f) => f.field === 'count'))).toBe(true);
        expect(indexes.some((i) => i.name === 'title-idx')).toBe(true);
      });

      it('should drop an index', async () => {
        await store.createIndex({ name: 'to-drop', fields: ['count'] });
        let indexes = await store.getIndexes();
        expect(indexes.some((i) => i.name === 'to-drop')).toBe(true);

        await store.dropIndex('to-drop');

        indexes = await store.getIndexes();
        expect(indexes.some((i) => i.name === 'to-drop')).toBe(false);
      });

      it('should create compound index', async () => {
        await store.createIndex({ fields: ['title', 'count'] });

        const indexes = await store.getIndexes();
        const compoundIdx = indexes.find(
          (i) =>
            i.fields.some((f) => f.field === 'title') && i.fields.some((f) => f.field === 'count')
        );
        expect(compoundIdx).toBeDefined();
      });
    });

    describe('counting', () => {
      beforeEach(async () => {
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
        const count = await store.count({ spec: { filter: { count: { $gt: 15 } } } });
        expect(count).toBe(2);
      });
    });

    describe('change events', () => {
      it('should emit changes', async () => {
        const changes: any[] = [];
        const subscription = store.changes().subscribe((event) => changes.push(event));

        await store.put({ _id: '1', title: 'New', count: 1, tags: [], nested: { value: 1 } });

        // Give time for the event to propagate
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(changes.length).toBeGreaterThan(0);
        subscription.unsubscribe();
      });
    });

    describe('clear', () => {
      it('should remove all documents', async () => {
        await store.bulkPut([
          { _id: '1', title: 'A', count: 1, tags: [], nested: { value: 1 } },
          { _id: '2', title: 'B', count: 2, tags: [], nested: { value: 2 } },
        ]);

        await store.clear();

        const all = await store.getAll();
        expect(all).toHaveLength(0);
      });
    });
  });

  describe('multiple stores', () => {
    it('should isolate data between stores', async () => {
      const store1 = storage.getStore<TestDoc>('collection1');
      const store2 = storage.getStore<TestDoc>('collection2');

      await store1.put({ _id: '1', title: 'Store 1', count: 1, tags: [], nested: { value: 1 } });
      await store2.put({ _id: '1', title: 'Store 2', count: 2, tags: [], nested: { value: 2 } });

      const doc1 = await store1.get('1');
      const doc2 = await store2.get('1');

      expect(doc1?.title).toBe('Store 1');
      expect(doc2?.title).toBe('Store 2');
    });

    it('should return same store instance for same name', () => {
      const store1 = storage.getStore('collection');
      const store2 = storage.getStore('collection');
      expect(store1).toBe(store2);
    });
  });

  describe('close', () => {
    it('should close storage', async () => {
      await storage.close();
      // Memory adapter doesn't have special close behavior
      // but shouldn't throw
    });
  });
});

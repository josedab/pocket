import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDBAdapter, createIndexedDBStorage } from '../adapter.js';
import type { Document } from '@pocket/core';

// Helper: get a store and wait for the async version upgrade to complete
async function getReadyStore<T extends Document>(adapter: IndexedDBAdapter, name: string) {
  const store = adapter.getStore<T>(name);
  // triggerUpgrade is fire-and-forget; give fake-indexeddb a microtask to complete
  await new Promise((r) => setTimeout(r, 50));
  return store;
}

describe('IndexedDBAdapter (fake-indexeddb)', () => {
  let adapter: IndexedDBAdapter;

  beforeEach(async () => {
    adapter = createIndexedDBStorage();
    await adapter.initialize({ name: `test-db-${Date.now()}-${Math.random()}`, version: 1 });
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('lifecycle', () => {
    it('should report as available', () => {
      expect(adapter.isAvailable()).toBe(true);
    });

    it('should initialize and close without error', async () => {
      await adapter.close();
    });

    it('should throw when accessing store before initialize', () => {
      const freshAdapter = createIndexedDBStorage();
      expect(() => freshAdapter.getStore('test')).toThrow();
    });
  });

  describe('getStore', () => {
    it('should return a document store', async () => {
      const store = await getReadyStore(adapter, 'todos');
      expect(store).toBeDefined();
    });

    it('should return the same store instance for the same name', async () => {
      const store1 = await getReadyStore(adapter, 'todos');
      const store2 = adapter.getStore('todos');
      expect(store1).toBe(store2);
    });
  });

  describe('document operations', () => {
    it('should put and get a document', async () => {
      const store = await getReadyStore<{ _id: string; title: string }>(adapter, 'todos');
      await store.put({ _id: 'todo-1', title: 'Buy milk' });

      const doc = await store.get('todo-1');
      expect(doc).toBeDefined();
      expect(doc!.title).toBe('Buy milk');
    });

    it('should return null for non-existent document', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'todos');
      const doc = await store.get('non-existent');
      expect(doc).toBeNull();
    });

    it('should update an existing document', async () => {
      const store = await getReadyStore<{ _id: string; title: string; done: boolean }>(adapter, 'todos');
      await store.put({ _id: 'todo-1', title: 'Buy milk', done: false });
      await store.put({ _id: 'todo-1', title: 'Buy milk', done: true });

      const doc = await store.get('todo-1');
      expect(doc!.done).toBe(true);
    });

    it('should delete a document', async () => {
      const store = await getReadyStore<{ _id: string; title: string }>(adapter, 'todos');
      await store.put({ _id: 'todo-1', title: 'Buy milk' });
      await store.delete('todo-1');

      const doc = await store.get('todo-1');
      expect(doc).toBeNull();
    });

    it('should not throw when deleting non-existent document', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'empty');
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('bulk operations', () => {
    it('should bulk put documents', async () => {
      const store = await getReadyStore<{ _id: string; title: string }>(adapter, 'todos');
      await store.bulkPut([
        { _id: 'todo-1', title: 'First' },
        { _id: 'todo-2', title: 'Second' },
        { _id: 'todo-3', title: 'Third' },
      ]);

      const doc1 = await store.get('todo-1');
      const doc3 = await store.get('todo-3');
      expect(doc1!.title).toBe('First');
      expect(doc3!.title).toBe('Third');
    });

    it('should handle empty bulk put', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'todos');
      await expect(store.bulkPut([])).resolves.not.toThrow();
    });
  });

  describe('getAll', () => {
    it('should return all documents in a store', async () => {
      const store = await getReadyStore<{ _id: string; title: string }>(adapter, 'todos');
      await store.bulkPut([
        { _id: 'a', title: 'A' },
        { _id: 'b', title: 'B' },
      ]);

      const all = await store.getAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array for empty store', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'empty');
      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('count', () => {
    it('should count documents', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'items');
      await store.bulkPut([{ _id: '1' }, { _id: '2' }, { _id: '3' }]);

      const count = await store.count();
      expect(count).toBe(3);
    });

    it('should return 0 for empty store', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'empty2');
      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all documents from a store', async () => {
      const store = await getReadyStore<{ _id: string }>(adapter, 'items');
      await store.bulkPut([{ _id: '1' }, { _id: '2' }]);
      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe('factory function', () => {
    it('should create adapter via factory', () => {
      const a = createIndexedDBStorage();
      expect(a).toBeInstanceOf(IndexedDBAdapter);
      expect(a.name).toBe('indexeddb');
    });
  });
});

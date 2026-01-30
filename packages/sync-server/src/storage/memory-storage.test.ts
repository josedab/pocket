import type { Document } from '@pocket/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncChange } from '../types.js';
import { createMemoryStorage, MemoryStorage } from './memory-storage.js';

interface TestDoc extends Document {
  name: string;
  value?: number;
  category?: string;
  _updatedAt?: number;
  _collection?: string;
}

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('constructor', () => {
    it('creates storage with default maxChanges', () => {
      const store = new MemoryStorage();
      expect(store.getStats().changes).toBe(0);
    });

    it('creates storage with custom maxChanges', () => {
      const store = new MemoryStorage({ maxChanges: 100 });
      expect(store.getStats().changes).toBe(0);
    });
  });

  describe('saveDocument and getDocument', () => {
    it('saves and retrieves a document', async () => {
      const doc: TestDoc = { _id: 'doc1', name: 'Test Doc' };
      await storage.saveDocument('users', doc);

      const retrieved = await storage.getDocument<TestDoc>('users', 'doc1');
      expect(retrieved).toEqual(doc);
    });

    it('returns null for non-existent document', async () => {
      const retrieved = await storage.getDocument('users', 'nonexistent');
      expect(retrieved).toBeNull();
    });

    it('returns null for non-existent collection', async () => {
      const retrieved = await storage.getDocument('nonexistent', 'doc1');
      expect(retrieved).toBeNull();
    });

    it('updates existing document', async () => {
      const doc: TestDoc = { _id: 'doc1', name: 'Test Doc' };
      await storage.saveDocument('users', doc);

      const updated: TestDoc = { _id: 'doc1', name: 'Updated Doc', value: 42 };
      await storage.saveDocument('users', updated);

      const retrieved = await storage.getDocument<TestDoc>('users', 'doc1');
      expect(retrieved).toEqual(updated);
    });
  });

  describe('getDocuments', () => {
    beforeEach(async () => {
      await storage.saveDocument('users', {
        _id: 'doc1',
        name: 'Alice',
        value: 10,
        category: 'A',
        _updatedAt: 1000,
      });
      await storage.saveDocument('users', {
        _id: 'doc2',
        name: 'Bob',
        value: 20,
        category: 'B',
        _updatedAt: 2000,
      });
      await storage.saveDocument('users', {
        _id: 'doc3',
        name: 'Charlie',
        value: 30,
        category: 'A',
        _updatedAt: 3000,
      });
    });

    it('returns all documents from collection', async () => {
      const docs = await storage.getDocuments<TestDoc>('users');
      expect(docs).toHaveLength(3);
    });

    it('returns empty array for non-existent collection', async () => {
      const docs = await storage.getDocuments('nonexistent');
      expect(docs).toEqual([]);
    });

    it('filters by since timestamp', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', { since: 1500 });
      expect(docs).toHaveLength(2);
      expect(docs.map((d) => d._id).sort()).toEqual(['doc2', 'doc3']);
    });

    it('applies limit', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', { limit: 2 });
      expect(docs).toHaveLength(2);
    });

    it('filters by simple equality', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { category: 'A' },
      });
      expect(docs).toHaveLength(2);
      expect(docs.every((d) => d.category === 'A')).toBe(true);
    });

    it('filters with $eq operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { value: { $eq: 20 } },
      });
      expect(docs).toHaveLength(1);
      expect(docs[0]._id).toBe('doc2');
    });

    it('filters with $ne operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { category: { $ne: 'A' } },
      });
      expect(docs).toHaveLength(1);
      expect(docs[0]._id).toBe('doc2');
    });

    it('filters with $gt operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { value: { $gt: 15 } },
      });
      expect(docs).toHaveLength(2);
    });

    it('filters with $gte operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { value: { $gte: 20 } },
      });
      expect(docs).toHaveLength(2);
    });

    it('filters with $lt operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { value: { $lt: 25 } },
      });
      expect(docs).toHaveLength(2);
    });

    it('filters with $lte operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { value: { $lte: 20 } },
      });
      expect(docs).toHaveLength(2);
    });

    it('filters with $in operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { name: { $in: ['Alice', 'Charlie'] } },
      });
      expect(docs).toHaveLength(2);
    });

    it('filters with $nin operator', async () => {
      const docs = await storage.getDocuments<TestDoc>('users', {
        filter: { name: { $nin: ['Alice', 'Charlie'] } },
      });
      expect(docs).toHaveLength(1);
      expect(docs[0]._id).toBe('doc2');
    });
  });

  describe('deleteDocument', () => {
    it('deletes an existing document', async () => {
      await storage.saveDocument('users', { _id: 'doc1', name: 'Test' });
      await storage.deleteDocument('users', 'doc1');

      const retrieved = await storage.getDocument('users', 'doc1');
      expect(retrieved).toBeNull();
    });

    it('handles deleting from non-existent collection', async () => {
      await storage.deleteDocument('nonexistent', 'doc1');
      // Should not throw
    });
  });

  describe('recordChange and getChanges', () => {
    it('records and retrieves changes', async () => {
      const change: SyncChange<TestDoc> = {
        type: 'create',
        documentId: 'doc1',
        document: { _id: 'doc1', name: 'Test', _collection: 'users' },
        timestamp: 1000,
        clientId: 'client1',
      };

      await storage.recordChange(change);
      const changes = await storage.getChanges('users', 0);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual(change);
    });

    it('filters changes by since timestamp', async () => {
      await storage.recordChange({
        type: 'create',
        documentId: 'doc1',
        document: { _id: 'doc1', name: 'Test1', _collection: 'users' },
        timestamp: 1000,
        clientId: 'client1',
      });
      await storage.recordChange({
        type: 'create',
        documentId: 'doc2',
        document: { _id: 'doc2', name: 'Test2', _collection: 'users' },
        timestamp: 2000,
        clientId: 'client1',
      });

      const changes = await storage.getChanges('users', 1500);
      expect(changes).toHaveLength(1);
      expect(changes[0].documentId).toBe('doc2');
    });

    it('applies limit to changes', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.recordChange({
          type: 'create',
          documentId: `doc${i}`,
          document: { _id: `doc${i}`, name: `Test${i}`, _collection: 'users' },
          timestamp: 1000 + i,
          clientId: 'client1',
        });
      }

      const changes = await storage.getChanges('users', 0, 3);
      expect(changes).toHaveLength(3);
    });

    it('applies document changes for create/update', async () => {
      await storage.recordChange({
        type: 'create',
        documentId: 'doc1',
        document: { _id: 'doc1', name: 'Test', _collection: 'users' },
        timestamp: 1000,
        clientId: 'client1',
      });

      const doc = await storage.getDocument('users', 'doc1');
      expect(doc).toBeDefined();
    });

    it('applies document changes for delete', async () => {
      // Note: delete changes fall back to 'default' collection when document is null
      // and no _collection metadata is available
      await storage.saveDocument('default', { _id: 'doc1', name: 'Test' });

      await storage.recordChange({
        type: 'delete',
        documentId: 'doc1',
        document: null,
        timestamp: 1000,
        clientId: 'client1',
      });

      const doc = await storage.getDocument('default', 'doc1');
      expect(doc).toBeNull();
    });

    it('enforces maxChanges limit', async () => {
      const store = new MemoryStorage({ maxChanges: 3 });

      for (let i = 0; i < 5; i++) {
        await store.recordChange({
          type: 'create',
          documentId: `doc${i}`,
          document: { _id: `doc${i}`, name: `Test${i}`, _collection: 'users' },
          timestamp: 1000 + i,
          clientId: 'client1',
        });
      }

      expect(store.getStats().changes).toBe(3);
    });
  });

  describe('clear', () => {
    it('clears all data', async () => {
      await storage.saveDocument('users', { _id: 'doc1', name: 'Test' });
      await storage.recordChange({
        type: 'create',
        documentId: 'doc1',
        document: { _id: 'doc1', name: 'Test', _collection: 'users' },
        timestamp: 1000,
        clientId: 'client1',
      });

      storage.clear();

      expect(storage.getStats().collections).toBe(0);
      expect(storage.getStats().documents).toBe(0);
      expect(storage.getStats().changes).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns correct stats', async () => {
      await storage.saveDocument('users', { _id: 'doc1', name: 'Test1' });
      await storage.saveDocument('users', { _id: 'doc2', name: 'Test2' });
      await storage.saveDocument('posts', { _id: 'post1', name: 'Post1' });

      await storage.recordChange({
        type: 'create',
        documentId: 'doc1',
        document: { _id: 'doc1', name: 'Test1', _collection: 'users' },
        timestamp: 1000,
        clientId: 'client1',
      });

      const stats = storage.getStats();
      expect(stats.collections).toBe(2);
      expect(stats.documents).toBe(3);
      expect(stats.changes).toBe(1);
    });
  });

  describe('createMemoryStorage factory', () => {
    it('creates a MemoryStorage instance', () => {
      const store = createMemoryStorage();
      expect(store).toBeInstanceOf(MemoryStorage);
    });

    it('passes options to constructor', () => {
      const store = createMemoryStorage({ maxChanges: 50 });
      expect(store).toBeInstanceOf(MemoryStorage);
    });
  });
});

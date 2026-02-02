/**
 * Tests for BaseKVDocumentStore
 *
 * Uses a concrete in-memory mock implementation of the abstract base class
 * to verify all DocumentStore operations, query filtering, and sorting.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Document } from '@pocket/core';
import { BaseKVDocumentStore, type KVListEntry } from '../base-kv-store.js';

// ---------------------------------------------------------------------------
// Test document type
// ---------------------------------------------------------------------------

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
  status?: string;
  tags?: string[];
  nested?: { value: number };
}

// ---------------------------------------------------------------------------
// Mock KV implementation using a Map
// ---------------------------------------------------------------------------

class MockKVStore<T extends Document> extends BaseKVDocumentStore<T> {
  private data = new Map<string, string>();

  protected async kvGet(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  protected async kvSet(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  protected async kvDelete(key: string): Promise<void> {
    this.data.delete(key);
  }

  protected async kvList(prefix: string): Promise<KVListEntry[]> {
    const entries: KVListEntry[] = [];
    for (const [key, value] of this.data) {
      if (key.startsWith(prefix)) {
        entries.push({ key, value });
      }
    }
    return entries;
  }

  /** Expose internal data size for testing */
  get size(): number {
    return this.data.size;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseKVDocumentStore', () => {
  let store: MockKVStore<TestDoc>;

  beforeEach(() => {
    store = new MockKVStore<TestDoc>('test-collection');
  });

  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------

  describe('basic CRUD', () => {
    it('should put and get a document', async () => {
      const doc: TestDoc = { _id: '1', title: 'Hello', count: 42 };
      await store.put(doc);

      const result = await store.get('1');
      expect(result).toEqual(doc);
    });

    it('should return null for non-existent document', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should update an existing document', async () => {
      const doc: TestDoc = { _id: '1', title: 'Original', count: 1 };
      await store.put(doc);

      const updated: TestDoc = { _id: '1', title: 'Updated', count: 2 };
      await store.put(updated);

      const result = await store.get('1');
      expect(result?.title).toBe('Updated');
      expect(result?.count).toBe(2);
    });

    it('should delete a document', async () => {
      const doc: TestDoc = { _id: '1', title: 'Hello', count: 1 };
      await store.put(doc);
      await store.delete('1');

      const result = await store.get('1');
      expect(result).toBeNull();
    });

    it('should not throw when deleting non-existent document', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });

    it('should get all documents', async () => {
      await store.put({ _id: '1', title: 'A', count: 1 });
      await store.put({ _id: '2', title: 'B', count: 2 });
      await store.put({ _id: '3', title: 'C', count: 3 });

      const all = await store.getAll();
      expect(all).toHaveLength(3);
    });

    it('should get many documents', async () => {
      await store.put({ _id: '1', title: 'A', count: 1 });
      await store.put({ _id: '2', title: 'B', count: 2 });
      await store.put({ _id: '3', title: 'C', count: 3 });

      const results = await store.getMany(['1', '3', 'missing']);
      expect(results).toHaveLength(3);
      expect(results[0]?._id).toBe('1');
      expect(results[1]?._id).toBe('3');
      expect(results[2]).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  describe('bulk operations', () => {
    it('should bulk put documents', async () => {
      const docs: TestDoc[] = [
        { _id: '1', title: 'A', count: 1 },
        { _id: '2', title: 'B', count: 2 },
        { _id: '3', title: 'C', count: 3 },
      ];

      const results = await store.bulkPut(docs);
      expect(results).toHaveLength(3);

      const all = await store.getAll();
      expect(all).toHaveLength(3);
    });

    it('should bulk delete documents', async () => {
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1 },
        { _id: '2', title: 'B', count: 2 },
        { _id: '3', title: 'C', count: 3 },
      ]);

      await store.bulkDelete(['1', '3']);

      const all = await store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]?._id).toBe('2');
    });
  });

  // -----------------------------------------------------------------------
  // Query filtering
  // -----------------------------------------------------------------------

  describe('query filtering', () => {
    beforeEach(async () => {
      await store.bulkPut([
        { _id: '1', title: 'Alpha', count: 10, status: 'active' },
        { _id: '2', title: 'Beta', count: 20, status: 'inactive' },
        { _id: '3', title: 'Gamma', count: 30, status: 'active' },
        { _id: '4', title: 'Delta', count: 40, status: 'archived' },
        { _id: '5', title: 'Epsilon', count: 50, status: 'active' },
      ]);
    });

    it('should filter by direct equality', async () => {
      const results = await store.query({
        spec: { filter: { status: 'active' } as Record<string, unknown> },
      });
      expect(results).toHaveLength(3);
      expect(results.map((d) => d._id).sort()).toEqual(['1', '3', '5']);
    });

    it('should filter by $eq operator', async () => {
      const results = await store.query({
        spec: { filter: { status: { $eq: 'inactive' } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('2');
    });

    it('should filter by $ne operator', async () => {
      const results = await store.query({
        spec: { filter: { status: { $ne: 'active' } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by $gt operator', async () => {
      const results = await store.query({
        spec: { filter: { count: { $gt: 30 } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(2);
      expect(results.map((d) => d._id).sort()).toEqual(['4', '5']);
    });

    it('should filter by $gte operator', async () => {
      const results = await store.query({
        spec: { filter: { count: { $gte: 30 } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(3);
    });

    it('should filter by $lt operator', async () => {
      const results = await store.query({
        spec: { filter: { count: { $lt: 20 } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?._id).toBe('1');
    });

    it('should filter by $lte operator', async () => {
      const results = await store.query({
        spec: { filter: { count: { $lte: 20 } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by $in operator', async () => {
      const results = await store.query({
        spec: { filter: { status: { $in: ['active', 'archived'] } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(4);
    });

    it('should filter by $nin operator', async () => {
      const results = await store.query({
        spec: { filter: { status: { $nin: ['active'] } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(2);
    });

    it('should return all documents when no filter', async () => {
      const results = await store.query({ spec: {} });
      expect(results).toHaveLength(5);
    });
  });

  // -----------------------------------------------------------------------
  // Query sorting
  // -----------------------------------------------------------------------

  describe('query sorting', () => {
    beforeEach(async () => {
      await store.bulkPut([
        { _id: '1', title: 'Gamma', count: 30 },
        { _id: '2', title: 'Alpha', count: 10 },
        { _id: '3', title: 'Beta', count: 20 },
        { _id: '4', title: 'Delta', count: 40 },
      ]);
    });

    it('should sort ascending by field', async () => {
      const results = await store.query({
        spec: { sort: [{ field: 'title', direction: 'asc' }] },
      });
      expect(results.map((d) => d.title)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    });

    it('should sort descending by field', async () => {
      const results = await store.query({
        spec: { sort: [{ field: 'count', direction: 'desc' }] },
      });
      expect(results.map((d) => d.count)).toEqual([40, 30, 20, 10]);
    });

    it('should apply limit', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          limit: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results.map((d) => d.count)).toEqual([10, 20]);
    });

    it('should apply skip', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results.map((d) => d.count)).toEqual([30, 40]);
    });

    it('should apply skip and limit together', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 1,
          limit: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results.map((d) => d.count)).toEqual([20, 30]);
    });
  });

  // -----------------------------------------------------------------------
  // Count
  // -----------------------------------------------------------------------

  describe('count', () => {
    beforeEach(async () => {
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1, status: 'active' },
        { _id: '2', title: 'B', count: 2, status: 'inactive' },
        { _id: '3', title: 'C', count: 3, status: 'active' },
      ]);
    });

    it('should count all documents without query', async () => {
      const count = await store.count();
      expect(count).toBe(3);
    });

    it('should count documents matching filter', async () => {
      const count = await store.count({
        spec: { filter: { status: 'active' } as Record<string, unknown> },
      });
      expect(count).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('should remove all documents', async () => {
      await store.bulkPut([
        { _id: '1', title: 'A', count: 1 },
        { _id: '2', title: 'B', count: 2 },
      ]);

      await store.clear();

      const all = await store.getAll();
      expect(all).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Change events
  // -----------------------------------------------------------------------

  describe('changes', () => {
    it('should emit insert event on put (new document)', async () => {
      const events: ChangeEvent<TestDoc>[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: '1', title: 'Hello', count: 1 });

      expect(events).toHaveLength(1);
      expect(events[0]?.operation).toBe('insert');
      expect(events[0]?.documentId).toBe('1');
      expect(events[0]?.document?._id).toBe('1');
    });

    it('should emit update event on put (existing document)', async () => {
      await store.put({ _id: '1', title: 'Original', count: 1 });

      const events: ChangeEvent<TestDoc>[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: '1', title: 'Updated', count: 2 });

      expect(events).toHaveLength(1);
      expect(events[0]?.operation).toBe('update');
      expect(events[0]?.previousDocument?.title).toBe('Original');
    });

    it('should emit delete event on delete', async () => {
      await store.put({ _id: '1', title: 'Hello', count: 1 });

      const events: ChangeEvent<TestDoc>[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.delete('1');

      expect(events).toHaveLength(1);
      expect(events[0]?.operation).toBe('delete');
      expect(events[0]?.document).toBeNull();
      expect(events[0]?.previousDocument?.title).toBe('Hello');
    });

    it('should have monotonically increasing sequence numbers', async () => {
      const events: ChangeEvent<TestDoc>[] = [];
      store.changes().subscribe((event) => events.push(event));

      await store.put({ _id: '1', title: 'A', count: 1 });
      await store.put({ _id: '2', title: 'B', count: 2 });
      await store.put({ _id: '3', title: 'C', count: 3 });

      expect(events).toHaveLength(3);
      expect(events[0]!.sequence).toBeLessThan(events[1]!.sequence);
      expect(events[1]!.sequence).toBeLessThan(events[2]!.sequence);
    });
  });

  // -----------------------------------------------------------------------
  // Indexes (in-memory definitions)
  // -----------------------------------------------------------------------

  describe('indexes', () => {
    it('should create an index definition', async () => {
      await store.createIndex({
        name: 'idx_status',
        fields: ['status'],
      });

      const indexes = await store.getIndexes();
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.name).toBe('idx_status');
      expect(indexes[0]?.fields[0]?.field).toBe('status');
    });

    it('should auto-generate index name', async () => {
      await store.createIndex({
        fields: ['status', 'count'],
      });

      const indexes = await store.getIndexes();
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.name).toBe('idx_status_count');
    });

    it('should drop an index', async () => {
      await store.createIndex({ name: 'idx_status', fields: ['status'] });
      await store.dropIndex('idx_status');

      const indexes = await store.getIndexes();
      expect(indexes).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Store metadata
  // -----------------------------------------------------------------------

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(store.name).toBe('test-collection');
    });
  });
});

// Import the type we need for the test
import type { ChangeEvent } from '@pocket/core';

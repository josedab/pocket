import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, createDatabase } from '../database/database.js';
import { createMemoryStorage } from '../../../storage-memory/src/adapter.js';
import type { Document } from '../types/document.js';

interface TestDoc extends Document {
  _id: string;
  counter: number;
  label: string;
}

describe('Collection Concurrency', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: `concurrency-test-${Date.now()}`,
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    if (db?.isOpen) {
      await db.close();
    }
  });

  it('should handle concurrent inserts without data loss', async () => {
    const collection = db.collection<TestDoc>('items');
    const count = 50;

    const inserts = Array.from({ length: count }, (_, i) =>
      collection.insert({ counter: i, label: `item-${i}` })
    );

    const results = await Promise.all(inserts);
    expect(results).toHaveLength(count);

    // Verify all documents exist
    const all = await collection.find({}).exec();
    expect(all).toHaveLength(count);

    // Verify all counters are unique (no overwrites)
    const counters = new Set(all.map((d) => d.counter));
    expect(counters.size).toBe(count);
  });

  it('should handle concurrent updates to different documents', async () => {
    const collection = db.collection<TestDoc>('items');

    // Insert 10 documents
    const docs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        collection.insert({ counter: i, label: `item-${i}` })
      )
    );

    // Update all 10 concurrently
    const updates = docs.map((doc) =>
      collection.update(doc._id, { label: `updated-${doc.counter}` })
    );

    const updatedDocs = await Promise.all(updates);
    expect(updatedDocs).toHaveLength(10);

    for (const doc of updatedDocs) {
      expect(doc.label).toMatch(/^updated-/);
    }
  });

  it('should handle concurrent deletes without error', async () => {
    const collection = db.collection<TestDoc>('items');

    const docs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        collection.insert({ counter: i, label: `del-${i}` })
      )
    );

    // Delete all concurrently
    const deletes = docs.map((doc) => collection.delete(doc._id));
    await Promise.all(deletes);

    const remaining = await collection.find({}).exec();
    expect(remaining).toHaveLength(0);
  });

  it('should handle mixed concurrent operations', async () => {
    const collection = db.collection<TestDoc>('items');

    // Insert initial data
    const initial = await collection.insert({ counter: 0, label: 'initial' });

    // Run mixed operations concurrently
    const operations = [
      collection.insert({ counter: 1, label: 'new-1' }),
      collection.insert({ counter: 2, label: 'new-2' }),
      collection.update(initial._id, { label: 'updated' }),
      collection.insert({ counter: 3, label: 'new-3' }),
    ];

    await Promise.all(operations);

    const all = await collection.find({}).exec();
    // Should have initial (updated) + 3 new = 4 total
    expect(all).toHaveLength(4);

    const updatedInitial = await collection.get(initial._id);
    expect(updatedInitial?.label).toBe('updated');
  });

  it('should handle rapid sequential operations correctly', async () => {
    const collection = db.collection<TestDoc>('items');

    // Rapid fire: insert → update → read → delete → verify gone
    const doc = await collection.insert({ counter: 42, label: 'ephemeral' });
    await collection.update(doc._id, { label: 'changed' });
    const fetched = await collection.get(doc._id);
    expect(fetched?.label).toBe('changed');

    await collection.delete(doc._id);
    const gone = await collection.get(doc._id);
    expect(gone).toBeNull();
  });

  it('should maintain consistency with interleaved insert and query', async () => {
    const collection = db.collection<TestDoc>('items');

    // Insert and query interleaved
    await collection.insert({ counter: 1, label: 'a' });
    const r1 = await collection.find({}).exec();
    expect(r1).toHaveLength(1);

    await collection.insert({ counter: 2, label: 'b' });
    const r2 = await collection.find({}).exec();
    expect(r2).toHaveLength(2);

    await collection.insert({ counter: 3, label: 'c' });
    const r3 = await collection.find({}).exec();
    expect(r3).toHaveLength(3);
  });
});

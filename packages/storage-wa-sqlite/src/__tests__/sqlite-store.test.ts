import type { ChangeEvent, Document } from '@pocket/core';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteDocumentStore } from '../sqlite-store.js';
import type { SqlJsDatabase, SqlJsStatic } from '../types.js';

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

/**
 * Set up a fresh in-memory SQLite database with the schema required
 * by SQLiteDocumentStore, and return the db + store.
 */
async function createTestStore(
  name = 'test'
): Promise<{ db: SqlJsDatabase; store: SQLiteDocumentStore<TestDoc> }> {
  const SQL = await getSqlJs();
  const db = new SQL.Database() as unknown as SqlJsDatabase;

  // Create metadata tables (normally done by WaSQLiteAdapter)
  db.run(`
    CREATE TABLE IF NOT EXISTS _pocket_indexes (
      name TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      fields TEXT NOT NULL,
      is_unique INTEGER NOT NULL DEFAULT 0,
      sparse INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create collection table (normally done by WaSQLiteAdapter.ensureCollectionTable)
  db.run(`
    CREATE TABLE IF NOT EXISTS "pocket_${name}" (
      _id TEXT PRIMARY KEY,
      _rev TEXT,
      _deleted INTEGER DEFAULT 0,
      _updatedAt INTEGER,
      _vclock TEXT,
      _data TEXT NOT NULL
    )
  `);

  const store = new SQLiteDocumentStore<TestDoc>(db, name);
  return { db, store };
}

// Helper to make a test document
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

describe('SQLiteDocumentStore', () => {
  let db: SqlJsDatabase;
  let store: SQLiteDocumentStore<TestDoc>;

  beforeEach(async () => {
    ({ db, store } = await createTestStore());
  });

  afterEach(() => {
    store.destroy();
    db.close();
  });

  // ── Basic CRUD ──────────────────────────────────────────────

  describe('get()', () => {
    it('should return null for non-existent document', async () => {
      expect(await store.get('missing')).toBeNull();
    });

    it('should return a stored document', async () => {
      await store.put(makeDoc({ _id: '1', title: 'Hello', count: 42 }));
      const doc = await store.get('1');
      expect(doc).not.toBeNull();
      expect(doc!._id).toBe('1');
      expect(doc!.title).toBe('Hello');
      expect(doc!.count).toBe(42);
    });

    it('should not return soft-deleted documents', async () => {
      await store.put(makeDoc({ _id: '1' }));
      await store.delete('1');
      expect(await store.get('1')).toBeNull();
    });

    it('should return documents with arrays preserved', async () => {
      await store.put(makeDoc({ _id: '1', tags: ['a', 'b', 'c'] }));
      const doc = await store.get('1');
      expect(doc!.tags).toEqual(['a', 'b', 'c']);
    });

    it('should return documents with nested objects preserved', async () => {
      await store.put(makeDoc({ _id: '1', nested: { value: 999 } }));
      const doc = await store.get('1');
      expect(doc!.nested).toEqual({ value: 999 });
    });
  });

  describe('put()', () => {
    it('should insert a new document', async () => {
      const doc = makeDoc({ _id: 'new1', title: 'New' });
      const result = await store.put(doc);
      expect(result._id).toBe('new1');

      const stored = await store.get('new1');
      expect(stored!.title).toBe('New');
    });

    it('should update an existing document', async () => {
      await store.put(makeDoc({ _id: '1', title: 'V1' }));
      await store.put(makeDoc({ _id: '1', title: 'V2' }));

      const doc = await store.get('1');
      expect(doc!.title).toBe('V2');
    });

    it('should preserve _rev field', async () => {
      await store.put(makeDoc({ _id: '1', _rev: '2-abc123' }));
      const doc = await store.get('1');
      expect(doc!._rev).toBe('2-abc123');
    });

    it('should preserve _updatedAt field', async () => {
      const ts = Date.now();
      await store.put(makeDoc({ _id: '1', _updatedAt: ts }));
      const doc = await store.get('1');
      expect(doc!._updatedAt).toBe(ts);
    });

    it('should preserve _vclock field', async () => {
      const vclock = { node1: 1, node2: 3 };
      await store.put(makeDoc({ _id: '1', _vclock: vclock as unknown as TestDoc['_vclock'] }));
      const doc = await store.get('1');
      expect(doc!._vclock).toEqual(vclock);
    });

    it('should handle _deleted = true in document', async () => {
      await store.put(makeDoc({ _id: '1', _deleted: true }));
      // Soft-deleted docs are not returned by get()
      const doc = await store.get('1');
      expect(doc).toBeNull();
    });

    it('should store documents with empty strings', async () => {
      await store.put(makeDoc({ _id: '1', title: '' }));
      const doc = await store.get('1');
      expect(doc!.title).toBe('');
    });

    it('should store documents with special characters', async () => {
      await store.put(makeDoc({ _id: '1', title: 'it\'s a "test" with <html> & stuff' }));
      const doc = await store.get('1');
      expect(doc!.title).toBe('it\'s a "test" with <html> & stuff');
    });

    it('should store documents with unicode', async () => {
      await store.put(makeDoc({ _id: '1', title: '日本語テスト 🎉' }));
      const doc = await store.get('1');
      expect(doc!.title).toBe('日本語テスト 🎉');
    });
  });

  describe('getMany()', () => {
    it('should return empty array for empty input', async () => {
      expect(await store.getMany([])).toEqual([]);
    });

    it('should return docs in order of requested IDs', async () => {
      await store.bulkPut([makeDoc({ _id: 'a' }), makeDoc({ _id: 'b' }), makeDoc({ _id: 'c' })]);

      const results = await store.getMany(['c', 'a', 'b']);
      expect(results.map((r) => r?._id)).toEqual(['c', 'a', 'b']);
    });

    it('should return null for missing docs', async () => {
      await store.put(makeDoc({ _id: '1' }));
      const results = await store.getMany(['1', 'missing', '1']);
      expect(results[0]?._id).toBe('1');
      expect(results[1]).toBeNull();
      expect(results[2]?._id).toBe('1');
    });

    it('should not return soft-deleted docs', async () => {
      await store.put(makeDoc({ _id: '1' }));
      await store.delete('1');
      const results = await store.getMany(['1']);
      expect(results[0]).toBeNull();
    });
  });

  describe('getAll()', () => {
    it('should return empty array when no documents exist', async () => {
      expect(await store.getAll()).toEqual([]);
    });

    it('should return all non-deleted documents', async () => {
      await store.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' }), makeDoc({ _id: '3' })]);
      await store.delete('2');

      const all = await store.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((d) => d._id).sort()).toEqual(['1', '3']);
    });
  });

  describe('bulkPut()', () => {
    it('should insert multiple documents', async () => {
      const docs = [
        makeDoc({ _id: '1', title: 'A' }),
        makeDoc({ _id: '2', title: 'B' }),
        makeDoc({ _id: '3', title: 'C' }),
      ];
      const results = await store.bulkPut(docs);
      expect(results).toHaveLength(3);

      const all = await store.getAll();
      expect(all).toHaveLength(3);
    });

    it('should handle empty array', async () => {
      const results = await store.bulkPut([]);
      expect(results).toEqual([]);
    });

    it('should handle upsert (replace existing)', async () => {
      await store.put(makeDoc({ _id: '1', title: 'V1' }));
      await store.bulkPut([
        makeDoc({ _id: '1', title: 'V2' }),
        makeDoc({ _id: '2', title: 'New' }),
      ]);

      const doc1 = await store.get('1');
      const doc2 = await store.get('2');
      expect(doc1!.title).toBe('V2');
      expect(doc2!.title).toBe('New');
    });
  });

  describe('delete()', () => {
    it('should soft-delete a document', async () => {
      await store.put(makeDoc({ _id: '1' }));
      await store.delete('1');
      expect(await store.get('1')).toBeNull();
    });

    it('should be a no-op for non-existent document', async () => {
      await expect(store.delete('nonexistent')).resolves.not.toThrow();
    });

    it('should set _updatedAt on deletion', async () => {
      await store.put(makeDoc({ _id: '1' }));
      const before = Date.now();
      await store.delete('1');

      // Verify via raw SQL that _updatedAt was set
      const stmt = db.prepare('SELECT _updatedAt FROM "pocket_test" WHERE _id = ?');
      stmt.bind(['1']);
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();

      expect(row._updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('bulkDelete()', () => {
    it('should soft-delete multiple documents', async () => {
      await store.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' }), makeDoc({ _id: '3' })]);
      await store.bulkDelete(['1', '3']);

      const all = await store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]._id).toBe('2');
    });

    it('should handle empty array', async () => {
      await expect(store.bulkDelete([])).resolves.not.toThrow();
    });

    it('should handle mix of existing and non-existing IDs', async () => {
      await store.put(makeDoc({ _id: '1' }));
      await store.bulkDelete(['1', 'nonexistent']);
      expect(await store.getAll()).toHaveLength(0);
    });
  });

  // ── Change Events ──────────────────────────────────────────

  describe('change events', () => {
    it('should emit insert event on new document', async () => {
      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.put(makeDoc({ _id: '1', title: 'New' }));

      expect(events).toHaveLength(1);
      expect(events[0].operation).toBe('insert');
      expect(events[0].documentId).toBe('1');
      expect(events[0].document!._id).toBe('1');
      expect(events[0].document!.title).toBe('New');
      expect(events[0].previousDocument).toBeUndefined();
      expect(events[0].isFromSync).toBe(false);
      expect(events[0].timestamp).toBeGreaterThan(0);
      expect(events[0].sequence).toBe(1);
      sub.unsubscribe();
    });

    it('should emit update event on existing document', async () => {
      await store.put(makeDoc({ _id: '1', title: 'Original' }));

      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.put(makeDoc({ _id: '1', title: 'Updated' }));

      expect(events).toHaveLength(1);
      expect(events[0].operation).toBe('update');
      expect(events[0].document!.title).toBe('Updated');
      expect(events[0].previousDocument).toBeDefined();
      expect(events[0].previousDocument!.title).toBe('Original');
      sub.unsubscribe();
    });

    it('should emit delete event with previous document', async () => {
      await store.put(makeDoc({ _id: '1', title: 'ToDelete' }));

      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.delete('1');

      expect(events).toHaveLength(1);
      expect(events[0].operation).toBe('delete');
      expect(events[0].documentId).toBe('1');
      expect(events[0].document).toBeNull();
      expect(events[0].previousDocument!.title).toBe('ToDelete');
      sub.unsubscribe();
    });

    it('should not emit delete event for non-existent document', async () => {
      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.delete('nonexistent');

      expect(events).toHaveLength(0);
      sub.unsubscribe();
    });

    it('should increment sequence across events', async () => {
      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.put(makeDoc({ _id: '1' }));
      await store.put(makeDoc({ _id: '2' }));
      await store.put(makeDoc({ _id: '3' }));

      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
      expect(events[2].sequence).toBe(3);
      sub.unsubscribe();
    });

    it('should emit events during bulkPut', async () => {
      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' })]);

      expect(events).toHaveLength(2);
      expect(events[0].operation).toBe('insert');
      expect(events[1].operation).toBe('insert');
      sub.unsubscribe();
    });

    it('should emit delete events during clear()', async () => {
      await store.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' })]);

      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.clear();

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.operation === 'delete')).toBe(true);
      sub.unsubscribe();
    });

    it('should emit events during bulkDelete', async () => {
      await store.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' })]);

      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.bulkDelete(['1', '2']);

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.operation === 'delete')).toBe(true);
      sub.unsubscribe();
    });

    it('should provide deep-cloned documents (not references)', async () => {
      const original = makeDoc({ _id: '1', title: 'Original', nested: { value: 42 } });
      const events: ChangeEvent<TestDoc>[] = [];
      const sub = store.changes().subscribe((e) => events.push(e));

      await store.put(original);

      // Modifying the original should not affect the event
      original.title = 'Mutated';
      original.nested.value = 999;

      expect(events[0].document!.title).toBe('Original');
      expect(events[0].document!.nested.value).toBe(42);
      sub.unsubscribe();
    });
  });

  describe('destroy()', () => {
    it('should complete the changes observable', () => {
      let completed = false;
      store.changes().subscribe({
        complete: () => {
          completed = true;
        },
      });

      store.destroy();
      expect(completed).toBe(true);
    });

    it('should not emit events after destroy', () => {
      const events: ChangeEvent<TestDoc>[] = [];
      store.changes().subscribe({
        next: (e) => events.push(e),
      });

      store.destroy();

      // After destroy, the subject is completed so no events should appear
      // (put would still work at the SQL level but the subject won't emit)
      expect(events).toHaveLength(0);
    });
  });

  // ── Querying ────────────────────────────────────────────────

  describe('query()', () => {
    beforeEach(async () => {
      await store.bulkPut([
        makeDoc({ _id: '1', title: 'Alpha', count: 10, status: 'active' }),
        makeDoc({ _id: '2', title: 'Beta', count: 20, status: 'active' }),
        makeDoc({ _id: '3', title: 'Gamma', count: 30, status: 'inactive' }),
        makeDoc({ _id: '4', title: 'Delta', count: 40, status: 'active' }),
        makeDoc({ _id: '5', title: 'Epsilon', count: 50, status: 'inactive' }),
      ]);
    });

    it('should return all non-deleted docs with empty spec', async () => {
      const results = await store.query({ spec: {} });
      expect(results).toHaveLength(5);
    });

    it('should filter with equality', async () => {
      const results = await store.query({
        spec: { filter: { title: { $eq: 'Beta' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('2');
    });

    it('should filter with $gt', async () => {
      const results = await store.query({
        spec: { filter: { count: { $gt: 30 } } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['4', '5']);
    });

    it('should filter with $in', async () => {
      const results = await store.query({
        spec: { filter: { title: { $in: ['Alpha', 'Gamma'] } } },
      });
      expect(results).toHaveLength(2);
    });

    it('should filter with $nin', async () => {
      const results = await store.query({
        spec: { filter: { title: { $nin: ['Alpha', 'Gamma'] } } },
      });
      expect(results).toHaveLength(3);
    });

    it('should filter with $contains', async () => {
      const results = await store.query({
        spec: { filter: { title: { $contains: 'elt' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('4');
    });

    it('should filter with $startsWith', async () => {
      const results = await store.query({
        spec: { filter: { title: { $startsWith: 'Ep' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('5');
    });

    it('should filter with $endsWith', async () => {
      const results = await store.query({
        spec: { filter: { title: { $endsWith: 'ha' } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('1');
    });

    it('should filter with $or', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $or: [{ count: { $lt: 15 } }, { count: { $gt: 45 } }],
          },
        },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['1', '5']);
    });

    it('should filter with $and', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $and: [{ count: { $gte: 20 } }, { status: { $eq: 'active' } }],
          },
        },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['2', '4']);
    });

    it('should filter with $not', async () => {
      const results = await store.query({
        spec: {
          filter: {
            $not: { status: { $eq: 'active' } },
          },
        },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['3', '5']);
    });

    it('should sort ascending', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
        },
      });
      const ids = results.map((r) => r._id);
      expect(ids).toEqual(['1', '2', '3', '4', '5']);
    });

    it('should sort descending', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'desc' }],
        },
      });
      const ids = results.map((r) => r._id);
      expect(ids).toEqual(['5', '4', '3', '2', '1']);
    });

    it('should apply limit', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          limit: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0]._id).toBe('1');
    });

    it('should apply skip', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 3,
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0]._id).toBe('4');
    });

    it('should apply skip with limit', async () => {
      const results = await store.query({
        spec: {
          sort: [{ field: 'count', direction: 'asc' }],
          skip: 1,
          limit: 2,
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0]._id).toBe('2');
      expect(results[1]._id).toBe('3');
    });

    it('should not return soft-deleted documents in queries', async () => {
      await store.delete('3');
      const results = await store.query({ spec: {} });
      expect(results).toHaveLength(4);
      expect(results.every((r) => r._id !== '3')).toBe(true);
    });

    it('should handle empty $in (no results)', async () => {
      const results = await store.query({
        spec: { filter: { title: { $in: [] } } },
      });
      expect(results).toHaveLength(0);
    });

    it('should handle empty $nin (all results)', async () => {
      const results = await store.query({
        spec: { filter: { title: { $nin: [] } } },
      });
      expect(results).toHaveLength(5);
    });

    it('should query on internal field _id', async () => {
      const results = await store.query({
        spec: { filter: { _id: { $in: ['1', '3'] } } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['1', '3']);
    });
  });

  // ── Counting ────────────────────────────────────────────────

  describe('count()', () => {
    beforeEach(async () => {
      await store.bulkPut([
        makeDoc({ _id: '1', count: 10 }),
        makeDoc({ _id: '2', count: 20 }),
        makeDoc({ _id: '3', count: 30 }),
      ]);
    });

    it('should count all non-deleted documents', async () => {
      expect(await store.count()).toBe(3);
    });

    it('should count with filter', async () => {
      const count = await store.count({
        spec: { filter: { count: { $gt: 15 } } },
      });
      expect(count).toBe(2);
    });

    it('should not count soft-deleted documents', async () => {
      await store.delete('1');
      expect(await store.count()).toBe(2);
    });

    it('should return 0 for no matching documents', async () => {
      const count = await store.count({
        spec: { filter: { count: { $gt: 100 } } },
      });
      expect(count).toBe(0);
    });

    it('should count 0 when store is empty', async () => {
      await store.clear();
      expect(await store.count()).toBe(0);
    });

    it('should handle count without spec filter (undefined)', async () => {
      const count = await store.count({ spec: {} });
      expect(count).toBe(3);
    });
  });

  // ── Indexes ─────────────────────────────────────────────────

  describe('indexes', () => {
    it('should create a single-field index', async () => {
      await store.createIndex({ name: 'idx_count', fields: ['count'] });
      const indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_count')).toBe(true);
    });

    it('should create a compound index', async () => {
      await store.createIndex({
        name: 'idx_compound',
        fields: ['title', 'count'],
      });
      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_compound');
      expect(idx).toBeDefined();
      expect(idx!.fields).toHaveLength(2);
      expect(idx!.fields[0].field).toBe('title');
      expect(idx!.fields[1].field).toBe('count');
    });

    it('should create a unique index', async () => {
      await store.createIndex({
        name: 'idx_unique',
        fields: ['title'],
        unique: true,
      });
      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_unique');
      expect(idx!.unique).toBe(true);
    });

    it('should create a sparse index', async () => {
      await store.createIndex({
        name: 'idx_sparse',
        fields: ['status'],
        sparse: true,
      });
      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_sparse');
      expect(idx!.sparse).toBe(true);
    });

    it('should auto-generate index name when none is provided', async () => {
      await store.createIndex({ fields: ['title'] });
      const indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name.startsWith('idx_test_'))).toBe(true);
    });

    it('should handle index field as IndexField object', async () => {
      await store.createIndex({
        name: 'idx_dir',
        fields: [{ field: 'count', direction: 'desc' }],
      });
      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_dir');
      expect(idx).toBeDefined();
      expect(idx!.fields[0].field).toBe('count');
    });

    it('should drop an index', async () => {
      await store.createIndex({ name: 'idx_drop', fields: ['title'] });
      await store.dropIndex('idx_drop');
      const indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_drop')).toBe(false);
    });

    it('should handle drop of non-existent index gracefully', async () => {
      await expect(store.dropIndex('nonexistent')).resolves.not.toThrow();
    });

    it('should replace index with same name', async () => {
      await store.createIndex({ name: 'idx_replace', fields: ['title'] });
      await store.createIndex({ name: 'idx_replace', fields: ['count'] });
      const indexes = await store.getIndexes();
      const idx = indexes.find((i) => i.name === 'idx_replace');
      expect(idx!.fields[0].field).toBe('count');
    });

    it('should create index on internal field without json_extract', async () => {
      await store.createIndex({ name: 'idx_internal', fields: ['_id'] });
      const indexes = await store.getIndexes();
      expect(indexes.some((i) => i.name === 'idx_internal')).toBe(true);
    });

    it('should return empty array when no indexes exist', async () => {
      const indexes = await store.getIndexes();
      expect(indexes).toEqual([]);
    });
  });

  // ── Clear ───────────────────────────────────────────────────

  describe('clear()', () => {
    it('should remove all documents', async () => {
      await store.bulkPut([makeDoc({ _id: '1' }), makeDoc({ _id: '2' })]);
      await store.clear();
      expect(await store.getAll()).toEqual([]);
    });

    it('should be safe on already empty store', async () => {
      await expect(store.clear()).resolves.not.toThrow();
      expect(await store.getAll()).toEqual([]);
    });

    it('should remove soft-deleted docs too', async () => {
      await store.put(makeDoc({ _id: '1' }));
      await store.delete('1');
      await store.clear();

      // Verify via raw SQL that table is truly empty
      const result = db.exec('SELECT COUNT(*) FROM "pocket_test"');
      expect(result[0].values[0][0]).toBe(0);
    });
  });

  // ── Store Name ──────────────────────────────────────────────

  describe('name property', () => {
    it('should expose the store name', () => {
      expect(store.name).toBe('test');
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle documents with many fields', async () => {
      const doc = makeDoc({ _id: '1' }) as Record<string, unknown>;
      for (let i = 0; i < 50; i++) {
        doc[`field_${i}`] = `value_${i}`;
      }
      await store.put(doc as TestDoc);
      const retrieved = (await store.get('1')) as Record<string, unknown>;
      expect(retrieved!.field_0).toBe('value_0');
      expect(retrieved!.field_49).toBe('value_49');
    });

    it('should handle large batch operations', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => makeDoc({ _id: `doc-${i}`, count: i }));
      await store.bulkPut(docs);
      const all = await store.getAll();
      expect(all).toHaveLength(100);
    });

    it('should handle IDs with special characters', async () => {
      const specialIds = [
        'with spaces',
        'with-dashes',
        'with_underscores',
        'with.dots',
        'with/slashes',
        'with@symbols',
      ];

      for (const id of specialIds) {
        await store.put(makeDoc({ _id: id }));
        const doc = await store.get(id);
        expect(doc!._id).toBe(id);
      }
    });

    it('should handle document with null optional field', async () => {
      await store.put(makeDoc({ _id: '1', status: undefined }));
      const doc = await store.get('1');
      expect(doc).not.toBeNull();
    });

    it('should handle query on nested JSON field', async () => {
      await store.bulkPut([
        makeDoc({ _id: '1', nested: { value: 10 } }),
        makeDoc({ _id: '2', nested: { value: 20 } }),
        makeDoc({ _id: '3', nested: { value: 30 } }),
      ]);

      const results = await store.query({
        spec: { filter: { 'nested.value': { $gt: 15 } } as Record<string, unknown> },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r._id).sort()).toEqual(['2', '3']);
    });
  });
});

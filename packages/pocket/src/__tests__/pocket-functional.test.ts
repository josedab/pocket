import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../index.js';

describe('pocket umbrella – functional integration', () => {
  let db: Database;

  beforeEach(async () => {
    const { createDatabase, createMemoryStorage } = await import('../index.js');
    db = await createDatabase({
      name: `test-${Date.now()}`,
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    await db?.close();
  });

  // ── 1. Database creation ────────────────────────────────────────────

  describe('database creation', () => {
    it('should create a database via re-exported createDatabase + createMemoryStorage', async () => {
      const { Database } = await import('../index.js');
      expect(db).toBeDefined();
      expect(db).toBeInstanceOf(Database);
    });

    it('should expose collection() on the created database', () => {
      expect(typeof db.collection).toBe('function');
    });

    it('should allow creating a database with pre-configured collections', async () => {
      const { createDatabase, createMemoryStorage } = await import('../index.js');
      const db2 = await createDatabase({
        name: `test-preconfigured-${Date.now()}`,
        storage: createMemoryStorage(),
        collections: [{ name: 'tasks' }],
      });
      const col = db2.collection('tasks');
      expect(col).toBeDefined();
      await db2.close();
    });
  });

  // ── 2. Collection CRUD ──────────────────────────────────────────────

  describe('collection CRUD through umbrella imports', () => {
    interface Todo {
      _id: string;
      _rev: string;
      _createdAt: number;
      _updatedAt: number;
      title: string;
      priority: number;
      completed: boolean;
    }

    it('should insert a document and auto-generate _id and _rev', async () => {
      const col = db.collection<Todo>('todos');
      const doc = await col.insert({ title: 'Write tests', priority: 1, completed: false });

      expect(doc._id).toBeDefined();
      expect(doc._rev).toBeDefined();
      expect(doc._createdAt).toBeTypeOf('number');
      expect(doc._updatedAt).toBeTypeOf('number');
      expect(doc.title).toBe('Write tests');
    });

    it('should get a document by id', async () => {
      const col = db.collection<Todo>('todos');
      const inserted = await col.insert({ title: 'Get test', priority: 2, completed: false });

      const fetched = await col.get(inserted._id);
      expect(fetched).not.toBeNull();
      expect(fetched!._id).toBe(inserted._id);
      expect(fetched!.title).toBe('Get test');
    });

    it('should return null for a non-existent id', async () => {
      const col = db.collection<Todo>('todos');
      const result = await col.get('does-not-exist');
      expect(result).toBeNull();
    });

    it('should update a document', async () => {
      const col = db.collection<Todo>('todos');
      const doc = await col.insert({ title: 'Update me', priority: 1, completed: false });

      const updated = await col.update(doc._id, { completed: true, priority: 5 });
      expect(updated.completed).toBe(true);
      expect(updated.priority).toBe(5);
      expect(updated.title).toBe('Update me');
      expect(updated._rev).not.toBe(doc._rev);
    });

    it('should delete a document', async () => {
      const col = db.collection<Todo>('todos');
      const doc = await col.insert({ title: 'Delete me', priority: 1, completed: false });

      await col.delete(doc._id);
      const result = await col.get(doc._id);
      expect(result).toBeNull();
    });

    it('should support findOne', async () => {
      const col = db.collection<Todo>('todos');
      await col.insert({ title: 'First', priority: 1, completed: false });
      await col.insert({ title: 'Second', priority: 2, completed: true });

      const found = await col.findOne({ completed: true });
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Second');
    });

    it('should return null from findOne when no match', async () => {
      const col = db.collection<Todo>('todos');
      await col.insert({ title: 'Only', priority: 1, completed: false });

      const found = await col.findOne({ completed: true });
      expect(found).toBeNull();
    });
  });

  // ── 3. Query operations ─────────────────────────────────────────────

  describe('query operations through umbrella imports', () => {
    interface Item {
      _id: string;
      _rev: string;
      _createdAt: number;
      _updatedAt: number;
      name: string;
      price: number;
      category: string;
    }

    beforeEach(async () => {
      const col = db.collection<Item>('items');
      await col.insert({ name: 'Apple', price: 1, category: 'fruit' });
      await col.insert({ name: 'Banana', price: 2, category: 'fruit' });
      await col.insert({ name: 'Carrot', price: 3, category: 'vegetable' });
      await col.insert({ name: 'Donut', price: 4, category: 'snack' });
      await col.insert({ name: 'Eggplant', price: 5, category: 'vegetable' });
    });

    it('should find all documents with no filter', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find().exec();
      expect(results).toHaveLength(5);
    });

    it('should find documents matching a partial filter', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find({ category: 'fruit' }).exec();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.category === 'fruit')).toBe(true);
    });

    it('should support where().equals() chaining', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find().where('category').equals('vegetable').exec();
      expect(results).toHaveLength(2);
    });

    it('should support where().greaterThan()', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find().where('price').greaterThan(3).exec();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.price > 3)).toBe(true);
    });

    it('should support sort()', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find().sort('price', 'desc').exec();
      expect(results).toHaveLength(5);
      expect(results[0].name).toBe('Eggplant');
      expect(results[4].name).toBe('Apple');
    });

    it('should support limit()', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find().sort('price', 'asc').limit(2).exec();
      expect(results).toHaveLength(2);
      expect(results[0].price).toBe(1);
      expect(results[1].price).toBe(2);
    });

    it('should support skip()', async () => {
      const col = db.collection<Item>('items');
      const results = await col.find().sort('price', 'asc').skip(3).exec();
      expect(results).toHaveLength(2);
      expect(results[0].price).toBe(4);
    });

    it('should combine filter, sort, limit, and skip', async () => {
      const col = db.collection<Item>('items');
      const results = await col
        .find()
        .where('price')
        .greaterThan(1)
        .sort('price', 'asc')
        .skip(1)
        .limit(2)
        .exec();

      expect(results).toHaveLength(2);
      expect(results[0].price).toBe(3);
      expect(results[1].price).toBe(4);
    });
  });

  // ── 4. Utility functions ────────────────────────────────────────────

  describe('utility re-exports', () => {
    it('generateId should produce unique strings', async () => {
      const { generateId } = await import('../index.js');
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).toBeTypeOf('string');
      expect(id1.length).toBeGreaterThan(0);
      expect(id1).not.toBe(id2);
    });

    it('matchesFilter should evaluate document against a filter', async () => {
      const { matchesFilter } = await import('../index.js');
      const doc = {
        _id: '1',
        _rev: '1-abc',
        _createdAt: 1,
        _updatedAt: 1,
        status: 'active',
        count: 10,
      };

      expect(matchesFilter(doc, { status: { $eq: 'active' } })).toBe(true);
      expect(matchesFilter(doc, { status: { $eq: 'inactive' } })).toBe(false);
      expect(matchesFilter(doc, { count: { $gt: 5 } })).toBe(true);
      expect(matchesFilter(doc, { count: { $lt: 5 } })).toBe(false);
    });

    it('matchesFilter should support $and / $or logical operators', async () => {
      const { matchesFilter } = await import('../index.js');
      const doc = {
        _id: '1',
        _rev: '1-abc',
        _createdAt: 1,
        _updatedAt: 1,
        a: 1,
        b: 2,
      };

      expect(matchesFilter(doc, { $and: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }] })).toBe(true);
      expect(matchesFilter(doc, { $or: [{ a: { $eq: 99 } }, { b: { $eq: 2 } }] })).toBe(true);
      expect(matchesFilter(doc, { $or: [{ a: { $eq: 99 } }, { b: { $eq: 99 } }] })).toBe(false);
    });

    it('prepareNewDocument should add system fields', async () => {
      const { prepareNewDocument } = await import('../index.js');
      const raw = { title: 'test' } as any;
      const prepared = prepareNewDocument(raw);

      expect(prepared._id).toBeDefined();
      expect(prepared._rev).toBeDefined();
      expect(prepared._createdAt).toBeTypeOf('number');
      expect(prepared._updatedAt).toBeTypeOf('number');
      expect(prepared.title).toBe('test');
    });

    it('cloneDocument should produce a deep copy', async () => {
      const { cloneDocument } = await import('../index.js');
      const original = {
        _id: '1',
        _rev: '1-abc',
        _createdAt: 1,
        _updatedAt: 1,
        nested: { value: 42 },
      };
      const clone = cloneDocument(original);

      expect(clone).toEqual(original);
      expect(clone).not.toBe(original);
      expect(clone.nested).not.toBe(original.nested);
    });

    it('documentsEqual should compare documents correctly', async () => {
      const { documentsEqual } = await import('../index.js');
      const doc1 = { _id: '1', _rev: '1-a', _createdAt: 1, _updatedAt: 1, x: 1 };
      const doc2 = { _id: '1', _rev: '1-a', _createdAt: 1, _updatedAt: 1, x: 1 };
      const doc3 = { _id: '1', _rev: '1-a', _createdAt: 1, _updatedAt: 1, x: 2 };

      expect(documentsEqual(doc1, doc2)).toBe(true);
      expect(documentsEqual(doc1, doc3)).toBe(false);
    });

    it('Schema should validate documents', async () => {
      const { Schema } = await import('../index.js');
      const schema = new Schema({
        properties: {
          title: { type: 'string', required: true },
          done: { type: 'boolean' },
        },
      });

      const valid = schema.validate({
        _id: '1',
        _rev: '1-a',
        _createdAt: 1,
        _updatedAt: 1,
        title: 'hi',
        done: false,
      });
      expect(valid.valid).toBe(true);
    });

    it('HybridLogicalClock should generate timestamps via tick()', async () => {
      const { HybridLogicalClock } = await import('../index.js');
      const clock = new HybridLogicalClock();
      const t1 = clock.tick();
      const t2 = clock.tick();
      expect(t1).toBeDefined();
      expect(t2).toBeDefined();
      expect(t1.pt).toBeTypeOf('number');
      expect(t2.lc).toBeGreaterThanOrEqual(t1.lc);
    });
  });

  // ── 5. Type re-exports (compile-time + runtime shape checks) ───────

  describe('type re-exports', () => {
    it('should export Document-related types as importable symbols', async () => {
      // Types are erased at runtime, but we can verify the module resolves
      // and key value-level exports coexist alongside the types.
      const mod = await import('../index.js');

      // These are value exports that accompany the types
      expect(mod.Database).toBeTypeOf('function');
      expect(mod.Collection).toBeTypeOf('function');
      expect(mod.QueryBuilder).toBeTypeOf('function');
      expect(mod.QueryExecutor).toBeTypeOf('function');
      expect(mod.Schema).toBeTypeOf('function');
      expect(mod.LiveQuery).toBeTypeOf('function');
    });
  });

  // ── 6. Storage adapter re-exports ───────────────────────────────────

  describe('storage adapters', () => {
    it('should re-export MemoryStorageAdapter as a constructable class', async () => {
      const { MemoryStorageAdapter } = await import('../index.js');
      const adapter = new MemoryStorageAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('memory');
      expect(typeof adapter.initialize).toBe('function');
      expect(typeof adapter.getStore).toBe('function');
      expect(typeof adapter.close).toBe('function');
    });

    it('should re-export createMemoryStorage factory', async () => {
      const { createMemoryStorage } = await import('../index.js');
      const adapter = createMemoryStorage();
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('memory');
      expect(typeof adapter.getStore).toBe('function');
    });

    it('should re-export IndexedDBAdapter class', async () => {
      const { IndexedDBAdapter, createIndexedDBStorage } = await import('../index.js');
      expect(IndexedDBAdapter).toBeTypeOf('function');
      expect(createIndexedDBStorage).toBeTypeOf('function');
    });

    it('should re-export OPFSAdapter and WAL utilities', async () => {
      const { OPFSAdapter, WriteAheadLog, createOPFSStorage, createWAL } =
        await import('../index.js');
      expect(OPFSAdapter).toBeTypeOf('function');
      expect(WriteAheadLog).toBeTypeOf('function');
      expect(createOPFSStorage).toBeTypeOf('function');
      expect(createWAL).toBeTypeOf('function');
    });
  });
});

// ── 7. Sync sub-path re-exports ─────────────────────────────────────

describe('pocket/sync sub-path – functional checks', () => {
  it('should re-export SyncEngine as a constructable class', async () => {
    const { SyncEngine } = await import('../sync.js');
    expect(SyncEngine).toBeTypeOf('function');
    expect(SyncEngine.prototype).toBeDefined();
  });

  it('should re-export createSyncEngine factory', async () => {
    const { createSyncEngine } = await import('../sync.js');
    expect(createSyncEngine).toBeTypeOf('function');
  });

  it('should re-export ConflictResolver and allow standalone construction', async () => {
    const { ConflictResolver } = await import('../sync.js');
    expect(ConflictResolver).toBeTypeOf('function');

    const resolver = new ConflictResolver('last-write-wins');
    expect(resolver).toBeDefined();
  });

  it('should re-export CheckpointManager and allow construction', async () => {
    const { CheckpointManager } = await import('../sync.js');
    expect(CheckpointManager).toBeTypeOf('function');

    const mgr = new CheckpointManager('test-node');
    expect(mgr).toBeDefined();
  });

  it('should re-export transport classes', async () => {
    const { HttpTransport, WebSocketTransport, createHttpTransport, createWebSocketTransport } =
      await import('../sync.js');

    expect(HttpTransport).toBeTypeOf('function');
    expect(WebSocketTransport).toBeTypeOf('function');
    expect(createHttpTransport).toBeTypeOf('function');
    expect(createWebSocketTransport).toBeTypeOf('function');
  });

  it('should re-export OptimisticUpdateManager', async () => {
    const { OptimisticUpdateManager, createOptimisticUpdateManager } = await import('../sync.js');
    expect(OptimisticUpdateManager).toBeTypeOf('function');
    expect(createOptimisticUpdateManager).toBeTypeOf('function');
  });

  it('should re-export RollbackManager', async () => {
    const { RollbackManager, createRollbackManager } = await import('../sync.js');
    expect(RollbackManager).toBeTypeOf('function');
    expect(createRollbackManager).toBeTypeOf('function');
  });

  it('should re-export conflict detection utility', async () => {
    const { detectConflict } = await import('../sync.js');
    expect(detectConflict).toBeTypeOf('function');
  });

  it('should re-export checkpoint serialization helpers', async () => {
    const { serializeCheckpoint, deserializeCheckpoint } = await import('../sync.js');
    expect(serializeCheckpoint).toBeTypeOf('function');
    expect(deserializeCheckpoint).toBeTypeOf('function');
  });

  it('should re-export generateMessageId utility', async () => {
    const { generateMessageId } = await import('../sync.js');
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    expect(id1).toBeTypeOf('string');
    expect(id1).not.toBe(id2);
  });
});

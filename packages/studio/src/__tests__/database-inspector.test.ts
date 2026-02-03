import type { Document } from '@pocket/core';
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { DatabaseInspector, createDatabaseInspector } from '../database-inspector.js';
import { DocumentEditor, createDocumentEditor } from '../document-editor.js';
import { PerformanceProfiler, createPerformanceProfiler } from '../performance-profiler.js';
import { SyncInspector, createSyncInspector } from '../sync-inspector.js';

/**
 * Extended document type for test data.
 */
interface UserDoc extends Document {
  name: string;
  age?: number;
  role?: string;
  active?: boolean;
}

interface PostDoc extends Document {
  title: string;
  author: string;
  published: boolean;
}

describe('DatabaseInspector', () => {
  let db: Database;
  let inspector: DatabaseInspector;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-studio-db',
      storage: createMemoryStorage(),
      collections: [
        { name: 'users' },
        { name: 'posts' },
      ],
    });

    inspector = createDatabaseInspector(db);

    // Seed some test data
    const users = db.collection<UserDoc>('users');
    await users.insert({ name: 'Alice', age: 30, role: 'admin' });
    await users.insert({ name: 'Bob', age: 25, role: 'user' });
    await users.insert({ name: 'Charlie', age: 35, role: 'user' });

    const posts = db.collection<PostDoc>('posts');
    await posts.insert({ title: 'Hello World', author: 'Alice', published: true });
    await posts.insert({ title: 'Draft Post', author: 'Bob', published: false });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('listCollections', () => {
    it('should list all collections with metadata', async () => {
      const collections = await inspector.listCollections();

      expect(collections).toHaveLength(2);

      const usersColl = collections.find((c) => c.name === 'users');
      expect(usersColl).toBeDefined();
      expect(usersColl!.documentCount).toBe(3);

      const postsColl = collections.find((c) => c.name === 'posts');
      expect(postsColl).toBeDefined();
      expect(postsColl!.documentCount).toBe(2);
    });

    it('should include storage size estimates', async () => {
      const collections = await inspector.listCollections();
      const usersColl = collections.find((c) => c.name === 'users');

      // Storage size should be > 0 since there are documents
      expect(usersColl!.storageSize).toBeGreaterThan(0);
    });

    it('should include sample documents', async () => {
      const collections = await inspector.listCollections();
      const usersColl = collections.find((c) => c.name === 'users');

      expect(usersColl!.sampleDocument).toBeDefined();
    });
  });

  describe('getCollection', () => {
    it('should return detailed collection info', async () => {
      const info = await inspector.getCollection('users');

      expect(info.name).toBe('users');
      expect(info.documentCount).toBe(3);
      expect(info.indexCount).toBeGreaterThanOrEqual(0);
      expect(info.sampleDocument).toBeDefined();
    });

    it('should return info for empty collections', async () => {
      // Create a collection with no documents by accessing it
      db.collection('empty');
      const info = await inspector.getCollection('empty');

      expect(info.name).toBe('empty');
      expect(info.documentCount).toBe(0);
      expect(info.storageSize).toBe(0);
    });
  });

  describe('getDocument', () => {
    it('should return a specific document by ID', async () => {
      const users = db.collection<UserDoc>('users');
      const allUsers = await users.getAll();
      const firstUser = allUsers[0]!;

      const doc = await inspector.getDocument('users', firstUser._id);
      expect(doc).toBeDefined();
      expect((doc as UserDoc).name).toBe(firstUser.name);
    });

    it('should return null for non-existent document', async () => {
      const doc = await inspector.getDocument('users', 'non-existent-id');
      expect(doc).toBeNull();
    });
  });

  describe('queryDocuments', () => {
    it('should query documents without filter', async () => {
      const result = await inspector.queryDocuments('users');

      expect(result.documents).toHaveLength(3);
      expect(result.totalCount).toBe(3);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should query documents with filter', async () => {
      const result = await inspector.queryDocuments('users', { role: 'user' });

      expect(result.documents).toHaveLength(2);
      expect(result.totalCount).toBe(2);
    });

    it('should query documents with limit', async () => {
      const result = await inspector.queryDocuments('users', undefined, undefined, 1);

      expect(result.documents).toHaveLength(1);
      expect(result.totalCount).toBe(3);
    });

    it('should query documents with sort', async () => {
      const result = await inspector.queryDocuments(
        'users',
        undefined,
        { name: 'asc' }
      );

      const names = result.documents.map(
        (d) => (d as unknown as UserDoc).name
      );
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should include a query plan', async () => {
      const result = await inspector.queryDocuments('users', { role: 'admin' });

      expect(result.queryPlan).toBeDefined();
      expect(result.queryPlan!.collection).toBe('users');
      expect(result.queryPlan!.filters).toHaveLength(1);
    });

    it('should include execution time', async () => {
      const result = await inspector.queryDocuments('users');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('explainQuery', () => {
    it('should explain a query with filter', async () => {
      const plan = await inspector.explainQuery('users', { role: 'admin' });

      expect(plan.collection).toBe('users');
      expect(plan.strategy).toBe('full-scan');
      expect(plan.filters).toHaveLength(1);
      expect(plan.filters[0]).toContain('role');
    });

    it('should detect ID lookup strategy', async () => {
      const plan = await inspector.explainQuery('users', { _id: 'some-id' });

      expect(plan.strategy).toBe('id-lookup');
      expect(plan.estimatedCost).toBe(1);
    });

    it('should detect index scan when index exists', async () => {
      const users = db.collection<UserDoc>('users');
      await users.createIndex({ name: 'idx_role', fields: ['role'] });

      const plan = await inspector.explainQuery('users', { role: 'admin' });

      expect(plan.strategy).toBe('index-scan');
      expect(plan.indexUsed).toBe('idx_role');
    });
  });

  describe('countDocuments', () => {
    it('should count all documents', async () => {
      const count = await inspector.countDocuments('users');
      expect(count).toBe(3);
    });

    it('should count filtered documents', async () => {
      const count = await inspector.countDocuments('users', { role: 'user' });
      expect(count).toBe(2);
    });

    it('should return 0 for empty collection', async () => {
      db.collection('empty');
      const count = await inspector.countDocuments('empty');
      expect(count).toBe(0);
    });
  });

  describe('getIndexes', () => {
    it('should return empty array when no indexes', async () => {
      const indexes = await inspector.getIndexes('users');
      expect(indexes).toEqual([]);
    });

    it('should return indexes after creation', async () => {
      const users = db.collection<UserDoc>('users');
      await users.createIndex({
        name: 'idx_role',
        fields: ['role'],
        unique: false,
      });

      const indexes = await inspector.getIndexes('users');

      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.name).toBe('idx_role');
      expect(indexes[0]!.fields).toContain('role');
      expect(indexes[0]!.unique).toBe(false);
    });
  });
});

describe('DocumentEditor', () => {
  let db: Database;
  let editor: DocumentEditor;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-editor-db',
      storage: createMemoryStorage(),
      collections: [{ name: 'users' }],
    });

    editor = createDocumentEditor(db);
  });

  afterEach(async () => {
    editor.destroy();
    await db.close();
  });

  describe('insertDocument', () => {
    it('should insert a document', async () => {
      const doc = await editor.insertDocument('users', {
        name: 'Alice',
        age: 30,
      });

      expect(doc._id).toBeDefined();
      expect((doc as unknown as UserDoc).name).toBe('Alice');
    });

    it('should emit a document:modified event', async () => {
      const events: unknown[] = [];
      editor.events.subscribe((event) => events.push(event));

      await editor.insertDocument('users', { name: 'Bob' });

      expect(events).toHaveLength(1);
      expect((events[0] as { type: string }).type).toBe('document:modified');
    });
  });

  describe('updateDocument', () => {
    it('should update an existing document', async () => {
      const doc = await editor.insertDocument('users', {
        name: 'Alice',
        age: 30,
      });

      const updated = await editor.updateDocument('users', doc._id, { age: 31 });

      expect((updated as unknown as UserDoc).age).toBe(31);
      expect((updated as unknown as UserDoc).name).toBe('Alice');
    });

    it('should throw for non-existent document', async () => {
      await expect(
        editor.updateDocument('users', 'non-existent', { name: 'X' })
      ).rejects.toThrow();
    });
  });

  describe('deleteDocument', () => {
    it('should delete a document', async () => {
      const doc = await editor.insertDocument('users', { name: 'Alice' });
      await editor.deleteDocument('users', doc._id);

      const users = db.collection<UserDoc>('users');
      const found = await users.get(doc._id);
      expect(found).toBeNull();
    });
  });

  describe('bulkDelete', () => {
    it('should delete matching documents', async () => {
      await editor.insertDocument('users', { name: 'Alice', role: 'admin' });
      await editor.insertDocument('users', { name: 'Bob', role: 'user' });
      await editor.insertDocument('users', { name: 'Charlie', role: 'user' });

      const count = await editor.bulkDelete('users', { role: 'user' });

      expect(count).toBe(2);

      const users = db.collection<UserDoc>('users');
      const remaining = await users.getAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.name).toBe('Alice');
    });
  });

  describe('readOnly mode', () => {
    it('should throw on insert in read-only mode', async () => {
      const readOnlyEditor = createDocumentEditor(db, { readOnly: true });

      await expect(
        readOnlyEditor.insertDocument('users', { name: 'Alice' })
      ).rejects.toThrow('read-only');

      readOnlyEditor.destroy();
    });

    it('should throw on update in read-only mode', async () => {
      const doc = await editor.insertDocument('users', { name: 'Alice' });
      const readOnlyEditor = createDocumentEditor(db, { readOnly: true });

      await expect(
        readOnlyEditor.updateDocument('users', doc._id, { name: 'Bob' })
      ).rejects.toThrow('read-only');

      readOnlyEditor.destroy();
    });

    it('should throw on delete in read-only mode', async () => {
      const doc = await editor.insertDocument('users', { name: 'Alice' });
      const readOnlyEditor = createDocumentEditor(db, { readOnly: true });

      await expect(
        readOnlyEditor.deleteDocument('users', doc._id)
      ).rejects.toThrow('read-only');

      readOnlyEditor.destroy();
    });

    it('should throw on bulkDelete in read-only mode', async () => {
      const readOnlyEditor = createDocumentEditor(db, { readOnly: true });

      await expect(
        readOnlyEditor.bulkDelete('users', { role: 'user' })
      ).rejects.toThrow('read-only');

      readOnlyEditor.destroy();
    });

    it('should report isReadOnly correctly', () => {
      expect(editor.isReadOnly).toBe(false);

      const readOnlyEditor = createDocumentEditor(db, { readOnly: true });
      expect(readOnlyEditor.isReadOnly).toBe(true);
      readOnlyEditor.destroy();
    });
  });
});

describe('SyncInspector', () => {
  describe('without sync engine', () => {
    it('should return not-configured status', () => {
      const inspector = createSyncInspector();
      const status = inspector.getStatus();

      expect(status.status).toBe('not-configured');
      expect(status.lastSyncAt).toBeNull();
      expect(status.pendingChanges).toBe(0);
      expect(status.conflictCount).toBe(0);
      expect(status.connectedPeers).toBe(0);
    });

    it('should return empty pending changes', () => {
      const inspector = createSyncInspector();
      const pending = inspector.getPendingChanges();
      expect(pending).toEqual([]);
    });

    it('should throw on forcePush without engine', async () => {
      const inspector = createSyncInspector();
      await expect(inspector.forcePush()).rejects.toThrow('No sync engine configured');
    });

    it('should throw on forcePull without engine', async () => {
      const inspector = createSyncInspector();
      await expect(inspector.forcePull()).rejects.toThrow('No sync engine configured');
    });
  });

  describe('with mock sync engine', () => {
    it('should return status from sync engine', () => {
      const mockEngine = {
        getStatus: () => ({ getValue: () => 'idle' }),
        getStats: () => ({
          getValue: () => ({
            lastSyncAt: 1000,
            conflictCount: 2,
            pushCount: 10,
            pullCount: 5,
          }),
        }),
      };

      const inspector = createSyncInspector(mockEngine);
      const status = inspector.getStatus();

      expect(status.status).toBe('idle');
      expect(status.lastSyncAt).toBe(1000);
      expect(status.conflictCount).toBe(2);
      expect(status.connectedPeers).toBe(1);
    });

    it('should call push on the sync engine', async () => {
      let pushCalled = false;
      const mockEngine = {
        push: async () => {
          pushCalled = true;
        },
      };

      const inspector = createSyncInspector(mockEngine);
      await inspector.forcePush();

      expect(pushCalled).toBe(true);
    });

    it('should call pull on the sync engine', async () => {
      let pullCalled = false;
      const mockEngine = {
        pull: async () => {
          pullCalled = true;
        },
      };

      const inspector = createSyncInspector(mockEngine);
      await inspector.forcePull();

      expect(pullCalled).toBe(true);
    });

    it('should fall back to forceSync if push is not available', async () => {
      let forceSyncCalled = false;
      const mockEngine = {
        forceSync: async () => {
          forceSyncCalled = true;
        },
      };

      const inspector = createSyncInspector(mockEngine);
      await inspector.forcePush();

      expect(forceSyncCalled).toBe(true);
    });
  });

  describe('conflicts tracking', () => {
    it('should track conflicts', () => {
      const inspector = createSyncInspector();

      inspector.addConflict({
        documentId: 'doc-1',
        collection: 'users',
        detectedAt: Date.now(),
        localVersion: { name: 'Alice' },
        remoteVersion: { name: 'Alice2' },
      });

      const conflicts = inspector.getConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.documentId).toBe('doc-1');
    });

    it('should clear conflicts', () => {
      const inspector = createSyncInspector();

      inspector.addConflict({
        documentId: 'doc-1',
        collection: 'users',
        detectedAt: Date.now(),
        localVersion: {},
        remoteVersion: {},
      });

      const cleared = inspector.clearConflict('doc-1');
      expect(cleared).toBe(true);
      expect(inspector.getConflicts()).toHaveLength(0);
    });

    it('should return false when clearing non-existent conflict', () => {
      const inspector = createSyncInspector();
      const cleared = inspector.clearConflict('non-existent');
      expect(cleared).toBe(false);
    });
  });

  describe('sync history', () => {
    it('should record sync history entries', () => {
      const inspector = createSyncInspector();

      inspector.recordHistory({
        type: 'push',
        timestamp: Date.now(),
        changeCount: 5,
        success: true,
      });

      inspector.recordHistory({
        type: 'pull',
        timestamp: Date.now(),
        changeCount: 3,
        success: true,
      });

      const history = inspector.getSyncHistory();
      expect(history).toHaveLength(2);
      // Most recent first
      expect(history[0]!.type).toBe('pull');
    });

    it('should respect limit parameter', () => {
      const inspector = createSyncInspector();

      for (let i = 0; i < 10; i++) {
        inspector.recordHistory({
          type: 'push',
          timestamp: Date.now(),
          changeCount: i,
          success: true,
        });
      }

      const history = inspector.getSyncHistory(3);
      expect(history).toHaveLength(3);
    });
  });
});

describe('PerformanceProfiler', () => {
  let db: Database;
  let profiler: PerformanceProfiler;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-profiler-db',
      storage: createMemoryStorage(),
      collections: [{ name: 'users' }],
    });

    // Seed data
    const users = db.collection<UserDoc>('users');
    for (let i = 0; i < 10; i++) {
      await users.insert({ name: `User ${i}`, age: 20 + i, active: i % 2 === 0 });
    }

    profiler = createPerformanceProfiler(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('startProfiling / stopProfiling', () => {
    it('should start and stop profiling', () => {
      expect(profiler.isActive).toBe(false);

      profiler.startProfiling();
      expect(profiler.isActive).toBe(true);

      const profiles = profiler.stopProfiling();
      expect(profiler.isActive).toBe(false);
      expect(profiles).toEqual([]);
    });

    it('should clear previous profiles on start', () => {
      profiler.startProfiling();
      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 10,
        documentCount: 5,
        timestamp: Date.now(),
      });
      profiler.stopProfiling();

      // Starting again should clear
      profiler.startProfiling();
      const profiles = profiler.stopProfiling();
      expect(profiles).toEqual([]);
    });
  });

  describe('record', () => {
    it('should record profiles when profiling is active', () => {
      profiler.startProfiling();

      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 15,
        documentCount: 3,
        timestamp: Date.now(),
      });

      const profiles = profiler.stopProfiling();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.operation).toBe('query');
    });

    it('should NOT record profiles when profiling is inactive', () => {
      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 15,
        documentCount: 3,
        timestamp: Date.now(),
      });

      expect(profiler.getAllProfiles()).toEqual([]);
    });
  });

  describe('profileQuery', () => {
    it('should profile a query and return result', async () => {
      profiler.startProfiling();

      const { result, profile } = await profiler.profileQuery('users', {
        active: true,
      });

      expect(result.documents).toHaveLength(5);
      expect(result.totalCount).toBe(5);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      expect(profile.operation).toBe('query');
      expect(profile.collection).toBe('users');
      expect(profile.durationMs).toBeGreaterThanOrEqual(0);
      expect(profile.documentCount).toBe(5);

      const profiles = profiler.stopProfiling();
      expect(profiles).toHaveLength(1);
    });

    it('should work even when profiling is inactive (just not recorded)', async () => {
      const { result, profile } = await profiler.profileQuery('users', {});

      expect(result.documents).toHaveLength(10);
      expect(profile.operation).toBe('query');

      // Not recorded because profiling was not active
      expect(profiler.getAllProfiles()).toEqual([]);
    });
  });

  describe('getSlowQueries', () => {
    it('should return queries above threshold', () => {
      profiler.startProfiling();

      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 5,
        documentCount: 3,
        timestamp: Date.now(),
      });
      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 200,
        documentCount: 100,
        timestamp: Date.now(),
      });
      profiler.record({
        operation: 'query',
        collection: 'posts',
        durationMs: 150,
        documentCount: 50,
        timestamp: Date.now(),
      });

      const slow = profiler.getSlowQueries(100);
      expect(slow).toHaveLength(2);
      // Sorted by duration descending
      expect(slow[0]!.durationMs).toBe(200);
      expect(slow[1]!.durationMs).toBe(150);
    });

    it('should use default threshold of 100ms', () => {
      profiler.startProfiling();

      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 50,
        documentCount: 3,
        timestamp: Date.now(),
      });
      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 150,
        documentCount: 10,
        timestamp: Date.now(),
      });

      const slow = profiler.getSlowQueries();
      expect(slow).toHaveLength(1);
    });
  });

  describe('getOperationStats', () => {
    it('should compute aggregate statistics', () => {
      profiler.startProfiling();

      // Read operations
      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 10,
        documentCount: 5,
        timestamp: Date.now(),
      });
      profiler.record({
        operation: 'get',
        collection: 'users',
        durationMs: 2,
        documentCount: 1,
        timestamp: Date.now(),
      });

      // Write operations
      profiler.record({
        operation: 'insert',
        collection: 'users',
        durationMs: 5,
        documentCount: 1,
        timestamp: Date.now(),
      });
      profiler.record({
        operation: 'update',
        collection: 'users',
        durationMs: 3,
        documentCount: 1,
        timestamp: Date.now(),
      });
      profiler.record({
        operation: 'delete',
        collection: 'users',
        durationMs: 2,
        documentCount: 1,
        timestamp: Date.now(),
      });

      const stats = profiler.getOperationStats();

      expect(stats.reads).toBe(2);
      expect(stats.writes).toBe(3);
      expect(stats.avgReadMs).toBe(6); // (10 + 2) / 2
      expect(stats.avgWriteMs).toBeCloseTo(10 / 3); // (5 + 3 + 2) / 3
    });

    it('should handle empty profiles', () => {
      profiler.startProfiling();

      const stats = profiler.getOperationStats();

      expect(stats.reads).toBe(0);
      expect(stats.writes).toBe(0);
      expect(stats.avgReadMs).toBe(0);
      expect(stats.avgWriteMs).toBe(0);
    });
  });

  describe('clearProfiles', () => {
    it('should clear profiles without stopping profiling', () => {
      profiler.startProfiling();

      profiler.record({
        operation: 'query',
        collection: 'users',
        durationMs: 10,
        documentCount: 5,
        timestamp: Date.now(),
      });

      profiler.clearProfiles();

      expect(profiler.isActive).toBe(true);
      expect(profiler.getAllProfiles()).toEqual([]);
    });
  });
});

describe('Factory functions', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: 'test-factory-db',
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('createDatabaseInspector should return a DatabaseInspector', () => {
    const inspector = createDatabaseInspector(db);
    expect(inspector).toBeInstanceOf(DatabaseInspector);
  });

  it('createDocumentEditor should return a DocumentEditor', () => {
    const editor = createDocumentEditor(db);
    expect(editor).toBeInstanceOf(DocumentEditor);
    editor.destroy();
  });

  it('createSyncInspector should return a SyncInspector', () => {
    const inspector = createSyncInspector();
    expect(inspector).toBeInstanceOf(SyncInspector);
  });

  it('createPerformanceProfiler should return a PerformanceProfiler', () => {
    const profiler = createPerformanceProfiler(db);
    expect(profiler).toBeInstanceOf(PerformanceProfiler);
  });
});

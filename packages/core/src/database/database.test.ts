import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '../../../storage-memory/src/adapter.js';
import type { Document } from '../types/document.js';
import { Database, createDatabase } from './database.js';

interface TestDoc extends Document {
  _id: string;
  name: string;
  value?: number;
}

function createMemoryStorage() {
  return new MemoryStorageAdapter();
}

describe('Database', () => {
  let db: Database;

  afterEach(async () => {
    if (db?.isOpen) {
      await db.close();
    }
  });

  describe('Database.create()', () => {
    it('should create and initialize a database', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      expect(db).toBeInstanceOf(Database);
      expect(db.name).toBe('test-db');
      expect(db.isOpen).toBe(true);
    });

    it('should set default version to 1', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      expect(db.version).toBe(1);
    });

    it('should accept custom version', async () => {
      db = await Database.create({
        name: 'test-db',
        version: 3,
        storage: createMemoryStorage(),
      });

      expect(db.version).toBe(3);
    });

    it('should generate nodeId if not provided', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      expect(db.nodeId).toBeDefined();
      expect(db.nodeId.length).toBeGreaterThan(0);
    });

    it('should use custom nodeId when provided', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
        nodeId: 'custom-node',
      });

      expect(db.nodeId).toBe('custom-node');
    });

    it('should throw for unavailable storage adapter', async () => {
      const unavailableStorage = createMemoryStorage();
      unavailableStorage.isAvailable = () => false;

      await expect(
        Database.create({
          name: 'test-db',
          storage: unavailableStorage,
        })
      ).rejects.toThrow('not available');
    });

    it('should initialize pre-configured collections', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
        collections: [{ name: 'users' }, { name: 'todos' }],
      });

      expect(db.hasCollection('users')).toBe(true);
      expect(db.hasCollection('todos')).toBe(true);
    });
  });

  describe('createDatabase() factory', () => {
    it('should create database via factory function', async () => {
      db = await createDatabase({
        name: 'factory-db',
        storage: createMemoryStorage(),
      });

      expect(db).toBeInstanceOf(Database);
      expect(db.name).toBe('factory-db');
    });
  });

  describe('collection()', () => {
    beforeEach(async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
    });

    it('should create collection on-demand (lazy creation)', () => {
      const col = db.collection<TestDoc>('test');
      expect(col).toBeDefined();
    });

    it('should return same collection instance on subsequent calls', () => {
      const col1 = db.collection<TestDoc>('test');
      const col2 = db.collection<TestDoc>('test');
      expect(col1).toBe(col2);
    });

    it('should allow typed access', async () => {
      const col = db.collection<TestDoc>('test');
      await col.initialize();
      const doc = await col.insert({ name: 'Alice', value: 42 });

      expect(doc.name).toBe('Alice');
      expect(doc.value).toBe(42);
      expect(doc._id).toBeDefined();
    });

    it('should throw when accessing collection after close', async () => {
      await db.close();

      expect(() => db.collection('test')).toThrow('closed');
    });
  });

  describe('hasCollection()', () => {
    it('should return true for existing collection', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
        collections: [{ name: 'users' }],
      });

      expect(db.hasCollection('users')).toBe(true);
    });

    it('should return true after lazy collection creation', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      db.collection('newcol');
      expect(db.hasCollection('newcol')).toBe(true);
    });
  });

  describe('listCollections()', () => {
    it('should list all collections', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
        collections: [{ name: 'col1' }, { name: 'col2' }],
      });

      const collections = await db.listCollections();
      expect(collections).toContain('col1');
      expect(collections).toContain('col2');
    });
  });

  describe('deleteCollection()', () => {
    it('should delete collection and its data', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
        collections: [{ name: 'users' }],
      });

      const users = db.collection<TestDoc>('users');
      await users.insert({ name: 'Alice' });

      await db.deleteCollection('users');

      // Collection should be recreated as empty on access
      const newUsers = db.collection<TestDoc>('users');
      await newUsers.initialize();
      const docs = await newUsers.getAll();
      expect(docs).toHaveLength(0);
    });

    it('should throw when database is closed', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      await expect(db.deleteCollection('test')).rejects.toThrow('closed');
    });
  });

  describe('transaction()', () => {
    it('should execute transaction function', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      const result = await db.transaction(['test'], 'readwrite', async () => {
        return 'done';
      });

      expect(result).toBe('done');
    });

    it('should support readonly mode', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      const result = await db.transaction(['test'], 'readonly', async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should throw when database is closed', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      await expect(db.transaction(['test'], 'readonly', async () => 'x')).rejects.toThrow('closed');
    });
  });

  describe('getStats()', () => {
    it('should return database statistics', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
        collections: [{ name: 'users' }],
      });

      const stats = await db.getStats();

      expect(stats.databaseName).toBe('test-db');
      expect(stats.databaseVersion).toBe(1);
      expect(stats.collectionCount).toBe(1);
      expect(typeof stats.documentCount).toBe('number');
      expect(typeof stats.storageSize).toBe('number');
    });

    it('should throw when database is closed', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      await expect(db.getStats()).rejects.toThrow('closed');
    });
  });

  describe('close()', () => {
    it('should close the database', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      await db.close();

      expect(db.isOpen).toBe(false);
    });

    it('should be idempotent (safe to call twice)', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      await db.close();
      await db.close(); // Should not throw

      expect(db.isOpen).toBe(false);
    });
  });

  describe('isOpen', () => {
    it('should return true when initialized and not closed', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      expect(db.isOpen).toBe(true);
    });

    it('should return false after close', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      expect(db.isOpen).toBe(false);
    });
  });

  describe('ensureOpen edge cases', () => {
    it('should throw on collection() after close', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      expect(() => db.collection('test')).toThrow('closed');
    });

    it('should throw on deleteCollection() after close', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      await expect(db.deleteCollection('test')).rejects.toThrow('closed');
    });

    it('should throw on transaction() after close', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      await expect(db.transaction(['test'], 'readonly', async () => 'x')).rejects.toThrow('closed');
    });

    it('should throw on getStats() after close', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });
      await db.close();

      await expect(db.getStats()).rejects.toThrow('closed');
    });
  });

  describe('transaction error handling', () => {
    it('should propagate errors thrown inside transaction', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      await expect(
        db.transaction(['test'], 'readwrite', async () => {
          throw new Error('tx-error');
        })
      ).rejects.toThrow('tx-error');
    });

    it('should return value from successful transaction', async () => {
      db = await Database.create({
        name: 'test-db',
        storage: createMemoryStorage(),
      });

      const result = await db.transaction(['col'], 'readwrite', async () => {
        return { answer: 42 };
      });

      expect(result).toEqual({ answer: 42 });
    });
  });
});

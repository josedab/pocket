import { Database, createDatabase } from '../database/database.js';
import { createMemoryStorage } from '../../../storage-memory/src/adapter.js';
import type { Document } from '../types/document.js';

interface TestUser extends Document {
  _id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
}

describe('Database Lifecycle Integration', () => {
  let db: Database;

  afterEach(async () => {
    if (db?.isOpen) {
      await db.close();
    }
  });

  describe('full CRUD lifecycle', () => {
    beforeEach(async () => {
      db = await Database.create({
        name: 'lifecycle-test',
        storage: createMemoryStorage(),
      });
    });

    it('should create database and verify it is open', () => {
      expect(db.isOpen).toBe(true);
      expect(db.name).toBe('lifecycle-test');
    });

    it('should create a collection and insert documents', async () => {
      const users = db.collection<TestUser>('users');

      const alice = await users.insert({ name: 'Alice', email: 'alice@test.com', age: 30, active: true });
      expect(alice._id).toBeDefined();
      expect(alice.name).toBe('Alice');
      expect(alice._updatedAt).toBeDefined();

      const bob = await users.insert({ name: 'Bob', email: 'bob@test.com', age: 25, active: false });
      expect(bob._id).toBeDefined();
      expect(bob.name).toBe('Bob');
    });

    it('should query documents with filters', async () => {
      const users = db.collection<TestUser>('users');

      await users.insertMany([
        { name: 'Alice', email: 'alice@test.com', age: 30, active: true },
        { name: 'Bob', email: 'bob@test.com', age: 25, active: false },
        { name: 'Charlie', email: 'charlie@test.com', age: 35, active: true },
      ]);

      const activeUsers = await users.find({ active: true }).exec();
      expect(activeUsers).toHaveLength(2);
      expect(activeUsers.map((u) => u.name).sort()).toEqual(['Alice', 'Charlie']);

      const singleUser = await users.findOne({ name: 'Bob' });
      expect(singleUser).not.toBeNull();
      expect(singleUser!.age).toBe(25);
    });

    it('should update documents', async () => {
      const users = db.collection<TestUser>('users');

      const alice = await users.insert({ name: 'Alice', email: 'alice@test.com', age: 30, active: true });

      const updated = await users.update(alice._id, { age: 31, email: 'alice.new@test.com' });
      expect(updated.age).toBe(31);
      expect(updated.email).toBe('alice.new@test.com');
      expect(updated.name).toBe('Alice'); // unchanged

      const retrieved = await users.get(alice._id);
      expect(retrieved!.age).toBe(31);
    });

    it('should delete documents', async () => {
      const users = db.collection<TestUser>('users');

      const alice = await users.insert({ name: 'Alice', email: 'alice@test.com', age: 30, active: true });
      const bob = await users.insert({ name: 'Bob', email: 'bob@test.com', age: 25, active: false });

      await users.delete(alice._id);

      const deletedUser = await users.get(alice._id);
      expect(deletedUser).toBeNull();

      const remainingUser = await users.get(bob._id);
      expect(remainingUser).not.toBeNull();
      expect(remainingUser!.name).toBe('Bob');
    });

    it('should close database and prevent further operations', async () => {
      await db.close();
      expect(db.isOpen).toBe(false);

      expect(() => db.collection('users')).toThrow();
    });
  });

  describe('multiple collections', () => {
    beforeEach(async () => {
      db = await Database.create({
        name: 'multi-collection-test',
        storage: createMemoryStorage(),
      });
    });

    it('should isolate data between collections', async () => {
      const users = db.collection<TestUser>('users');
      const admins = db.collection<TestUser>('admins');

      await users.insert({ name: 'Alice', email: 'alice@test.com', age: 30, active: true });
      await admins.insert({ name: 'Admin', email: 'admin@test.com', age: 40, active: true });

      const allUsers = await users.getAll();
      const allAdmins = await admins.getAll();

      expect(allUsers).toHaveLength(1);
      expect(allAdmins).toHaveLength(1);
      expect(allUsers[0].name).toBe('Alice');
      expect(allAdmins[0].name).toBe('Admin');
    });

    it('should list collections', async () => {
      db.collection('users');
      db.collection('posts');

      const collections = await db.listCollections();
      expect(collections).toContain('users');
      expect(collections).toContain('posts');
    });

    it('should delete a collection', async () => {
      const users = db.collection<TestUser>('users');
      await users.insert({ name: 'Alice', email: 'a@t.com', age: 30, active: true });

      await db.deleteCollection('users');

      const collections = await db.listCollections();
      expect(collections).not.toContain('users');
    });
  });

  describe('no lingering state after close', () => {
    it('should have clean state with a new storage instance', async () => {
      const storage1 = createMemoryStorage();
      const db1 = await Database.create({ name: 'db1', storage: storage1 });

      const users1 = db1.collection<TestUser>('users');
      await users1.insert({ name: 'Alice', email: 'a@t.com', age: 30, active: true });
      await db1.close();

      // New storage = new state
      const storage2 = createMemoryStorage();
      const db2 = await Database.create({ name: 'db2', storage: storage2 });

      const users2 = db2.collection<TestUser>('users');
      const allUsers = await users2.getAll();
      expect(allUsers).toHaveLength(0);

      await db2.close();
    });
  });

  describe('database stats', () => {
    it('should return accurate stats', async () => {
      db = await Database.create({
        name: 'stats-test',
        storage: createMemoryStorage(),
      });

      const users = db.collection<TestUser>('users');
      await users.insertMany([
        { name: 'Alice', email: 'a@t.com', age: 30, active: true },
        { name: 'Bob', email: 'b@t.com', age: 25, active: false },
      ]);

      const stats = await db.getStats();
      expect(stats.databaseName).toBe('stats-test');
      expect(stats.documentCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createDatabase convenience function', () => {
    it('should create database using factory function', async () => {
      db = await createDatabase({
        name: 'factory-test',
        storage: createMemoryStorage(),
      });

      expect(db.isOpen).toBe(true);
      expect(db.name).toBe('factory-test');
    });
  });
});

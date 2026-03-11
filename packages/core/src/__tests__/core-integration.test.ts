/**
 * Integration tests: Core database ↔ Storage ↔ Reactive queries
 *
 * Tests the full lifecycle of database operations using in-memory storage,
 * verifying that inserts, updates, deletes, and live queries work together.
 */
import type { Document } from '@pocket/core';
import { Database } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface Todo extends Document {
  title: string;
  completed: boolean;
  priority?: number;
}

describe('Core ↔ Storage integration', () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create({
      name: `test-db-${Date.now()}`,
      storage: createMemoryStorage(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('CRUD lifecycle', () => {
    it('should insert and retrieve a document', async () => {
      const todos = db.collection<Todo>('todos');
      const doc = await todos.insert({ title: 'Buy groceries', completed: false });

      expect(doc._id).toBeDefined();
      expect(doc.title).toBe('Buy groceries');
      expect(doc.completed).toBe(false);

      const retrieved = await todos.get(doc._id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Buy groceries');
    });

    it('should insert multiple documents', async () => {
      const todos = db.collection<Todo>('todos');
      const docs = await todos.insertMany([
        { title: 'Task 1', completed: false },
        { title: 'Task 2', completed: true },
        { title: 'Task 3', completed: false },
      ]);

      expect(docs).toHaveLength(3);
      const all = await todos.find().exec();
      expect(all).toHaveLength(3);
    });

    it('should update a document', async () => {
      const todos = db.collection<Todo>('todos');
      const doc = await todos.insert({ title: 'Original', completed: false });

      const updated = await todos.update(doc._id, { completed: true });
      expect(updated.completed).toBe(true);
      expect(updated.title).toBe('Original');

      const retrieved = await todos.get(doc._id);
      expect(retrieved!.completed).toBe(true);
    });

    it('should delete a document', async () => {
      const todos = db.collection<Todo>('todos');
      const doc = await todos.insert({ title: 'To delete', completed: false });

      await todos.delete(doc._id);
      const retrieved = await todos.get(doc._id);
      expect(retrieved).toBeNull();
    });

    it('should upsert — insert when missing, update when exists', async () => {
      const todos = db.collection<Todo>('todos');

      const created = await todos.upsert('upsert-1', { title: 'Created', completed: false });
      expect(created.title).toBe('Created');

      const updated = await todos.upsert('upsert-1', { title: 'Updated', completed: true });
      expect(updated.title).toBe('Updated');
      expect(updated.completed).toBe(true);

      const all = await todos.find().exec();
      expect(all).toHaveLength(1);
    });
  });

  describe('query operations', () => {
    it('should filter documents with find()', async () => {
      const todos = db.collection<Todo>('todos');
      await todos.insertMany([
        { title: 'Active 1', completed: false },
        { title: 'Done 1', completed: true },
        { title: 'Active 2', completed: false },
      ]);

      const active = await todos.find({ completed: false }).exec();
      expect(active).toHaveLength(2);
      expect(active.every((t) => !t.completed)).toBe(true);
    });

    it('should sort documents', async () => {
      const todos = db.collection<Todo>('todos');
      await todos.insertMany([
        { title: 'C', completed: false, priority: 3 },
        { title: 'A', completed: false, priority: 1 },
        { title: 'B', completed: false, priority: 2 },
      ]);

      const sorted = await todos.find().sort('priority', 'asc').exec();
      expect(sorted[0]!.title).toBe('A');
      expect(sorted[1]!.title).toBe('B');
      expect(sorted[2]!.title).toBe('C');
    });

    it('should limit and skip results', async () => {
      const todos = db.collection<Todo>('todos');
      for (let i = 0; i < 10; i++) {
        await todos.insert({ title: `Task ${i}`, completed: false, priority: i });
      }

      const page = await todos.find().sort('priority', 'asc').skip(3).limit(3).exec();
      expect(page).toHaveLength(3);
      expect(page[0]!.title).toBe('Task 3');
    });

    it('should count documents', async () => {
      const todos = db.collection<Todo>('todos');
      await todos.insertMany([
        { title: 'A', completed: false },
        { title: 'B', completed: true },
        { title: 'C', completed: false },
      ]);

      const total = await todos.count();
      expect(total).toBe(3);
    });
  });

  describe('reactive queries (live)', () => {
    it('should emit initial results via live query', async () => {
      const todos = db.collection<Todo>('todos');
      await todos.insert({ title: 'Existing', completed: false });

      // Live queries may emit empty first then populate; wait for non-empty
      const results = await new Promise<Todo[]>((resolve) => {
        const sub = todos
          .find()
          .live()
          .subscribe((docs) => {
            if (docs.length > 0) {
              sub.unsubscribe();
              resolve(docs);
            }
          });
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Existing');
    });

    it('should update live query when document is inserted', async () => {
      const todos = db.collection<Todo>('todos');

      const emissions: Todo[][] = [];
      const sub = todos
        .find()
        .live()
        .subscribe((docs) => {
          emissions.push([...docs]);
        });

      // Wait for initial emission
      await new Promise((r) => setTimeout(r, 50));

      await todos.insert({ title: 'New task', completed: false });
      await new Promise((r) => setTimeout(r, 100));

      sub.unsubscribe();

      // Should have at least initial (empty) + after insert
      expect(emissions.length).toBeGreaterThanOrEqual(2);
      const last = emissions[emissions.length - 1]!;
      expect(last.some((t) => t.title === 'New task')).toBe(true);
    });

    it('should update live query when document is deleted', async () => {
      const todos = db.collection<Todo>('todos');
      const doc = await todos.insert({ title: 'Will delete', completed: false });

      const emissions: Todo[][] = [];
      const sub = todos
        .find()
        .live()
        .subscribe((docs) => {
          emissions.push([...docs]);
        });

      await new Promise((r) => setTimeout(r, 50));
      await todos.delete(doc._id);
      await new Promise((r) => setTimeout(r, 100));

      sub.unsubscribe();

      const last = emissions[emissions.length - 1]!;
      expect(last).toHaveLength(0);
    });
  });

  describe('multiple collections', () => {
    it('should support independent collections in same database', async () => {
      const todos = db.collection<Todo>('todos');
      const notes = db.collection('notes');

      await todos.insert({ title: 'Todo', completed: false });
      await notes.insert({ title: 'Note', content: 'Hello' } as Record<string, unknown>);

      const todoCount = await todos.count();
      const noteCount = await notes.count();

      expect(todoCount).toBe(1);
      expect(noteCount).toBe(1);
    });

    it('should list collections', async () => {
      db.collection('alpha');
      db.collection('beta');
      db.collection('gamma');

      const collections = await db.listCollections();
      expect(collections).toContain('alpha');
      expect(collections).toContain('beta');
      expect(collections).toContain('gamma');
    });
  });

  describe('database lifecycle', () => {
    it('should report database as open', () => {
      expect(db.isOpen).toBe(true);
    });

    it('should have a name', () => {
      expect(db.name).toContain('test-db');
    });

    it('should have a nodeId', () => {
      expect(db.nodeId).toBeDefined();
      expect(typeof db.nodeId).toBe('string');
    });

    it('should return stats', async () => {
      const stats = await db.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.documentCount).toBe('number');
    });
  });
});

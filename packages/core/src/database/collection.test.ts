import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '../../../storage-memory/src/adapter.js';
import type { CollectionConfig } from '../schema/schema.js';
import type { ChangeEvent, Document } from '../types/document.js';
import { Collection, ValidationError } from './collection.js';

function createMemoryStorage() {
  return new MemoryStorageAdapter();
}

interface Todo extends Document {
  _id: string;
  title: string;
  completed: boolean;
  priority?: number;
}

describe('Collection', () => {
  let collection: Collection<Todo>;

  beforeEach(async () => {
    const storage = createMemoryStorage();
    await storage.initialize({ name: 'test' });
    const store = storage.getStore<Todo>('todos');

    const config: CollectionConfig<Todo> = {
      name: 'todos',
    };
    collection = new Collection<Todo>(config, store, 'test-node');
    await collection.initialize();
  });

  describe('CRUD operations', () => {
    describe('insert', () => {
      it('should insert a new document', async () => {
        const doc = await collection.insert({
          title: 'Buy groceries',
          completed: false,
        });

        expect(doc._id).toBeDefined();
        expect(doc.title).toBe('Buy groceries');
        expect(doc.completed).toBe(false);
        expect(doc._rev).toBeDefined();
        expect(doc._updatedAt).toBeDefined();
      });

      it('should allow custom _id', async () => {
        const doc = await collection.insert({
          _id: 'custom-id',
          title: 'Custom task',
          completed: false,
        });

        expect(doc._id).toBe('custom-id');
      });

      it('should emit insert change event', async () => {
        const events: ChangeEvent<Todo>[] = [];
        collection.changes().subscribe((e) => events.push(e));

        await collection.insert({
          title: 'Test task',
          completed: false,
        });

        expect(events).toHaveLength(1);
        expect(events[0].operation).toBe('insert');
        expect(events[0].document?.title).toBe('Test task');
      });
    });

    describe('insertMany', () => {
      it('should insert multiple documents', async () => {
        const docs = await collection.insertMany([
          { title: 'Task 1', completed: false },
          { title: 'Task 2', completed: true },
        ]);

        expect(docs).toHaveLength(2);
        expect(docs[0].title).toBe('Task 1');
        expect(docs[1].title).toBe('Task 2');
      });

      it('should emit change events for each document', async () => {
        const events: ChangeEvent<Todo>[] = [];
        collection.changes().subscribe((e) => events.push(e));

        await collection.insertMany([
          { title: 'Task 1', completed: false },
          { title: 'Task 2', completed: true },
        ]);

        expect(events).toHaveLength(2);
      });
    });

    describe('get', () => {
      it('should return document by id', async () => {
        const inserted = await collection.insert({
          title: 'Test',
          completed: false,
        });

        const doc = await collection.get(inserted._id);

        expect(doc).not.toBeNull();
        expect(doc?._id).toBe(inserted._id);
        expect(doc?.title).toBe('Test');
      });

      it('should return null for non-existent id', async () => {
        const doc = await collection.get('non-existent');
        expect(doc).toBeNull();
      });

      it('should return null for deleted documents', async () => {
        const inserted = await collection.insert({
          title: 'Test',
          completed: false,
        });

        await collection.delete(inserted._id);

        const doc = await collection.get(inserted._id);
        expect(doc).toBeNull();
      });
    });

    describe('getMany', () => {
      it('should return multiple documents by ids', async () => {
        const doc1 = await collection.insert({ title: 'Task 1', completed: false });
        const doc2 = await collection.insert({ title: 'Task 2', completed: true });

        const docs = await collection.getMany([doc1._id, doc2._id]);

        expect(docs).toHaveLength(2);
        expect(docs[0]?._id).toBe(doc1._id);
        expect(docs[1]?._id).toBe(doc2._id);
      });

      it('should return null for non-existent ids', async () => {
        const doc1 = await collection.insert({ title: 'Task 1', completed: false });

        const docs = await collection.getMany([doc1._id, 'non-existent']);

        expect(docs[0]?._id).toBe(doc1._id);
        expect(docs[1]).toBeNull();
      });
    });

    describe('getAll', () => {
      it('should return all documents', async () => {
        await collection.insert({ title: 'Task 1', completed: false });
        await collection.insert({ title: 'Task 2', completed: true });

        const docs = await collection.getAll();

        expect(docs).toHaveLength(2);
      });

      it('should exclude deleted documents', async () => {
        const doc = await collection.insert({ title: 'Task 1', completed: false });
        await collection.insert({ title: 'Task 2', completed: true });
        await collection.delete(doc._id);

        const docs = await collection.getAll();

        expect(docs).toHaveLength(1);
      });
    });

    describe('update', () => {
      it('should update a document', async () => {
        const inserted = await collection.insert({
          title: 'Original',
          completed: false,
        });

        const updated = await collection.update(inserted._id, {
          title: 'Updated',
        });

        expect(updated.title).toBe('Updated');
        expect(updated.completed).toBe(false);
        expect(updated._rev).not.toBe(inserted._rev);
      });

      it('should emit update change event', async () => {
        const inserted = await collection.insert({
          title: 'Original',
          completed: false,
        });

        const events: ChangeEvent<Todo>[] = [];
        collection.changes().subscribe((e) => events.push(e));

        await collection.update(inserted._id, { title: 'Updated' });

        expect(events).toHaveLength(1);
        expect(events[0].operation).toBe('update');
        expect(events[0].document?.title).toBe('Updated');
        expect(events[0].previousDocument?.title).toBe('Original');
      });

      it('should throw error for non-existent document', async () => {
        await expect(collection.update('non-existent', { title: 'Test' })).rejects.toThrow(
          'Document with id "non-existent" not found'
        );
      });

      it('should throw error for deleted document', async () => {
        const inserted = await collection.insert({
          title: 'Test',
          completed: false,
        });
        await collection.delete(inserted._id);

        // Without sync enabled, delete is a hard delete, so document is not found
        await expect(collection.update(inserted._id, { title: 'Test' })).rejects.toThrow(
          'not found'
        );
      });
    });

    describe('upsert', () => {
      it('should insert if document does not exist', async () => {
        const doc = await collection.upsert('new-id', {
          title: 'New task',
          completed: false,
        });

        expect(doc._id).toBe('new-id');
        expect(doc.title).toBe('New task');
      });

      it('should update if document exists', async () => {
        await collection.insert({
          _id: 'existing-id',
          title: 'Original',
          completed: false,
        });

        const doc = await collection.upsert('existing-id', {
          title: 'Updated',
        });

        expect(doc._id).toBe('existing-id');
        expect(doc.title).toBe('Updated');
      });
    });

    describe('delete', () => {
      it('should delete a document', async () => {
        const inserted = await collection.insert({
          title: 'Test',
          completed: false,
        });

        await collection.delete(inserted._id);

        const doc = await collection.get(inserted._id);
        expect(doc).toBeNull();
      });

      it('should emit delete change event', async () => {
        const inserted = await collection.insert({
          title: 'Test',
          completed: false,
        });

        const events: ChangeEvent<Todo>[] = [];
        collection.changes().subscribe((e) => events.push(e));

        await collection.delete(inserted._id);

        expect(events).toHaveLength(1);
        expect(events[0].operation).toBe('delete');
        expect(events[0].documentId).toBe(inserted._id);
        expect(events[0].previousDocument?.title).toBe('Test');
      });

      it('should not throw for non-existent document', async () => {
        await expect(collection.delete('non-existent')).resolves.not.toThrow();
      });
    });

    describe('deleteMany', () => {
      it('should delete multiple documents', async () => {
        const doc1 = await collection.insert({ title: 'Task 1', completed: false });
        const doc2 = await collection.insert({ title: 'Task 2', completed: true });

        await collection.deleteMany([doc1._id, doc2._id]);

        const docs = await collection.getAll();
        expect(docs).toHaveLength(0);
      });
    });
  });

  describe('querying', () => {
    beforeEach(async () => {
      await collection.insertMany([
        { title: 'Task 1', completed: false, priority: 1 },
        { title: 'Task 2', completed: true, priority: 2 },
        { title: 'Task 3', completed: false, priority: 3 },
      ]);
    });

    describe('find', () => {
      it('should return all documents with empty filter', async () => {
        const docs = await collection.find().exec();
        expect(docs).toHaveLength(3);
      });

      it('should filter documents', async () => {
        const docs = await collection.find({ completed: false }).exec();
        expect(docs).toHaveLength(2);
      });

      it('should support chained where clauses', async () => {
        const docs = await collection.find().where('completed').equals(false).exec();
        expect(docs).toHaveLength(2);
      });

      it('should support comparison operators', async () => {
        const docs = await collection.find().where('priority').greaterThan(1).exec();
        expect(docs).toHaveLength(2);
      });

      it('should support sorting', async () => {
        const docs = await collection.find().sort('priority', 'desc').exec();
        expect(docs[0].priority).toBe(3);
        expect(docs[2].priority).toBe(1);
      });

      it('should support limit', async () => {
        const docs = await collection.find().limit(2).exec();
        expect(docs).toHaveLength(2);
      });

      it('should support skip', async () => {
        const docs = await collection.find().sort('priority', 'asc').skip(1).exec();
        expect(docs).toHaveLength(2);
        expect(docs[0].priority).toBe(2);
      });
    });

    describe('findOne', () => {
      it('should return single matching document', async () => {
        const doc = await collection.findOne({ completed: true });
        expect(doc).not.toBeNull();
        expect(doc?.title).toBe('Task 2');
      });

      it('should return null when no match', async () => {
        const doc = await collection.findOne({ priority: 10 });
        expect(doc).toBeNull();
      });
    });

    describe('count', () => {
      it('should return total count without filter', async () => {
        const count = await collection.count();
        expect(count).toBe(3);
      });

      it('should return filtered count', async () => {
        const count = await collection.count({ completed: false });
        expect(count).toBe(2);
      });
    });
  });

  describe('observeById', () => {
    it('should emit initial value', async () => {
      const doc = await collection.insert({
        title: 'Observable task',
        completed: false,
      });

      const values: (Todo | null)[] = [];
      const subscription = collection.observeById(doc._id).subscribe((v) => values.push(v));

      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(values.length).toBeGreaterThan(0);
      expect(values[values.length - 1]?.title).toBe('Observable task');

      subscription.unsubscribe();
    });

    it('should emit updates', async () => {
      const doc = await collection.insert({
        title: 'Original',
        completed: false,
      });

      const values: (Todo | null)[] = [];
      const subscription = collection.observeById(doc._id).subscribe((v) => values.push(v));

      await new Promise((resolve) => setTimeout(resolve, 10));

      await collection.update(doc._id, { title: 'Updated' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const lastValue = values[values.length - 1];
      expect(lastValue?.title).toBe('Updated');

      subscription.unsubscribe();
    });
  });

  describe('indexes', () => {
    it('should create an index', async () => {
      await collection.createIndex({ fields: ['completed'] });

      const indexes = await collection.getIndexes();
      expect(indexes.some((i) => i.fields.some((f) => f.field === 'completed'))).toBe(true);
    });

    it('should drop an index', async () => {
      await collection.createIndex({ name: 'completed-idx', fields: ['completed'] });
      await collection.dropIndex('completed-idx');

      const indexes = await collection.getIndexes();
      expect(indexes.some((i) => i.name === 'completed-idx')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all documents', async () => {
      await collection.insertMany([
        { title: 'Task 1', completed: false },
        { title: 'Task 2', completed: true },
      ]);

      await collection.clear();

      const docs = await collection.getAll();
      expect(docs).toHaveLength(0);
    });

    it('should emit delete events for all documents', async () => {
      await collection.insertMany([
        { title: 'Task 1', completed: false },
        { title: 'Task 2', completed: true },
      ]);

      const events: ChangeEvent<Todo>[] = [];
      collection.changes().subscribe((e) => events.push(e));

      await collection.clear();

      const deleteEvents = events.filter((e) => e.operation === 'delete');
      expect(deleteEvents).toHaveLength(2);
    });
  });
});

describe('Collection with schema', () => {
  let collection: Collection<Todo>;

  beforeEach(async () => {
    const storage = createMemoryStorage();
    await storage.initialize({ name: 'test' });
    const store = storage.getStore<Todo>('todos');

    const config: CollectionConfig<Todo> = {
      name: 'todos',
      schema: {
        properties: {
          title: { type: 'string', required: true, min: 1 },
          completed: { type: 'boolean', default: false },
          priority: { type: 'number' },
        },
      },
    };
    collection = new Collection<Todo>(config, store, 'test-node');
    await collection.initialize();
  });

  it('should apply defaults on insert', async () => {
    const doc = await collection.insert({
      title: 'Test task',
    } as any);

    expect(doc.completed).toBe(false);
  });

  it('should validate on insert', async () => {
    await expect(collection.insert({} as any)).rejects.toThrow(ValidationError);
  });

  it('should validate on update', async () => {
    const doc = await collection.insert({
      title: 'Test',
      completed: false,
    });

    await expect(collection.update(doc._id, { title: '' } as any)).rejects.toThrow(ValidationError);
  });
});

describe('Collection with sync enabled', () => {
  let collection: Collection<Todo>;

  beforeEach(async () => {
    const storage = createMemoryStorage();
    await storage.initialize({ name: 'test' });
    const store = storage.getStore<Todo>('todos');

    const config: CollectionConfig<Todo> = {
      name: 'todos',
      sync: true,
    };
    collection = new Collection<Todo>(config, store, 'test-node');
    await collection.initialize();
  });

  it('should soft delete when sync is enabled', async () => {
    const doc = await collection.insert({
      title: 'Test',
      completed: false,
    });

    await collection.delete(doc._id);

    // Document should still exist in storage but marked as deleted
    const all = await collection.getAll();
    expect(all).toHaveLength(0);
  });

  it('should throw "has been deleted" when updating soft-deleted document', async () => {
    const doc = await collection.insert({
      title: 'Test',
      completed: false,
    });

    await collection.delete(doc._id);

    // With sync enabled, document is soft-deleted, so we get "has been deleted" error
    await expect(collection.update(doc._id, { title: 'Updated' })).rejects.toThrow(
      'has been deleted'
    );
  });
});

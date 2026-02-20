/**
 * CRUD benchmarks for Pocket database using vitest bench API
 *
 * Uses module-level top-level await for initialization because
 * vitest bench does not reliably execute beforeAll/beforeEach hooks.
 */

import { bench, describe } from 'vitest';
import { createDatabase } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';

interface TestDoc {
  _id: string;
  _rev: string;
  name: string;
  email: string;
  age: number;
}

function generateDoc(i: number): { name: string; email: string; age: number } {
  return {
    name: `User ${i}`,
    email: `user${i}@example.com`,
    age: 20 + (i % 50),
  };
}

function generateDocs(count: number): Array<{ name: string; email: string; age: number }> {
  return Array.from({ length: count }, (_, i) => generateDoc(i));
}

// Module-level initialization
const insertDb = await createDatabase({ name: 'bench-crud-insert', storage: createMemoryStorage() });

const readDb = await createDatabase({ name: 'bench-crud-read', storage: createMemoryStorage() });
const readCollection = readDb.collection<TestDoc>('users');
const readDocs = await readCollection.insertMany(generateDocs(1000));
const readDocIds = readDocs.map((d) => d._id);

const updateDb = await createDatabase({ name: 'bench-crud-update', storage: createMemoryStorage() });
const updateCollection = updateDb.collection<TestDoc>('users');
const updateDocs = await updateCollection.insertMany(generateDocs(1000));
const updateDocIds = updateDocs.map((d) => d._id);

const deleteDb = await createDatabase({ name: 'bench-crud-delete', storage: createMemoryStorage() });
const deleteCollection = deleteDb.collection<TestDoc>('users');
await deleteCollection.insertMany(generateDocs(10000));
const deleteSnapshot = await deleteCollection.find().exec();
const deleteDocIds = deleteSnapshot.map((d) => d._id);

let insertCounter = 0;
let bulkCounter = 0;
let readIdx = 0;
let updateIdx = 0;
let deleteIdx = 0;

describe('CRUD Operations', () => {
  describe('Insert', () => {
    bench('single insert', async () => {
      const collection = insertDb.collection<TestDoc>('insert-single');
      await collection.insert(generateDoc(insertCounter++));
    });

    bench('bulk insert 100', async () => {
      const collection = insertDb.collection<TestDoc>(`insert-bulk-100-${bulkCounter++}`);
      await collection.insertMany(generateDocs(100));
    });

    bench('bulk insert 1000', async () => {
      const collection = insertDb.collection<TestDoc>(`insert-bulk-1000-${bulkCounter++}`);
      await collection.insertMany(generateDocs(1000));
    });
  });

  describe('Read', () => {
    bench('get by id', async () => {
      await readCollection.get(readDocIds[readIdx++ % readDocIds.length]!);
    });
  });

  describe('Update', () => {
    bench('update single', async () => {
      const id = updateDocIds[updateIdx++ % updateDocIds.length]!;
      await updateCollection.update(id, { age: 25 + (updateIdx % 50) });
    });
  });

  describe('Delete', () => {
    bench('delete single', async () => {
      const id = deleteDocIds[deleteIdx++ % deleteDocIds.length];
      if (id) {
        await deleteCollection.delete(id);
      }
    });
  });
});

/**
 * Query benchmarks for Pocket database using vitest bench API
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

function generateDocs(count: number): Array<{ name: string; email: string; age: number }> {
  return Array.from({ length: count }, (_, i) => ({
    name: `User ${i}`,
    email: `user${i}@example.com`,
    age: 20 + (i % 50),
  }));
}

// Module-level initialization
const db100 = await createDatabase({ name: 'bench-query-100', storage: createMemoryStorage() });
const col100 = db100.collection<TestDoc>('users');
await col100.insertMany(generateDocs(100));

const db1000 = await createDatabase({ name: 'bench-query-1000', storage: createMemoryStorage() });
const col1000 = db1000.collection<TestDoc>('users');
await col1000.insertMany(generateDocs(1000));

describe('Query Operations', () => {
  describe('100-doc collection', () => {
    bench('find all (100 docs)', async () => {
      await col100.find().exec();
    });

    bench('find with filter (100 docs)', async () => {
      await col100.find().where('age').equals(30).exec();
    });

    bench('find with sort (100 docs)', async () => {
      await col100.find().sort('age', 'desc').exec();
    });
  });

  describe('1000-doc collection', () => {
    bench('find with limit (1000 docs)', async () => {
      await col1000.find().limit(10).exec();
    });

    bench('count documents', async () => {
      await col1000.count();
    });
  });
});
